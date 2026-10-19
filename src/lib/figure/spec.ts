// 문제 그림과 단계 풀이의 '설계도'. AI 는 좌표와 도형 목록(JSON)만 주고, 그림은 앱이 그린다.
// 1) JSON 스키마: Claude structured outputs 에 넣는다 (재귀 없음, 모든 칸 필수, 안 쓰는 칸은 빈 값).
// 2) normalizeFigure·normalizeSteps: 받은 값을 검사해 그릴 수 있는 것만 남긴다 (DB 에도 이 모양으로 저장).
import { compileExpr } from './expr';

export const FIG_TYPES = ['point', 'segment', 'line', 'ray', 'vector', 'polygon', 'circle', 'arc', 'angle', 'function', 'text', 'box', 'arrow'] as const;
export type FigType = (typeof FIG_TYPES)[number];

/** given: 문제에 주어진 것, aux: 보조선(점선), answer: 답·결과(강조 색), muted: 흐리게 */
export const FIG_STYLES = ['given', 'aux', 'answer', 'muted'] as const;
export type FigStyle = (typeof FIG_STYLES)[number];

export type FigItem = {
  id: string;
  type: FigType;
  /** 쓰는 점(상자) 번호들. 선분·직선·반직선·벡터: [시작, 끝], 다각형: 꼭짓점들, 원: [중심] 또는 [중심, 지나는 점], 호: [중심, 시작, 끝], 각: [한쪽, 꼭짓점, 다른 쪽], 화살표: [시작, 끝] */
  refs: string[];
  /** 점·글·상자의 가운데 */
  x: number;
  y: number;
  /** 상자 크기 */
  w: number;
  h: number;
  /** 원 반지름 */
  r: number;
  /** 함수식 (x 에 대한 식) */
  expr: string;
  /** 함수 그리는 범위 (from < to 일 때만) */
  from: number;
  to: number;
  label: string;
  style: FigStyle;
  /** 같은 길이 표시(선분) 또는 같은 각 표시(각) 개수 */
  marks: number;
};

export type FigView = { x_min: number; x_max: number; y_min: number; y_max: number };

export type Figure = {
  v: 1;
  view: FigView;
  /** x·y 축과 눈금 */
  axes: boolean;
  /** 모눈 */
  grid: boolean;
  items: FigItem[];
};

export type Step = {
  /** 이 단계의 설명 ($수식$ 가능) */
  text: string;
  /** 이 단계에서 처음 나타나는 그림 요소 */
  add: string[];
  /** 이 단계에서 강조할 그림 요소 */
  focus: string[];
};

export const FIGURE_LIMITS = { items: 30, steps: 8, label: 40, expr: 100, id: 16, stepText: 400, coord: 1e6 } as const;

// ---------------------------------------------------------------- AI 에게 줄 JSON 스키마
type JsonSchema = Record<string, unknown>;
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const int = { type: 'integer' } as const;
const bool = { type: 'boolean' } as const;
const strArr = { type: 'array', items: str } as const;
function obj(properties: Record<string, unknown>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export const figureJsonSchema: JsonSchema = obj({
  include: bool,
  view: obj({ x_min: num, x_max: num, y_min: num, y_max: num }),
  axes: bool,
  grid: bool,
  items: {
    type: 'array',
    items: obj({
      id: str,
      type: { type: 'string', enum: [...FIG_TYPES] },
      refs: strArr,
      x: num,
      y: num,
      w: num,
      h: num,
      r: num,
      expr: str,
      from: num,
      to: num,
      label: str,
      style: { type: 'string', enum: [...FIG_STYLES] },
      marks: int,
    }),
  },
});

export const stepsJsonSchema: JsonSchema = { type: 'array', items: obj({ text: str, add: strArr, focus: strArr }) };
/** 그림 없이 글로만 된 단계 (무료 채팅) */
export const textStepsJsonSchema: JsonSchema = { type: 'array', items: obj({ text: str }) };

// ---------------------------------------------------------------- 검사
const fin = (v: unknown, fb = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.max(-FIGURE_LIMITS.coord, Math.min(FIGURE_LIMITS.coord, n));
};
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

type Raw = Record<string, unknown>;

function rawItems(raw: unknown): Raw[] {
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as Raw).items;
  return Array.isArray(items) ? (items.filter((x) => x && typeof x === 'object') as Raw[]) : [];
}

