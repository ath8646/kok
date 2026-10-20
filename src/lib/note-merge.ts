// 노트 합치기 (AI 없이): 고른 노트들을 한 노트(남길 노트)에 이어 붙인다. 서버의 합치기 라우트와 시험이 같이 쓴다.
// - 남길 노트의 정리·개념 번호·마인드맵은 그대로 두고, 합쳐지는 노트의 것을 뒤에 붙인다
// - 합쳐지는 노트의 개념은 겹치지 않는 새 번호를 받는다 (문제·마인드맵·자주 틀리는 것·예시·자료 그림이 따라간다).
//   그 노트의 문제는 maps 로 새 번호를 받는다 (DB 함수 kok_merge_notes)
// - 합쳐지는 노트의 쪽 번호는 비운다: 남길 노트의 원본(처음 자료)이 아니라 다른 자료의 쪽이라서 (자료를 더할 때와 같다)
// - 용어·공식은 같은 것이 두 번 나오지 않게, '확인해 보세요'·'AI가 바꾼 것'은 모두 남긴다
// - body.merged = { count, at }: 합친 노트라는 표시 ('AI로 다시 정리' 안내). 노트 몇 개가 모였는지 센다
import { zNote, type Mindmap, type MindNode, type Note, type TableSpec, type TimelineSpec } from '@/lib/ai/schemas';
import { MAX_NOTE_FIGURES, readFigures, type SourceFigure } from '@/lib/source-figures';

export type MergePart = {
  noteId: string;
  /** 노트 정리 (notes.body 그대로) */
  body: Record<string, unknown>;
  mindmap: Mindmap | null;
  table: TableSpec | null;
  timeline: TimelineSpec | null;
};

export type MergedVisual =
  | { type: 'mindmap'; spec: Mindmap }
  | { type: 'table'; spec: TableSpec }
  | { type: 'timeline'; spec: TimelineSpec };

export type MergedNote = {
  body: Record<string, unknown>;
  visuals: MergedVisual[];
  /** 합쳐지는 노트마다 예전 개념 번호 → 새 번호 (그 노트의 문제에 쓴다. 없는 번호의 문제는 개념 없이) */
  maps: Record<string, Record<string, string>>;
};

/** 합친 노트라는 표시 (body.merged) */
export type MergedMark = { count: number; at: string; hide?: boolean };

/** 합친 마인드맵의 가지 수 끝 (그림 다시 만들기가 받는 가장 큰 마인드맵과 같다) */
export const MERGED_MAX_NODES = 150;

/** 한 번에 합칠 수 있는 노트 수 (남길 노트까지) */
export const MERGE_MAX_NOTES = 10;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** body.merged 를 읽는다 (없거나 모양이 이상하면 null) */
export function readMergedMark(body: unknown): MergedMark | null {
  const raw = body && typeof body === 'object' ? (body as { merged?: unknown }).merged : null;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { count?: unknown; at?: unknown; hide?: unknown };
  const count = typeof r.count === 'number' && Number.isFinite(r.count) ? Math.max(2, Math.floor(r.count)) : 2;
  return { count, at: typeof r.at === 'string' ? r.at : '', ...(r.hide === true ? { hide: true } : {}) };
}

