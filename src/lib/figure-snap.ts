// 자료 그림 상자 다듬기 (AI 없음, 순수 계산): AI 가 준 그림 상자의 네 변을 쪽의 빈 줄(여백)에 맞춘다.
// AI 의 상자는 몇 % 씩 어긋난다. 그래서 변마다
//   - 변이 여백 위에 있으면 안쪽으로 여백만큼 줄이고 (그림을 자르지 않는다: 빈 줄만 건너뛴다),
//   - 변이 내용(그림·글)을 가로지르면 가까운 여백까지 옮긴다:
//     안쪽 여백이 더 가까우면 변에 걸친 얇은 띠(그림 밖의 글 한 줄)를 빼고, 바깥 여백이 더 가까우면 잘린 그림을 마저 넣는다.
// 바깥으로는 쪽의 3% 까지만 찾는다 (옆 그림·글을 삼키지 않게). 결과가 처음 상자와 너무 다르면 처음 상자를 쓴다.
// PDF 쪽(평평하고 바탕이 고르다)에만 쓴다. 비스듬히 찍은 사진은 바탕이 고르지 않아서 쓰지 않는다.

/** 쪽 픽셀 (RGBA, 한 줄씩) */
export type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
/** 픽셀 상자: x0 ≤ x < x1, y0 ≤ y < y1 */
export type PxRect = { x0: number; y0: number; x1: number; y1: number };

/** 바탕색과 이만큼(0~255, 가장 많이 다른 색 성분) 넘게 다르면 내용으로 본다: 옅은 바다·옅은 상자도 내용이다 */
const INK_DIFF = 14;
/** 줄의 내용 픽셀이 이 비율 이하면 빈 줄 (잡티 몇 개는 빈 줄로) */
const EMPTY_FRAC = 0.003;

/** 쪽 가장자리(짧은 변의 1.5%)에서 가장 많은 색을 바탕색으로 본다 (32 단계로 묶어 세고, 그 묶음의 평균) */
export function backgroundOf(px: Pixels): [number, number, number] {
  const { data, width: W, height: H } = px;
  const m = Math.max(2, Math.round(Math.min(W, H) * 0.015));
  const count = new Uint32Array(512);
  const sum = new Float64Array(512 * 3);
  const add = (x: number, y: number) => {
    const k = (y * W + x) * 4;
    const r = data[k];
    const g = data[k + 1];
    const b = data[k + 2];
    const bin = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    count[bin]++;
    sum[bin * 3] += r;
    sum[bin * 3 + 1] += g;
    sum[bin * 3 + 2] += b;
  };
  // 너무 큰 쪽은 건너뛰며 센다 (색을 고르는 데는 충분하다)
  const step = Math.max(1, Math.floor(Math.max(W, H) / 1200));
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (y < m || y >= H - m || x < m || x >= W - m) add(x, y);
    }
  }
  let best = 0;
  for (let i = 1; i < 512; i++) if (count[i] > count[best]) best = i;
  const n = Math.max(1, count[best]);
  return [sum[best * 3] / n, sum[best * 3 + 1] / n, sum[best * 3 + 2] / n];
}

/** 내용 픽셀 표 (1 = 바탕색과 다르다) */
export function contentMask(px: Pixels, bg: [number, number, number] = backgroundOf(px), diff = INK_DIFF): Uint8Array {
  const { data, width: W, height: H } = px;
  const out = new Uint8Array(W * H);
  const [br, bgc, bb] = bg;
  for (let i = 0, k = 0; i < out.length; i++, k += 4) {
    const d = Math.max(Math.abs(data[k] - br), Math.abs(data[k + 1] - bgc), Math.abs(data[k + 2] - bb));
    if (d > diff) out[i] = 1;
  }
  return out;
}

type Mask = { m: Uint8Array; W: number; H: number };

/** 가로줄 y 의 [a, b) 안 내용 픽셀이 거의 없는지, 줄마다 (from..to, 쪽 안만) */
function rowsEmpty(mask: Mask, a: number, b: number): (y: number) => boolean {
  const lim = Math.max(1, (b - a) * EMPTY_FRAC);
  const memo = new Map<number, boolean>();
  return (y) => {
    let v = memo.get(y);
    if (v === undefined) {
      let n = 0;
      const base = y * mask.W;
      for (let x = a; x < b && n <= lim; x++) n += mask.m[base + x];
      v = n <= lim;
      memo.set(y, v);
    }
    return v;
  };
}

function colsEmpty(mask: Mask, a: number, b: number): (x: number) => boolean {
  const lim = Math.max(1, (b - a) * EMPTY_FRAC);
  const memo = new Map<number, boolean>();
  return (x) => {
    let v = memo.get(x);
    if (v === undefined) {
      let n = 0;
      for (let y = a; y < b && n <= lim; y++) n += mask.m[y * mask.W + x];
      v = n <= lim;
      memo.set(x, v);
    }
    return v;
  };
}

/**
 * start 에서 step 쪽으로 가며 빈 줄이 need 개 이어지는 첫 자리 (그 띠의 첫 줄)와 거리. limit 줄 안에 없으면 null.
 * len: 줄의 수 (쪽 밖으로 나가지 않게)
 */
