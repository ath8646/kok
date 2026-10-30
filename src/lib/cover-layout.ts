// 표지 그림 v2 의 배치 (lib/cover.ts): 모양(연표·흐름·구조·순환·비교·핵심어·공식·그림)과 글로, 카드의 실제 크기(px)에 맞춰
// 자리·글자 크기를 정해 그릴 조각(Prim)을 만든다. 화면과 상관없는 순수 코드 (시험 cover.test.ts, 눈으로 보기 tools/cover-lab).
//
// 디자인 규칙
// - 색은 과목 색 하나(p)와 글자 색: 바탕색 상자에 과목 색 가는 테두리, 가장 중요한 것(key)만 과목 색으로 꽉 칠하고 글자는 바탕색
//   (비교의 오른쪽만 짝 색 p2). 과목 색 글자는 바탕(옅은 과목 색) 위에만 둔다 (그보다 짙은 칠 위에서는 4.5 가 안 될 수 있다)
// - 글자 크기는 카드 크기로 정하고(폰 카드 약 11.5px, 가장 작게 10px), 넘치면 두 줄 → 조금 작게 → 다른 배치 → 그래도 넘치면 … 로 자른다.
//   글이 도형 밖으로 나가거나 도형끼리 겹치지 않는다
// - 오른쪽 위(카드의 별·⋯ 단추 자리)는 늘 비운다
// - 배치는 모양마다 큰 카드에 어울리는 것부터 해 보고(가로 흐름·조직도·고리), 좁으면 작은 카드용(ㄹ자 흐름·단계 목록·들여 쓴 나무·되돌이 목록)으로
import type { CoverItem, CoverV2 } from './cover';
import { previewText } from './richtext';

/** 색 이름 → 화면이 칠하는 색 (CoverArt: p 과목 색, p2 짝 색, ink 글자, muted 흐린 글자, on 꽉 칠한 곳 위 글자, paper 바탕) */
export type Ink = 'p' | 'p2' | 'ink' | 'muted' | 'on' | 'paper';

export type Prim =
  | { t: 'path'; d: string; stroke?: Ink; w?: number; op?: number; dash?: string; fill?: Ink; fillOp?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: Ink; fillOp?: number; stroke?: Ink; w?: number; op?: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: Ink; fillOp?: number; stroke?: Ink; sw?: number; op?: number }
  /** 글: (x, y) 는 글 덩어리 가운데 높이. anchor 는 가로 맞춤 */
  | { t: 'text'; x: number; y: number; lines: string[]; size: number; weight: number; fill: Ink; anchor: 'start' | 'middle' | 'end'; lh: number };

export type Area = { x: number; y: number; w: number; h: number };
/** 공식 표지: 큰 공식(KaTeX)과 기호 알약은 화면이 HTML 로 그린다. size 로 그려 보고 넘치면 min 까지 줄인다 */
export type FormulaPlan = Area & { size: number; min: number; chip: number; chipH: number; gap: number };
export type CoverPlan = { prims: Prim[]; /** kind figure: 그래프·도형을 그릴 자리 */ figure?: Area; formula?: FormulaPlan };
export type CoverSize = {
  w: number;
  h: number;
  /** 오른쪽 위 비워 둘 곳 (카드의 별·⋯ 단추) */
  reserve?: { w: number; h: number };
  /** 실제 글꼴이 표(charW)보다 넓은 만큼 (coverFont). 없으면 표 그대로 */
  font?: CoverFont;
};
/** 글자 너비 배율 (한글, 그 밖의 글자). 1 = 표 그대로 */
export type CoverFont = { hangul: number; latin: number };

/** 카드 오른쪽 위 단추 자리 (자료함 카드: 32px 단추 둘 = 표지 칸 오른쪽 위 64×32 + 여유) */
export const COVER_RESERVE = { w: 70, h: 36 } as const;
/** 별표 단추가 없는 카드 (자료함 정리 기능이 없는 예전 DB: ⋯ 단추 하나) */
export const COVER_RESERVE_MENU = { w: 38, h: 36 } as const;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- 글 재기·나누기
const PLAIN: CoverFont = { hangul: 1, latin: 1 };
/** 지금 배치하는 표지의 글꼴 배율 (layoutCover 가 그리는 동안만 바꾼다) */
let font: CoverFont = PLAIN;

/**
 * 글자 하나의 너비 (글자 크기에 대한 비율). 한글은 글꼴마다 0.82~0.93em 이라 넉넉히 0.94em,
 * 영문·숫자는 기본 글꼴(Pretendard)을 잰 값보다 조금 넉넉히. 이보다 넓은 글꼴(터미널 테마의 고정폭 글꼴은 한글 1em)은
 * 화면이 실제 글꼴로 재서(coverFont) 배율을 넘긴다
 */
function charW(ch: string, f: CoverFont): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x2e80) return 0.94 * f.hangul;
  return latinW(ch) * f.latin;
}

function latinW(ch: string): number {
  if (ch === ' ') return 0.27;
  if ("ijlI|!.,:;'`".includes(ch)) return 0.31;
  if ('ftr()[]{}/-'.includes(ch)) return 0.43;
  if ('mwMW'.includes(ch)) return 0.93;
  if (/[A-Z0-9]/.test(ch)) return 0.7;
  if (/[a-z]/.test(ch)) return 0.61;
  if ('→…'.includes(ch)) return 0.94;
  if ('⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉ₐₑₖₙₘₓ'.includes(ch)) return 0.46;
  return 0.72;
}

/** 글 너비 (굵으면 조금 더) */
export function measure(s: string, size: number, weight = 700, f: CoverFont = font): number {
  let w = 0;
  for (const ch of s) w += charW(ch, f);
  return w * size * (weight >= 700 ? 1.03 : 1);
}

/** 화면이 실제 글꼴로 재는 글 (굵게, 글자 크기 1 에 대한 너비를 coverFont 에 넘긴다) */
export const FONT_SAMPLE = { hangul: '가나다라마바사아자차', latin: 'ATP 1392 mitochondria' } as const;

/**
 * 실제 글꼴로 잰 FONT_SAMPLE 의 너비 → 표보다 넓은 만큼의 배율 (2% 여유). 표보다 좁은 글꼴은 1 (표의 여유를 그대로 둔다).
 * 잴 수 없었으면(0·NaN) 1
 */
export function coverFont(w: { hangul: number; latin: number }): CoverFont {
  const k = (real: number, s: string) => {
    const table = measure(s, 1, 700, PLAIN);
    return Number.isFinite(real) && real > 0 ? Math.max(1, Math.round(((real * 1.02) / table) * 1000) / 1000) : 1;
  };
  return { hangul: k(w.hangul, FONT_SAMPLE.hangul), latin: k(w.latin, FONT_SAMPLE.latin) };
}

/** maxW 안에 들게 끝을 … 로 자른다 (한 글자도 안 들어가면 빈 글) */
function ellipsize(s: string, size: number, maxW: number, weight = 700): string {
  if (measure(s, size, weight) <= maxW) return s;
  const chars = [...s];
  while (chars.length > 1 && measure(`${chars.join('').trimEnd()}…`, size, weight) > maxW) chars.pop();
  const out = `${chars.join('').trimEnd()}…`;
  return measure(out, size, weight) <= maxW ? out : '';
}

/** 낱말 사이에서 두 줄로 (두 줄의 길이가 비슷하게). 낱말이 하나면 null */
function twoLines(s: string, size: number, weight: number): [string, string] | null {
  const words = s.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let bestW = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' ');
    const b = words.slice(k).join(' ');
    const m = Math.max(measure(a, size, weight), measure(b, size, weight));
    // 같으면 뒤에서 나눈 것 (첫 줄이 긴 쪽이 읽기 쉽다)
    if (m <= bestW + 0.01) {
      bestW = m;
      best = [a, b];
    }
  }
  return best;
}

export type Fit = { lines: string[]; size: number; w: number };

/**
 * 글을 maxW 안에: 큰 글자 한 줄 → 큰 글자 두 줄 → 한 단계 작게 … → 가장 작은 글자에서도 넘치면 … 로 자른다.
 * sizes: 해 볼 글자 크기 (큰 것부터)
 */
