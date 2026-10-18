// 노트에 자료를 더할 때 쓰는 계산 (서버의 처리 파이프라인과 시험이 같이 쓴다)
import type { Note } from '@/lib/ai/schemas';

/** 합칠 때 AI 에 보내는 지금 노트의 최대 길이 (글자). 넘으면 합치지 않고 새 노트로 넣으라고 안내한다 */
export const NOTE_MERGE_MAX_CHARS = 24_000;

export const NOTE_TOO_LONG = '노트가 너무 길어서 새 자료를 합치지 못했어요. 이 자료는 새 노트로 넣어 주세요.';

/** 합친 노트를 한 번에 돌려받는 답의 최대 길이 (토큰). 파이프라인의 합치기 단계 max_tokens 와 같다 */
export const MERGE_OUT_TOKENS = 8000;

/**
 * 글의 토큰 수를 넉넉하게 어림한다: 한글·한자·가나는 한 글자에 1, 그 밖(영어·숫자·JSON 기호)은 0.3.
 * 실제보다 조금 크게 잡아, 답이 잘릴 노트는 AI 를 부르기 전에 막는다.
 */
export function estimateTokens(text: string): number {
  let wide = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x1100 && c <= 0x11ff) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0x3130 && c <= 0x318f) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0xac00 && c <= 0xd7af)
    )
      wide++;
  }
  return Math.ceil(wide + (text.length - wide) * 0.3);
}

/**
 * 새 자료가 합친 노트를 늘리는 양 (토큰). 합친 노트는 개념 수가 정해져 있어서(새 내용은 있는 개념 안에 넣는다)
 * 새 자료가 아무리 길어도 MERGE_GROWTH_MAX 보다 크게 늘지 않고, 짧아도 MERGE_GROWTH_MIN 은 늘어난다고 본다.
 */
export const MERGE_GROWTH_MIN = 600;
export const MERGE_GROWTH_MAX = 1500;

export function mergeGrowth(estimate: number): number {
  return Math.min(MERGE_GROWTH_MAX, Math.max(MERGE_GROWTH_MIN, Math.ceil(Number.isFinite(estimate) ? estimate : MERGE_GROWTH_MAX)));
}

/** 합치는 단계에서: 새 자료의 정리(JSON)가 노트를 늘리는 양은 그 절반쯤으로 본다 */
export function growthOfParts(newPartsJson: string): number {
  return Math.ceil(estimateTokens(newPartsJson) * 0.5);
}

/**
 * 합친 노트가 답 길이 안에 들어갈지: 지금 노트는 다시 다 써야 하고, 새 자료는 줄여서 들어간다.
 * growth: 새 자료가 늘릴 양의 어림 (자료를 넣을 때는 글이면 글 길이, 파일이면 가장 크게. 합칠 때는 growthOfParts)
 */
export function mergeFits(noteJson: string, growth = 0): boolean {
  return estimateTokens(noteJson) + mergeGrowth(growth) + 300 <= MERGE_OUT_TOKENS * 0.9;
}

/**
 * 합칠 때 AI 에 보낼 지금 노트: 자르지 않고 모두 보낸다 ('확인해 보세요'·'바꾼 것'까지).
 * 잘라서 보내면 AI 가 잘린 글을 그대로 돌려줘 긴 설명이 잘린 채 새 버전에 남는다. 너무 길면 null.
 */
export function noteForMerge(note: Note): string | null {
  const out = JSON.stringify({
    title: note.title,
    unit: note.unit,
    summary: note.summary,
    key_points: note.key_points.map(({ id, title, explanation, why, importance, pages }) => ({ id, title, explanation, why, importance, pages: pages ?? [] })),
    terms: note.terms.map(({ term, meaning }) => ({ term, meaning })),
    formulas: note.formulas.map(({ latex, label }) => ({ latex, label })),
    pitfalls: note.pitfalls.map(({ text, key_point_id }) => ({ text, key_point_id })),
    examples: note.examples.map(({ text, key_point_id }) => ({ text, key_point_id })),
    checks: note.checks.map(({ text }) => ({ text })),
    changes: note.changes.map(({ text }) => ({ text })),
  });
  return out.length <= NOTE_MERGE_MAX_CHARS ? out : null;
}

/** 지금 버전에 다시 합치는 횟수의 끝 (일어나지 않아야 하지만 끝없이 돌지 않게) */
export const MAX_REMERGES = 3;

export type RemergeState = {
  step: 'merge' | 'organize';
  partials: unknown[];
  progress: number;
  chunk_index?: number;
  draft: Record<string, unknown>;
};

/**
 * 합친 뒤에 노트가 바뀌었을 때(실패해 멈춘 사이 다른 자료를 더함·버전을 바꿈·노트를 고침):
 * 합치기 단계로 돌아가 지금 노트에 다시 합치는 처리 상태. 새 자료의 정리(newParts)는 그대로 쓰고,
 * 옛 노트로 만든 합친 노트·그림·문제는 버린다. 너무 여러 번이면 null ('다시 하기'를 누르면 처음부터 센다).
 */
