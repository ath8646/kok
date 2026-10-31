// 다시 그린 그림의 자리 계산 (화면과 상관없는 순수 함수, 시험 있음): 그래프 눈금, 연표, 도식, 지도 선 이름
import { niceStep, segmentHitsRect, textWidth, wrapText, type Rect } from '@/lib/figure/layout';
import type { XY } from './geo';
import type { DiagramArt, TimelineArt } from './spec';

// ---------------------------------------------------------------- 그래프 눈금
/** 보기 좋은 눈금 범위 (0 을 포함하도록 넓힌다. given 이 있으면 그 범위) */
export function niceRange(lo: number, hi: number, maxTicks = 5, given?: { min: number; max: number }): { min: number; max: number; ticks: number[] } {
  if (given && given.max > given.min) {
    const step = niceStep(given.max - given.min, maxTicks);
    const ticks: number[] = [];
    for (let v = Math.ceil(given.min / step) * step; v <= given.max + step * 1e-9 && ticks.length < 30; v += step) ticks.push(Math.round(v / step) * step);
    return { min: given.min, max: given.max, ticks };
  }
  let min = Math.min(0, lo);
  let max = Math.max(0, hi);
  if (max - min < 1e-9) max = min + 1;
  const step = niceStep(max - min, maxTicks);
  min = Math.floor(min / step + 1e-9) * step;
  max = Math.ceil(max / step - 1e-9) * step;
  if (max === min) max = min + step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-9 && ticks.length < 30; v += step) ticks.push(Math.round(v / step) * step);
  return { min, max, ticks };
}

/** 눈금 숫자: 천 단위 쉼표, 소수는 둘째 자리까지 */
export function fmtNum(v: number): string {
  if (Math.abs(v) < 1e-9) return '0';
  const abs = Math.abs(v);
  const s = abs >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100);
  return s.replace('-', '−');
}

// ---------------------------------------------------------------- 연표 (세로: 왼쪽 날짜 · 기간 막대 · 줄 · 사건)
export const TL = { top: 18, bottom: 18, gap: 46, minGap: 34, lane: 20, bar: 16, size: 13, detail: 11.5, year: 12 } as const;

export type TimelineLayout = {
  W: number;
  H: number;
  /** 날짜 글의 오른쪽 끝 */
  yearRight: number;
  /** 기간 막대 줄의 가운데 x (줄 번호마다) */
  laneX: number[];
  axisX: number;
  labelX: number;
  events: Array<{ y: number; lines: string[]; detail: string[] }>;
  spans: Array<{ y0: number; y1: number }>;
};

/**
 * 연표 자리: 사건과 기간 끝을 한 줄의 시간 축에 해 순서대로 놓는다. even 이 아니면 해의 차이만큼 벌리되
 * 사건 글이 겹치지 않게, 너무 멀지도 않게 (긴 빈 시간은 줄인다). 기간 막대는 그 축에서 해 → 높이를 바꿔 놓는다
 */
