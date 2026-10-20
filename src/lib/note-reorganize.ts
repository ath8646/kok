// 합친 노트를 AI 로 다시 정리한 답을 지금 노트에 맞춘다 (서버의 '다시 정리' 라우트와 시험이 같이 쓴다).
// AI 는 겹치는 개념을 하나로 묶고 차례를 다듬는다. 문제·마인드맵·자료 그림이 가리키는 개념 번호는 qmap 으로 따라간다
import type { KeyPoint, Mindmap, Note } from '@/lib/ai/schemas';
import type { SourceFigure } from '@/lib/source-figures';
import { idMaker } from './note-merge';

/** AI 가 알려 주는 개념 번호 옮김 (예전 번호 → 그 내용이 들어간 번호) */
export type IdPair = { from: string; to: string };

/**
 * 다시 정리할 때 AI 에게 알려 주는 개념 수의 끝: 지금 개념 수 (9개보다 적게 줄이라고는 하지 않는다).
 * 겹치는 것만 묶게 하고, 서로 다른 개념을 억지로 합치거나 빼게 하지 않는다 (노트 여러 개를 합친 노트는 개념이 많다)
 */
export function reorganizeMaxKeyPoints(current: number): number {
  return Math.max(9, current);
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 같은 글은 한 번만, 먼저 나온 차례대로 */
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

/** 지금 노트에서 내가 고친(edited) 것을 AI 가 글 그대로 두었으면 '고침' 표시도 남긴다 */
function keepEdited<T extends { edited?: boolean }>(next: T[], current: T[], same: (a: T, b: T) => boolean): T[] {
  const edited = current.filter((c) => c.edited);
  return next.map((m) => {
    const { edited: _e, ...rest } = m;
    void _e;
    return (edited.some((c) => same(c, m)) ? { ...rest, edited: true } : rest) as T;
  });
}

/** 개념 번호를 다시 정리한 노트의 번호로 (qmap 에 있으면 그것, 남은 번호면 그대로, 모르면 '' = 개념 없음) */
export function remapKeyPoint(id: string, qmap: Record<string, string>, finalIds: Set<string>): string {
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(qmap, id)) return qmap[id];
  return finalIds.has(id) ? id : '';
}

/**
 * AI 가 다시 정리한 노트(ai)를 지금 노트(current)에 맞춘다.
 * - 개념 번호: 비었거나 겹치면 새 번호. 지금 노트에 없던 번호인데 문제·마인드맵이 쓰는 번호(reserved)여도 새 번호
 *   (지운 개념의 문제가 새 개념에 붙지 않게)
 * - qmap: 지금 노트의 개념 번호 → 그 내용이 들어간 개념 번호. AI 의 id_map 을 먼저 보고, 없으면 같은 번호가 남았는지 본다.
 *   어디로 갔는지 모르면 '' (개념 없음). 바뀌는 번호만 담는다
 * - 별표한 개념이 들어간 개념은 별표, '고침' 표시는 같은 번호에 글이 그대로일 때만
 * - 제목은 지금 제목 그대로, '확인해 보세요'·'AI가 바꾼 것'은 지금 것도 모두 남긴다, 직접 만든 노트 표시는 그대로
 */