function gutter(empty: (i: number) => boolean, start: number, step: 1 | -1, limit: number, need: number, len: number): { at: number; dist: number } | null {
  let run = 0;
  for (let d = 0, p = start; d <= limit && p >= 0 && p < len; d++, p += step) {
    if (empty(p)) {
      run++;
      if (run >= need) return { at: p - step * (need - 1), dist: d - (need - 1) };
    } else run = 0;
  }
  return null;
}

type EdgeOpts = { need: number; grow: number; pad: number };

/**
 * 한 축의 두 변(lo: 안쪽 첫 줄, hi: 안쪽 마지막 줄)을 다듬는다. 돌려주는 값은 새 [lo, hi] (안쪽 첫 줄·마지막 줄)
 */
function fixAxis(empty: (i: number) => boolean, lo: number, hi: number, len: number, o: EdgeOpts): [number, number] {
  const span = hi - lo + 1;
  const band = Math.max(o.need + 1, Math.floor(span * 0.15));
  const out: number[] = [];
  for (const [edge, inward] of [
    [lo, 1],
    [hi, -1],
  ] as Array<[number, 1 | -1]>) {
    if (empty(edge)) {
      // 여백 위의 변: 빈 줄만 건너 안쪽으로 (첫 내용 줄 앞에 pad 만큼 여백). 4분의 1 넘게 비었으면 그대로 둔다
      let p = edge;
      let n = 0;
      const max = Math.floor(span / 4);
      while (p >= 0 && p < len && empty(p) && n < max) {
        p += inward;
        n++;
      }
      out.push(n >= max ? edge : clampLine(p - inward * Math.min(o.pad, n), len));
      continue;
    }
    // 내용을 가로지르는 변: 더 가까운 여백으로
    const outer = gutter(empty, edge - inward, -inward as 1 | -1, o.grow, o.need, len);
    const inner = gutter(empty, edge + inward, inward, band, o.need, len);
    if (inner && (!outer || inner.dist < outer.dist)) {
      // 변에 걸친 얇은 띠(그림 밖의 글 한 줄)를 뺀다: 안쪽 여백의 첫 줄에서 멈춘다 (다음 번에 여백을 줄인다)
      out.push(inner.at);
    } else if (outer) {
      // 잘린 그림을 마저 넣는다: 바깥 여백의 첫 줄에서 빈 줄을 따라 pad 만큼 더
      let p = outer.at;
      for (let k = 0; k < o.pad; k++) {
        const q = p - inward;
        if (q < 0 || q >= len || !empty(q)) break;
        p = q;
      }
      out.push(p);
    } else {
      // 가까운 여백이 없다: 그대로 (조금만 넉넉히)
      out.push(clampLine(edge - inward * o.pad, len));
    }
  }
  return [out[0], out[1]];
}

const clampLine = (v: number, len: number) => Math.max(0, Math.min(len - 1, Math.round(v)));

/**
 * 상자를 쪽의 내용에 맞춘다. 결과가 처음 상자와 너무 다르면(넓이가 반 아래·1.7배 위) 처음 상자를 그대로 돌려준다
 */
export function snapRect(mask: Mask, r: PxRect, passes = 2): PxRect {
  const { W, H } = mask;
  let x0 = Math.max(0, Math.min(W - 1, Math.round(r.x0)));
  let y0 = Math.max(0, Math.min(H - 1, Math.round(r.y0)));
  let x1 = Math.max(x0 + 1, Math.min(W, Math.round(r.x1)));
  let y1 = Math.max(y0 + 1, Math.min(H, Math.round(r.y1)));
  const start = { x0, y0, x1, y1 };
  const big = Math.max(W, H);
  const o: EdgeOpts = { need: Math.max(3, Math.round(big * 0.0015)), grow: Math.round(big * 0.03), pad: Math.max(2, Math.round(big * 0.003)) };
  for (let i = 0; i < passes; i++) {
    const [ny0, ny1] = fixAxis(rowsEmpty(mask, x0, x1), y0, y1 - 1, H, o);
    if (ny1 <= ny0) break;
    y0 = ny0;
    y1 = ny1 + 1;
    const [nx0, nx1] = fixAxis(colsEmpty(mask, y0, y1), x0, x1 - 1, W, o);
    if (nx1 <= nx0) break;
    x0 = nx0;
    x1 = nx1 + 1;
  }
  const area = (q: PxRect) => Math.max(0, q.x1 - q.x0) * Math.max(0, q.y1 - q.y0);
  const ratio = area({ x0, y0, x1, y1 }) / Math.max(1, area(start));
  if (!(ratio >= 0.5 && ratio <= 1.7)) return start;
  return { x0, y0, x1, y1 };
}

/** 상자 둘레에 여백을 pad 만큼 두른다: 빈 줄로만 넓히고 내용(옆 글·그림)에 닿으면 멈춘다 */
export function padEmpty(mask: Mask, r: PxRect, pad: number): PxRect {
  const { W, H } = mask;
  let { x0, y0, x1, y1 } = r;
  const rows = rowsEmpty(mask, x0, x1);
  for (let k = 0; k < pad && y0 > 0 && rows(y0 - 1); k++) y0--;
  for (let k = 0; k < pad && y1 < H && rows(y1); k++) y1++;
  const cols = colsEmpty(mask, y0, y1);
  for (let k = 0; k < pad && x0 > 0 && cols(x0 - 1); k++) x0--;
  for (let k = 0; k < pad && x1 < W && cols(x1); k++) x1++;
  return { x0, y0, x1, y1 };
}

export type { Mask as ContentMask };