export function layoutTimeline(t: TimelineArt, W = 360): TimelineLayout {
  const lanes = t.spans.length ? Math.max(...t.spans.map((s) => s.lane)) + 1 : 0;
  const yearW = Math.max(28, ...t.events.map((e) => textWidth(e.when || String(e.year), TL.year)));
  const yearRight = Math.min(112, yearW + 8);
  const laneX = Array.from({ length: lanes }, (_, k) => yearRight + 12 + TL.lane / 2 + k * TL.lane);
  const axisX = lanes ? laneX[lanes - 1] + TL.lane / 2 + 10 : yearRight + 16;
  const labelX = axisX + 14;
  const maxW = W - labelX - 8;
  const events = t.events.map((e) => ({
    lines: wrapText(e.label || e.when, TL.size, maxW, 2),
    detail: e.detail ? wrapText(e.detail, TL.detail, maxW, 2) : [],
  }));
  // 사건마다 차지하는 높이 (글 줄 수)
  const need = events.map((e) => Math.max(TL.minGap, e.lines.length * 17 + e.detail.length * 15 + 10));

  // 시간 축의 점들: 사건마다 하나, 사건과 해가 같지 않은 기간 끝마다 하나 (해 순서, 같은 해면 사건 먼저)
  type Pt = { year: number; event: number };
  const pts: Pt[] = t.events.map((e, i) => ({ year: e.year, event: i }));
  const eventYears = new Set(t.events.map((e) => e.year));
  for (const year of new Set(t.spans.flatMap((s) => [s.from, s.to]))) if (!eventYears.has(year)) pts.push({ year, event: -1 });
  pts.sort((a, b) => a.year - b.year || (a.event < 0 ? 1 : 0) - (b.event < 0 ? 1 : 0) || a.event - b.event);
  const first = pts[0]?.year ?? 0;
  const last = pts[pts.length - 1]?.year ?? 0;
  // 해 1년의 높이: 점 사이 평균이 gap 쯤 되게
  const unit = (TL.gap * Math.max(1, pts.length - 1)) / Math.max(1, last - first);
  const ys: number[] = [];
  let y = TL.top + 8;
  pts.forEach((p, i) => {
    if (i > 0) {
      const prev = pts[i - 1];
      const want = t.even ? (p.event >= 0 && prev.event >= 0 ? TL.gap : TL.gap / 2) : (p.year - prev.year) * unit;
      // 앞 점이 사건이면 그 글이 차지하는 만큼은 벌린다 (기간 끝끼리는 조금만)
      const min = prev.event >= 0 ? need[prev.event] : p.event >= 0 ? 14 : 8;
      y += Math.max(min, Math.min(TL.gap * 3, want));
    }
    ys.push(y);
  });
  const eventY = new Array<number>(t.events.length).fill(TL.top);
  pts.forEach((p, i) => {
    if (p.event >= 0) eventY[p.event] = ys[i];
  });
  /** 해 → 높이 (from 은 그 해의 첫 점, to 는 마지막 점) */
  const yAt = (year: number, end: boolean): number => {
    let found = -1;
    pts.forEach((p, i) => {
      if (p.year === year && (found < 0 || end)) found = i;
    });
    if (found >= 0) return ys[found];
    // 축 밖이면 끝에서 평균 간격으로 (점은 모두 기간 끝이라 여기 오지 않는다)
    return year < first ? ys[0] - (first - year) * unit : ys[ys.length - 1] + (year - last) * unit;
  };
  const spans = t.spans.map((s) => {
    let y0 = yAt(s.from, false);
    let y1 = yAt(s.to, true);
    if (y1 - y0 < 22) {
      const mid = (y0 + y1) / 2;
      y0 = mid - 11;
      y1 = mid + 11;
    }
    return { y0, y1 };
  });
  const lastEvent = t.events.length ? Math.max(...t.events.map((_, i) => eventY[i] + need[i] - 10)) : 0;
  const bottom = Math.max(lastEvent, ...spans.map((s) => s.y1), TL.top + 20);
  // 위로 삐져나온 기간이 있으면 모두 내린다
  const minTop = Math.min(TL.top, ...spans.map((s) => s.y0));
  const shift = TL.top - minTop;
  return {
    W,
    H: Math.ceil(bottom + TL.bottom + shift),
    yearRight,
    laneX,
    axisX,
    labelX,
    events: events.map((e, i) => ({ ...e, y: eventY[i] + shift })),
    spans: spans.map((s) => ({ y0: s.y0 + shift, y1: s.y1 + shift })),
  };
}

// ---------------------------------------------------------------- 도식 (칸에 놓인 상자)
export const DG = { pad: 12, rowGap: 36, groupTop: 20, size: 12.5, line: 16, padX: 9, padY: 8 } as const;

export type NodeBox = { cx: number; cy: number; w: number; h: number; lines: string[] };
export type DiagramLayout = {
  W: number;
  H: number;
  boxes: Map<string, NodeBox>;
  groups: Array<{ x: number; y: number; w: number; h: number }>;
};

