// 마인드맵 배치 계산 (화면과 상관없는 순수 함수)
// 입력: 평평한 노드 목록(parent_id) → 출력: 각 노드의 x, y, 너비, 높이와 연결선
import type { Mindmap, MindNode } from '@/lib/ai/schemas';

export const ROOT_ID = '__root__';

export type Layout = 'radial' | 'right' | 'down';

export type TreeNode = {
  id: string;
  label: string;
  icon: string;
  keyPointId: string;
  pages: number[];
  edited: boolean;
  depth: number;
  /** 1단계 가지 번호 (색 고르기용), 루트는 -1 */
  branch: number;
  parentId: string | null;
  children: TreeNode[];
};

export type PlacedNode = TreeNode & {
  x: number; // 가운데 x
  y: number; // 가운데 y
  w: number;
  h: number;
  side: 1 | -1; // 오른쪽(1) 왼쪽(-1)
  order: number; // 펼치는 순서
};

export type Edge = { from: PlacedNode; to: PlacedNode };

export type PlacedMap = {
  nodes: PlacedNode[];
  edges: Edge[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** 대략적인 글자 너비 (한글은 글자 크기만큼, 영문·숫자는 0.6배) */
export function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x2e80) w += fontSize * 1.0;
    else if (ch === ' ') w += fontSize * 0.32;
    else if (/[A-Z0-9]/.test(ch)) w += fontSize * 0.64;
    else w += fontSize * 0.56;
  }
  return w;
}

/** 평평한 목록 → 나무. 부모를 못 찾거나 고리가 생기면 루트 아래로 보낸다 */
export function buildTree(map: Mindmap, collapsed: Set<string> = new Set()): TreeNode {
  const root: TreeNode = {
    id: ROOT_ID,
    label: map.root_label || '주제',
    icon: '',
    keyPointId: '',
    pages: [],
    edited: !!map.root_edited,
    depth: 0,
    branch: -1,
    parentId: null,
    children: [],
  };
  const byId = new Map<string, MindNode>();
  for (const n of map.nodes) if (n.id && !byId.has(n.id) && n.id !== ROOT_ID) byId.set(n.id, n);

  const parentOf = (n: MindNode): string => {
    const p = n.parent_id;
    if (!p || p === ROOT_ID || !byId.has(p) || p === n.id) return ROOT_ID;
    // 고리 검사
    const seen = new Set<string>([n.id]);
    let cur: string | undefined = p;
    while (cur && cur !== ROOT_ID) {
      if (seen.has(cur)) return ROOT_ID;
      seen.add(cur);
      const next = byId.get(cur);
      cur = next ? (next.parent_id && byId.has(next.parent_id) ? next.parent_id : ROOT_ID) : ROOT_ID;
    }
    return p;
  };

  const tree = new Map<string, TreeNode>([[ROOT_ID, root]]);
  for (const n of byId.values()) {
    tree.set(n.id, {
      id: n.id,
      label: n.label || '…',
      icon: n.icon ?? '',
      keyPointId: n.key_point_id ?? '',
      pages: n.pages ?? [],
      edited: !!n.edited,
      depth: 0,
      branch: 0,
      parentId: null,
      children: [],
    });
  }
  // 입력 순서를 지키면서 붙인다
  for (const n of byId.values()) {
    const p = parentOf(n);
    const child = tree.get(n.id)!;
    child.parentId = p;
    tree.get(p)!.children.push(child);
  }
  // 깊이, 가지 번호
  const walk = (t: TreeNode, depth: number, branch: number) => {
    t.depth = depth;
    t.branch = branch;
    if (collapsed.has(t.id)) {
      t.children = t.children.length ? [] : t.children;
      return;
    }
    t.children.forEach((c, i) => walk(c, depth + 1, depth === 0 ? i : branch));
  };
  // 접힌 노드도 자식 수를 알 수 있게 따로 기록하지 않고, 화면에서 원본으로 센다
  walk(root, 0, -1);
  return root;
}

export type LayoutOptions = {
  layout: Layout;
  fontSize: number;
  rootFontSize?: number;
};

