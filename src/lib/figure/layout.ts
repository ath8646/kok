// 그림 설계도 → 화면 좌표 계산 (화면과 상관없는 순수 함수, 시험 있음)
import { compileExpr } from './expr';
import { extents, type FigItem, type FigView, type Figure } from './spec';

export type Pt = { x: number; y: number };

export type Mapper = {
  /** 그림 전체 크기 (SVG viewBox) */
  W: number;
  H: number;
  /** 그리는 칸 (안쪽 여백을 뺀 곳) */
  left: number;
  top: number;
  right: number;
  bottom: number;
  sx: number;
  sy: number;
  uniform: boolean;
  px: (x: number) => number;
  py: (y: number) => number;
};

/**
 * 좌표 범위를 화면 크기로 바꾼다. 도형(원·각)이 있으면 가로세로 같은 비율로 그리고,
 * 축 그래프만 있으면 화면에 알맞게 늘리거나 줄인다 (y 가 아주 큰 함수 그래프 등).
 */
export function makeMapper(figure: Figure, width = 360, maxHeight = 340, pad = 22): Mapper {
  const v = fitView(figure);
  const dx = v.x_max - v.x_min;
  const dy = v.y_max - v.y_min;
  const shapes = figure.items.some((i) => i.type === 'circle' || i.type === 'arc' || i.type === 'angle' || i.type === 'polygon');
  const inner = width - pad * 2;
  let sx = inner / dx;
  let sy = sx;
  let H = dy * sy + pad * 2;
  let uniform = true;
  if (H > maxHeight) {
    if (!shapes && figure.axes) {
      sy = (maxHeight - pad * 2) / dy;
      uniform = false;
      H = maxHeight;
    } else {
      sy = sx = (maxHeight - pad * 2) / dy;
      H = maxHeight;
    }
  } else if (!shapes && figure.axes && H < width * 0.5) {
    // 납작한 그래프는 조금 키운다 (수직선처럼 일부러 납작한 것은 그대로: 축이 없다)
    sy = (width * 0.5 - pad * 2) / dy;
    H = width * 0.5;
    uniform = false;
  }
  H = Math.max(H, 90);
  const drawnW = dx * sx;
  const ox = (width - drawnW) / 2;
  const drawnH = dy * sy;
  const oy = (H - drawnH) / 2;
  return {
    W: width,
    H,
    left: ox,
    top: oy,
    right: ox + drawnW,
    bottom: oy + drawnH,
    sx,
    sy,
    uniform,
    px: (x) => ox + (x - v.x_min) * sx,
    py: (y) => oy + (v.y_max - y) * sy,
  };
}

// ---------------------------------------------------------------- 상자 그림 (과정·순환·분류)
/** 상자·글의 화면 자리: 가운데, 반너비·반높이, 줄 */
export type BoxGeom = { c: Pt; hw: number; hh: number; lines: string[] };

export const BOX_FONT = 12.5;
const BOX_LINE = 16;
const BOX_PAD_X = 10;
const BOX_PAD_Y = 7;

/** 상자·화살표·글로만 된 그림인지 (좌표의 크기보다 놓인 순서가 중요한 그림) */
export function isDiagram(figure: Figure): boolean {
  if (figure.axes) return false;
  const boxes = figure.items.filter((i) => i.type === 'box').length;
  if (boxes < 2) return false;
  return figure.items.every((i) => i.type === 'box' || i.type === 'text' || i.type === 'arrow' || (i.type === 'point' && !i.label));
}