export function fitText(s: string, maxW: number, sizes: number[], o: { lines?: number; weight?: number } = {}): Fit {
  const weight = o.weight ?? 700;
  const maxLines = o.lines ?? 2;
  const widthOf = (lines: string[], size: number) => Math.max(...lines.map((l) => measure(l, size, weight)));
  for (const size of sizes) {
    if (measure(s, size, weight) <= maxW) return { lines: [s], size, w: measure(s, size, weight) };
    if (maxLines > 1) {
      const two = twoLines(s, size, weight);
      if (two && widthOf(two, size) <= maxW) return { lines: two, size, w: widthOf(two, size) };
    }
  }
  const size = sizes[sizes.length - 1];
  const two = maxLines > 1 ? twoLines(s, size, weight) : null;
  const lines = two ? two.map((l) => ellipsize(l, size, maxW, weight)) : [ellipsize(s, size, maxW, weight)];
  return { lines, size, w: widthOf(lines, size) };
}

/** … 로 잘랐거나 한 글자도 안 들어간 글인지 */
const cut = (f: Fit | null | undefined) => !!f && f.lines.some((l) => l === '' || l.endsWith('…'));

/** 큰 것부터 0.5px 씩 작게 (끝은 꼭 to) */
function steps(from: number, to: number): number[] {
  const out: number[] = [];
  for (let s = from; s > to + 0.01; s -= 0.5) out.push(r1(s));
  out.push(r1(to));
  return out;
}

/** 표지 글: 수식($…$, 첨자 표시)은 읽을 수 있는 글자로, 꾸미기 기호는 빼고 */
const show = (s: string) => previewText(s);

// ---------------------------------------------------------------- 판 (크기·여백·비울 곳)
type Geo = {
  w: number;
  h: number;
  pad: number;
  /** 비울 곳: x > rx 이고 y < ry */
  rx: number;
  ry: number;
  /** 단추 자리 아래 (가로 전체) */
  band: Area;
  /** 단추 자리 왼쪽 (세로 전체) */
  left: Area;
  full: Area;
  /** 큰 글·작은 글·가장 작은 글 */
  f: number;
  fs: number;
  min: number;
};

export function coverGeo(size: CoverSize): Geo {
  const { w, h } = size;
  const reserve = size.reserve ?? COVER_RESERVE;
  const pad = clamp(Math.round(Math.min(w, h) * 0.075), 8, 16);
  // 비울 곳이 없으면(표지 그림 창) 판 밖으로
  const rx = reserve.w > 0 ? w - reserve.w : w + 1;
  const ry = reserve.h > 0 ? reserve.h : -1;
  const bandTop = Math.max(pad, ry + 2);
  // 글자 크기: 폰 카드(약 161×110)는 11.5px, 넓은 카드는 13~14px, 표지 그림 창의 큰 미리보기는 16px
  const f = r1(clamp(Math.min(w / 14.2, h / 9.2), 11.5, 16));
  return {
    w,
    h,
    pad,
    rx,
    ry,
    band: { x: pad, y: bandTop, w: w - pad * 2, h: h - pad - bandTop },
    left: { x: pad, y: pad, w: Math.min(w - pad * 2, rx - 6 - pad), h: h - pad * 2 },
    full: { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 },
    f,
    fs: r1(Math.max(10, f * 0.84)),
    min: 10,
  };
}

const overlap = (a: Area, b: Area, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const within = (o: Area, b: Area) => b.x >= o.x - 0.5 && b.y >= o.y - 0.5 && b.x + b.w <= o.x + o.w + 0.5 && b.y + b.h <= o.y + o.h + 0.5;
/** 상자가 비울 곳(오른쪽 위 단추 자리)에 들어가는지 */
const hitsReserve = (g: Geo, b: Area) => b.x + b.w > g.rx && b.y < g.ry;
/** 상자들이 판 안에 있고, 단추 자리에 닿지 않고, 서로 겹치지 않는지 */
function clean(g: Geo, boxes: Area[], m = 3): boolean {
  if (boxes.some((b) => !within(g.full, b) || hitsReserve(g, b))) return false;
  return !boxes.some((a, i) => boxes.some((b, j) => j > i && overlap(a, b, m)));
}

type Mode = (size: number) => Prim[] | null;

/**
 * 배치 고르기 (안 되면 null):
 * 1) 주된 배치(큰 카드에 어울리는 것)를 큰 글자(f ~ f-1.5)로 2) 주된 배치를 가장 작은 글자까지 3) 좁은 카드용 배치를 큰 글자부터
 */
function tryModes(g: Geo, primary: Mode[], compact: Mode[] = []): Prim[] | null {
  const floor = Math.max(g.min, g.f - 1.5);
  const passes: Array<[Mode[], number, number]> = [
    [primary, g.f, floor],
    [primary, floor, g.min],
    [compact, g.f, g.min],
  ];
  for (const [modes, hi, lo] of passes) {
    for (const mode of modes) {
      for (const size of steps(hi, lo)) {
        const r = mode(size);
        if (r) return r;
      }
    }
  }
  return null;
}

/**
 * 남길 차례: 가장 중요한 것(key) → 처음 → 끝 → 이미 고른 것에서 가장 먼 것 (고르게 남는다)
 */
function keepOrder(n: number, keyI: number): number[] {
  const chosen: number[] = [];
  const add = (i: number) => {
    if (i >= 0 && i < n && !chosen.includes(i)) chosen.push(i);
  };
  add(keyI);
  add(0);
  add(n - 1);
  while (chosen.length < n) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (chosen.includes(i)) continue;
      const d = Math.min(...chosen.map((c) => Math.abs(c - i)));
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

/**
 * 글이 너무 많아 어떤 배치에도 안 들어가면 덜 중요한 것부터 뺀 목록들 (연표·구조·핵심어만: 흐름·순환은 단계를 빼면 틀린 그림이 된다).
 * 차례는 그대로 둔다
 */
function* trims(items: CoverItem[], min: number): Generator<CoverItem[]> {
  yield items;
  const order = keepOrder(
    items.length,
    items.findIndex((i) => i.key),
  );
  for (let keep = items.length - 1; keep >= Math.max(2, min); keep--) {
    const idx = new Set(order.slice(0, keep));
    yield items.filter((_, i) => idx.has(i));
  }
}

// ---------------------------------------------------------------- 그리기 조각
const LH = 1.22;

function textPrim(x: number, y: number, fit: Fit, fill: Ink, weight: number, anchor: 'start' | 'middle' | 'end' = 'middle'): Prim {
  return { t: 'text', x: r1(x), y: r1(y), lines: fit.lines, size: fit.size, weight, fill, anchor, lh: r1(fit.size * LH) };
}

const rnd = (b: Area) => ({ x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) });

type BoxStyle = 'plain' | 'solid' | 'strong';

/**
 * 둥근 상자 + 가운데 글. plain: 바탕색 상자에 과목 색 가는 테두리, solid: 과목 색으로 꽉 칠 (가장 중요한 것),
 * strong: 굵은 테두리 (가장 중요한 부분). 글은 글자 색이나 꽉 칠한 곳 위 글자 색만
 */
function boxPrims(b: Area, fit: Fit, style: BoxStyle, ink: Ink = 'p'): Prim[] {
  const r = Math.min(7, b.h / 2);
  const rect: Prim =
    style === 'solid'
      ? { t: 'rect', ...rnd(b), r, fill: ink }
      : { t: 'rect', ...rnd(b), r, fill: 'paper', stroke: ink, sw: style === 'strong' ? 2 : 1.25, op: style === 'strong' ? 1 : 0.62 };
  const fill: Ink = style === 'solid' ? 'on' : 'ink';
  return [rect, textPrim(b.x + b.w / 2, b.y + b.h / 2, fit, fill, style === 'plain' ? 650 : 800)];
}

/** 끝에 작은 삼각형 머리가 달린 선 (점들을 잇는다) */
function arrowPrims(pts: Array<[number, number]>, ink: Ink = 'p', o: { w?: number; op?: number; head?: number } = {}): Prim[] {
  if (pts.length < 2) return [];
  const w = o.w ?? 1.6;
  const head = o.head ?? 5.5;
  const op = o.op ?? 0.75;
  const [x2, y2] = pts[pts.length - 1];
  const [x1, y1] = pts[pts.length - 2];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  // 선은 머리 안쪽까지만 (끝이 머리 밖으로 삐져나오지 않게)
  const end: [number, number] = [x2 - ux * head * 0.7, y2 - uy * head * 0.7];
  const line = [...pts.slice(0, -1), end];
  const d = line.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join(' ');
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const hw = head * 0.6;
  const tri = `M${r1(x2)} ${r1(y2)} L${r1(bx - uy * hw)} ${r1(by + ux * hw)} L${r1(bx + uy * hw)} ${r1(by - ux * hw)} Z`;
  return [
    { t: 'path', d, stroke: ink, w, op },
    { t: 'path', d: tri, fill: ink, fillOp: op },
  ];
}

/** 꺾인 선 (둥근 모서리) */
function elbowPath(pts: Array<[number, number]>, radius = 6): string {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join(' ');
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py) || 1;
    const l2 = Math.hypot(nx - cx, ny - cy) || 1;
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    const ax = cx - ((cx - px) / l1) * rr;
    const ay = cy - ((cy - py) / l1) * rr;
    const bx = cx + ((nx - cx) / l2) * rr;
    const by = cy + ((ny - cy) / l2) * rr;
    d += ` L${r1(ax)} ${r1(ay)} Q${r1(cx)} ${r1(cy)} ${r1(bx)} ${r1(by)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${r1(last[0])} ${r1(last[1])}`;
}

