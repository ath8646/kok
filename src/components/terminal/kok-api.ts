// 터미널의 setting(KOK 관리 모드)이 쓰는 데이터 길: 앱의 다른 화면과 같은 길로만 읽고 쓴다
// (브라우저 Supabase 는 RLS·칸 단위 GRANT 가 내 것만 허락하고, 지우기·옮기기·합치기는 서버 API).
// 쓰기는 sb()·api() 를 거쳐서 기억해 둔 화면(view-cache)도 옛것이 된다.
import { perkTierName } from '@/lib/plans';
import { api } from '@/components/ui';
import { zNote } from '@/lib/ai/schemas';
import { deleteSession, fetchAll, fetchPlanData, fetchQuestionsByIds, fetchSubjects, sb, topLevelSources } from '@/lib/data';
import { SOURCES_CHANGED, SUBJECTS_CHANGED } from '@/lib/events';
import { BULK_MAX } from '@/lib/library-order';
import { pickToday } from '@/lib/review-plan';
import { plainMathText, previewText } from '@/lib/richtext';
import { SUBJECT_COLORS, readUserSettings, type UserSettings } from '@/lib/settings';
import { texToText } from '@/lib/tex-text';
import { SettingError, type KConfig, type KNote, type KQuestion, type KSubject, type KWrong, type KokApi } from '@/lib/term/setting';
import type { MeResponse } from '@/lib/types';

type Features = MeResponse['features'];

/** config 로 보고 바꿀 수 있는 설정 (설정 화면의 이름과 같게) */
type ConfigDef = {
  key: string;
  label: string;
  kind: 'bool' | 'int' | 'percent' | 'enum';
  min?: number;
  max?: number;
  values?: string[];
  /** 이 혜택이 있어야 바꿀 수 있다 (lib/plans.ts) */
  perk?: 'figures' | 'cover';
  /** DB 에 칸이 있어야 보인다 */
  feature?: keyof Features;
};

const CONFIG: ConfigDef[] = [
  { key: 'review.dailyMax', label: '하루 최대 문제 수 (10~500)', kind: 'int', min: 10, max: 500 },
  { key: 'review.retention', label: '목표 기억률 % (80~95)', kind: 'percent', min: 80, max: 95 },
  { key: 'review.interleave', label: '여러 과목 섞어 풀기', kind: 'bool' },
  { key: 'review.aiShortGrade', label: '단답형은 AI가 같은 뜻까지 채점', kind: 'bool' },
  { key: 'review.minutes', label: '복습 시간 (5·15·30분)', kind: 'enum', values: ['5', '15', '30'] },
  { key: 'quiz.language', label: '문제 언어 (ko: 한국어, material: 자료의 언어)', kind: 'enum', values: ['ko', 'material'] },
  { key: 'quiz.sourceFigures', label: '자료의 그림으로 문제 만들기', kind: 'bool', feature: 'sourceFigures' },
  { key: 'quiz.figures', label: '필요한 문제에 그림과 단계 풀이 붙이기', kind: 'bool', perk: 'figures', feature: 'figures' },
  { key: 'visual.autoCover', label: '자료를 넣으면 표지 그림 그리기', kind: 'bool', perk: 'cover', feature: 'covers' },
  { key: 'visual.icons', label: '마인드맵 그림 기호(이모지) 보이기', kind: 'bool' },
  { key: 'chat.allowQuestions', label: "채팅에서 '문제로 넣어 줘'", kind: 'bool', feature: 'chat' },
  { key: 'chat.allowNote', label: "채팅에서 '노트에 넣어 줘'", kind: 'bool', feature: 'chat' },
  { key: 'notify.done', label: '완료 알림 보이기', kind: 'bool' },
  { key: 'note.importance', label: '개념 카드에 AI가 정한 중요도 보이기 (꼭 외우기·중요·참고)', kind: 'bool' },
  { key: 'theme.motion', label: '시그니처 테마 움직임', kind: 'bool' },
];

const ON = /^(on|true|1|yes|y|켬|켜기|예)$/i;
const OFF = /^(off|false|0|no|n|끔|끄기|아니요)$/i;

type Section = Record<string, unknown>;

function getPath(s: UserSettings, key: string): unknown {
  const [sec, name] = key.split('.');
  return ((s as unknown as Record<string, Section>)[sec] ?? {})[name];
}

function shown(def: ConfigDef, v: unknown): string {
  if (def.kind === 'bool') return v ? 'on' : 'off';
  if (def.kind === 'percent') return String(Math.round(Number(v) * 100));
  return String(v);
}