/** 가까운 값끼리 묶는다 (같은 줄·같은 칸). 묶음의 가운데 값들을 작은 것부터 */
function clusters(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/** 값 → 가장 가까운 묶음 번호 */
function nearest(list: number[], v: number): number {
  let best = 0;
  for (let k = 1; k < list.length; k++) if (Math.abs(list[k] - v) < Math.abs(list[best] - v)) best = k;
  return best;
}

/** 묶음 가운데(좌표) → 화면 자리를 잇는 꺾은선 (밖은 끝 기울기로 늘린다) */
function piecewise(from: number[], to: number[], fallbackSlope: number): (v: number) => number {
  if (from.length === 1) return (v) => to[0] + (v - from[0]) * fallbackSlope;
  return (v) => {
    let k = 0;
    while (k < from.length - 2 && v > from[k + 1]) k++;
    const span = from[k + 1] - from[k] || 1;
    return to[k] + ((v - from[k]) / span) * (to[k + 1] - to[k]);
  };
}

/**
 * 상자 그림의 자리: 상자 가운데를 칸(세로줄)·줄로 묶어 고르게 벌리고, 상자는 글에 맞는 크기로 (긴 글은 줄을 바꾼다).
 * 좌표가 가까워도 상자가 겹치거나 화살표가 묻히지 않는다. 점(보이지 않는 도움점)도 같은 꺾은선으로 옮긴다
 */
export function diagramLayout(figure: Figure, labelOf: (i: FigItem) => string, width = 360, pad = 16): { m: Mapper; boxes: Map<string, BoxGeom> } {
  const nodes = figure.items.filter((i) => i.type === 'box' || i.type === 'text');
  const xsAll = nodes.map((n) => n.x);
  const ysAll = nodes.map((n) => n.y);
  const spanX = Math.max(...xsAll) - Math.min(...xsAll);
  const spanY = Math.max(...ysAll) - Math.min(...ysAll);
  const cols = clusters(xsAll, Math.max(0.2, spanX / 12));
  const rows = clusters(ysAll, Math.max(0.2, spanY / 12)).reverse(); // 위(큰 y)부터
  const inner = width - pad * 2;
  const minGapX = 30;
  const gapY = 44;
  // 칸이 많을수록 상자를 좁게 (긴 글은 줄을 바꾼다)
  const maxBoxW = Math.max(64, Math.min(156, (inner - (cols.length - 1) * minGapX) / cols.length));
  const sizes = new Map<string, { w: number; h: number; lines: string[] }>();
  for (const n of nodes) {
    const label = labelOf(n);
    if (n.type === 'box') {
      const lines = wrapText(label, BOX_FONT, maxBoxW - BOX_PAD_X * 2, 3);
      const w = Math.max(52, Math.max(...lines.map((l) => textWidth(l, BOX_FONT))) + BOX_PAD_X * 2);
      sizes.set(n.id, { w, h: lines.length * BOX_LINE + BOX_PAD_Y * 2, lines });
    } else {
      sizes.set(n.id, { w: textWidth(label, 13.5) + 6, h: 18, lines: [label] });
    }
  }
  const colW = cols.map(() => 0);
  const rowH = rows.map(() => 0);
  for (const n of nodes) {
    const s = sizes.get(n.id)!;
    const ci = nearest(cols, n.x);
    const ri = nearest(rows, n.y);
    colW[ci] = Math.max(colW[ci], s.w);
    rowH[ri] = Math.max(rowH[ri], s.h);
  }
  const sumW = colW.reduce((a, b) => a + b, 0);
  // 남는 너비는 칸 사이에 나눠 화살표를 길게 (너무 멀어지지 않게 최대 96)
  const gapX = cols.length > 1 ? Math.max(minGapX, Math.min(96, (inner - sumW) / (cols.length - 1))) : 0;
  const usedW = sumW + gapX * (cols.length - 1);
  const W = Math.max(width, Math.ceil(usedW + pad * 2));
  let x = (W - usedW) / 2;
  const colPx = colW.map((w) => {
    const c = x + w / 2;
    x += w + gapX;
    return c;
  });
  const top = pad + 6;
  let y = top;
  const rowPx = rowH.map((h) => {
    const c = y + h / 2;
    y += h + gapY;
    return c;
  });
  const H = Math.max(90, Math.ceil(y - gapY + pad + 6));
  const slope = 34;
  const toX = piecewise(cols, colPx, slope);
  // 줄은 위(큰 y)부터 놓았으니 작은 y 부터 다시 줄 세워 꺾은선을 만든다
  const rowsAsc = [...rows].reverse();
  const rowPxAsc = [...rowPx].reverse();
  const toY = piecewise(rowsAsc, rowPxAsc, -slope);
  const boxes = new Map<string, BoxGeom>();
  for (const n of nodes) {
    const s = sizes.get(n.id)!;
    boxes.set(n.id, { c: { x: colPx[nearest(cols, n.x)], y: rowPx[nearest(rows, n.y)] }, hw: s.w / 2, hh: s.h / 2, lines: s.lines });
  }
  const m: Mapper = {
    W,
    H,
    left: pad / 2,
    top: pad / 2,
    right: W - pad / 2,
    bottom: H - pad / 2,
    sx: slope,
    sy: slope,
    uniform: false,
    px: toX,
    py: toY,
  };
  return { m, boxes };
}

/** 정해진 크기의 틀 (표지 그림: 카드 위 칸에 맞춘 가로로 긴 틀) */
export type Frame = { w: number; h: number; pad: number };

/**
 * 틀에 그대로 담기: AI 가 정한 보이는 범위(view)를 줄이지 않고(fitView 없이: 구도와 비워 둔 모서리를 지킨다)
 * 가로세로 같은 비율로 틀 가운데에
 */
export function frameMapper(figure: Figure, f: Frame): Mapper {
  const v = figure.view;
  const dx = Math.max(v.x_max - v.x_min, 1e-6);
  const dy = Math.max(v.y_max - v.y_min, 1e-6);
  const s = Math.min((f.w - f.pad * 2) / dx, (f.h - f.pad * 2) / dy);
  const ox = (f.w - dx * s) / 2;
  const oy = (f.h - dy * s) / 2;
  return {
    W: f.w,
    H: f.h,
    left: ox,
    top: oy,
    right: ox + dx * s,
    bottom: oy + dy * s,
    sx: s,
    sy: s,
    uniform: true,
    px: (x) => ox + (x - v.x_min) * s,
    py: (y) => oy + (v.y_max - y) * s,
  };
}

/**
 * 그림 전체의 자리: 상자 그림이면 diagramLayout, 아니면 좌표 비율대로 (상자는 글에 맞는 크기, w·h 를 정했으면 그 크기).
 * labelOf: 상자·글에 보일 글 (수식 기호를 읽기 쉬운 글로 바꾼 것). frame: 정해진 틀에 담을 때 (표지 그림)
 */
export function figureLayout(figure: Figure, labelOf: (i: FigItem) => string, frame?: Frame): { m: Mapper; boxes: Map<string, BoxGeom> } {
  // 틀에 담는 그림(표지)은 상자 그림도 AI 가 놓은 자리 그대로 (칸·줄로 다시 벌리면 틀보다 넓어져 작게 보인다)
  if (isDiagram(figure) && !frame) return diagramLayout(figure, labelOf);
  const m = frame ? frameMapper(figure, frame) : makeMapper(figure);
  const boxes = new Map<string, BoxGeom>();
  for (const i of figure.items) {
    if (i.type !== 'box' && i.type !== 'text') continue;
    const label = labelOf(i);
    if (i.type === 'box') {
      const maxW = i.w > 0 ? Math.max(40, i.w * m.sx - BOX_PAD_X * 2) : 132;
      const lines = wrapText(label, BOX_FONT, maxW);
      const w = i.w > 0 ? i.w * m.sx : Math.max(52, Math.max(...lines.map((l) => textWidth(l, BOX_FONT))) + BOX_PAD_X * 2);
      const h = i.h > 0 ? i.h * m.sy : lines.length * BOX_LINE + BOX_PAD_Y * 2;
      boxes.set(i.id, { c: { x: m.px(i.x), y: m.py(i.y) }, hw: w / 2, hh: h / 2, lines });
    } else {
      boxes.set(i.id, { c: { x: m.px(i.x), y: m.py(i.y) }, hw: textWidth(label, 13.5) / 2 + 3, hh: 9, lines: [label] });
    }
  }
  return { m, boxes };
}

/**
 * 그릴 범위: 축이 없는 도형 그림은 AI 가 준 범위가 내용보다 훨씬 넓으면 내용에 맞춰 줄인다 (빈 곳 없이 크게 보이게).
 * 축·그래프·직선(끝없이 늘어나는 것)이 있으면 준 범위 그대로
 */
export function fitView(figure: Figure): FigView {
  const v = figure.view;
  if (figure.axes || figure.items.some((i) => i.type === 'function' || i.type === 'line' || i.type === 'ray')) return v;
  const e = extents(figure.items);
  if (!e) return v;
  const w = e.x_max - e.x_min;
  const h = e.y_max - e.y_min;
  const side = Math.max(w, h, 1e-6);
  // 글자가 붙을 자리를 남긴다 (긴 쪽의 14%)
  const m = side * 0.14;
  const fit = { x_min: e.x_min - m, x_max: e.x_max + m, y_min: e.y_min - m, y_max: e.y_max + m };
  const area = (r: FigView) => Math.max(1e-9, (r.x_max - r.x_min) * (r.y_max - r.y_min));
  return area(fit) < area(v) * 0.8 ? fit : v;
}

/** 1·2·5 × 10ⁿ 꼴의 보기 좋은 눈금 간격 */
export function niceStep(range: number, maxTicks = 8): number {
  if (!(range > 0)) return 1;
  const raw = range / maxTicks;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const k = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return k * p;
}

export function ticks(min: number, max: number, maxTicks = 8): number[] {
  const step = niceStep(max - min, maxTicks);
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-9 && out.length < 50; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** 눈금 숫자 (소수점 아래 쓸데없는 0 없이) */
export function tickLabel(v: number): string {
  if (Math.abs(v) < 1e-9) return '0';
  const s = Math.abs(v) >= 1000 || Math.abs(v) < 0.01 ? v.toExponential(1) : String(Math.round(v * 1000) / 1000);
  return s.replace('-', '−');
}

/** 함수 그래프 점들. 계산할 수 없거나 크게 튀는 곳(점근선)에서 끊는다 */
export function sampleFunction(expr: string, from: number, to: number, view: FigView, n = 240): Pt[][] {
  const f = compileExpr(expr);
  if (!f) return [];
  const a = from < to ? Math.max(from, view.x_min) : view.x_min;
  const b = from < to ? Math.min(to, view.x_max) : view.x_max;
  if (!(b > a)) return [];
  const span = view.y_max - view.y_min;
  const far = span * 8;
  const lines: Pt[][] = [];
  let cur: Pt[] = [];
  let prevY: number | null = null;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    let y: number;
    try {
      y = f(x);
    } catch {
      y = NaN;
    }
    const bad = !Number.isFinite(y) || y > view.y_max + far || y < view.y_min - far;
    const jump = prevY !== null && Number.isFinite(y) && Math.abs(y - prevY) > span * 3;
    if (bad || jump) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
      prevY = bad ? null : y;
      if (!bad) cur.push({ x, y });
      continue;
    }
    cur.push({ x, y });
    prevY = y;
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

/** 각 표시: 꼭짓점 V 에서 P 쪽과 Q 쪽 사이 (화면 좌표). 직각이면 네모 */
export function angleMark(V: Pt, P: Pt, Q: Pt, radius: number, forceRight = false): { path: string; right: boolean; labelAt: Pt; delta: number } {
  const a1 = Math.atan2(P.y - V.y, P.x - V.x);
  const a2 = Math.atan2(Q.y - V.y, Q.x - V.x);
  let d = a2 - a1;
  while (d <= -Math.PI) d += Math.PI * 2;
  while (d > Math.PI) d -= Math.PI * 2;
  const right = forceRight || Math.abs(Math.abs(d) - Math.PI / 2) < 0.035;
  const mid = a1 + d / 2;
  const labelR = radius + (right ? 10 : 13);
  const labelAt = { x: V.x + Math.cos(mid) * labelR, y: V.y + Math.sin(mid) * labelR };
  if (right) {
    const s = radius * 0.62;
    const u1 = { x: Math.cos(a1), y: Math.sin(a1) };
    const u2 = { x: Math.cos(a2), y: Math.sin(a2) };
    const p1 = { x: V.x + u1.x * s, y: V.y + u1.y * s };
    const p2 = { x: V.x + (u1.x + u2.x) * s, y: V.y + (u1.y + u2.y) * s };
    const p3 = { x: V.x + u2.x * s, y: V.y + u2.y * s };
    return { path: `M${f2(p1.x)} ${f2(p1.y)}L${f2(p2.x)} ${f2(p2.y)}L${f2(p3.x)} ${f2(p3.y)}`, right, labelAt, delta: d };
  }
  const s = { x: V.x + Math.cos(a1) * radius, y: V.y + Math.sin(a1) * radius };
  const e = { x: V.x + Math.cos(a2) * radius, y: V.y + Math.sin(a2) * radius };
  return { path: `M${f2(s.x)} ${f2(s.y)}A${f2(radius)} ${f2(radius)} 0 0 ${d > 0 ? 1 : 0} ${f2(e.x)} ${f2(e.y)}`, right, labelAt, delta: d };
}

export function f2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** 선을 화면 칸 끝까지 늘린다 (직선은 양쪽, 반직선은 한쪽) */
export function extendLine(A: Pt, B: Pt, m: Pick<Mapper, 'left' | 'top' | 'right' | 'bottom'>, both: boolean): [Pt, Pt] {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const big = (m.right - m.left + m.bottom - m.top) * 2;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const end = { x: A.x + ux * big, y: A.y + uy * big };
  const start = both ? { x: A.x - ux * big, y: A.y - uy * big } : A;
  return [start, end];
}

/** 가운데 c, 반너비 hw·반높이 hh 인 상자의 테두리에서 toward 쪽 점 */
export function boxEdge(c: Pt, hw: number, hh: number, toward: Pt): Pt {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return c;
  const tx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** 글 너비 대강 (한글은 글자 크기만큼, 영문·숫자는 0.6배) */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x2e80) w += size;
    else if (ch === ' ') w += size * 0.32;
    else if (/[A-Z0-9]/.test(ch)) w += size * 0.64;
    else w += size * 0.56;
  }
  return w;
}