/**
 * 도식 자리: 칸 너비는 고르게, 줄 높이는 그 줄의 가장 큰 상자에 맞춘다. 묶음이 시작하는 줄은 이름 자리를 위에 더 둔다.
 * 칸이 많아도 폰 너비(360~400)에 그린다: 칸 사이를 좁히고 긴 이름은 줄을 바꾼다 (옆으로 밀거나 글이 작아지지 않게)
 */
/**
 * 같은 줄에서 칸이 겹치는 상자를 옆의 빈칸으로 옮긴다 (AI 가 두 상자를 같은 칸에 두면 글이 겹쳐 보였다).
 * 그 줄에 빈칸이 없으면 아래에 줄을 하나 더 만들어 둔다. 옮긴 자리 (번호 → {col,row,span}) 와 줄 수
 */
export function placeDiagramNodes(d: Pick<DiagramArt, 'cols' | 'rows' | 'nodes'>): {
  at: Map<string, { col: number; row: number; span: number }>;
  rows: number;
} {
  const used = new Map<number, boolean[]>();
  const cells = (row: number) => {
    let c = used.get(row);
    if (!c) {
      c = Array.from({ length: d.cols }, () => false);
      used.set(row, c);
    }
    return c;
  };
  const free = (row: number, col: number, span: number) =>
    col >= 0 &&
    col + span <= d.cols &&
    cells(row)
      .slice(col, col + span)
      .every((x) => !x);
  const take = (row: number, col: number, span: number) => {
    for (let k = col; k < col + span; k++) cells(row)[k] = true;
  };
  const at = new Map<string, { col: number; row: number; span: number }>();
  let rows = d.rows;
  for (const n of d.nodes) {
    const span = Math.max(1, Math.min(n.span, d.cols));
    let col = Math.max(0, Math.min(n.col, d.cols - span));
    let row = n.row;
    if (!free(row, col, span)) {
      // 가까운 빈칸부터 (오른쪽 → 왼쪽 번갈아)
      let found = -1;
      for (let off = 1; off < d.cols && found < 0; off++) {
        if (free(row, col + off, span)) found = col + off;
        else if (free(row, col - off, span)) found = col - off;
      }
      if (found >= 0) col = found;
      else {
        // 줄이 꽉 찼다: 아래에 새 줄
        row = rows;
        rows += 1;
      }
    }
    take(row, col, span);
    at.set(n.id, { col, row, span });
  }
  return { at, rows };
}

