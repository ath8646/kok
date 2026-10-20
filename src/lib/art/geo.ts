// 지도 그리기 계산 (화면과 상관없는 순수 함수, 시험 있음). 좌표는 [경도, 위도, 경도, 위도, …] 납작한 배열.
// 투영: 보는 범위 가운데 위도를 표준 위선으로 하는 정거원통도법 (x = 경도 × cos(가운데 위도), y = 위도).
// 한반도·동아시아처럼 좁은 범위에서는 모양이 거의 그대로이고, 계산이 단순해서 AI 가 준 경도·위도를 바로 쓸 수 있다.
// (도구 tools/maps/build.mjs 도 이 파일을 그대로 불러 쓴다: 타입 표시 말고 TS 문법을 쓰지 않는다)

export type Bounds = { west: number; east: number; south: number; north: number };
export type XY = { x: number; y: number };

// ---------------------------------------------------------------- 선 단순하게 (Douglas–Peucker)
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** 모양을 지키며 점을 줄인다 (tol: 같은 단위의 허용 거리). 첫 점과 끝 점은 그대로 */
export function simplifyFlat(pts: number[], tol: number): number[] {
  const n = Math.floor(pts.length / 2);
  if (n <= 2 || !(tol > 0)) return pts.slice(0, n * 2);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let best = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

// ---------------------------------------------------------------- 범위
export function boundsOf(pts: number[]): Bounds | null {
  if (pts.length < 2) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (let k = 0; k + 1 < pts.length; k += 2) {
    west = Math.min(west, pts[k]);
    east = Math.max(east, pts[k]);
    south = Math.min(south, pts[k + 1]);
    north = Math.max(north, pts[k + 1]);
  }
  return { west, east, south, north };
}

export function inside(b: Bounds, outer: Bounds): boolean {
  return b.west >= outer.west && b.east <= outer.east && b.south >= outer.south && b.north <= outer.north;
}

export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

// ---------------------------------------------------------------- 투영과 그림 틀
export type Frame = {
  /** 그림 크기 (SVG viewBox) */
  W: number;
  H: number;
  /** 틀에 맞게 넓힌 보는 범위 */
  view: Bounds;
  x: (lon: number) => number;
  y: (lat: number) => number;
};

/**
 * 보는 범위를 그림 틀에 맞춘다. 높이는 범위 모양대로(minH~maxH), 남는 쪽은 범위를 넓혀 채운다
 * (한반도처럼 세로로 긴 지도도 양옆이 비지 않고 바다·땅이 이어진다)
 */
export function fitFrame(view: Bounds, W = 360, minH = 220, maxH = 480): Frame {
  const mid = ((view.south + view.north) / 2) * (Math.PI / 180);
  const k = Math.max(0.2, Math.cos(mid));
  const spanX = Math.max(0.2, (view.east - view.west) * k);
  const spanY = Math.max(0.2, view.north - view.south);
  const H = Math.round(Math.max(minH, Math.min(maxH, (W * spanY) / spanX)));
  // 틀 비율에 맞게 범위를 넓힌다 (가운데는 그대로)
  let sx = spanX;
  let sy = spanY;
  if (sy / sx < H / W) sy = (sx * H) / W;
  else sx = (sy * W) / H;
  const cx = (view.west + view.east) / 2;
  const cy = (view.south + view.north) / 2;
  const halfLon = sx / k / 2;
  const halfLat = sy / 2;
  const fitted: Bounds = { west: cx - halfLon, east: cx + halfLon, south: cy - halfLat, north: cy + halfLat };
  const scale = W / sx;
  return {
    W,
    H,
    view: fitted,
    x: (lon) => (lon - fitted.west) * k * scale,
    y: (lat) => (fitted.north - lat) * scale,
  };
}

/** 납작한 경도·위도 → 화면 점 */
export function projectFlat(pts: number[], f: Pick<Frame, 'x' | 'y'>): XY[] {
  const out: XY[] = [];
  for (let k = 0; k + 1 < pts.length; k += 2) out.push({ x: f.x(pts[k]), y: f.y(pts[k + 1]) });
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 닫힌 고리(땅·영역)의 SVG 길 */
export function ringPath(pts: XY[]): string {
  if (pts.length < 3) return '';
  return `M${pts.map((p) => `${r1(p.x)} ${r1(p.y)}`).join('L')}Z`;
}

/** 열린 선의 SVG 길. smooth 면 부드러운 곡선 (진출로·바닷길) */
export function linePath(pts: XY[], smooth = false): string {
  if (pts.length < 2) return '';
  if (!smooth || pts.length < 3) return `M${pts.map((p) => `${r1(p.x)} ${r1(p.y)}`).join('L')}`;
  // Catmull–Rom → 베지어
  let d = `M${r1(pts[0].x)} ${r1(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(p2.x)} ${r1(p2.y)}`;
  }
  return d;
}

// ---------------------------------------------------------------- 다각형
/** 점이 고리 안에 있는지 (짝홀 규칙) */
export function inRing(p: XY, ring: XY[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) hit = !hit;
  }
  return hit;
}