export function remergeState(draft: Record<string, unknown>): RemergeState | null {
  const times = Number(draft.remerged ?? 0) + 1;
  if (times > MAX_REMERGES) return null;
  const keep: Record<string, unknown> = { ...draft };
  for (const k of ['note', 'visual', 'questions', 'base', 'baseVersion']) delete keep[k];
  const parts = Array.isArray(draft.newParts) ? draft.newParts : [];
  // 새 자료의 정리가 남아 있지 않으면 처음부터 다시 정리한다
  if (!parts.length) return { step: 'organize', chunk_index: 0, partials: [], progress: 3, draft: { ...keep, newParts: [], attempts: 0, remerged: times } };
  return { step: 'merge', partials: parts, progress: 60, draft: { ...keep, attempts: 0, remerged: times } };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 같은 글은 한 번만, 먼저 나온 순서대로 */
function uniqueTexts(...lists: Array<Array<{ text: string }>>): Array<{ text: string }> {
  const seen = new Set<string>();
  const out: Array<{ text: string }> = [];
  for (const list of lists) {
    for (const item of list) {
      const key = norm(item.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text: item.text });
    }
  }
  return out;
}

/**
 * 지금 노트에 있던 항목은 지금 노트의 순서대로 둔다 (내가 바꾼 순서를 지킨다).
 * 새로 생긴 항목은 AI 가 둔 자리에 그대로 두고, 있던 항목들이 차지한 자리만 지금 순서로 다시 채운다
 */
export function keepOrder<T>(merged: T[], current: T[], keyOf: (x: T) => string): T[] {
  const rank = new Map<string, number>();
  current.forEach((c, i) => {
    const k = keyOf(c);
    if (k && !rank.has(k)) rank.set(k, i);
  });
  const slots: number[] = [];
  merged.forEach((m, i) => {
    if (rank.has(keyOf(m))) slots.push(i);
  });
  const olds = slots.map((i) => merged[i]).sort((a, b) => (rank.get(keyOf(a)) ?? 0) - (rank.get(keyOf(b)) ?? 0));
  const out = merged.slice();
  slots.forEach((slot, j) => {
    out[slot] = olds[j];
  });
  return out;
}

/** 지금 노트에서 내가 고친(edited) 항목을 AI 가 그대로 두었으면 '고침' 표시도 남긴다 */
function keepEdited<T extends { edited?: boolean }>(merged: T[], current: T[], same: (a: T, b: T) => boolean): T[] {
  const edited = current.filter((c) => c.edited);
  if (!edited.length) return merged;
  return merged.map((m) => (edited.some((c) => same(c, m)) ? { ...m, edited: true } : m));
}

/**
 * AI 가 합친 노트에 지금 노트의 것을 지킨다.
 * - 별표한 개념은 그대로 별표, 내가 고친 것을 그대로 둔 곳은 '고침' 표시
 * - 있던 개념·용어·공식은 지금 노트의 순서대로 (내가 바꾼 순서)
 * - '한 번 확인해 보세요'(checks)와 'AI가 바꾼 것'(changes)은 지금 노트·새 자료의 것을 모두 남긴다 (AI 가 빠뜨려도)
 * - 직접 만든 노트(manual)는 그 표시를 남긴다
 */
export function keepFromCurrent(current: Note, merged: Note, newParts: Note[] = []): Note {
  const byId = new Map(current.key_points.map((k) => [k.id, k]));
  const key_points = keepOrder(merged.key_points, current.key_points, (k) => k.id).map((k) => {
    const c = byId.get(k.id);
    if (!c) return k;
    const next = { ...k };
    if (c.starred) next.starred = true;
    if (c.edited && norm(c.title) === norm(k.title) && norm(c.explanation) === norm(k.explanation) && norm(c.why) === norm(k.why)) next.edited = true;
    return next;
  });
  const out: Note = {
    ...merged,
    key_points,
    terms: keepEdited(
      keepOrder(merged.terms, current.terms, (t) => norm(t.term)),
      current.terms,
      (a, b) => norm(a.term) === norm(b.term) && norm(a.meaning) === norm(b.meaning),
    ),
    formulas: keepEdited(
      keepOrder(merged.formulas, current.formulas, (f) => norm(f.latex)),
      current.formulas,
      (a, b) => norm(a.latex) === norm(b.latex) && norm(a.label) === norm(b.label),
    ),
    pitfalls: keepEdited(merged.pitfalls, current.pitfalls, (a, b) => norm(a.text) === norm(b.text)),
    examples: keepEdited(merged.examples, current.examples, (a, b) => norm(a.text) === norm(b.text)),
    checks: uniqueTexts(current.checks, merged.checks, ...newParts.map((p) => p.checks)),
    changes: uniqueTexts(current.changes, merged.changes, ...newParts.map((p) => p.changes)),
  };
  if (current.summary_edited && norm(current.summary) === norm(merged.summary)) out.summary_edited = true;
  else delete out.summary_edited;
  if (current.manual) out.manual = true;
  else delete out.manual;
  return out;
}