/** 상자 글을 줄로 나눈다 (한 줄 최대 너비 maxW) */
export function wrapText(s: string, size: number, maxW: number, maxLines = 3): string[] {
  const words = s.split(/(\s+)/).filter((w) => w !== '');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur + w;
    if (textWidth(next.trim(), size) <= maxW || !cur.trim()) {
      cur = next;
      continue;
    }
    lines.push(cur.trim());
    cur = w.trim() ? w : '';
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  // 한 단어가 너무 길면 글자 단위로 자른다
  return lines
    .flatMap((l) => {
      if (textWidth(l, size) <= maxW * 1.15) return [l];
      const out: string[] = [];
      let piece = '';
      for (const ch of l) {
        if (textWidth(piece + ch, size) > maxW && piece) {
          out.push(piece);
          piece = '';
        }
        piece += ch;
      }
      if (piece) out.push(piece);
      return out;
    })
    .slice(0, maxLines);
}

/** 그림의 가운데 (점들의 평균, 화면 좌표) */
export function centerOf(items: FigItem[], m: Mapper): Pt {
  const pts = items.filter((i) => i.type === 'point');
  if (!pts.length) return { x: m.W / 2, y: m.H / 2 };
  return { x: pts.reduce((a, p) => a + m.px(p.x), 0) / pts.length, y: pts.reduce((a, p) => a + m.py(p.y), 0) / pts.length };
}