const line = (pts: Array<[number, number]>, o: { w?: number; op?: number; elbow?: boolean } = {}): Prim => ({
  t: 'path',
  d: o.elbow ? elbowPath(pts, 6) : pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join(' '),
  stroke: 'p',
  w: o.w ?? 1.5,
  op: o.op ?? 0.5,
});

/** 상자 안쪽 여백 */
const padX = (size: number) => Math.max(6.5, size * 0.6);
const padY = (size: number) => Math.max(3.5, size * 0.36);

/** 상자 크기: 글 + 안쪽 여백 */
function boxOf(fit: Fit, minW = 0): { w: number; h: number } {
  return { w: Math.max(minW, fit.w + padX(fit.size) * 2), h: fit.lines.length * fit.size * LH + padY(fit.size) * 2 };
}

/** 상자 안 글이 들어갈 너비 (상자 너비에서 안쪽 여백을 뺀 것) */
const innerW = (boxW: number, size: number) => boxW - padX(size) * 2;

/** 단계 동그라미 (번호): 가장 중요한 단계는 꽉 칠한다 */
function nodePrims(cx: number, cy: number, r: number, n: number, key: boolean): Prim[] {
  const num: Fit = { lines: [String(n)], size: r1(clamp(r * 1.25, 9, 11)), w: 0 };
  return key
    ? [{ t: 'circle', cx: r1(cx), cy: r1(cy), r: r1(r), fill: 'p' }, textPrim(cx, cy, num, 'on', 800)]
    : [{ t: 'circle', cx: r1(cx), cy: r1(cy), r: r1(r), fill: 'paper', stroke: 'p', w: 1.4, op: 0.75 }, textPrim(cx, cy, num, 'ink', 800)];
}

// ================================================================ 연표
/** 연표: 가로선 위에 때, 아래에 사건. 붐비면 위아래로 번갈아(때는 늘 선 가까이). 가장 중요한 사건은 큰 점과 굵은 글 */
function timeline(c: CoverV2, g: Geo): Prim[] {
  let last = c.items;
  for (const items of trims(c.items, 2)) {
    const r = timelineOf(items, g, false);
    if (r) return r;
    last = items;
  }
  // 어디에도 안 들어가면: 단추 자리 아래에 들어가는 줄 수만큼 세로로 (넘치는 글은 … )
  const rows = Math.max(2, Math.floor(g.band.h / timelineRowH(g.min)));
  let items = c.items;
  for (const t of trims(c.items, 2)) {
    items = t;
    if (t.length <= rows) break;
  }
  return timelineOf(items.length <= rows ? items : last, g, true) ?? [];
}

function timelineOf(items: CoverItem[], g: Geo, forced: boolean): Prim[] | null {
  const n = items.length;
  const A = g.band;
  const cell = A.w / n;
  type Lab = { year: Fit | null; ev: Fit; up: boolean; x: number; w: number };
  const build = (size: number, alternate: boolean, force = false): Prim[] | null => {
    const ys = r1(Math.max(g.min, size * 0.94));
    // 이웃한 사건 이름 사이는 적어도 이만큼 (붙어 있으면 두 사건이 한 낱말처럼 읽힌다)
    const sep = Math.max(7, size * 0.6);
    const maxW = alternate ? cell * 2 - sep : cell - sep;
    const labs: Lab[] = items.map((it, i) => {
      const year = it.sub ? fitText(show(it.sub), maxW, [ys], { lines: 1, weight: 750 }) : null;
      const ev = fitText(show(it.text), maxW, [size], { lines: 2, weight: it.key ? 800 : 650 });
      const w = Math.max(year?.w ?? 0, ev.w);
      const cx = A.x + cell * (i + 0.5);
      // 끝의 글은 판 안으로 당긴다 (점은 제자리)
      return { year, ev, up: alternate && i % 2 === 1, x: clamp(cx, A.x + w / 2, A.x + A.w - w / 2), w };
    });
    if (!force && labs.some((l) => cut(l.ev) || cut(l.year))) return null;
    // 같은 쪽 이웃끼리 겹치지 않게
    if (!force)
      for (const side of [false, true]) {
        const row = labs.filter((l) => l.up === side);
        for (let k = 1; k < row.length; k++) if (row[k - 1].x + row[k - 1].w / 2 + sep > row[k].x - row[k].w / 2 + 0.5) return null;
      }
    const gap = Math.max(3, size * 0.3);
    const yearH = ys * LH;
    const evH = (l: Lab) => l.ev.lines.length * l.ev.size * LH;
    const block = (l: Lab) => (l.year ? yearH : 0) + evH(l);
    const dotR = Math.max(3.6, size * 0.34);
    const keyR = Math.max(4.6, size * 0.45);
    const mid = keyR + 4;
    let above: number;
    let below: number;
    if (!alternate) {
      above = labs.some((l) => l.year) ? yearH : 0;
      below = Math.max(...labs.map(evH));
    } else {
      above = Math.max(0, ...labs.filter((l) => l.up).map(block));
      below = Math.max(0, ...labs.filter((l) => !l.up).map(block));
    }
    const total = (above ? above + gap : 0) + mid * 2 + (below ? gap + below : 0);
    if (!force && total > A.h + 0.5) return null;
    const top = A.y + Math.max(0, (A.h - total) / 2);
    const yLine = top + (above ? above + gap : 0) + mid;
    const out: Prim[] = [];
    // 시간 축: 판 끝에서 끝까지, 오른쪽 끝에 작은 화살 머리 (시간이 흐르는 쪽)
    out.push(
      ...arrowPrims(
        [
          [A.x, yLine],
          [A.x + A.w, yLine],
        ],
        'p',
        { w: 1.8, op: 0.4, head: 6 },
      ),
    );
    labs.forEach((l, i) => {
      const it = items[i];
      const dx = A.x + cell * (i + 0.5);
      if (it.key) {
        out.push({ t: 'circle', cx: r1(dx), cy: r1(yLine), r: r1(keyR + 3.5), fill: 'p', fillOp: 0.16 });
        out.push({ t: 'circle', cx: r1(dx), cy: r1(yLine), r: r1(keyR), fill: 'p' });
      } else {
        out.push({ t: 'circle', cx: r1(dx), cy: r1(yLine), r: r1(dotR), fill: 'paper', stroke: 'p', w: 1.8 });
      }
      const ew = it.key ? 800 : 650;
      if (!l.up) {
        let y = yLine + mid + gap;
        if (alternate && l.year) {
          out.push(textPrim(l.x, y + yearH / 2, l.year, 'p', 750));
          y += yearH;
        } else if (l.year) out.push(textPrim(l.x, yLine - mid - gap - yearH / 2, l.year, 'p', 750));
        out.push(textPrim(l.x, y + evH(l) / 2, l.ev, 'ink', ew));
      } else {
        let y = yLine - mid - gap;
        if (l.year) {
          out.push(textPrim(l.x, y - yearH / 2, l.year, 'p', 750));
          y -= yearH;
        }
        out.push(textPrim(l.x, y - evH(l) / 2, l.ev, 'ink', ew));
      }
    });
    return out;
  };
  // 세로 연표 (좁은 카드): 왼쪽 세로줄 위의 점, 오른쪽에 때와 사건을 줄마다. F: 판 전체 또는 단추 자리 아래
  const vertical = (size: number, F: Area, force = false): Prim[] | null => {
    const ys = r1(Math.max(g.min, size * 0.94));
    const dotR = Math.max(3.4, size * 0.32);
    const keyR = Math.max(4.4, size * 0.42);
    const rowH = timelineRowH(size);
    const spacing = n > 1 ? clamp((F.h - rowH) / (n - 1), rowH, rowH * 1.5) : rowH;
    const total = (n - 1) * spacing + rowH;
    if (!force && total > F.h + 0.5) return null;
    const top = F.y + Math.max(0, (F.h - total) / 2);
    const nx = F.x + keyR + 4;
    const years = items.map((it) => (it.sub ? fitText(show(it.sub), F.w * 0.4, [ys], { lines: 1, weight: 750 }) : null));
    if (!force && years.some(cut)) return null;
    const yearW = Math.max(0, ...years.map((y) => y?.w ?? 0));
    const yx = nx + keyR + 7;
    const tx = yx + (yearW ? yearW + 7 : 0);
    const out: Prim[] = [];
    const rowY = (i: number) => top + rowH / 2 + i * spacing;
    if (n > 1)
      out.push(
        line(
          [
            [nx, rowY(0)],
            [nx, rowY(n - 1)],
          ],
          { w: 1.6, op: 0.35 },
        ),
      );
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const y = rowY(i);
      const right = y - rowH / 2 < g.ry ? g.rx - 4 : F.x + F.w;
      const ev = fitText(show(it.text), right - tx, [size], { lines: 1, weight: it.key ? 800 : 650 });
      if (!force && (cut(ev) || right - tx < size * 2)) return null;
      if (it.key) {
        out.push({ t: 'circle', cx: r1(nx), cy: r1(y), r: r1(keyR + 3.5), fill: 'p', fillOp: 0.16 });
        out.push({ t: 'circle', cx: r1(nx), cy: r1(y), r: r1(keyR), fill: 'p' });
      } else out.push({ t: 'circle', cx: r1(nx), cy: r1(y), r: r1(dotR), fill: 'paper', stroke: 'p', w: 1.8 });
      const yr = years[i];
      if (yr) out.push(textPrim(yx, y, yr, 'p', 750, 'start'));
      out.push(textPrim(tx, y, ev, 'ink', it.key ? 800 : 650, 'start'));
    }
    return out;
  };
  if (forced) return vertical(g.min, g.band, true);
  return tryModes(g, [(s) => build(s, false), (s) => (n > 2 ? build(s, true) : null)], [(s) => vertical(s, g.full), (s) => vertical(s, g.band)]);
}

