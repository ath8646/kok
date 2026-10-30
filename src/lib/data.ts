// 화면에서 쓰는 데이터 읽기·쓰기 (로그인한 사람 권한, RLS 적용)
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/client';
import type { CardRow, QuestionRow, SourceListRow, SubjectRow } from './types';
import type { PlanCard, PlanSubject } from './review-plan';
import { readSession, type Answered, type SessionKey, type SessionRow } from './review-session';
import { kstDayStart } from './time';
import { previewText } from './richtext';

export function sb(): SupabaseClient {
  return supabaseBrowser();
}

/** 1000행 제한을 넘어 모두 읽는다. 쪽이 어긋나지 않게 make 안에서 겹치지 않는 칸(id 등)으로 정렬해야 한다 */
export async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    if (from > 50_000) break;
  }
  return out;
}

const SUBJECT_COLS = 'id, name, color, exam_date, position, created_at';
/** 과목 서랍 칸 (고정·보관·최근 쓴 때). schema.sql 을 다시 실행하기 전에는 없어서, 처음 읽을 때 알아낸다 */
const DRAWER_COLS = 'pinned, archived, used_at';
/** 칸이 없다고 알아낸 때 (1분 동안만 믿는다: 그 사이 schema.sql 을 다시 실행했으면 다시 읽어 본다) */
let drawerColsMissingAt = 0;

export async function fetchSubjects(): Promise<SubjectRow[]> {
  const read = (more: boolean) =>
    sb()
      .from('subjects')
      .select(more ? `${SUBJECT_COLS}, ${DRAWER_COLS}` : SUBJECT_COLS)
      .order('position')
      .order('created_at');
  if (Date.now() - drawerColsMissingAt > 60_000) {
    const { data, error } = await read(true);
    if (!error) return (data ?? []) as unknown as SubjectRow[];
    if (!missingColumn(error, 'pinned|archived|used_at')) throw error;
    drawerColsMissingAt = Date.now();
  }
  const { data, error } = await read(false);
  if (error) throw error;
  return (data ?? []) as unknown as SubjectRow[];
}

export const SOURCE_COLS =
  'id, subject_id, kind, title, unit, status, step, progress, chunk_index, chunk_total, error, locked_until, page_count, file_paths, files_expire_at, created_at, updated_at';
/** 자료함 정리 칸 (복습에 넣기·별표·순서). DB 에 있을 때만 읽는다 (features.organize: schema.sql 을 다시 실행하기 전에는 없다) */
export const ORGANIZE_COLS = 'in_review, starred, position';

/** 칸이 없거나 읽을 권한이 없다는 오류인지 (schema.sql 을 다시 실행하기 전) */
function missingColumn(e: unknown, col: string): boolean {
  const err = e as { code?: string; message?: string } | null;
  return !!err && (err.code === '42703' || err.code === '42501' || new RegExp(col).test(err.message ?? ''));
}

/** 복습에 넣는 칸(in_review)이 DB 에 있는지. 처음 읽을 때 알아낸다 */
let reviewCol: boolean | null = null;

/** 복습에서 뺀 노트의 자료 번호. 칸이 없는 예전 DB 면 비어 있다 (모든 노트가 복습에 들어간다) */
export async function fetchReviewOff(): Promise<Set<string>> {
  if (reviewCol === false) return new Set();
  try {
    const rows = await fetchAll<{ id: string }>(
      (a, b) =>
        sb().from('sources').select('id').eq('in_review', false).order('id').range(a, b) as unknown as PromiseLike<{
          data: Array<{ id: string }> | null;
          error: unknown;
        }>,
    );
    reviewCol = true;
    return new Set(rows.map((r) => r.id));
  } catch (e) {
    if (!missingColumn(e, 'in_review')) throw e;
    reviewCol = false;
    return new Set();
  }
}

export type SourceRowWithUnit = SourceListRow & { unit: string };