export function layoutDiagram(d: DiagramArt): DiagramLayout {
  const W = d.cols <= 4 ? 360 : 400;
  const gapX = d.cols >= 5 ? 8 : d.cols === 4 ? 10 : 14;
  const padX = d.cols >= 5 ? 5 : DG.padX;
  const cw = (W - DG.pad * 2) / d.cols;
  const placed = placeDiagramNodes(d);
  const nodesAt = d.nodes.map((n) => ({ ...n, ...placed.at.get(n.id)! }));
  const sized = nodesAt.map((n) => {
    const room = n.span * cw - gapX;
    const maxW = Math.max(24, room - padX * 2);
    const label = n.label || ' ';
    const lines = wrapText(label, DG.size, maxW, 3);
    const textW = Math.max(...lines.map((l) => textWidth(l, DG.size)));
    const round = n.shape === 'ellipse' || n.shape === 'circle';
    // 여러 칸을 차지하는 네모는 그 칸을 다 채운다 (신분 구조처럼 너비가 뜻을 가진 그림), 한 칸짜리·타원·원은 글에 맞게
    // (원·타원이 여러 칸을 다 채우면 판만큼 커져 다른 상자를 덮었다)
    let w =
      n.span >= 2 && n.shape !== 'plain' && !round
        ? room
        : Math.min(room, Math.max(Math.min(56, room), textW + padX * 2 + (n.shape === 'ellipse' ? 18 : n.shape === 'circle' ? 10 : 0)));
    let h = Math.max(34, lines.length * DG.line + DG.padY * 2 + (n.shape === 'ellipse' ? 8 : 0));
    if (n.shape === 'circle') {
      // 원은 글이 들어가는 만큼만 (너무 크지 않게: 지름 120 까지)
      const r = Math.min(Math.max(w, h, 44), room, 120);
      w = r;
      h = r;
    }
    if (n.shape === 'plain') h = Math.max(24, lines.length * DG.line + 6);
    return { n, w, h, lines };
  });
  const rowCount = placed.rows;
  const rowH = Array.from({ length: rowCount }, (_, r) => Math.max(18, ...sized.filter((s) => s.n.row === r).map((s) => s.h)));
  const extra = Array.from({ length: rowCount }, (_, r) => (d.groups.some((g) => g.row === r) ? DG.groupTop : 0));
  const rowTop: number[] = [];
  let y = DG.pad;
  for (let r = 0; r < rowCount; r++) {
    y += extra[r];
    rowTop.push(y);
    y += rowH[r] + (r < rowCount - 1 ? DG.rowGap : 0);
  }
  const H = Math.ceil(y + DG.pad);
  const boxes = new Map<string, NodeBox>();
  for (const s of sized) {
    const cx = DG.pad + (s.n.col + s.n.span / 2) * cw;
    const cy = rowTop[s.n.row] + rowH[s.n.row] / 2;
    boxes.set(s.n.id, { cx, cy, w: s.w, h: s.h, lines: s.lines });
  }
  const groups = d.groups.map((g) => {
    const x = DG.pad + g.col * cw + 2;
    const top = rowTop[g.row] - DG.groupTop + 2;
    const last = Math.min(rowCount - 1, g.row + g.rows - 1);
    const bottom = rowTop[last] + rowH[last] + 8;
    return { x, y: top, w: g.cols * cw - 4, h: bottom - top };
  });
  return { W, H, boxes, groups };
}

// ---------------------------------------------------------------- 지도 선 이름 (진출로·강 …)
/** 꺾은선 길이의 t(0~1) 자리와 그 자리에서 선에 수직인 쪽 (화면 위쪽을 먼저) */
export function pointAlong(pts: XY[], t: number): { at: XY; normal: XY } {
  let total = 0;
  for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  const goal = total * Math.max(0, Math.min(1, t));
  let walked = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0 && walked + len >= goal - 1e-9) {
      const u = (goal - walked) / len;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      return { at: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, normal: ny <= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny } };
    }
    walked += len;
  }
  return { at: pts[0] ?? { x: 0, y: 0 }, normal: { x: 0, y: -1 } };
}

const pointRectDist = (p: XY, r: Rect) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));

function pointSegDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** 글 상자와 꺾은선 사이의 가장 짧은 거리 (겹치면 0) */
export function rectLineDist(r: Rect, pts: XY[]): number {
  const corners: XY[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h },
    { x: r.x + r.w, y: r.y + r.h },
  ];
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    if (segmentHitsRect(a, b, r)) return 0;
    best = Math.min(best, pointRectDist(a, r), pointRectDist(b, r), ...corners.map((c) => pointSegDist(c, a, b)));
  }
  return best;
}