/** 세로 연표 한 줄 높이 (timelineOf 의 vertical 과 같게) */
const timelineRowH = (size: number) => Math.max(size * LH + 2, 2 * Math.max(4.4, size * 0.42) + 4);

// ================================================================ 흐름
/** 흐름: 한 줄에 들어가면 가로로 상자와 화살표, 아니면 ㄹ자(두 칸씩), 그래도 안 되면 번호 단계 목록 */
function flow(c: CoverV2, g: Geo): Prim[] {
  const items = c.items;
  const n = items.length;
  const A = g.band;
  const weightOf = (it: CoverItem) => (it.key ? 800 : 650);
  const style = (it: CoverItem): BoxStyle => (it.key ? 'solid' : 'plain');

  // 가로 한 줄 (상자 크기는 모두 같게: 가지런하게)
  const row = (size: number): Prim[] | null => {
    const gapA = clamp(size * 1.45, 14, 24);
    const cellW = (A.w - gapA * (n - 1)) / n;
    const maxText = innerW(cellW, size);
    if (maxText < size * 1.5) return null;
    const fits = items.map((it) => fitText(show(it.text), maxText, [size], { lines: 2, weight: weightOf(it) }));
    if (fits.some(cut)) return null;
    const bw = Math.min(cellW, Math.max(...fits.map((f) => boxOf(f, size * 2.8).w)));
    const bh = Math.max(...fits.map((f) => boxOf(f).h));
    const rowW = bw * n + gapA * (n - 1);
    const subs = items.map((it) => (it.sub ? fitText(show(it.sub), bw + gapA - 4, [g.fs], { lines: 1, weight: 600 }) : null));
    if (subs.some(cut)) return null;
    const subH = subs.some(Boolean) ? 3 + g.fs * LH : 0;
    if (bh + subH > A.h) return null;
    const top = A.y + (A.h - bh - subH) / 2;
    const yc = top + bh / 2;
    let x = A.x + (A.w - rowW) / 2;
    const out: Prim[] = [];
    items.forEach((it, i) => {
      out.push(...boxPrims({ x, y: top, w: bw, h: bh }, fits[i], style(it)));
      const s = subs[i];
      if (s) out.push(textPrim(x + bw / 2, top + bh + 3 + (g.fs * LH) / 2, s, 'muted', 600));
      if (i < n - 1)
        out.push(
          ...arrowPrims([
            [x + bw + 3, yc],
            [x + bw + gapA - 3, yc],
          ]),
        );
      x += bw + gapA;
    });
    return out;
  };

  // ㄹ자: 첫 줄 왼쪽 → 오른쪽, 아래로, 둘째 줄 오른쪽 → 왼쪽 (3·4단계)
  const snake = (size: number): Prim[] | null => {
    if (n < 3) return null;
    const gapA = clamp(size * 1.45, 14, 22);
    const gapV = clamp(size * 1.3, 13, 20);
    const cellW = (A.w - gapA) / 2;
    const fits = items.map((it) => fitText(show(it.text), innerW(cellW, size), [size], { lines: 2, weight: weightOf(it) }));
    if (fits.some(cut)) return null;
    const bw = Math.min(cellW, Math.max(...fits.map((f) => boxOf(f, size * 3.2).w)));
    const bh = Math.max(...fits.map((f) => boxOf(f).h));
    const total = bh * 2 + gapV;
    if (total > A.h) return null;
    const top = A.y + (A.h - total) / 2;
    const x0 = A.x + (A.w - bw * 2 - gapA) / 2;
    const at = [
      { x: x0, y: top },
      { x: x0 + bw + gapA, y: top },
      { x: x0 + bw + gapA, y: top + bh + gapV },
      { x: x0, y: top + bh + gapV },
    ];
    const out: Prim[] = [];
    items.forEach((it, i) => {
      const b = { ...at[i], w: bw, h: bh };
      out.push(...boxPrims(b, fits[i], style(it)));
    });
    const yc0 = top + bh / 2;
    const yc1 = top + bh + gapV + bh / 2;
    out.push(
      ...arrowPrims([
        [x0 + bw + 3, yc0],
        [x0 + bw + gapA - 3, yc0],
      ]),
    );
    out.push(
      ...arrowPrims([
        [x0 + bw + gapA + bw / 2, top + bh + 3],
        [x0 + bw + gapA + bw / 2, top + bh + gapV - 3],
      ]),
    );
    if (n > 3)
      out.push(
        ...arrowPrims([
          [x0 + bw + gapA - 3, yc1],
          [x0 + bw + 3, yc1],
        ]),
      );
    return out;
  };

  return tryModes(g, [row, snake], [(s) => stepper(items, g, s, false)]) ?? stepper(items, g, g.min, false, true) ?? [];
}

/**
 * 번호 단계 목록 (좁은 카드의 흐름·순환): 세로줄 위에 번호 동그라미, 오른쪽에 글. 단추 자리와 겹치는 줄은 그 앞까지만 쓴다.
 * loop: 마지막에서 처음으로 돌아가는 화살표를 왼쪽에 (순환)
 */