/** 글 → 저장할 값 (틀리면 SettingError) */
function parseValue(def: ConfigDef, raw: string): unknown {
  const v = raw.trim();
  if (def.kind === 'bool') {
    if (ON.test(v)) return true;
    if (OFF.test(v)) return false;
    throw new SettingError(`config: ${def.key} 는 on 이나 off 로 적어 주세요`);
  }
  if (def.kind === 'enum') {
    if (!def.values!.includes(v)) throw new SettingError(`config: ${def.key} 는 ${def.values!.join(' · ')} 가운데 하나예요`);
    return /^\d+$/.test(v) ? Number(v) : v;
  }
  const n = Number(v.replace(/%$/, ''));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < def.min! || n > def.max!) {
    throw new SettingError(`config: ${def.key} 는 ${def.min}~${def.max} 사이의 정수로 적어 주세요`);
  }
  return def.kind === 'percent' ? n / 100 : n;
}

const chunks = <T>(list: T[], n = BULK_MAX): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

async function check<T extends { error: unknown }>(p: PromiseLike<T>): Promise<T> {
  const r = await p;
  if (r.error) throw r.error;
  return r;
}

type SourceRow = {
  id: string;
  subject_id: string;
  kind: KNote['kind'];
  title: string | null;
  unit: string | null;
  status: string;
  progress: number | null;
  created_at: string;
  page_count: number | null;
  in_review?: boolean | null;
  starred?: boolean | null;
};

