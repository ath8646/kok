// 노트 불러오기 (주인 확인) + AI 에 보낼 짧은 노트
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zNote, type Note } from '@/lib/ai/schemas';
import { UserFacingError } from './errors';

export type OwnedNote = { id: string; source_id: string; subject_id: string; user_id: string; title: string; note: Note; raw: Record<string, unknown> };

export async function loadOwnedNote(admin: SupabaseClient, noteId: string, userId: string): Promise<OwnedNote> {
  const { data, error } = await admin.from('notes').select('id, source_id, subject_id, user_id, title, body').eq('id', noteId).maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== userId) throw new UserFacingError('not_found', '노트를 찾을 수 없어요.', 404);
  const raw = (data.body ?? {}) as Record<string, unknown>;
  return { id: data.id, source_id: data.source_id, subject_id: data.subject_id, user_id: data.user_id, title: data.title, note: zNote.parse(raw), raw };
}

/** AI 에 보낼 노트의 최대 길이 (글자). 학생이 노트를 아주 길게 고쳐도 비용이 크게 늘지 않게 */
export const NOTE_PROMPT_MAX_CHARS = 24_000;

function clip(s: unknown, n: number): string {
  const t = typeof s === 'string' ? s : '';
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function noteJson(note: Note, scale: number): string {
  const n = (x: number) => Math.max(20, Math.floor(x * scale));
  const k = (x: number) => Math.max(3, Math.floor(x * scale));
  return JSON.stringify({
    title: clip(note.title, 120),
    summary: clip(note.summary, n(1500)),
    key_points: note.key_points.slice(0, 12).map(({ id, title, explanation, why, importance, pages }) => ({
      id: clip(id, 20),
      title: clip(title, 120),
      explanation: clip(explanation, n(1200)),
      why: clip(why, n(300)),
      importance,
      pages: (pages ?? []).slice(0, 20),
    })),
    terms: note.terms.slice(0, k(40)).map(({ term, meaning }) => ({ term: clip(term, 80), meaning: clip(meaning, n(300)) })),
    formulas: note.formulas.slice(0, k(20)).map(({ latex, label }) => ({ latex: clip(latex, 300), label: clip(label, 100) })),
    pitfalls: note.pitfalls.slice(0, k(20)).map(({ text, key_point_id }) => ({ text: clip(text, n(300)), key_point_id: clip(key_point_id, 20) })),
    examples: note.examples.slice(0, k(20)).map(({ text, key_point_id }) => ({ text: clip(text, n(300)), key_point_id: clip(key_point_id, 20) })),
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
    summary: clip(note.summary, 1500),
    key_point: kp ? { id: clip(kp.id, 20), title: clip(kp.title, 120), explanation: clip(kp.explanation, 1500), why: clip(kp.why, 400) } : null,
    pitfalls: note.pitfalls
      .filter((p) => !kp || p.key_point_id === kp.id)
      .slice(0, 10)
      .map((p) => clip(p.text, 300)),
    terms: note.terms.slice(0, 30).map(({ term, meaning }) => ({ term: clip(term, 80), meaning: clip(meaning, 300) })),
  });
}