/** 받은 그림이 쓸 만하면 Figure, 아니면 null. include 가 false 이거나 그릴 것이 없으면 null */
export function normalizeFigure(raw: unknown): Figure | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  if (r.include === false) return null;
  const seen = new Set<string>();
  const items: FigItem[] = [];
  for (const it of rawItems(raw).slice(0, FIGURE_LIMITS.items * 2)) {
    const type = String(it.type ?? '').toLowerCase() as FigType;
    if (!FIG_TYPES.includes(type)) continue;
    let id = text(it.id, FIGURE_LIMITS.id) || `${type}${items.length + 1}`;
    while (seen.has(id)) id = `${id}'`;
    const style = FIG_STYLES.includes(it.style as FigStyle) ? (it.style as FigStyle) : 'given';
    const refs = Array.isArray(it.refs)
      ? it.refs
          .map((x) => text(x, FIGURE_LIMITS.id))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const item: FigItem = {
      id,
      type,
      refs,
      x: fin(it.x),
      y: fin(it.y),
      w: Math.abs(fin(it.w)),
      h: Math.abs(fin(it.h)),
      r: Math.abs(fin(it.r)),
      expr: text(it.expr, FIGURE_LIMITS.expr),
      from: fin(it.from),
      to: fin(it.to),
      label: text(it.label, FIGURE_LIMITS.label),
      style,
      marks: Math.max(0, Math.min(3, Math.round(fin(it.marks)))),
    };
    seen.add(id);
    items.push(item);
  }
  // 없는 것을 가리키는 요소는 빼고, 개수를 줄인 뒤 한 번 더 뺀다 (줄이다가 잘린 점을 가리키는 선이 남지 않게)
  const kept = prune(prune(items).slice(0, FIGURE_LIMITS.items));
  if (!kept.some((i) => i.type !== 'point' || i.label)) return null;
  const view = normalizeView(r.view, kept);
  return { v: 1, view, axes: r.axes === true, grid: r.grid === true, items: kept };
}

/** 그리기 전에 한 번 더: 없는 것을 가리키는 요소를 뺀 그림 (예전에 저장한 그림도 그리다가 멈추지 않게) */
export function pruneFigure(f: Figure): Figure {
  const items = prune(f.items);
  return items.length === f.items.length ? f : { ...f, items };
}

/** 없는 것을 가리키는 요소를 뺀다 (뺀 것을 가리키던 것도 다시 빼므로 바뀌지 않을 때까지) */
function prune(items: FigItem[]): FigItem[] {
  let kept = items;
  for (;;) {
    const byId = new Map(kept.map((i) => [i.id, i]));
    const next = kept.filter((i) => valid(i, byId));
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

function isPoint(i: FigItem | undefined): i is FigItem {
  return !!i && i.type === 'point';
}

function valid(i: FigItem, byId: Map<string, FigItem>): boolean {
  const pts = i.refs.map((id) => byId.get(id));
  switch (i.type) {
    case 'point':
      return true;
    case 'segment':
    case 'line':
    case 'ray':
    case 'vector':
      return i.refs.length >= 2 && isPoint(pts[0]) && isPoint(pts[1]) && !samePlace(pts[0], pts[1]);
    case 'polygon':
      return i.refs.length >= 3 && pts.every(isPoint);
    case 'circle':
      if (i.refs.length >= 2 && isPoint(pts[0]) && isPoint(pts[1])) return !samePlace(pts[0], pts[1]);
      return i.refs.length >= 1 && isPoint(pts[0]) && i.r > 0;
    case 'arc':
    case 'angle':
      return i.refs.length >= 3 && pts.slice(0, 3).every(isPoint) && !samePlace(pts[0]!, pts[1]!) && !samePlace(pts[2]!, pts[1]!);
    case 'function':
      return !!compileExpr(i.expr);
    case 'text':
      return !!i.label;
    case 'box':
      return !!i.label;
    case 'arrow':
      return (
        i.refs.length >= 2 && pts.slice(0, 2).every((p) => !!p && (p.type === 'point' || p.type === 'box' || p.type === 'text')) && i.refs[0] !== i.refs[1]
      );
    default:
      return false;
  }
}

function samePlace(a: FigItem, b: FigItem): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/** 보이는 범위: 받은 값이 이상하면 점·상자·글을 모두 담는 범위로 */
function normalizeView(raw: unknown, items: FigItem[]): FigView {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  let view: FigView = { x_min: fin(v.x_min, NaN), x_max: fin(v.x_max, NaN), y_min: fin(v.y_min, NaN), y_max: fin(v.y_max, NaN) };
  const ok = [view.x_min, view.x_max, view.y_min, view.y_max].every(Number.isFinite) && view.x_max - view.x_min > 1e-6 && view.y_max - view.y_min > 1e-6;
  const pts = extents(items);
  if (!ok) {
    if (!pts) return { x_min: -5, x_max: 5, y_min: -5, y_max: 5 };
    view = pad({ x_min: pts.x_min, x_max: pts.x_max, y_min: pts.y_min, y_max: pts.y_max }, 0.15);
  } else if (pts) {
    // 받은 범위 밖으로 나간 점이 있으면 넓힌다 (그림이 잘리지 않게)
    const out = pts.x_min < view.x_min || pts.x_max > view.x_max || pts.y_min < view.y_min || pts.y_max > view.y_max;
    if (out) {
      view = pad(
        {
          x_min: Math.min(view.x_min, pts.x_min),
          x_max: Math.max(view.x_max, pts.x_max),
          y_min: Math.min(view.y_min, pts.y_min),
          y_max: Math.max(view.y_max, pts.y_max),
        },
        0.08,
      );
    }
  }
  return view;
}

function pad(v: FigView, k: number): FigView {
  const w = Math.max(v.x_max - v.x_min, 1);
  const h = Math.max(v.y_max - v.y_min, 1);
  return { x_min: v.x_min - w * k, x_max: v.x_max + w * k, y_min: v.y_min - h * k, y_max: v.y_max + h * k };
}

/** 점·상자·글·원이 차지하는 범위 (없으면 null) */
export function extents(items: FigItem[]): FigView | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const i of items) {
    if (i.type === 'point' || i.type === 'text') {
      xs.push(i.x);
      ys.push(i.y);
    } else if (i.type === 'box') {
      const w = i.w || 2;
      const h = i.h || 1;
      xs.push(i.x - w / 2, i.x + w / 2);
      ys.push(i.y - h / 2, i.y + h / 2);
    } else if (i.type === 'circle') {
      const c = byId.get(i.refs[0]);
      if (!c) continue;
      const through = i.refs[1] ? byId.get(i.refs[1]) : undefined;
      const r = through ? Math.hypot(through.x - c.x, through.y - c.y) : i.r;
      xs.push(c.x - r, c.x + r);
      ys.push(c.y - r, c.y + r);
    }
  }
  if (!xs.length) return null;
  return { x_min: Math.min(...xs), x_max: Math.max(...xs), y_min: Math.min(...ys), y_max: Math.max(...ys) };
}

