// 노트 불러오기 (주인 확인) + AI 에 보낼 짧은 노트
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zNote, type Note } from '@/lib/ai/schemas';
import { KEY_POINTS_MAX } from '@/lib/ai/scale';
import { stripMarks } from '@/lib/richtext';
import { UserFacingError } from './errors';

export type OwnedNote = {
  id: string;
  source_id: string;
  subject_id: string;
  user_id: string;
  title: string;
  note: Note;
  raw: Record<string, unknown>;
  /** 지금 버전 번호 (버전 칸이 없는 DB 면 null) */
  version: number | null;
  updatedAt: string;
};

export async function loadOwnedNote(admin: SupabaseClient, noteId: string, userId: string): Promise<OwnedNote> {
  // '*': 버전 칸(current_version)은 schema.sql 을 다시 실행한 DB 에만 있다
  const { data, error } = await admin.from('notes').select('*').eq('id', noteId).maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== userId) throw new UserFacingError('not_found', '노트를 찾을 수 없어요.', 404);
  const raw = (data.body ?? {}) as Record<string, unknown>;
  return {
    id: data.id,
    source_id: data.source_id,
    subject_id: data.subject_id,
    user_id: data.user_id,
    title: data.title,
    note: zNote.parse(raw),
    raw,
    version: typeof data.current_version === 'number' ? data.current_version : null,
    updatedAt: String(data.updated_at),
  };
}

/** AI 로 그림·문제를 만들기 전에: 비어 있는 노트(직접 만들고 아직 안 채움)는 에너지를 쓰기 전에 알려 준다 */
export function assertNoteHasContent(note: Note): void {
  const empty = !note.key_points.length && !note.summary.trim() && !note.terms.length && !note.formulas.length;
  if (empty) throw new UserFacingError('empty_note', '노트가 비어 있어요. 정리 탭에서 개념을 먼저 적어 주세요.', 400);
}

/**
 * 이 노트에 자료를 더하는 중이면 노트·그림을 바꾸지 않는다 (합치는 바탕이 바뀌면 처음부터 다시 합쳐야 해서).
 * 더한 자료 칸(parent_id)이 없는 예전 DB 는 더하는 자료도 없다
 */
export async function assertNoAppendRunning(admin: SupabaseClient, sourceId: string): Promise<void> {
  const { data, error } = await admin.from('sources').select('id').eq('parent_id', sourceId).in('status', ['queued', 'processing']).limit(1);
  if (error) {
    if (/parent_id/.test(error.message ?? '')) return;
    throw error;
  }
  if (data?.length) throw new UserFacingError('append_running', '이 노트에 자료를 더하는 중이에요. 끝난 뒤에 해 주세요.', 409);
}

/**
 * 미리보기를 만든 노트 버전과 지금 버전이 다르면 넣지 않는다 (다른 기기에서 자료를 더했거나 버전을 바꿨을 때).
 * 버전을 보내지 않은 예전 화면이나 버전 칸이 없는 DB 는 검사하지 않는다
 */
export function assertSameVersion(note: OwnedNote, version: number | null | undefined) {
  if (version == null || note.version === null || note.version === version) return;
  throw new UserFacingError('stale_version', '그사이 노트가 다른 버전으로 바뀌었어요. 새로 불러왔으니 다시 해 주세요.', 409);
}

/**
 * 노트 내용을 읽어 고친 뒤 저장한다. 읽은 뒤에 다른 곳(다른 탭, 자료 더하기 마무리, 버전 바꾸기)이 노트를 바꿨으면
 * 덮어쓰지 않고 다시 읽어 고친다 (updated_at 이 그대로일 때만 저장한다)
 */
export async function updateNoteBody(admin: SupabaseClient, noteId: string, userId: string, edit: (note: OwnedNote) => Record<string, unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const cur = await loadOwnedNote(admin, noteId, userId);
    const { data, error } = await admin
      .from('notes')
      .update({ body: edit(cur) })
      .eq('id', cur.id)
      .eq('updated_at', cur.updatedAt)
      .select('id');
    if (error) throw error;
    if (data?.length) return;
  }
  throw new UserFacingError('note_busy', '노트가 계속 바뀌고 있어서 저장하지 못했어요. 잠시 뒤에 다시 해 주세요.', 409);
}

/** AI 에 보낼 노트의 최대 길이 (글자). 학생이 노트를 아주 길게 고쳐도 비용이 크게 늘지 않게 */
export const NOTE_PROMPT_MAX_CHARS = 36_000;

function clip(s: unknown, n: number): string {
  const t = typeof s === 'string' ? s : '';
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** AI 에 보낼 글: 학생의 글자 꾸미기(**굵게** 등)는 빼고 (문제·그림에 기호가 옮겨 가지 않게), 길면 자른다 */
function clipText(s: unknown, n: number): string {
  return clip(typeof s === 'string' ? stripMarks(s) : '', n);
}

function noteJson(note: Note, scale: number): string {
  const n = (x: number) => Math.max(20, Math.floor(x * scale));
  const k = (x: number) => Math.max(3, Math.floor(x * scale));
  return JSON.stringify({
    title: clipText(note.title, 120),
    summary: clipText(note.summary, n(1500)),
    key_points: note.key_points.slice(0, KEY_POINTS_MAX).map(({ id, title, explanation, why, importance, pages }) => ({
      id: clip(id, 20),
      title: clipText(title, 120),
      explanation: clipText(explanation, n(1200)),
      why: clipText(why, n(300)),
      importance,
      pages: (pages ?? []).slice(0, 20),
    })),
    terms: note.terms.slice(0, k(40)).map(({ term, meaning }) => ({ term: clipText(term, 80), meaning: clipText(meaning, n(300)) })),
    formulas: note.formulas.slice(0, k(20)).map(({ latex, label }) => ({ latex: clip(latex, 300), label: clipText(label, 100) })),
    pitfalls: note.pitfalls.slice(0, k(20)).map(({ text, key_point_id }) => ({ text: clipText(text, n(300)), key_point_id: clip(key_point_id, 20) })),
    examples: note.examples.slice(0, k(20)).map(({ text, key_point_id }) => ({ text: clipText(text, n(300)), key_point_id: clip(key_point_id, 20) })),
  });
}

/** AI 에 보낼 노트 (긴 칸은 자르고, 그래도 길면 더 줄인다) */
export function noteForPrompt(note: Note, maxChars = NOTE_PROMPT_MAX_CHARS): string {
  let out = noteJson(note, 1);
  for (const scale of [0.6, 0.35, 0.2]) {
    if (out.length <= maxChars) break;
    out = noteJson(note, scale);
  }
  return out;
}

/** 채점·문제 고치기에 쓸 노트 일부 (그 개념 + 요약) */
export function noteExcerpt(note: Note, keyPointId: string | null): string {
  const kp = keyPointId ? note.key_points.find((k) => k.id === keyPointId) : undefined;
  return JSON.stringify({
    summary: clipText(note.summary, 1500),
    key_point: kp ? { id: clip(kp.id, 20), title: clipText(kp.title, 120), explanation: clipText(kp.explanation, 1500), why: clipText(kp.why, 400) } : null,
    pitfalls: note.pitfalls
      .filter((p) => !kp || p.key_point_id === kp.id)
      .slice(0, 10)
      .map((p) => clipText(p.text, 300)),
    terms: note.terms.slice(0, 30).map(({ term, meaning }) => ({ term: clipText(term, 80), meaning: clipText(meaning, 300) })),
  });
}
