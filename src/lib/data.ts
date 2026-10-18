// 화면에서 쓰는 데이터 읽기·쓰기 (로그인한 사람 권한, RLS 적용)
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/client';
import type { CardRow, QuestionRow, SourceListRow, SubjectRow } from './types';
import type { PlanCard, PlanSubject } from './review-plan';
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

export async function fetchSubjects(): Promise<SubjectRow[]> {
  const { data, error } = await sb().from('subjects').select('id, name, color, exam_date, position, created_at').order('position').order('created_at');
  if (error) throw error;
  return (data ?? []) as SubjectRow[];
}

export const SOURCE_COLS =
  'id, subject_id, kind, title, unit, status, step, progress, chunk_index, chunk_total, error, locked_until, page_count, file_paths, files_expire_at, created_at, updated_at';

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
  opts: { subjectId?: string; active?: boolean; limit?: number; /** 노트에 더하는 자료도 (동시에 정리하는 수 세기) */ withChildren?: boolean } = {},
): Promise<SourceRowWithUnit[]> {
  const build = (onlyTop: boolean) => {
    let q = sb().from('sources').select(SOURCE_COLS).order('created_at', { ascending: false });
    if (onlyTop) q = q.is('parent_id', null);
    if (opts.subjectId) q = q.eq('subject_id', opts.subjectId);
    if (opts.active) q = q.in('status', ['queued', 'processing', 'error']);
    if (opts.limit) q = q.limit(opts.limit);
    return q;
  };
  const { data, error } = opts.withChildren ? await build(false) : await topLevelSources(build);
  if (error) throw error;
  return (data ?? []) as SourceRowWithUnit[];
}

/** 카드 미리보기에 쓸 노트 조각: 요약 (직접 만든 노트는 요약이 없으면 첫 개념) */
export const NOTE_PEEK = 'source_id, summary:body->>summary, manual:body->>manual, kp:body->key_points->0->>title, kpx:body->key_points->0->>explanation';
export type NotePeek = { source_id: string; summary: string | null; manual: string | null; kp: string | null; kpx: string | null };
export function peekText(n: NotePeek): string | null {
  if (n.summary?.trim() || n.manual !== 'true') return n.summary;
  return [n.kp, n.kpx].filter((x) => x?.trim()).join(' · ') || null;
}

type NoteKps = { id: string; kps: Array<{ id: string; importance?: string; title?: string }> | null };

/** 노트마다 개념 중요도 */
export async function fetchImportance(): Promise<Map<string, Map<string, { importance: string; title: string }>>> {
  const rows = await fetchAll<NoteKps>(
    (a, b) =>
      sb().from('notes').select('id, kps:body->key_points').order('id').range(a, b) as unknown as PromiseLike<{ data: NoteKps[] | null; error: unknown }>,
  );
  const m = new Map<string, Map<string, { importance: string; title: string }>>();
  for (const r of rows) {
    const inner = new Map<string, { importance: string; title: string }>();
    // 이름은 꾸미기 기호(**굵게** 등) 없이 글로
    for (const k of r.kps ?? []) if (k?.id) inner.set(k.id, { importance: k.importance ?? 'medium', title: k.title ? previewText(k.title) || k.title : '' });
    m.set(r.id, inner);
  }
  return m;
}

export type PlanData = {
  cards: Array<PlanCard & { note_id: string | null; key_point_id: string | null }>;
  /** 카드 전체 칸 (복습 저장에 쓴다) */
  rawCards: Map<string, CardRow>;
  subjects: SubjectRow[];
  planSubjects: PlanSubject[];
  doneToday: number;
};

/** 복습 계획에 필요한 것 한 번에: 카드(쉬는 문제 빼고), 과목, 오늘 푼 수 */
export async function fetchPlanData(): Promise<PlanData> {
  const [subjects, cards, questions, importance, done] = await Promise.all([
    fetchSubjects(),
    fetchAll<CardRow>(
      (a, b) =>
        sb()
          .from('cards')
          .select('question_id, subject_id, due, state, reps, lapses, last_review, last_correct, correct_streak, wrong_count, in_wrong_note, fsrs')
          .order('question_id')
          .range(a, b) as unknown as PromiseLike<{ data: CardRow[] | null; error: unknown }>,
    ),
    fetchAll<{ id: string; note_id: string | null; key_point_id: string | null; status: string }>(
      (a, b) =>
        sb().from('questions').select('id, note_id, key_point_id, status').order('id').range(a, b) as unknown as PromiseLike<{
          data: Array<{ id: string; note_id: string | null; key_point_id: string | null; status: string }> | null;
          error: unknown;
        }>,
    ),
    fetchImportance(),
    sb().from('review_logs').select('id', { count: 'exact', head: true }).gte('reviewed_at', kstDayStart().toISOString()),
  ]);
  const qmap = new Map(questions.map((q) => [q.id, q]));
  const planCards: PlanData['cards'] = [];
  for (const c of cards) {
    const q = qmap.get(c.question_id);
    if (!q || q.status !== 'active') continue;
    const imp = q.note_id && q.key_point_id ? importance.get(q.note_id)?.get(q.key_point_id)?.importance : undefined;
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
      note_id: q.note_id,
      key_point_id: q.key_point_id,
    });
  }
  return {
    cards: planCards,
    rawCards: new Map(cards.map((c) => [c.question_id, c])),
    subjects,
    planSubjects: subjects.map((s) => ({ id: s.id, exam_date: s.exam_date })),
    doneToday: done.count ?? 0,
  };
}

export async function fetchQuestionsByIds(ids: string[]): Promise<QuestionRow[]> {
  const out: QuestionRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb()
      .from('questions')
      .select(
        'id, note_id, subject_id, key_point_id, type, prompt, choices, answer, accepted, explanation, difficulty, pages, created_by, locked, edited, status, created_at',
      )
      .in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data ?? []) as QuestionRow[]));
  }
  return out;
}

export async function fetchStudyDays(days = 120): Promise<string[]> {
  const { data, error } = await sb().rpc('kok_my_study_days', { p_days: days });
  if (error) throw error;
  return ((data ?? []) as Array<string | { kok_my_study_days: string }>).map((d) => (typeof d === 'string' ? d : d.kok_my_study_days));
}