/** 'k12' 의 12 (모양이 다르면 0) */
function numberOf(id: string, prefix: string): number {
  if (!id.startsWith(prefix)) return 0;
  const n = Number(id.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** 쓰지 않은 번호를 차례로 준다 (prefix + 이어지는 수, 이미 쓰인 번호는 건너뛴다) */
export function idMaker(prefix: string, taken: Iterable<string>): () => string {
  const used = new Set(taken);
  let n = 0;
  for (const id of used) n = Math.max(n, numberOf(id, prefix));
  return () => {
    let id: string;
    do {
      n += 1;
      id = `${prefix}${n}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

/** 같은 글은 한 번만, 먼저 나온 차례대로 */
function uniqueBy<T>(list: T[], keyOf: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of list) {
    const k = keyOf(x);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(x);
  }
  return out;
}

/** 마인드맵의 각 노드가 몇 단계인지 (1단계 = 가운데 바로 아래). 부모를 못 찾으면 1단계로 본다 */
function levels(nodes: MindNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, number>();
  const depth = (n: MindNode, seen: Set<string>): number => {
    const known = out.get(n.id);
    if (known) return known;
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
    const d = !parent || seen.has(parent.id) ? 1 : depth(parent, new Set(seen).add(n.id)) + 1;
    out.set(n.id, d);
    return d;
  };
  for (const n of nodes) depth(n, new Set([n.id]));
  return out;
}

/**
 * 가지가 너무 많으면 깊은 단계부터 뺀다: 남길 노트의 가지는 모두 두고, 합쳐지는 노트의 가지는 1단계부터 차례로 넣는다
 * (부모가 빠진 노드는 넣지 않는다)
 */
function capNodes(mainNodes: MindNode[], extra: MindNode[][], max: number): MindNode[] {
  const all = extra.flat();
  if (mainNodes.length + all.length <= max) return [...mainNodes, ...all];
  const kept = new Set(mainNodes.map((n) => n.id));
  let room = max - mainNodes.length;
  const lv = extra.map((nodes) => levels(nodes));
  const top = Math.max(1, ...lv.flatMap((m) => [...m.values()]));
  for (let d = 1; d <= top && room > 0; d++) {
    for (let i = 0; i < extra.length && room > 0; i++) {
      for (const n of extra[i]) {
        if (room <= 0) break;
        if ((lv[i].get(n.id) ?? 1) !== d) continue;
        if (n.parent_id && !kept.has(n.parent_id)) continue;
        kept.add(n.id);
        room -= 1;
      }
    }
  }
  // 고른 노드는 원래 차례대로 (가지 안의 차례가 바뀌지 않게)
  return [...mainNodes, ...all.filter((n) => kept.has(n.id))];
}

/**
 * 노트 합치기. main: 남길 노트, others: 합쳐지는 노트 (붙일 차례대로).
 * reserved: 새 개념 번호로 쓰지 않을 번호 (남길 노트의 문제·마인드맵이 가리키는 번호: 지운 개념의 문제가 새 개념에 붙지 않게)
 */
export function mergeNotes(main: MergePart, others: MergePart[], o: { reserved?: Iterable<string>; at?: string; maxNodes?: number } = {}): MergedNote {
  const base = zNote.parse(main.body ?? {});
  const parts = others.map((p) => ({ part: p, note: zNote.parse(p.body ?? {}) }));
  const mainMap = main.mindmap;

  // 새 개념 번호: 남길 노트의 개념·문제·마인드맵이 쓰는 번호는 건너뛴다
  const takenKp = new Set<string>([...base.key_points.map((k) => k.id), ...(o.reserved ?? [])]);
  for (const n of mainMap?.nodes ?? []) if (n.key_point_id) takenKp.add(n.key_point_id);
  const nextKp = idMaker('k', takenKp);
  // 새 마인드맵 노드 번호, 새 그림 번호
  const nextNode = idMaker('n', [...(mainMap?.nodes ?? []).map((n) => n.id), '__root__']);
  const baseFigures = readFigures(main.body);
  const nextFig = idMaker('f', baseFigures.map((f) => f.id));

  const maps: Record<string, Record<string, string>> = {};
  const keyPoints = [...base.key_points];
  const pitfalls = [...base.pitfalls];
  const examples = [...base.examples];
  let terms = [...base.terms];
  let formulas = [...base.formulas];
  const checks = [...base.checks];
  const changes = [...base.changes];
  const summaries = [base.summary];
  const figures: SourceFigure[] = [...baseFigures];
  const extraNodes: MindNode[][] = [];
  let summaryEdited = !!base.summary_edited;
  let allManual = !!base.manual;
  let count = readMergedMark(main.body)?.count ?? 1;
  let table = main.table;
  let timeline = main.timeline;

  for (const { part, note } of parts) {
    const kpMap = new Map<string, string>();
    for (const kp of note.key_points) {
      const id = nextKp();
      if (kp.id && !kpMap.has(kp.id)) kpMap.set(kp.id, id);
      keyPoints.push({ ...kp, id, pages: [] });
    }
    maps[part.noteId] = Object.fromEntries(kpMap);
    const kpOf = (old: string) => kpMap.get(old) ?? '';
    pitfalls.push(...note.pitfalls.map((p) => ({ ...p, key_point_id: kpOf(p.key_point_id) })));
    examples.push(...note.examples.map((p) => ({ ...p, key_point_id: kpOf(p.key_point_id) })));
    terms = [...terms, ...note.terms];
    formulas = [...formulas, ...note.formulas];
    checks.push(...note.checks);
    changes.push(...note.changes);
    summaries.push(note.summary);
    summaryEdited ||= !!note.summary_edited;
    allManual &&= !!note.manual;
    count += readMergedMark(part.body)?.count ?? 1;
    for (const f of readFigures(part.body)) {
      if (figures.length >= MAX_NOTE_FIGURES) break;
      figures.push({ ...f, id: nextFig(), key_point_id: kpOf(f.key_point_id) });
    }
    // 마인드맵: 이 노트의 가지를 새 번호로 (1단계 가지는 합친 노트의 1단계 가지가 된다)
    const nodes = part.mindmap?.nodes ?? [];
    if (nodes.length) {
      const nodeMap = new Map<string, string>();
      for (const n of nodes) if (n.id && !nodeMap.has(n.id)) nodeMap.set(n.id, nextNode());
      extraNodes.push(
        nodes
          .filter((n) => n.id && nodeMap.has(n.id))
          .map((n) => ({
            ...n,
            id: nodeMap.get(n.id) as string,
            parent_id: n.parent_id ? (nodeMap.get(n.parent_id) ?? '') : '',
            key_point_id: kpOf(n.key_point_id),
            pages: [],
          })),
      );
    }
    table ??= part.table;
    timeline ??= part.timeline;
  }

  const note: Note = {
    title: base.title,
    unit: base.unit,
    summary: summaries.map((s) => s.trim()).filter(Boolean).join('\n'),
    key_points: keyPoints,
    terms: uniqueBy(terms, (t) => `${norm(t.term)}\u0000${norm(t.meaning)}`),
    formulas: uniqueBy(formulas, (f) => `${norm(f.latex)}\u0000${norm(f.label)}`),
    pitfalls,
    examples,
    checks: uniqueBy(checks, (c) => norm(c.text)),
    changes: uniqueBy(changes, (c) => norm(c.text)),
  };
  const body: Record<string, unknown> = { ...main.body, ...note };
  delete body.summary_edited;
  delete body.manual;
  if (summaryEdited) body.summary_edited = true;
  if (allManual) body.manual = true;
  if (figures.length || 'figures' in main.body) body.figures = figures;
  body.merged = { count, at: o.at ?? new Date().toISOString() } satisfies MergedMark;

  const visuals: MergedVisual[] = [];
  const firstMap = mainMap ?? parts.find((p) => p.part.mindmap)?.part.mindmap ?? null;
  if (firstMap) {
    // 남길 노트에 마인드맵이 없으면 처음 나오는 마인드맵의 가운데 이름을 쓴다
    const mainNodes = mainMap ? mainMap.nodes : [];
    const nodes = capNodes(mainNodes, extraNodes, o.maxNodes ?? MERGED_MAX_NODES);
    visuals.push({
      type: 'mindmap',
      spec: { root_label: firstMap.root_label, ...(mainMap?.root_edited ? { root_edited: true } : {}), nodes },
    });
  }
  if (table) visuals.push({ type: 'table', spec: table });
  if (timeline) visuals.push({ type: 'timeline', spec: timeline });
  return { body, visuals, maps };
}