function nodeSize(t: TreeNode, fontSize: number, rootFontSize: number): { w: number; h: number } {
  const fs = t.depth === 0 ? rootFontSize : fontSize;
  const iconW = t.icon ? fs * 1.3 : 0;
  const padX = t.depth === 0 ? 22 : 14;
  const w = Math.max(t.depth === 0 ? 96 : 44, textWidth(t.label, fs) + iconW + padX * 2);
  const h = t.depth === 0 ? fs * 2.6 : fs * 2.2;
  return { w, h };
}

/** 한 방향(오른쪽 또는 아래)으로 펼치는 나무 배치. 반환 좌표는 임의 기준 */
function tidy(
  root: TreeNode,
  dir: 'right' | 'down',
  fontSize: number,
  rootFontSize: number,
  includeRoot: boolean,
  roots?: TreeNode[],
): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  const sizes = new Map<string, { w: number; h: number }>();
  const all: TreeNode[] = [];
  const collect = (t: TreeNode) => {
    sizes.set(t.id, nodeSize(t, fontSize, rootFontSize));
    all.push(t);
    t.children.forEach(collect);
  };
  collect(root);

  // 깊이별 칸 크기 (오른쪽: 열 너비, 아래: 행 높이). 노드는 칸의 시작 쪽에 붙인다
  const depthMain = new Map<number, number>();
  for (const t of all) {
    const sz = sizes.get(t.id)!;
    const main = dir === 'right' ? sz.w : sz.h;
    depthMain.set(t.depth, Math.max(depthMain.get(t.depth) ?? 0, main));
  }
  const gapMain = dir === 'right' ? 56 : 48;
  const gapCross = dir === 'right' ? 10 : 18;
  const colStart = new Map<number, number>();
  const maxDepth = Math.max(...depthMain.keys());
  let acc = 0;
  for (let d = 0; d <= maxDepth; d++) {
    colStart.set(d, acc);
    acc += (depthMain.get(d) ?? 0) + gapMain;
  }

  // 잎을 차례로 쌓고, 부모는 자식들의 가운데에 둔다.
  // 부모가 자식들보다 넓으면 자식 묶음 전체를 밀어서 겹치지 않게 한다.
  const placedOrder: string[] = [];
  const crossOf = new Map<string, number>();
  let cursor = 0;
  const place = (t: TreeNode): number => {
    const sz = sizes.get(t.id)!;
    const cross = dir === 'right' ? sz.h : sz.w;
    const start = cursor;
    let mid: number;
    if (!t.children.length) {
      mid = cursor + cross / 2;
      cursor += cross + gapCross;
    } else {
      const before = placedOrder.length;
      const mids = t.children.map(place);
      mid = (mids[0] + mids[mids.length - 1]) / 2;
      const have = cursor - gapCross - start;
      if (cross > have) {
        const shift = (cross - have) / 2;
        for (const id of placedOrder.slice(before)) crossOf.set(id, crossOf.get(id)! + shift);
        mid += shift;
        cursor = start + cross + gapCross;
      }
    }
    crossOf.set(t.id, mid);
    placedOrder.push(t.id);
    return mid;
  };

  if (roots) roots.forEach((r) => place(r));
  else place(root);

  for (const id of placedOrder) {
    const t = all.find((n) => n.id === id)!;
    const sz = sizes.get(id)!;
    const main = colStart.get(t.depth)! + (dir === 'right' ? sz.w / 2 : sz.h / 2);
    const cross = crossOf.get(id)!;
    out.set(id, { x: dir === 'right' ? main : cross, y: dir === 'right' ? cross : main, ...sz });
  }
  if (!includeRoot) out.delete(root.id);
  return out;
}