/** 노트에 더한 자료 칸(parent_id)이 DB 에 있는지 (schema.sql 을 다시 실행하기 전에는 없다). 처음 읽을 때 알아낸다 */
let parentCol: boolean | null = null;
function missingParentCol(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return !!err && (err.code === '42703' || err.code === '42501' || /parent_id/.test(err.message ?? ''));
}

/**
 * 자료 목록은 노트에 더한 자료(부모가 있는 자료)를 빼고 읽는다 (그 자료는 노트의 원본 탭에 보인다).
 * make(true) 는 부모가 없는 자료만 읽는 요청을 만든다. 칸이 아직 없으면 make(false) 로 그냥 읽는다.
 */
export async function topLevelSources<T>(
  make: (onlyTop: boolean) => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  if (parentCol !== false) {
    const r = await make(true);
    if (!r.error) {
      parentCol = true;
      return r;
    }
    if (!missingParentCol(r.error)) return r;
    parentCol = false;
  }
  return make(false);
}

export async function fetchSources(
  opts: {
    subjectId?: string;
    active?: boolean;
    limit?: number;
    /** 노트에 더하는 자료도 (동시에 정리하는 수 세기) */ withChildren?: boolean;
    /** 자료함 정리 칸(별표·복습·순서)도 (features.organize 일 때만: 칸 단위 GRANT) */ organize?: boolean;
  } = {},
): Promise<SourceRowWithUnit[]> {
  const cols: string = opts.organize ? `${SOURCE_COLS}, ${ORGANIZE_COLS}` : SOURCE_COLS;
  const build = (onlyTop: boolean) => {
    let q = sb().from('sources').select(cols).order('created_at', { ascending: false });
    if (onlyTop) q = q.is('parent_id', null);
    if (opts.subjectId) q = q.eq('subject_id', opts.subjectId);
    if (opts.active) q = q.in('status', ['queued', 'processing', 'error']);
    if (opts.limit) q = q.limit(opts.limit);
    return q;
  };
  const { data, error } = opts.withChildren ? await build(false) : await topLevelSources(build);
  if (error) throw error;
  return (data ?? []) as unknown as SourceRowWithUnit[];
}

/** 카드 미리보기에 쓸 노트 조각: 요약 (직접 만든 노트는 요약이 없으면 첫 개념) */
export const NOTE_PEEK = 'source_id, summary:body->>summary, manual:body->>manual, kp:body->key_points->0->>title, kpx:body->key_points->0->>explanation';
export type NotePeek = { source_id: string; summary: string | null; manual: string | null; kp: string | null; kpx: string | null };
export function peekText(n: NotePeek): string | null {
  if (n.summary?.trim() || n.manual !== 'true') return n.summary;
  return [n.kp, n.kpx].filter((x) => x?.trim()).join(' · ') || null;
}

type NoteKps = { id: string; source_id: string; kps: Array<{ id: string; importance?: string; title?: string; starred?: boolean }> | null };

/** 개념 하나: 중요도, 이름(꾸미기 기호 없이), 별표 */
export type ConceptInfo = { importance: string; title: string; starred: boolean };

/** 노트마다 개념 (노트 id → 개념 id → 중요도·이름·별표)과 노트의 자료 번호 */
export async function fetchNoteMeta(): Promise<{ concepts: Map<string, Map<string, ConceptInfo>>; noteSource: Map<string, string> }> {
  const rows = await fetchAll<NoteKps>(
    (a, b) =>
      sb().from('notes').select('id, source_id, kps:body->key_points').order('id').range(a, b) as unknown as PromiseLike<{
        data: NoteKps[] | null;
        error: unknown;
      }>,
  );
  const concepts = new Map<string, Map<string, ConceptInfo>>();
  const noteSource = new Map<string, string>();
  for (const r of rows) {
    const inner = new Map<string, ConceptInfo>();
    // 이름은 꾸미기 기호(**굵게** 등) 없이 글로
    for (const k of r.kps ?? [])
      if (k?.id) inner.set(k.id, { importance: k.importance ?? 'medium', title: k.title ? previewText(k.title) || k.title : '', starred: k.starred === true });
    concepts.set(r.id, inner);
    noteSource.set(r.id, r.source_id);
  }
  return { concepts, noteSource };
}