function stepper(items: CoverItem[], g: Geo, size: number, loop: boolean, force = false): Prim[] | null {
  const n = items.length;
  const F = g.full;
  const r = Math.max(7, size * 0.7);
  let rowH = Math.max(2 * r + 3, size * LH + 5);
  // 다 안 들어가면(force) 줄 사이를 좁힌다 (단계를 빼지 않는다)
  if (force) rowH = Math.min(rowH, F.h / n);
  const spacing = n > 1 ? clamp((F.h - rowH) / (n - 1), force ? 0 : rowH, rowH * 1.55) : rowH;
  const total = (n - 1) * spacing + rowH;
  if (!force && total > F.h + 0.5) return null;
  const top = F.y + Math.max(0, (F.h - total) / 2);
  const nx = F.x + (loop ? 11 : 0) + r + 1;
  const tx = nx + r + 7;
  const ys = items.map((_, i) => top + rowH / 2 + i * spacing);
  const out: Prim[] = [];
  // 세로줄 (동그라미가 덮는다)
  if (n > 1)
    out.push(
      line(
        [
          [nx, ys[0]],
          [nx, ys[n - 1]],
        ],
        { w: 1.6, op: 0.3 },
      ),
    );
  if (loop && n > 1) {
    // 왼쪽으로 크게 돌아 처음 단계로
    const lx = F.x + 2;
    const d0: Array<[number, number]> = [
      [nx - r - 1, ys[n - 1]],
      [lx, ys[n - 1]],
      [lx, ys[0]],
      [nx - r - 4, ys[0]],
    ];
    const path = elbowPath(d0, 6);
    out.push({ t: 'path', d: path, stroke: 'p', w: 1.5, op: 0.55 });
    out.push(
      ...arrowPrims(
        [
          [nx - r - 6, ys[0]],
          [nx - r - 1, ys[0]],
        ],
        'p',
        { w: 1.5, op: 0.55, head: 5 },
      ).slice(1),
    );
  }
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const y = ys[i];
    const rowTop = y - rowH / 2;
    const right = rowTop < g.ry ? g.rx - 4 : F.x + F.w;
    const avail = right - tx;
    const fit = fitText(show(it.text), avail, [size], { lines: 1, weight: it.key ? 800 : 650 });
    if (!force && (cut(fit) || avail < size * 2)) return null;
    out.push(...nodePrims(nx, y, r, i + 1, it.key));
    if (fit.lines[0]) out.push(textPrim(tx, y, fit, 'ink', it.key ? 800 : 650, 'start'));
    if (it.sub) {
      const sx = tx + fit.w + 6;
      const room = right - sx;
      const sub = fitText(show(it.sub), room, [g.fs], { lines: 1, weight: 600 });
      if (room > g.fs * 2 && !cut(sub)) out.push(textPrim(sx, y, sub, 'muted', 600, 'start'));
    }
  }
  return out;
}

// ================================================================ 구조 (핵심어의 좁은 배치도 같이)
type TreeOpts = { spokes: boolean };

/** 구조: 위에 전체(꽉 칠한 상자), 아래 줄에 부분들(조직도) → 왼쪽 전체·오른쪽 부분 목록 → 들여 쓴 목록 */
function tree(title: string, all: CoverItem[], g: Geo, o: TreeOpts): Prim[] {
  for (const forced of [false, true])
    for (const kids of trims(all, 2)) {
      const r = treeOf(title, kids, g, o, forced);
      if (r) return r;
    }
  return [];
}