export function layoutMindmap(root: TreeNode, opts: LayoutOptions): PlacedMap {
  const fs = opts.fontSize;
  const rfs = opts.rootFontSize ?? Math.round(fs * 1.25);
  const placed = new Map<string, PlacedNode>();
  const rootSize = nodeSize(root, fs, rfs);

  const put = (t: TreeNode, x: number, y: number, w: number, h: number, side: 1 | -1) => {
    placed.set(t.id, { ...t, x, y, w, h, side, order: 0 });
  };

  if (opts.layout === 'radial' && root.children.length > 1) {
    // 1단계 가지를 잎 수가 비슷하게 오른쪽/왼쪽으로 나눈다
    const leaves = (t: TreeNode): number => (t.children.length ? t.children.reduce((a, c) => a + leaves(c), 0) : 1);
    const kids = root.children;
    const total = kids.reduce((a, c) => a + leaves(c), 0);
    const right: TreeNode[] = [];
    const left: TreeNode[] = [];
    let acc = 0;
    for (const k of kids) {
      if (acc < total / 2 || right.length === 0) {
        right.push(k);
        acc += leaves(k);
      } else left.push(k);
    }
    const half = (sideKids: TreeNode[], side: 1 | -1) => {
      if (!sideKids.length) return;
      const fake: TreeNode = { ...root, children: sideKids };
      const pos = tidy(fake, 'right', fs, rfs, false, sideKids);
      // 세로 가운데 맞춤
      const ys = [...pos.values()].map((p) => p.y);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      // 루트 오른쪽 끝에서 시작
      const depth1 = Math.min(...[...pos.values()].map((p) => p.x - p.w / 2));
      for (const [id, p] of pos) {
        const node = findNode(root, id)!;
        const dx = p.x - depth1 + rootSize.w / 2 + 56;
        put(node, side * dx, p.y - mid, p.w, p.h, side);
      }
    };
    half(right, 1);
    half(left, -1);
    put(root, 0, 0, rootSize.w, rootSize.h, 1);
  } else {
    const dir = opts.layout === 'down' ? 'down' : 'right';
    const pos = tidy(root, dir, fs, rfs, true);
    const r = pos.get(root.id)!;
    for (const [id, p] of pos) {
      const node = findNode(root, id)!;
      put(node, p.x - r.x, p.y - r.y, p.w, p.h, 1);
    }
  }

  // 펼치는 순서: 깊이 우선
  let order = 0;
  const visit = (t: TreeNode) => {
    const p = placed.get(t.id);
    if (p) p.order = order++;
    t.children.forEach(visit);
  };
  visit(root);

  const nodes = [...placed.values()];
  const edges: Edge[] = [];
  for (const n of nodes) {
    if (n.parentId && placed.has(n.parentId)) edges.push({ from: placed.get(n.parentId)!, to: n });
  }
  const minX = Math.min(...nodes.map((n) => n.x - n.w / 2));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w / 2));
  const minY = Math.min(...nodes.map((n) => n.y - n.h / 2));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h / 2));
  return { nodes, edges, minX, minY, maxX, maxY };
}

export function findNode(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

type P = { x: number; y: number };

/** 연결선의 곡선 (시작·조절점 둘·끝) */
export function edgeCurve(e: Edge, layout: Layout): [P, P, P, P] {
  const a = e.from;
  const b = e.to;
  if (layout === 'down') {
    const y1 = a.y + a.h / 2;
    const y2 = b.y - b.h / 2;
    const my = (y1 + y2) / 2;
    return [
      { x: a.x, y: y1 },
      { x: a.x, y: my },
      { x: b.x, y: my },
      { x: b.x, y: y2 },
    ];
  }
  const side = b.side;
  // 가운데 주제에서 나가는 선은 주제 상자 안쪽에서 시작해 굵은 뿌리가 상자에 묻히게
  const x1 = a.x + (side * a.w) / 2 - (a.depth === 0 ? side * 10 : 0);
  const x2 = b.x - (side * b.w) / 2;
  const mx = (x1 + x2) / 2;
  return [
    { x: x1, y: a.y },
    { x: mx, y: a.y },
    { x: mx, y: b.y },
    { x: x2, y: b.y },
  ];
}

const r2 = (n: number) => Math.round(n * 10) / 10;

/**
 * 끝으로 갈수록 가늘어지는 리본 모양 연결선 (채워서 그린다): 곡선을 따라 굵기를 w1 → w2 로 줄인다.
 * 손으로 그린 마인드맵처럼 가지가 굵게 뻗어 나와 끝에서 가늘어진다
 */
export function ribbonPath(e: Edge, layout: Layout, w1: number, w2: number, n = 20): string {
  const [p0, p1, p2, p3] = edgeCurve(e, layout);
  const at = (t: number): P => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  };
  const left: P[] = [];
  const right: P[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const p = at(t);
    const q = at(Math.min(1, t + 0.01));
    const o = at(Math.max(0, t - 0.01));
    let dx = q.x - o.x;
    let dy = q.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // 처음에 빨리 가늘어지다 천천히 (부드러운 붓 느낌)
    const w = (w2 + (w1 - w2) * (1 - t) * (1 - t * 0.35)) / 2;
    left.push({ x: p.x - dy * w, y: p.y + dx * w });
    right.push({ x: p.x + dy * w, y: p.y - dx * w });
  }
  const pts = [...left, ...right.reverse()];
  return `M${pts.map((p) => `${r2(p.x)} ${r2(p.y)}`).join('L')}Z`;
}