export type PlanData = {
  /** in_review: 이 문제의 노트가 복습에 들어가는지 (자료함에서 끈 노트는 false. 노트에서 직접 푸는 것은 된다) */
  cards: Array<PlanCard & { note_id: string | null; key_point_id: string | null; in_review: boolean }>;
  /** 카드 전체 칸 (복습 저장에 쓴다) */
  rawCards: Map<string, CardRow>;
  subjects: SubjectRow[];
  planSubjects: PlanSubject[];
  doneToday: number;
  /** 노트마다 개념 (중요도·이름·별표) */
  concepts: Map<string, Map<string, ConceptInfo>>;
};

type PlanQuestion = { id: string; note_id: string | null; key_point_id: string | null; status: string; type: string; created_at: string };

/** 복습 계획에 필요한 것 한 번에: 카드(쉬는 문제 빼고), 과목, 오늘 푼 수, 개념 */
export async function fetchPlanData(): Promise<PlanData> {
  const [subjects, cards, questions, meta, done, reviewOff] = await Promise.all([
    fetchSubjects(),
    fetchAll<CardRow>(
      (a, b) =>
        sb()
          .from('cards')
          .select('question_id, subject_id, due, state, reps, lapses, last_review, last_correct, correct_streak, wrong_count, in_wrong_note, fsrs')
          .order('question_id')
          .range(a, b) as unknown as PromiseLike<{ data: CardRow[] | null; error: unknown }>,
    ),
    fetchAll<PlanQuestion>(
      (a, b) =>
        sb().from('questions').select('id, note_id, key_point_id, status, type, created_at').order('id').range(a, b) as unknown as PromiseLike<{
          data: PlanQuestion[] | null;
          error: unknown;
        }>,
    ),
    fetchNoteMeta(),
    sb().from('review_logs').select('id', { count: 'exact', head: true }).gte('reviewed_at', kstDayStart().toISOString()),
    fetchReviewOff(),
  ]);
  const { concepts, noteSource } = meta;
  const qmap = new Map(questions.map((q) => [q.id, q]));
  const planCards: PlanData['cards'] = [];
  for (const c of cards) {
    const q = qmap.get(c.question_id);
    if (!q || q.status !== 'active') continue;
    const kp = q.note_id && q.key_point_id ? concepts.get(q.note_id)?.get(q.key_point_id) : undefined;
    const imp = kp?.importance;
    planCards.push({
      question_id: c.question_id,
      subject_id: c.subject_id,
      due: c.due,
      state: c.state,
      reps: c.reps,
      lapses: c.lapses,
      wrong_count: c.wrong_count ?? 0,
      last_review: c.last_review,
      in_wrong_note: c.in_wrong_note,
      importance: imp === 'high' || imp === 'low' ? imp : 'medium',
      starred: kp?.starred ?? false,
      type: q.type,
      created_at: q.created_at,
      note_id: q.note_id,
      key_point_id: q.key_point_id,
      in_review: !(q.note_id && reviewOff.has(noteSource.get(q.note_id) ?? '')),
    });
  }
  return {
    cards: planCards,
    rawCards: new Map(cards.map((c) => [c.question_id, c])),
    subjects,
    planSubjects: subjects.map((s) => ({ id: s.id, exam_date: s.exam_date })),
    doneToday: done.count ?? 0,
    concepts,
  };
}

// ------------------------------------------------------------- 저장한 복습 세션 (features.sessions)
/** 저장한 세션 하나 (없으면 null) */
export async function fetchSession(key: SessionKey): Promise<SessionRow | null> {
  const { data, error } = await sb().from('review_sessions').select('*').eq('key', key).maybeSingle();
  if (error) throw error;
  return data ? readSession(data) : null;
}