// ---------------------------------------------------------------- 글자 자리 (겹치지 않게)
export type Rect = { x: number; y: number; w: number; h: number };

export type LabelReq = {
  key: string;
  /** 글자를 붙일 곳 (점, 선분 가운데, 화살표 끝 …) */
  at: Pt;
  /** 가고 싶은 쪽 (길이는 상관없다). 없으면 그 자리 가운데에 둔다 */
  dir?: Pt;
  /** 붙일 곳에서 글자 상자 가장자리까지 */
  dist: number;
  w: number;
  h: number;
};

function overlaps(a: Rect, b: Rect, gap = 2): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/**
 * 글자 자리를 고른다: 가고 싶은 쪽부터 조금씩 돌려 가며, 다른 글자·점·상자와 겹치지 않고 그림 안에 드는 첫 자리.
 * 다 겹치면 가고 싶은 쪽 그대로. 돌려주는 것은 글자 상자의 가운데.
 */
export function placeLabels(reqs: LabelReq[], obstacles: Rect[], bounds: Rect, lines: Array<[Pt, Pt]> = []): Map<string, Pt> {
  const placed: Rect[] = [...obstacles];
  const out = new Map<string, Pt>();
  const ANGLES = [0, 35, -35, 70, -70, 110, -110, 150, -150, 180];
  for (const r of reqs) {
    if (!r.dir) {
      const rect = { x: r.at.x - r.w / 2, y: r.at.y - r.h / 2, w: r.w, h: r.h };
      placed.push(rect);
      out.set(r.key, r.at);
      continue;
    }
    const base = Math.atan2(r.dir.y, r.dir.x);
    // 1순위: 다른 글자·점·상자와도, 선과도 안 겹친다. 2순위: 선만 겹친다. 없으면 가고 싶은 쪽 그대로
    let first: { c: Pt; rect: Rect } | null = null;
    let second: { c: Pt; rect: Rect } | null = null;
    let best: { c: Pt; rect: Rect } | null = null;
    for (const deg of ANGLES) {
      const a = base + (deg * Math.PI) / 180;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // 상자 가장자리가 dist 만큼 떨어지도록 가운데를 민다
      const push = r.dist + Math.abs(ux) * (r.w / 2) + Math.abs(uy) * (r.h / 2);
      const c = { x: r.at.x + ux * push, y: r.at.y + uy * push };
      const rect = { x: c.x - r.w / 2, y: c.y - r.h / 2, w: r.w, h: r.h };
      if (!first) first = { c, rect };
      const inside = rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.w <= bounds.x + bounds.w && rect.y + rect.h <= bounds.y + bounds.h;
      if (!inside || placed.some((p) => overlaps(rect, p))) continue;
      const shrunk = { x: rect.x + 1.5, y: rect.y + 1.5, w: rect.w - 3, h: rect.h - 3 };
      if (!lines.some(([p, q]) => segmentHitsRect(p, q, shrunk))) {
        best = { c, rect };
        break;
      }
      if (!second) second = { c, rect };
    }
    const pick = best ?? second ?? first!;
    placed.push(pick.rect);
    out.set(r.key, pick.c);
  }
  return out;
}

/** 선분 pq 가 상자 r 을 지나는지 */
export function segmentHitsRect(p: Pt, q: Pt, r: Rect): boolean {
  const inside = (a: Pt) => a.x >= r.x && a.x <= r.x + r.w && a.y >= r.y && a.y <= r.y + r.h;
  if (inside(p) || inside(q)) return true;
  const corners: Pt[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  for (let k = 0; k < 4; k++) if (segmentsCross(p, q, corners[k], corners[(k + 1) % 4])) return true;
  return false;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