function overlapArea(a: Rect, b: Rect, gap = 2): number {
  const w = Math.min(a.x + a.w + gap, b.x + b.w) - Math.max(a.x - gap, b.x);
  const h = Math.min(a.y + a.h + gap, b.y + b.h) - Math.max(a.y - gap, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export type LineLabelReq = { key: string; /** lines 안의 번호 */ line: number; w: number; h: number };

/**
 * 선 이름 자리: 선을 따라 여러 곳(가운데부터)·양쪽·몇 가지 거리에서 고른다. 다른 선보다 제 선에 가까워야 한다
 * (옆 진출로의 이름처럼 읽히면 틀린 그림이 된다: 겹치는 것보다 나쁘다) → 다른 글과 겹치지 않게 → 선을 덮지 않게 → 가운데에 가깝게.
 * lines 는 지도의 모든 선 (이름 없는 선도 헷갈림을 따질 때 쓴다), placed 는 이미 놓인 글·점. 돌려주는 것은 글 상자의 가운데
 */
export function placeLineLabels(reqs: LineLabelReq[], lines: XY[][], placed: Rect[], bounds: Rect): Map<string, XY> {
  const out = new Map<string, XY>();
  const taken = [...placed];
  const segs: Array<[XY, XY]> = lines.flatMap((pts) => pts.slice(1).map((b, k): [XY, XY] => [pts[k], b]));
  for (const r of reqs) {
    const own = lines[r.line];
    if (!own || own.length < 2) continue;
    let best: { c: XY; score: number } | null = null;
    for (const t of [0.5, 0.38, 0.62, 0.26, 0.74, 0.14, 0.86]) {
      const { at, normal } = pointAlong(own, t);
      for (const side of [1, -1]) {
        for (const dist of [4, 9, 15]) {
          const nx = normal.x * side;
          const ny = normal.y * side;
          const push = dist + (Math.abs(nx) * r.w) / 2 + (Math.abs(ny) * r.h) / 2;
          const c = { x: at.x + nx * push, y: at.y + ny * push };
          const rect = { x: c.x - r.w / 2, y: c.y - r.h / 2, w: r.w, h: r.h };
          if (rect.x < bounds.x || rect.y < bounds.y || rect.x + rect.w > bounds.x + bounds.w || rect.y + rect.h > bounds.y + bounds.h) continue;
          let score = Math.abs(t - 0.5) * 40 + (dist - 4) * 1.5 + (side < 0 ? 3 : 0);
          const dOwn = rectLineDist(rect, own);
          const dOther = Math.min(Infinity, ...lines.map((pts, i) => (i === r.line || pts.length < 2 ? Infinity : rectLineDist(rect, pts))));
          if (dOther <= dOwn + 4) score += 2500;
          const hit = taken.reduce((s, p) => s + overlapArea(rect, p), 0);
          if (hit > 0) score += 1500 + Math.min(1000, (hit / (r.w * r.h)) * 1000);
          const shrunk = { x: rect.x + 1.5, y: rect.y + 1.5, w: rect.w - 3, h: rect.h - 3 };
          if (segs.some(([p, q]) => segmentHitsRect(p, q, shrunk))) score += 100;
          if (!best || score < best.score) best = { c, score };
        }
      }
    }
    // 그림 안에 둘 자리가 하나도 없으면 (아주 작은 그림) 가운데 위쪽
    const c = best?.c ?? pointAlong(own, 0.5).at;
    out.set(r.key, c);
    taken.push({ x: c.x - r.w / 2, y: c.y - r.h / 2, w: r.w, h: r.h });
  }
  return out;
}

/** 상자 사이를 잇는 선: 위아래로 떨어져 있으면 꺾은선(가운데 높이에서 꺾는다), 같은 줄이면 옆으로 곧게 */
export function linkRoute(a: NodeBox, b: NodeBox): Array<{ x: number; y: number }> {
  const sameRow = Math.abs(a.cy - b.cy) < Math.min(a.h, b.h) / 2;
  if (sameRow) {
    const dir = b.cx >= a.cx ? 1 : -1;
    return [
      { x: a.cx + (dir * a.w) / 2, y: a.cy },
      { x: b.cx - (dir * b.w) / 2, y: b.cy },
    ];
  }
  const down = b.cy > a.cy ? 1 : -1;
  const start = { x: a.cx, y: a.cy + (down * a.h) / 2 };
  const end = { x: b.cx, y: b.cy - (down * b.h) / 2 };
  if (Math.abs(start.x - end.x) < 2) return [start, { x: start.x, y: end.y }];
  const mid = (start.y + end.y) / 2;
  return [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
}