/** 세션을 만들거나 바꾼다 (열쇠마다 하나) */
export async function saveSession(row: Omit<SessionRow, 'created_at' | 'updated_at'> & { user_id: string }): Promise<void> {
  const { error } = await sb().from('review_sessions').upsert(row, { onConflict: 'user_id,key' });
  if (error) throw error;
}

/** 세션의 계획만 바꾼다 (새 문제를 나눠 넣은 뒤) */
export async function updateSessionPlan(key: SessionKey, plan: string[]): Promise<void> {
  const { error } = await sb().from('review_sessions').update({ plan, seen_at: new Date().toISOString() }).eq('key', key);
  if (error) throw error;
}

export async function deleteSession(key: SessionKey): Promise<void> {
  const { error } = await sb().from('review_sessions').delete().eq('key', key);
  if (error) throw error;
}

/** 푼 문제 하나를 세션에 적는다 (DB 함수가 한 문제씩 더한다) */
export async function recordSessionAnswer(key: SessionKey, qid: string, entry: Answered): Promise<void> {
  const { error } = await sb().rpc('kok_session_answer', { p_key: key, p_qid: qid, p_entry: entry });
  if (error) throw error;
}

/** 어느 때 뒤에 푼 문제: 문제 번호 → 가장 늦게 푼 때 (세션 밖에서 푼 문제도 끝낸 것으로 세려고) */
export async function fetchReviewedSince(iso: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb()
      .from('review_logs')
      .select('question_id, reviewed_at')
      .gte('reviewed_at', iso)
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      if (!r.question_id) continue;
      const id = String(r.question_id);
      const at = String(r.reviewed_at);
      if ((out.get(id) ?? '') < at) out.set(id, at);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** 세션을 만든 뒤에 푼 문제만 (fetchReviewedSince 에서) */
export function reviewedAfter(m: Map<string, string>, iso: string): Set<string> {
  const since = Date.parse(iso);
  const out = new Set<string>();
  for (const [id, at] of m) if (Date.parse(at) >= since) out.add(id);
  return out;
}

/** 최근 푼 기록 (답하는 데 걸린 시간): 내 빠르기로 복습 시간마다 문제 수를 맞춘다 */
export async function fetchRecentPace(limit = 120): Promise<Array<{ question_id: string | null; ms: number | null }>> {
  const { data, error } = await sb().from('review_logs').select('question_id, ms').order('reviewed_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Array<{ question_id: string | null; ms: number | null }>;
}

/** 화면에서 읽는 문제 칸. 새 칸은 DB 에 있을 때만 (features: schema.sql 을 다시 실행하기 전에는 없다) */
export function questionCols(o: { figures?: boolean; rested?: boolean; sourceFigures?: boolean } = {}): string {
  return [
    'id, note_id, subject_id, key_point_id, type, prompt, choices, answer, accepted, explanation, difficulty, pages, created_by, locked, edited, status, created_at',
    o.rested ? 'rested_hidden' : '',
    o.figures ? 'figure, steps' : '',
    o.sourceFigures ? 'source_figure' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

export async function fetchQuestionsByIds(ids: string[], opts: { figures?: boolean; sourceFigures?: boolean } = {}): Promise<QuestionRow[]> {
  const out: QuestionRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb()
      .from('questions')
      .select(questionCols({ figures: opts.figures, sourceFigures: opts.sourceFigures }))
      .in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as QuestionRow[]));
  }
  return out;
}

export async function fetchStudyDays(days = 120): Promise<string[]> {
  const { data, error } = await sb().rpc('kok_my_study_days', { p_days: days });
  if (error) throw error;
  return ((data ?? []) as Array<string | { kok_my_study_days: string }>).map((d) => (typeof d === 'string' ? d : d.kok_my_study_days));
}