function treeOf(title: string, kids: CoverItem[], g: Geo, o: TreeOpts, forced: boolean): Prim[] | null {
  const n = kids.length;
  const F = g.full;
  const kidStyle = (k: CoverItem): BoxStyle => (k.key ? 'strong' : 'plain');
  const kidWeight = (k: CoverItem) => (k.key ? 800 : 650);
  const rootSizeOf = (size: number) => r1(Math.min(size * 1.08, g.f * 1.1));

  const draw = (root: Area, rootFit: Fit, boxes: Area[], fits: Fit[], kind: 'down' | 'right'): Prim[] => {
    const out: Prim[] = [];
    for (const k of boxes) {
      if (kind === 'down') {
        const rx0 = root.x + root.w / 2;
        if (o.spokes)
          out.push(
            line(
              [
                [rx0, root.y + root.h],
                [k.x + k.w / 2, k.y],
              ],
              { op: 0.45 },
            ),
          );
        else {
          const busY = root.y + root.h + (boxes[0].y - root.y - root.h) / 2;
          out.push(
            line(
              [
                [rx0, root.y + root.h],
                [rx0, busY],
                [k.x + k.w / 2, busY],
                [k.x + k.w / 2, k.y],
              ],
              { elbow: true, op: 0.5 },
            ),
          );
        }
      } else {
        const ry0 = root.y + root.h / 2;
        if (o.spokes)
          out.push(
            line(
              [
                [root.x + root.w, ry0],
                [k.x, k.y + k.h / 2],
              ],
              { op: 0.45 },
            ),
          );
        else {
          const busX = root.x + root.w + (boxes[0].x - root.x - root.w) / 2;
          out.push(
            line(
              [
                [root.x + root.w, ry0],
                [busX, ry0],
                [busX, k.y + k.h / 2],
                [k.x, k.y + k.h / 2],
              ],
              { elbow: true, op: 0.5 },
            ),
          );
        }
      }
    }
    out.push(...boxPrims(root, rootFit, 'solid'));
    boxes.forEach((b, i) => out.push(...boxPrims(b, fits[i], kidStyle(kids[i]))));
    return out;
  };

  // 조직도 (위 → 아래)
  const org = (size: number): Prim[] | null => {
    const gapX = Math.max(6, size * 0.55);
    const cellW = (F.w - gapX * (n - 1)) / n;
    const maxText = innerW(cellW, size);
    if (maxText < size * 1.5) return null;
    const fits = kids.map((k) => fitText(show(k.text), maxText, [size], { lines: 2, weight: kidWeight(k) }));
    if (fits.some(cut)) return null;
    const kb = fits.map((f) => boxOf(f, size * 2.8));
    const kidH = Math.max(...kb.map((b) => b.h));
    const rowW = kb.reduce((a, b) => a + b.w, 0) + gapX * (n - 1);
    if (rowW > F.w) return null;
    const rs = rootSizeOf(size);
    const rootFit = fitText(show(title), F.w * 0.7, [rs, size], { lines: 1, weight: 800 });
    if (cut(rootFit)) return null;
    const rb = boxOf(rootFit, rs * 3.2);
    const gapY = clamp(size * 1.35, 12, 24);
    const total = rb.h + gapY + kidH;
    if (total > F.h) return null;
    const rowX = F.x + (F.w - rowW) / 2;
    const centerX = rowX + rowW / 2 - rb.w / 2;
    // 가운데 맞춘 덩어리 → 전체 상자가 단추 자리에 닿으면 덩어리를 단추 자리 아래로 → 그래도 닿으면 전체 상자를 왼쪽으로
    const tops = [F.y + (F.h - total) / 2, g.ry + 2];
    for (const top of tops) {
      if (top < F.y - 0.5 || top + total > F.y + F.h + 0.5) continue;
      for (const rootX of [centerX, Math.max(F.x, g.rx - 6 - rb.w)]) {
        const root = { x: rootX, y: top, w: rb.w, h: rb.h };
        let x = rowX;
        const boxes = kb.map((b) => {
          const box = { x, y: top + rb.h + gapY + (kidH - b.h) / 2, w: b.w, h: b.h };
          x += b.w + gapX;
          return box;
        });
        if (clean(g, [root, ...boxes])) return draw(root, rootFit, boxes, fits, 'down');
      }
    }
    return null;
  };

  // 왼쪽 전체 → 오른쪽 부분 목록 (단추 자리 아래)
  const bracket = (size: number): Prim[] | null => {
    const rs = rootSizeOf(size);
    const rootFit = fitText(show(title), innerW(F.w * 0.42, rs), [rs, size], { lines: 2, weight: 800 });
    if (cut(rootFit)) return null;
    const rb = boxOf(rootFit, rs * 2.8);
    const gapX = clamp(size * 1.5, 14, 24);
    const kidX = F.x + rb.w + gapX;
    const kidMax = innerW(F.x + F.w - kidX, size);
    if (kidMax < size * 2) return null;
    const fits = kids.map((k) => fitText(show(k.text), kidMax, [size], { lines: 1, weight: kidWeight(k) }));
    if (fits.some(cut)) return null;
    const kb = fits.map((f) => boxOf(f, size * 2.6));
    const gapY = Math.max(4, size * 0.42);
    const total = kb.reduce((a, b) => a + b.h, 0) + gapY * (n - 1);
    const B = g.band;
    if (total > B.h) return null;
    let y = B.y + (B.h - total) / 2;
    const boxes = kb.map((b) => {
      const box = { x: kidX, y, w: b.w, h: b.h };
      y += b.h + gapY;
      return box;
    });
    const mid = (boxes[0].y + boxes[n - 1].y + boxes[n - 1].h) / 2;
    const root = { x: F.x, y: mid - rb.h / 2, w: rb.w, h: rb.h };
    return clean(g, [root, ...boxes]) ? draw(root, rootFit, boxes, fits, 'right') : null;
  };

  // 들여 쓴 목록: 왼쪽 위에 전체, 아래로 부분들 (좁은 카드). 한 줄에 여러 개가 들어가면 같은 줄에 (줄마다 첫 상자로 잇는다)
  const indent = (size: number, force = false): Prim[] | null => {
    const rs = rootSizeOf(size);
    const rootFit = fitText(show(title), innerW(g.rx - 4 - F.x, rs), [rs, size], { lines: 1, weight: 800 });
    if (!force && cut(rootFit)) return null;
    const rb = boxOf(rootFit, rs * 2.8);
    const kidX = F.x + Math.min(14, rb.w / 3) + 9;
    const kidH = size * LH + padY(size) * 2;
    const gapY = Math.max(3, size * 0.3);
    const gapX = Math.max(4, size * 0.4);
    const gap1 = Math.max(5, size * 0.5);
    const fits = kids.map((k) => fitText(show(k.text), innerW(F.x + F.w - kidX, size), [size], { lines: 1, weight: kidWeight(k) }));
    if (!force && fits.some(cut)) return null;
    const widths = fits.map((f) => boxOf(f, size * 2.6).w);
    // top 에서 시작할 때의 자리 (단추 자리와 겹치는 줄은 그 앞까지만)
    const place = (top: number) => {
      const boxes: Area[] = [];
      const rowStarts: number[] = [];
      let y = top + rb.h + gap1;
      let x = kidX;
      for (let i = 0; i < n; i++) {
        let right = y < g.ry ? g.rx - 4 : F.x + F.w;
        if (i > 0 && x > kidX && x + widths[i] > right) {
          y += kidH + gapY;
          x = kidX;
          right = y < g.ry ? g.rx - 4 : F.x + F.w;
        }
        // 단추 자리 옆 줄에 첫 상자도 안 들어가면 그 줄을 단추 자리 아래로
        if (x === kidX && kidX + widths[i] > right) y = Math.max(y, g.ry + 1);
        if (x === kidX) rowStarts.push(i);
        boxes.push({ x, y, w: widths[i], h: kidH });
        x += widths[i] + gapX;
      }
      return { boxes, rowStarts, bottom: y + kidH };
    };
    // 위아래 가운데 → 첫 줄이 단추 자리 바로 아래에 오게(줄을 넓게 쓴다) → 맨 위. 판 안에 들어가는 첫 것
    const first = place(F.y);
    const tops = [F.y + Math.max(0, (F.y + F.h - first.bottom) / 2), g.ry + 1 - rb.h - gap1, F.y].filter((t) => t >= F.y - 0.5);
    let top = F.y;
    let laid = first;
    let ok = false;
    for (const t of tops) {
      const l = place(t);
      if (l.bottom <= F.y + F.h + 0.5 && clean(g, [{ x: F.x, y: t, w: rb.w, h: rb.h }, ...l.boxes], 1)) {
        top = t;
        laid = l;
        ok = true;
        break;
      }
    }
    // 글은 … 로 잘라도(force) 자리는 판 안이어야 한다
    if (!ok) return null;
    const root = { x: F.x, y: top, w: rb.w, h: rb.h };
    const out: Prim[] = [];
    const sx = root.x + Math.min(14, root.w / 3);
    for (const i of laid.rowStarts) {
      const k = laid.boxes[i];
      out.push(
        line(
          [
            [sx, root.y + root.h],
            [sx, k.y + k.h / 2],
            [k.x, k.y + k.h / 2],
          ],
          { elbow: true, op: 0.5 },
        ),
      );
    }
    out.push(...boxPrims(root, rootFit, 'solid'));
    laid.boxes.forEach((b, i) => out.push(...boxPrims(b, fits[i], kidStyle(kids[i]))));
    return out;
  };

  if (forced) return indent(g.min, true);
  return tryModes(g, [org, bracket], [(s) => indent(s)]);
}

// ================================================================ 순환
/** 순환: 타원 둘레에 단계들과 둘레를 따라 도는 화살표 (위에서 시작해 시계 방향). 좁으면 번호 목록 + 처음으로 돌아가는 화살표 */
function cycle(c: CoverV2, g: Geo): Prim[] {
  const items = c.items;
  const n = items.length;
  const ring = (size: number, A: Area): Prim[] | null => {
    const fits = items.map((it) => fitText(show(it.text), Math.max(size * 3, A.w * (n > 3 ? 0.3 : 0.34)), [size], { lines: 2, weight: it.key ? 800 : 650 }));
    if (fits.some(cut)) return null;
    const boxes = fits.map((f) => boxOf(f, size * 2.8));
    const bw = Math.max(...boxes.map((b) => b.w));
    const bh = Math.max(...boxes.map((b) => b.h));
    const ry = (A.h - bh) / 2;
    const rx = Math.min((A.w - bw) / 2, ry * 2.4);
    if (ry < bh * 0.75 || rx < ry * 0.9) return null;
    let cx = A.x + A.w / 2;
    const cy = A.y + A.h / 2;
    const ang = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / n;
    const place = () => boxes.map((b, i) => ({ x: cx + rx * Math.cos(ang(i)) - b.w / 2, y: cy + ry * Math.sin(ang(i)) - b.h / 2, w: b.w, h: b.h }));
    let rects = place();
    // 단추 자리에 닿으면 고리를 왼쪽으로 옮겨 본다
    const push = Math.max(0, ...rects.filter((r) => r.y < g.ry).map((r) => r.x + r.w - (g.rx - 4)));
    if (push > 0) {
      cx -= push;
      rects = place();
    }
    if (!clean(g, rects, 4)) return null;
    const out: Prim[] = [];
    const inside = (p: { x: number; y: number }, r: Area, m = 4) => p.x > r.x - m && p.x < r.x + r.w + m && p.y > r.y - m && p.y < r.y + r.h + m;
    for (let i = 0; i < n; i++) {
      const a0 = ang(i);
      const a1 = ang(i) + (Math.PI * 2) / n;
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= 48; k++) {
        const t = a0 + ((a1 - a0) * k) / 48;
        const p = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
        if (inside(p, rects[i]) || inside(p, rects[(i + 1) % n])) continue;
        // 화살표도 단추 자리를 지나지 않는다
        if (p.x > g.rx - 2 && p.y < g.ry + 2) return null;
        pts.push([p.x, p.y]);
      }
      if (pts.length >= 3) out.push(...arrowPrims(pts, 'p', { w: 1.6, op: 0.6, head: 5.5 }));
    }
    // 가운데 이름 (들어갈 때만)
    if (c.title) {
      const t = fitText(show(c.title), rx * 1.2, [g.fs], { lines: 1, weight: 700 });
      const tb = { x: cx - t.w / 2, y: cy - (g.fs * LH) / 2, w: t.w, h: g.fs * LH };
      if (!cut(t) && !rects.some((r) => overlap(r, tb, 4))) out.push(textPrim(cx, cy, t, 'muted', 700));
    }
    rects.forEach((r, i) => out.push(...boxPrims(r, fits[i], items[i].key ? 'solid' : 'plain')));
    return out;
  };
  return tryModes(g, [(s) => ring(s, g.band), (s) => ring(s, g.full)], [(s) => stepper(items, g, s, true)]) ?? stepper(items, g, g.min, true, true) ?? [];
}