// ------------------------------------------------------------- 편집 도우미 (불변 업데이트)
let counter = 0;
export function newNodeId(existing: MindNode[]): string {
  const used = new Set(existing.map((n) => n.id));
  let id = '';
  do {
    counter += 1;
    id = `u${Date.now().toString(36)}${counter.toString(36)}`;
  } while (used.has(id));
  return id;
}

export function descendants(map: Mindmap, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of map.nodes) {
      if (n.parent_id === cur && !out.has(n.id)) {
        out.add(n.id);
        stack.push(n.id);
      }
    }
  }
  return out;
}

export function renameNode(map: Mindmap, id: string, label: string): Mindmap {
  const clean = label.trim().slice(0, 60);
  if (!clean) return map;
  if (id === ROOT_ID) return { ...map, root_label: clean, root_edited: true };
  return { ...map, nodes: map.nodes.map((n) => (n.id === id ? { ...n, label: clean, edited: true } : n)) };
}

export function addChild(map: Mindmap, parentId: string, label = '새 가지'): { map: Mindmap; id: string } {
  const id = newNodeId(map.nodes);
  const parent = parentId === ROOT_ID ? '' : parentId;
  return {
    id,
    map: {
      ...map,
      nodes: [...map.nodes, { id, parent_id: parent, label, icon: '', key_point_id: '', pages: [], edited: true }],
    },
  };
}

export function addSibling(map: Mindmap, id: string, label = '새 가지'): { map: Mindmap; id: string } {
  if (id === ROOT_ID) return addChild(map, ROOT_ID, label);
  const node = map.nodes.find((n) => n.id === id);
  const newId = newNodeId(map.nodes);
  const idx = map.nodes.findIndex((n) => n.id === id);
  const sib: MindNode = { id: newId, parent_id: node?.parent_id ?? '', label, icon: '', key_point_id: '', pages: [], edited: true };
  const nodes = [...map.nodes];
  nodes.splice(idx + 1, 0, sib);
  return { id: newId, map: { ...map, nodes } };
}

export function deleteNode(map: Mindmap, id: string): Mindmap {
  if (id === ROOT_ID) return map;
  const gone = descendants(map, id);
  gone.add(id);
  return { ...map, nodes: map.nodes.filter((n) => !gone.has(n.id)) };
}

/** 다른 가지 아래로 옮기기. 자기 자신이나 자손 아래로는 못 옮긴다 */
export function moveNode(map: Mindmap, id: string, newParent: string): Mindmap {
  if (id === ROOT_ID || id === newParent) return map;
  if (descendants(map, id).has(newParent)) return map;
  const parent = newParent === ROOT_ID ? '' : newParent;
  return { ...map, nodes: map.nodes.map((n) => (n.id === id ? { ...n, parent_id: parent, edited: true } : n)) };
}

/** 같은 부모 안에서 위(-1)/아래(+1)로 순서 바꾸기 */
export function reorderNode(map: Mindmap, id: string, delta: -1 | 1): Mindmap {
  const node = map.nodes.find((n) => n.id === id);
  if (!node) return map;
  const siblings = map.nodes.filter((n) => (n.parent_id || '') === (node.parent_id || ''));
  const i = siblings.findIndex((n) => n.id === id);
  const j = i + delta;
  if (j < 0 || j >= siblings.length) return map;
  const other = siblings[j];
  const a = map.nodes.findIndex((n) => n.id === id);
  const b = map.nodes.findIndex((n) => n.id === other.id);
  const nodes = [...map.nodes];
  [nodes[a], nodes[b]] = [nodes[b], nodes[a]];
  return { ...map, nodes: nodes.map((n) => (n.id === id ? { ...n, edited: true } : n)) };
}