export function settleReorganized(
  current: Note,
  ai: Note,
  idMap: IdPair[],
  o: { reserved?: Iterable<string> } = {},
): { note: Note; qmap: Record<string, string>; finalIds: Set<string> } {
  const currentIds = new Set(current.key_points.map((k) => k.id));
  const reserved = new Set(o.reserved ?? []);
  const aiIds = ai.key_points.map((k) => (k.id || '').trim()).filter(Boolean);
  const next = idMaker('k', [...currentIds, ...reserved, ...aiIds]);
  const rename = new Map<string, string>();
  const used = new Set<string>();
  const kps: KeyPoint[] = [];
  // AI 가 준 개념은 모두 둔다 (잘라 내면 그 개념의 내용과 문제의 개념이 사라진다)
  for (const kp of ai.key_points) {
    const raw = (kp.id || '').trim();
    let id = raw;
    if (!id || used.has(id) || (!currentIds.has(id) && reserved.has(id))) id = next();
    used.add(id);
    if (raw && !rename.has(raw)) rename.set(raw, id);
    kps.push({ ...kp, id });
  }
  const finalIds = new Set(kps.map((k) => k.id));
  /** AI 가 쓴 번호 → 남은 번호 (없는 번호면 '') */
  const fix = (id: string) => {
    const t = (id || '').trim();
    const r = rename.get(t) ?? t;
    return finalIds.has(r) ? r : '';
  };

  const pairs = new Map<string, string>();
  for (const p of idMap) {
    const from = (p.from || '').trim();
    if (from && !pairs.has(from)) pairs.set(from, p.to || '');
  }
  const qmap: Record<string, string> = {};
  for (const c of current.key_points) {
    const mapped = pairs.has(c.id) ? fix(pairs.get(c.id) as string) : '';
    const target = mapped || (finalIds.has(c.id) ? c.id : '');
    if (target !== c.id) qmap[c.id] = target;
  }

  // 별표: 별표한 개념의 내용이 들어간 개념. '고침': 같은 번호에 글이 그대로
  const starred = new Set<string>();
  for (const c of current.key_points) {
    if (!c.starred) continue;
    const t = remapKeyPoint(c.id, qmap, finalIds);
    if (t) starred.add(t);
  }
  const byId = new Map(current.key_points.map((k) => [k.id, k]));
  const key_points = kps.map((k) => {
    const { starred: _s, edited: _e, ...rest } = k;
    void _s;
    void _e;
    const out: KeyPoint = { ...rest };
    if (starred.has(k.id)) out.starred = true;
    const c = byId.get(k.id);
    if (c?.edited && norm(c.title) === norm(k.title) && norm(c.explanation) === norm(k.explanation) && norm(c.why) === norm(k.why)) out.edited = true;
    return out;
  });

  const note: Note = {
    ...ai,
    title: current.title,
    key_points,
    terms: keepEdited(ai.terms, current.terms, (a, b) => norm(a.term) === norm(b.term) && norm(a.meaning) === norm(b.meaning)),
    formulas: keepEdited(ai.formulas, current.formulas, (a, b) => norm(a.latex) === norm(b.latex) && norm(a.label) === norm(b.label)),
    pitfalls: keepEdited(
      ai.pitfalls.map((p) => ({ ...p, key_point_id: fix(p.key_point_id) })),
      current.pitfalls,
      (a, b) => norm(a.text) === norm(b.text),
    ),
    examples: keepEdited(
      ai.examples.map((p) => ({ ...p, key_point_id: fix(p.key_point_id) })),
      current.examples,
      (a, b) => norm(a.text) === norm(b.text),
    ),
    checks: uniqueTexts(current.checks, ai.checks),
    changes: uniqueTexts(current.changes, ai.changes),
  };
  delete note.summary_edited;
  delete note.manual;
  if (current.summary_edited && norm(current.summary) === norm(ai.summary)) note.summary_edited = true;
  if (current.manual) note.manual = true;
  return { note, qmap, finalIds };
}

/** 마인드맵의 개념 번호를 다시 정리한 노트의 번호로 (바뀐 것이 없으면 null) */
export function remapMindmap(map: Mindmap | null, qmap: Record<string, string>, finalIds: Set<string>): Mindmap | null {
  if (!map) return null;
  let changed = false;
  const nodes = map.nodes.map((n) => {
    const k = remapKeyPoint(n.key_point_id, qmap, finalIds);
    if (k === n.key_point_id) return n;
    changed = true;
    return { ...n, key_point_id: k };
  });
  return changed ? { ...map, nodes } : null;
}

/** 자료 그림이 붙은 개념을 다시 정리한 노트의 번호로 */
export function remapFigures(figures: SourceFigure[], qmap: Record<string, string>, finalIds: Set<string>): SourceFigure[] {
  return figures.map((f) => ({ ...f, key_point_id: remapKeyPoint(f.key_point_id, qmap, finalIds) }));
}