// ================================================================ 비교
/** 비교: 두 칸을 나란히. 칸 위에 이름 알약(과목 색 · 짝 색으로 꽉 칠), 아래에 특징 점 목록. 좁으면 특징을 앞에서부터 줄인다 */
function compare(c: CoverV2, g: Geo): Prim[] {
  const A = g.band;
  const sides: Array<{ name: string; items: CoverItem[]; ink: Ink }> = [
    { name: c.left, items: c.items.filter((i) => i.side === 'left'), ink: 'p' },
    { name: c.right, items: c.items.filter((i) => i.side === 'right'), ink: 'p2' },
  ];
  const most = Math.max(...sides.map((s) => s.items.length));
  const panels = (size: number, rowsMax: number, force = false): Prim[] | null => {
    const gap = clamp(size * 0.85, 8, 14);
    const pw = (A.w - gap) / 2;
    const ps = r1(Math.max(g.min, size * 0.94));
    const nameFits = sides.map((s) => fitText(show(s.name), innerW(pw - 12, size), [size], { lines: 2, weight: 800 }));
    const pills = nameFits.map((f) => boxOf(f, size * 3));
    const shown = sides.map((s) => s.items.slice(0, rowsMax));
    const itemFits = shown.map((list) => list.map((it) => fitText(show(it.text), pw - 23, [ps], { lines: 1, weight: 600 })));
    if (!force && (nameFits.some(cut) || itemFits.some((fs) => fs.some(cut)))) return null;
    const pillH = Math.max(...pills.map((p) => p.h));
    const rows = Math.max(...shown.map((l) => l.length));
    const itemGap = ps * LH * 1.22;
    const h = 7 + pillH + 5 + rows * itemGap + 5;
    if (!force && h > A.h + 0.5) return null;
    const top = A.y + Math.max(0, (A.h - h) / 2);
    const H = Math.min(h, A.h);
    const out: Prim[] = [];
    sides.forEach((s, k) => {
      const x = A.x + k * (pw + gap);
      out.push({ t: 'rect', x: r1(x), y: r1(top), w: r1(pw), h: r1(H), r: 11, fill: s.ink, fillOp: 0.085 });
      const pb = pills[k];
      const pwid = Math.min(pw - 12, pb.w);
      const pill = { x: x + (pw - pwid) / 2, y: top + 7 + (pillH - pb.h) / 2, w: pwid, h: pb.h };
      out.push({ t: 'rect', ...rnd(pill), r: r1(Math.min(pb.h / 2, 9)), fill: s.ink });
      out.push(textPrim(pill.x + pill.w / 2, pill.y + pill.h / 2, nameFits[k], 'on', 800));
      let y = top + 7 + pillH + 5 + itemGap / 2;
      itemFits[k].forEach((f) => {
        if (y > top + H) return;
        out.push({ t: 'circle', cx: r1(x + 11), cy: r1(y), r: 2.3, fill: s.ink });
        out.push(textPrim(x + 18, y, f, 'ink', 600, 'start'));
        y += itemGap;
      });
    });
    // 두 칸 사이 vs (이름 알약 높이에)
    const vx = A.x + pw + gap / 2;
    const vy = top + 7 + pillH / 2;
    out.push({ t: 'circle', cx: r1(vx), cy: r1(vy), r: 9.5, fill: 'paper', stroke: 'muted', w: 1, op: 0.35 });
    out.push(textPrim(vx, vy, { lines: ['vs'], size: 9, w: 10 }, 'muted', 750));
    return out;
  };
  // 좁은 카드: 두 줄로 (줄마다 이름 알약 + 들어가는 만큼의 특징)
  const stacked = (size: number, force = false): Prim[] | null => {
    const ps = r1(Math.max(g.min, size * 0.94));
    const ns = r1(Math.max(g.min, size * 0.92));
    const nameFits = sides.map((s) => fitText(show(s.name), A.w * 0.42, [ns], { lines: 1, weight: 800 }));
    if (!force && nameFits.some(cut)) return null;
    const pillW = Math.max(...nameFits.map((f) => f.w + 11), ns * 3);
    const gapRow = Math.max(5, size * 0.5);
    let pillH = boxOf(nameFits[0]).h;
    if (force) pillH = Math.min(pillH, (A.h - gapRow) / 2 - 8);
    const rowH = pillH + 8;
    const total = rowH * 2 + gapRow;
    if (!force && total > A.h + 0.5) return null;
    const top = A.y + Math.max(0, (A.h - total) / 2);
    const tx = A.x + 4 + pillW + 6;
    const room = A.x + A.w - 5 - tx;
    const out: Prim[] = [];
    for (let k = 0; k < 2; k++) {
      const s = sides[k];
      const y = top + k * (rowH + gapRow);
      out.push({ t: 'rect', x: r1(A.x), y: r1(y), w: r1(A.w), h: r1(rowH), r: 10, fill: s.ink, fillOp: 0.085 });
      const pill = { x: A.x + 4, y: y + 4, w: pillW, h: pillH };
      out.push({ t: 'rect', ...rnd(pill), r: r1(Math.min(pillH / 2, 9)), fill: s.ink });
      out.push(textPrim(pill.x + pillW / 2, pill.y + pillH / 2, nameFits[k], 'on', 800));
      // 특징: 들어가는 만큼 ' · ' 로 잇는다 (적어도 하나)
      let text = '';
      for (const it of s.items) {
        const next = text ? `${text} · ${show(it.text)}` : show(it.text);
        if (measure(next, ps, 600) <= room || !text) text = next;
        else break;
      }
      const fit = fitText(text, room, [ps], { lines: 1, weight: 600 });
      if (!force && cut(fit)) return null;
      out.push(textPrim(tx, y + rowH / 2, fit, 'ink', 600, 'start'));
    }
    return out;
  };
  // 좁은 카드에서 특징을 모두 보이게: 두 줄(쪽마다 이름 알약 + 특징을 한 줄에 하나씩). 넘치면 null
  const stackedList = (size: number, per: number, dots: boolean): Prim[] | null => {
    const ps = r1(Math.max(g.min, size * 0.94));
    const ns = r1(Math.max(g.min, size * 0.92));
    const nameFits = sides.map((s) => fitText(show(s.name), A.w * 0.42, [ns], { lines: 1, weight: 800 }));
    if (nameFits.some(cut)) return null;
    const pillW = Math.max(...nameFits.map((f) => f.w + 11), ns * 3);
    const pillH = boxOf(nameFits[0]).h;
    // 점을 찍을 자리가 없으면 점 없이 (줄마다 하나라서 그래도 목록으로 읽힌다)
    const dx = A.x + 4 + pillW + 8;
    const tx = dots ? dx + 6 : A.x + 4 + pillW + 6;
    const room = A.x + A.w - 5 - tx;
    const lists = sides.map((s) => s.items.slice(0, per).map((it) => fitText(show(it.text), room, [ps], { lines: 1, weight: 600 })));
    if (lists.some((l) => l.some(cut))) return null;
    const lineH = ps * LH;
    const gapRow = Math.max(5, size * 0.5);
    const rowHs = lists.map((l) => Math.max(pillH, l.length * lineH) + 8);
    const total = rowHs[0] + rowHs[1] + gapRow;
    if (total > A.h + 0.5) return null;
    let y = A.y + Math.max(0, (A.h - total) / 2);
    const out: Prim[] = [];
    sides.forEach((s, k) => {
      const rowH = rowHs[k];
      const mid = y + rowH / 2;
      out.push({ t: 'rect', x: r1(A.x), y: r1(y), w: r1(A.w), h: r1(rowH), r: 10, fill: s.ink, fillOp: 0.085 });
      const pill = { x: A.x + 4, y: mid - pillH / 2, w: pillW, h: pillH };
      out.push({ t: 'rect', ...rnd(pill), r: r1(Math.min(pillH / 2, 9)), fill: s.ink });
      out.push(textPrim(pill.x + pillW / 2, mid, nameFits[k], 'on', 800));
      lists[k].forEach((f, i) => {
        const ly = mid + (i - (lists[k].length - 1) / 2) * lineH;
        if (dots) out.push({ t: 'circle', cx: r1(dx), cy: r1(ly), r: 2.3, fill: s.ink });
        out.push(textPrim(tx, ly, f, 'ink', 600, 'start'));
      });
      y += rowH + gapRow;
    });
    return out;
  };
  // 모두 보이는 배치를 먼저: 나란한 두 칸(특징 모두) → 두 줄 목록(특징 모두) → 특징을 줄여 가며(같은 수면 나란한 두 칸이 먼저)
  // → 한 줄에 들어가는 만큼
  const compact: Mode[] = [];
  for (let rows = most; rows >= 1; rows--) {
    if (rows < most) compact.push((s) => panels(s, rows));
    if (rows >= 2)
      compact.push(
        (s) => stackedList(s, rows, true),
        (s) => stackedList(s, rows, false),
      );
  }
  compact.push((s) => stacked(s));
  return tryModes(g, [(s) => panels(s, most)], compact) ?? stacked(g.min, true) ?? [];
}

