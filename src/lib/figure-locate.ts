// 자료 그림 자리 찾기 (순수 계산): 쪽 그림을 AI 에 보낼 크기, AI 답 읽기, 그림이 없을 때 찾아볼 쪽의 차례.
// AI 는 정리할 때 PDF 여러 쪽을 한꺼번에 보고 그림을 찾지만, 그때 준 쪽 번호와 자리는 자주 틀린다
// (Anthropic 문서: PDF 위의 좌표·0~1000 비율 좌표는 믿기 어렵다 → 쪽을 직접 그림으로 그려, 그 그림의 픽셀 좌표를 받는다).
// 그래서 그림마다 그 쪽을 그림으로 그려 한 장씩 보여 주고(없으면 가까운 쪽부터 더 보고) 픽셀 상자를 받는다.

/**
 * Claude 가 줄이지 않고 그대로 보는 그림 크기 (표준 해상도: 긴 변 1568 픽셀, ⌈w/28⌉×⌈h/28⌉ ≤ 1568 토큰).
 * 문서의 resized_size 와 같은 방법이고, 경계에서 어긋나지 않게 조금 작게 잡는다. 그대로 보는 그림이어야 받은 픽셀 좌표가 그 그림의 좌표다
 */
export const VISION_MAX_EDGE = 1540;
export const VISION_MAX_TOKENS = 1540;

export function visionTokens(w: number, h: number): number {
  return Math.ceil(w / 28) * Math.ceil(h / 28);
}

export function visionSize(width: number, height: number, maxEdge = VISION_MAX_EDGE, maxTokens = VISION_MAX_TOKENS): { width: number; height: number } {
  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(height));
  const fits = (w: number, h: number) => Math.ceil(w / 28) * 28 <= maxEdge && Math.ceil(h / 28) * 28 <= maxEdge && visionTokens(w, h) <= maxTokens;
  if (fits(W, H)) return { width: W, height: H };
  if (H > W) {
    const r = visionSize(H, W, maxEdge, maxTokens);
    return { width: r.height, height: r.width };
  }
  const aspect = W / H;
  let lo = 1;
  let hi = W;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid, Math.max(1, Math.round(mid / aspect)))) lo = mid;
    else hi = mid;
  }
  return { width: lo, height: Math.max(1, Math.round(lo / aspect)) };
}

/** 그림 자리: 그림(AI 에 보낸 쪽 그림) 위의 네 꼭짓점 (왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래, 픽셀) */
export type Quad = [number, number, number, number, number, number, number, number];

export type Located = {
  /** 그림이 있는 쪽 그림의 차례 (0부터). 없으면 -1 */
  image: number;
  /** image 의 픽셀 꼭짓점 (없으면 null) */
  quad: Quad | null;
};

/** 너무 작은 상자(쪽 그림의 짧은 변의 4% 아래)는 그림이 아니거나 잘못 찾은 것 */
const MIN_SIDE_FRAC = 0.04;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

/** 상자 [x1, y1, x2, y2] (PDF) 또는 꼭짓점 여덟 수 (사진) → 쪽 그림 안의 꼭짓점. 이상하면 null */
export function quadOf(raw: unknown, size: { width: number; height: number }): Quad | null {
  if (!Array.isArray(raw)) return null;
  const v = raw.map(num);
  if (v.some((x) => !Number.isFinite(x))) return null;
  const { width: W, height: H } = size;
  // 그림 밖으로 조금 나간 것은 받는다 (사진 가장자리에 걸친 그림), 많이 나가면 잘못 준 것
  const slackX = W * 0.1;
  const slackY = H * 0.1;
  if (v.some((x, i) => (i % 2 === 0 ? x < -slackX || x > W + slackX : x < -slackY || x > H + slackY))) return null;
  let q: Quad;
  if (v.length === 4) {
    const x0 = Math.min(v[0], v[2]);
    const x1 = Math.max(v[0], v[2]);
    const y0 = Math.min(v[1], v[3]);
    const y1 = Math.max(v[1], v[3]);
    q = [x0, y0, x1, y0, x1, y1, x0, y1];
  } else if (v.length === 8) q = v as Quad;
  else return null;
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const min = MIN_SIDE_FRAC * Math.min(W, H);
  if (Math.max(...xs) - Math.min(...xs) < min || Math.max(...ys) - Math.min(...ys) < min) return null;
  return q;
}

/**
 * AI 의 답을 읽는다: 그림마다(차례 index) 어느 쪽 그림의 어디에 있는지, 쪽마다 인쇄된 쪽 번호.
 * figures: 물어본 그림 수, sizes: 보낸 쪽 그림들의 크기
 */
export function readLocate(raw: unknown, figures: number, sizes: Array<{ width: number; height: number }>): { located: Located[]; printed: number[] } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const located: Located[] = Array.from({ length: figures }, () => ({ image: -1, quad: null }));
  const list = Array.isArray(r.figures) ? r.figures : [];
  list.forEach((item, k) => {
    if (!item || typeof item !== 'object') return;
    const it = item as Record<string, unknown>;
    // 차례가 이상하면 답의 차례를 쓴다
    const idx = Number.isInteger(it.index) && (it.index as number) >= 0 && (it.index as number) < figures ? (it.index as number) : k;
    if (idx >= figures || located[idx].image >= 0) return;
    const image = Math.round(num(it.image)) - 1;
    if (!(image >= 0 && image < sizes.length)) return;
    const quad = quadOf(it.box ?? it.corners, sizes[image]);
    if (quad) located[idx] = { image, quad };
  });
  const printed = sizes.map((_, i) => {
    const p = Array.isArray(r.printed) ? Math.round(num(r.printed[i])) : NaN;
    return Number.isFinite(p) && p > 0 && p < 100000 ? p : 0;
  });
  return { located, printed };
}

/** 쪽 그림의 픽셀 → 원래 쪽(그린 쪽)의 픽셀 */
export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return q.map((v, i) => (i % 2 === 0 ? v * sx : v * sy)) as Quad;
}

/** 한 번에 보여 주는 쪽 수 (처음에는 그 쪽만, 없으면 가까운 쪽들을 이만큼씩) */
export const SEARCH_BATCH = 4;
/** 그림 하나를 찾느라 AI 에 묻는 수의 끝 (처음 쪽 + 이웃 묶음) */
export const SEARCH_CALLS_MAX = 4;

/**
 * 다음에 보여 줄 쪽들: 처음에는 AI 가 말한 쪽만, 그다음은 쪽 번호로 짐작한 쪽(hint) → 가까운 쪽부터 (범위 안, 본 쪽 빼고) 묶음 하나.
 * 더 볼 쪽이 없으면 []
 */
export function nextPages(o: { claimed: number; hints?: number[]; from: number; to: number; tried: number[]; batch?: number }): number[] {
  const tried = new Set(o.tried);
  const inRange = (p: number) => Number.isInteger(p) && p >= o.from && p <= o.to && !tried.has(p);
  if (!tried.size) return inRange(o.claimed) ? [o.claimed] : nextPages({ ...o, tried: [o.claimed] });
  const order: number[] = [];
  for (const h of o.hints ?? []) if (inRange(h) && !order.includes(h)) order.push(h);
  const far = Math.max(Math.abs(o.claimed - o.from), Math.abs(o.to - o.claimed));
  for (let d = 1; d <= far; d++) {
    for (const p of [o.claimed - d, o.claimed + d]) if (inRange(p) && !order.includes(p)) order.push(p);
  }
  return order.slice(0, o.batch ?? SEARCH_BATCH);
}