export function makeKokApi(me: MeResponse, refreshMe: () => Promise<void>): KokApi {
  const f = me.features;
  let settings = readUserSettings(me.settings);
  const sourcesChanged = () => window.dispatchEvent(new Event(SOURCES_CHANGED));
  const subjectsChanged = () => window.dispatchEvent(new Event(SUBJECTS_CHANGED));
  const visibleConfig = () => CONFIG.filter((d) => !d.feature || f[d.feature]);

  const noteIdOf = async (sourceId: string): Promise<string | null> => {
    const { data } = await check(sb().from('notes').select('id').eq('source_id', sourceId).maybeSingle());
    return (data as { id: string } | null)?.id ?? null;
  };

  return {
    features: { organize: f.organize, merge: f.merge, subjectDrawer: f.subjectDrawer, sessions: f.sessions },

    async load() {
      const cols = `id, subject_id, kind, title, unit, status, progress, created_at, page_count${f.organize ? ', in_review, starred' : ''}`;
      const [subjects, rows] = await Promise.all([
        fetchSubjects(),
        fetchAll<SourceRow>((a, b) =>
          topLevelSources<SourceRow[]>((onlyTop) => {
            let q = sb().from('sources').select(cols);
            if (onlyTop) q = q.is('parent_id', null);
            return q.order('created_at', { ascending: false }).order('id').range(a, b) as unknown as PromiseLike<{ data: SourceRow[] | null; error: unknown }>;
          }),
        ),
      ]);
      return {
        subjects: subjects.map((s): KSubject => ({
          id: s.id,
          name: s.name,
          color: s.color,
          pinned: !!s.pinned,
          archived: !!s.archived,
          position: s.position ?? 0,
        })),
        notes: rows.map((r): KNote => ({
          id: r.id,
          title: r.title ?? '',
          subject_id: r.subject_id,
          kind: r.kind,
          status: r.status,
          progress: r.progress ?? 0,
          starred: r.starred === true,
          in_review: r.in_review !== false,
          created_at: r.created_at,
          unit: r.unit ?? '',
          page_count: r.page_count,
        })),
      };
    },

    async noteBody(sourceId) {
      const { data } = await check(sb().from('notes').select('title, body').eq('source_id', sourceId).maybeSingle());
      const row = data as { title: string | null; body: unknown } | null;
      if (!row) return null;
      const n = zNote.parse(row.body ?? {});
      // 꾸미기 기호는 빼고 수식은 읽을 수 있는 글자로 (줄은 그대로)
      const text = (s: string) =>
        plainMathText(s)
          .replace(/\*\*|`/g, '')
          .trim();
      return {
        title: previewText(row.title || n.title),
        summary: text(n.summary),
        key_points: n.key_points.map((k) => ({
          title: previewText(k.title),
          explanation: text(k.explanation),
          importance: k.importance,
          starred: k.starred === true,
        })),
        terms: n.terms.map((t) => ({ term: previewText(t.term), meaning: text(t.meaning) })),
        formulas: n.formulas.map((x) => ({ latex: texToText(x.latex), label: previewText(x.label) })),
      };
    },

    async questions(sourceId) {
      const noteId = await noteIdOf(sourceId);
      if (!noteId) return { versions: false, list: [] };
      type Q = { id: string; type: string; prompt: string; status: string };
      type Card = { question_id: string; due: string; state: number; reps: number; lapses: number; wrong_count: number | null; in_wrong_note: boolean };
      const qs = await fetchAll<Q>(
        (a, b) =>
          sb()
            .from('questions')
            .select('id, type, prompt, status')
            .eq('note_id', noteId)
            .order('created_at')
            .order('id')
            .range(a, b) as unknown as PromiseLike<{
            data: Q[] | null;
            error: unknown;
          }>,
      );
      const cards = new Map<string, Card>();
      for (const part of chunks(qs.map((q) => q.id))) {
        const { data } = await check(sb().from('cards').select('question_id, due, state, reps, lapses, wrong_count, in_wrong_note').in('question_id', part));
        for (const c of (data ?? []) as Card[]) cards.set(c.question_id, c);
      }
      // 버전이 있는 노트는 문제 지우기를 앱에서 (버전마다 문제 목록이 달라서)
      let versions = false;
      if (f.versions) {
        const { count, error } = await sb().from('note_versions').select('id', { count: 'exact', head: true }).eq('note_id', noteId);
        versions = !error && (count ?? 0) > 0;
      }
      return {
        versions,
        list: qs.map((q): KQuestion => {
          const c = cards.get(q.id);
          return {
            id: q.id,
            type: q.type,
            prompt: previewText(q.prompt),
            status: q.status,
            due: c?.due ?? null,
            state: c ? c.state : null,
            reps: c?.reps ?? 0,
            lapses: c?.lapses ?? 0,
            wrong_count: c?.wrong_count ?? 0,
            in_wrong_note: !!c?.in_wrong_note,
          };
        }),
      };
    },

    async rename(id, title) {
      await check(sb().from('sources').update({ title }).eq('id', id));
      // 노트 화면의 제목도 같이 (노트가 있으면)
      await check(sb().from('notes').update({ title }).eq('source_id', id));
      sourcesChanged();
    },

    async setFlag(ids, flag, on) {
      for (const part of chunks(ids))
        await check(
          sb()
            .from('sources')
            .update({ [flag]: on })
            .in('id', part),
        );
      sourcesChanged();
    },

    async move(ids, subjectId) {
      for (const part of chunks(ids)) await api('/api/sources/move', { method: 'POST', body: JSON.stringify({ ids: part, subject: subjectId }) });
      sourcesChanged();
      subjectsChanged();
    },

    async remove(ids) {
      for (const part of chunks(ids)) await api('/api/sources/delete', { method: 'POST', body: JSON.stringify({ ids: part }) });
      sourcesChanged();
    },

    async createSubject(name) {
      const { count } = await check(sb().from('subjects').select('id', { count: 'exact', head: true }));
      const n = count ?? 0;
      const { data } = await check(
        sb()
          .from('subjects')
          .insert({ name, color: SUBJECT_COLORS[n % SUBJECT_COLORS.length], position: n })
          .select('id, name, color, position')
          .single(),
      );
      subjectsChanged();
      const row = data as { id: string; name: string; color: string; position: number };
      return { id: row.id, name: row.name, color: row.color, pinned: false, archived: false, position: row.position };
    },

    async updateSubject(id, patch) {
      await check(sb().from('subjects').update(patch).eq('id', id));
      subjectsChanged();
    },

    async deleteSubject(id) {
      await api(`/api/subjects/${id}`, { method: 'DELETE' });
      subjectsChanged();
      sourcesChanged();
    },

    async mergeSubjects(from, into) {
      await api('/api/subjects/merge', { method: 'POST', body: JSON.stringify({ from, into }) });
      subjectsChanged();
      sourcesChanged();
    },

    async stats() {
      const plan = await fetchPlanData();
      // 홈의 '오늘 복습'과 같은 계산 (복습을 끈 노트의 문제는 빼고)
      const live = plan.cards.filter((c) => c.in_review);
      const r = settings.review;
      const today = pickToday(live, plan.planSubjects, { dailyMax: r.dailyMax, doneToday: plan.doneToday, interleave: r.interleave });
      const byState: [number, number, number, number] = [0, 0, 0, 0];
      for (const c of live) byState[Math.max(0, Math.min(3, c.state))]++;
      const { count: resting } = await sb().from('questions').select('id', { count: 'exact', head: true }).eq('status', 'suspended');
      const names = new Map(plan.subjects.map((s) => [s.id, s.name]));
      const per = new Map<string, { name: string; cards: number; due: number }>();
      const entry = (sid: string) => {
        let e = per.get(sid);
        if (!e) {
          e = { name: names.get(sid) ?? '?', cards: 0, due: 0 };
          per.set(sid, e);
        }
        return e;
      };
      for (const c of live) entry(c.subject_id).cards++;
      for (const c of today) entry(c.subject_id).due++;
      return {
        total: live.length,
        due: today.length,
        doneToday: plan.doneToday,
        dailyMax: r.dailyMax,
        wrong: live.filter((c) => c.in_wrong_note).length,
        resting: resting ?? 0,
        reviewOff: plan.cards.length - live.length,
        byState,
        bySubject: [...per.values()].sort((a, b) => b.cards - a.cards),
      };
    },

    async wrong() {
      const plan = await fetchPlanData();
      // 오답노트 화면과 같게: 복습을 끈 노트의 문제는 빼고, 많이 틀린 것부터
      const cards = plan.cards.filter((c) => c.in_wrong_note && c.in_review).sort((a, b) => (b.wrong_count ?? 0) - (a.wrong_count ?? 0));
      if (!cards.length) return [];
      const qs = new Map((await fetchQuestionsByIds(cards.map((c) => c.question_id))).map((q) => [q.id, q]));
      const noteIds = [...new Set(cards.map((c) => c.note_id).filter((x): x is string => !!x))];
      const titles = new Map<string, string>();
      for (const part of chunks(noteIds)) {
        const { data } = await check(sb().from('notes').select('id, title').in('id', part));
        for (const n of (data ?? []) as Array<{ id: string; title: string | null }>) titles.set(n.id, previewText(n.title ?? ''));
      }
      const subj = new Map(plan.subjects.map((s) => [s.id, s.name]));
      return cards
        .filter((c) => qs.has(c.question_id))
        .map((c): KWrong => ({
          question_id: c.question_id,
          prompt: previewText(qs.get(c.question_id)!.prompt),
          subject: subj.get(c.subject_id) ?? '?',
          note: (c.note_id && titles.get(c.note_id)) || '제목 없는 자료',
          wrong_count: Math.max(1, c.wrong_count ?? 0),
        }));
    },

    async unwrong(ids) {
      for (const part of chunks(ids)) await check(sb().from('cards').update({ in_wrong_note: false }).in('question_id', part));
    },

    async sessions() {
      const { data } = await check(sb().from('review_sessions').select('key, day, plan, answered'));
      return ((data ?? []) as Array<{ key: string; day: string | null; plan: unknown; answered: unknown }>).map((r) => ({
        key: r.key,
        day: r.day,
        planned: Array.isArray(r.plan) ? r.plan.length : 0,
        answered: r.answered && typeof r.answered === 'object' ? Object.keys(r.answered).length : 0,
      }));
    },

    async dropSession(key) {
      if (key === 'home' || key === 'review' || key === 'wrong') await deleteSession(key);
    },

    async setQuestionStatus(ids, status) {
      for (const part of chunks(ids)) await check(sb().from('questions').update({ status }).in('id', part).neq('status', 'hidden'));
    },

    async resetCards(ids) {
      // 처음 넣은 카드처럼: 지금 복습할 차례, 익힌 정도 없음 (틀린 수·오답노트는 그대로)
      const fresh = { due: new Date().toISOString(), state: 0, reps: 0, lapses: 0, last_review: null, fsrs: {}, correct_streak: 0 };
      for (const part of chunks(ids)) await check(sb().from('cards').update(fresh).in('question_id', part));
    },

    async deleteQuestions(ids) {
      for (const part of chunks(ids)) await check(sb().from('questions').delete().in('id', part));
    },

    config(): KConfig[] {
      return visibleConfig().map((d) => ({ key: d.key, value: shown(d, getPath(settings, d.key)), label: d.label }));
    },

    async setConfig(key, raw) {
      const def = visibleConfig().find((d) => d.key === key);
      if (!def) throw new SettingError(`config: '${key}': 그런 설정이 없어요 (config 로 목록을 봐요)`);
      if (def.perk && !(def.perk === 'cover' ? me.canCover : me.canFigures)) {
        const tier = perkTierName(me.perkTiers, def.perk);
        throw new SettingError(`config: ${key} 는 ${tier ? `${tier}에서` : '지금은'} 바꿀 수 ${tier ? '있어요' : '없어요'}`);
      }
      const value = parseValue(def, raw);
      const before = shown(def, getPath(settings, key));
      const [sec, name] = key.split('.');
      const cur = settings as unknown as Record<string, Section>;
      const next = readUserSettings({ ...cur, [sec]: { ...cur[sec], [name]: value } });
      await check(sb().from('profiles').update({ settings: next }).eq('id', me.userId));
      settings = next;
      void refreshMe();
      return `${key}: ${before} → ${shown(def, getPath(next, key))}`;
    },
  };
}