// ================================================================ 핵심어
/** 핵심어: 가운데 개념(꽉 칠한 원·알약), 둘레에 낱말 상자와 잇는 선 (위쪽 오른쪽은 비운다). 좁으면 구조 배치에 곧은 선으로 */
function hub(c: CoverV2, g: Geo): Prim[] {
  const items = c.items;
  const n = items.length;
  const F = g.full;
  // 둘레 자리 (각도: 0 오른쪽, 90 아래, 180 왼쪽, 270 위): 단추 자리(위 오른쪽)는 쓰지 않는다
  const ANGLES: Record<number, number[]> = {
    2: [180, 0],
    3: [180, 0, 90],
    4: [180, 0, 125, 55],
    5: [180, 0, 125, 55, 235],
  };
  const angles = (ANGLES[n] ?? ANGLES[5]).map((a) => (a * Math.PI) / 180);
  const radial = (size: number): Prim[] | null => {
    const cs = r1(Math.min(g.f * 1.12, size * 1.12));
    const cFit = fitText(show(c.title), Math.min(F.w * 0.42, 130), [cs, size], { lines: 2, weight: 800 });
    if (cut(cFit)) return null;
    const cBox = boxOf(cFit, cs * 2.4);
    // 짧으면 원, 길면 알약
    const round = cFit.lines.length === 1 && cBox.w <= cBox.h * 1.9;
    const cw = round ? Math.max(cBox.w, cBox.h * 1.2) : cBox.w + 6;
    const ch = round ? cw : cBox.h + 2;
    const fits = items.map((it) => fitText(show(it.text), F.w * 0.36, [size], { lines: 1, weight: it.key ? 800 : 650 }));
    if (fits.some(cut)) return null;
    const boxes = fits.map((f) => boxOf(f, size * 2.6));
    const bw = Math.max(...boxes.map((b) => b.w));
    const bh = Math.max(...boxes.map((b) => b.h));
    const cx = F.x + F.w / 2;
    const cy = g.band.y + g.band.h * (n >= 5 ? 0.42 : 0.4);
    const exMin = cw / 2 + bw / 2 + 12;
    const exMax = F.w / 2 - bw / 2;
    if (exMin > exMax) return null;
    const ex = Math.min(exMax, exMin + 14);
    const below = F.y + F.h - cy - bh / 2;
    const eyMin = (ch / 2 + bh / 2 + 6) / Math.sin((55 * Math.PI) / 180);
    const ey = Math.max(eyMin, Math.min(below / Math.sin((55 * Math.PI) / 180), eyMin + 10));
    const rects = boxes.map((b, i) => ({ x: cx + ex * Math.cos(angles[i]) - b.w / 2, y: cy + ey * Math.sin(angles[i]) - b.h / 2, w: b.w, h: b.h }));
    const center = { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
    if (!clean(g, [center, ...rects], 4)) return null;
    const out: Prim[] = [];
    // 잇는 선: 가운데에서 낱말 상자 가운데로 (상자가 선 끝을 덮는다)
    rects.forEach((r) =>
      out.push(
        line(
          [
            [cx, cy],
            [r.x + r.w / 2, r.y + r.h / 2],
          ],
          { op: 0.42 },
        ),
      ),
    );
    rects.forEach((r, i) => out.push(...boxPrims(r, fits[i], items[i].key ? 'strong' : 'plain')));
    if (round) out.push({ t: 'circle', cx: r1(cx), cy: r1(cy), r: r1(cw / 2), fill: 'p' });
    else out.push({ t: 'rect', ...rnd(center), r: r1(ch / 2), fill: 'p' });
    out.push(textPrim(cx, cy, cFit, 'on', 800));
    return out;
  };
  // 둘레에 놓을 수 없으면 구조 배치(곧은 선)로
  for (const size of steps(g.f, Math.max(g.min, g.f - 1.5))) {
    const r = radial(size);
    if (r) return r;
  }
  return tree(c.title, items, g, { spokes: true });
}

// ================================================================ 공식
/** 공식: 큰 공식(KaTeX, 과목 색)과 아래 기호 뜻 알약. 화면이 HTML 로 그린다 (분수·근호를 교과서처럼) */
function formula(c: CoverV2, g: Geo): FormulaPlan {
  const A = g.band;
  const chip = g.fs;
  const chipH = r1(chip * LH + 7);
  return { ...A, size: r1(clamp(A.h * 0.42, 18, 34)), min: 11, chip, chipH: c.items.length ? chipH : 0, gap: c.items.length ? r1(Math.max(6, g.f * 0.55)) : 0 };
}

// ================================================================ 그래프·도형
/** 그래프·도형 자리: 단추 자리 아래(가로 전체)와 단추 자리 왼쪽(세로 전체) 가운데 그림이 더 크게 들어가는 곳 */
function figureArea(c: CoverV2, g: Geo): Area {
  const v = c.figure?.view;
  const dx = v ? Math.max(1e-6, v.x_max - v.x_min) : 1;
  const dy = v ? Math.max(1e-6, v.y_max - v.y_min) : 1;
  const sBand = Math.min(g.band.w / dx, g.band.h / dy);
  const sLeft = Math.min(g.left.w / dx, g.left.h / dy);
  return sLeft > sBand ? g.left : g.band;
}

/** 표지 v2 를 이 크기에 배치한다 (글 너비는 size.font 배율로) */
export function layoutCover(c: CoverV2, size: CoverSize): CoverPlan {
  const before = font;
  font = size.font ?? PLAIN;
  try {
    return place(c, coverGeo(size));
  } finally {
    font = before;
  }
}

function place(c: CoverV2, g: Geo): CoverPlan {
  switch (c.kind) {
    case 'timeline':
      return { prims: timeline(c, g) };
    case 'flow':
      return { prims: flow(c, g) };
    case 'tree':
      return { prims: tree(c.title, c.items, g, { spokes: false }) };
    case 'cycle':
      return { prims: cycle(c, g) };
    case 'compare':
      return { prims: compare(c, g) };
    case 'hub':
      return { prims: hub(c, g) };
    case 'formula':
      return { prims: [], formula: formula(c, g) };
    case 'figure':
      return { prims: [], figure: figureArea(c, g) };
  }
}

/** 조각이 차지하는 곳 (시험: 판 밖·단추 자리에 닿지 않는지). 글은 배치할 때와 같은 글꼴 배율로 잰다 */
export function primBounds(p: Prim, f: CoverFont = PLAIN): Area | null {
  if (p.t === 'rect') return { x: p.x, y: p.y, w: p.w, h: p.h };
  if (p.t === 'circle') return { x: p.cx - p.r, y: p.cy - p.r, w: p.r * 2, h: p.r * 2 };
  if (p.t === 'text') {
    const w = Math.max(...p.lines.map((l) => measure(l, p.size, p.weight, f)));
    const h = p.lines.length * p.lh;
    const x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
    return { x, y: p.y - h / 2, w, h };
  }
  const nums = (p.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (nums.length < 2) return null;
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