/** 단계 풀이 검사: 글이 있는 단계만, 그림 요소 번호는 있는 것만, 한 요소는 한 단계에서만 나타난다 */
export function normalizeSteps(raw: unknown, figure: Figure | null): Step[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set((figure?.items ?? []).map((i) => i.id));
  const added = new Set<string>();
  const out: Step[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const t = typeof (s as Raw).text === 'string' ? ((s as Raw).text as string).trim().slice(0, FIGURE_LIMITS.stepText) : '';
    if (!t) continue;
    const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => text(x, FIGURE_LIMITS.id)).filter((x) => ids.has(x)))] : []);
    const add = list((s as Raw).add).filter((id) => !added.has(id));
    add.forEach((id) => added.add(id));
    out.push({ text: t, add, focus: list((s as Raw).focus) });
    if (out.length >= FIGURE_LIMITS.steps) break;
  }
  return out;
}

/** 문제와 같이 보이는 요소 (어느 단계에서도 나타나지 않는 것) */
export function baseItemIds(figure: Figure, steps: Step[]): Set<string> {
  const later = new Set(steps.flatMap((s) => s.add));
  return new Set(figure.items.filter((i) => !later.has(i.id)).map((i) => i.id));
}

/** 문제와 같이 보여 줄 그림이 있는지 (점만 몇 개 있는 것은 그림이 아니다) */
export function hasBaseFigure(figure: Figure | null, steps: Step[]): boolean {
  if (!figure) return false;
  const base = baseItemIds(figure, steps);
  return figure.items.some((i) => base.has(i.id) && (i.type !== 'point' || !!i.label)) || (figure.axes && figure.items.some((i) => base.has(i.id)));
}

/** k 번째 단계(0부터)까지 보이는 요소. k 가 -1 이면 문제 그림만 */
export function visibleAt(figure: Figure, steps: Step[], k: number): Set<string> {
  const vis = baseItemIds(figure, steps);
  for (let i = 0; i <= k && i < steps.length; i++) for (const id of steps[i].add) vis.add(id);
  // 보이는 요소가 쓰는 점은 늘 같이 보인다 (점만 따로 숨기면 선이 허공에 뜬다)
  const byId = new Map(figure.items.map((i) => [i.id, i]));
  for (const id of [...vis]) for (const r of byId.get(id)?.refs ?? []) vis.add(r);
  return vis;
}

/** DB 에서 읽은 값 (예전 문제는 null) */
export function readFigure(v: unknown): Figure | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Raw;
  if (f.v !== 1 || !Array.isArray(f.items)) return null;
  return normalizeFigure({ ...f, include: true });
}

export function readSteps(v: unknown, figure: Figure | null): Step[] {
  return normalizeSteps(v, figure);
}