/** 고리 가장자리까지의 가장 짧은 거리 */
export function edgeDistance(p: XY, ring: XY[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, segDist2(p.x, p.y, ring[i].x, ring[i].y, ring[j].x, ring[j].y));
  return Math.sqrt(best);
}

/** 고리의 넓이 (부호 없음) */
export function ringArea(ring: XY[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return Math.abs(a / 2);
}

/**
 * 영역 이름을 둘 자리: 고리 안에서 가장자리와 가장 먼 점 (모양이 길쭉해도 안쪽에 온다).
 * ok 가 있으면 그 점들 중에서만 고른다 (땅 위의 점만 등). 격자로 찾고 가장 좋은 곳 둘레를 한 번 더 촘촘히 본다
 */
export function labelSpot(ring: XY[], ok?: (p: XY) => boolean): XY | null {
  if (ring.length < 3) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const search = (cx0: number, cx1: number, cy0: number, cy1: number, n: number, filter: boolean) => {
    let best: XY | null = null;
    let bestD = -1;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = { x: cx0 + ((cx1 - cx0) * i) / n, y: cy0 + ((cy1 - cy0) * j) / n };
        if (!inRing(p, ring)) continue;
        if (filter && ok && !ok(p)) continue;
        const d = edgeDistance(p, ring);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  };
  const coarse = search(x0, x1, y0, y1, 16, true) ?? search(x0, x1, y0, y1, 16, false);
  if (!coarse) return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const cw = (x1 - x0) / 16;
  const ch = (y1 - y0) / 16;
  return search(coarse.x - cw, coarse.x + cw, coarse.y - ch, coarse.y + ch, 8, true) ?? coarse;
}

// ---------------------------------------------------------------- 잘라 내기 (도구에서 밑그림을 만들 때)
/** 고리를 네모 범위로 자른다 (Sutherland–Hodgman). 고리가 범위 밖이면 빈 배열 */
export function clipRing(pts: number[], b: Bounds): number[] {
  type P = [number, number];
  let poly: P[] = [];
  for (let k = 0; k + 1 < pts.length; k += 2) poly.push([pts[k], pts[k + 1]]);
  const edges: Array<[(p: P) => boolean, (a: P, c: P) => P]> = [
    [(p) => p[0] >= b.west, (a, c) => [b.west, a[1] + ((c[1] - a[1]) * (b.west - a[0])) / (c[0] - a[0])]],
    [(p) => p[0] <= b.east, (a, c) => [b.east, a[1] + ((c[1] - a[1]) * (b.east - a[0])) / (c[0] - a[0])]],
    [(p) => p[1] >= b.south, (a, c) => [a[0] + ((c[0] - a[0]) * (b.south - a[1])) / (c[1] - a[1]), b.south]],
    [(p) => p[1] <= b.north, (a, c) => [a[0] + ((c[0] - a[0]) * (b.north - a[1])) / (c[1] - a[1]), b.north]],
  ];
  for (const [isIn, cross] of edges) {
    if (!poly.length) break;
    const out: P[] = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i];
      const prev = poly[(i + poly.length - 1) % poly.length];
      const cin = isIn(cur);
      const pin = isIn(prev);
      if (cin) {
        if (!pin) out.push(cross(prev, cur));
        out.push(cur);
      } else if (pin) out.push(cross(prev, cur));
    }
    poly = out;
  }
  return poly.length >= 3 ? poly.flat() : [];
}

/** 열린 선을 네모 범위로 자른다 (범위를 나갔다 들어오면 여러 조각) */
export function clipLine(pts: number[], b: Bounds): number[][] {
  const pieces: number[][] = [];
  let cur: number[] = [];
  const isIn = (x: number, y: number) => x >= b.west && x <= b.east && y >= b.south && y <= b.north;
  for (let k = 0; k + 1 < pts.length; k += 2) {
    const x = pts[k];
    const y = pts[k + 1];
    if (isIn(x, y)) cur.push(x, y);
    else {
      if (cur.length >= 4) pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 4) pieces.push(cur);
  return pieces;
}
