// 인쇄된 쪽 번호: PDF 의 몇째 쪽(1부터)이 책에 찍힌 몇 쪽인지.
// 교과서 일부(114~162쪽)를 PDF 로 만들면 PDF 의 1쪽이 책의 114쪽이다. 노트의 쪽 표시는 책의 쪽 번호로 보이고
// (없으면 PDF 쪽), 원본 열기는 그대로 PDF 쪽으로 간다. 노트 정리(body.page_labels)에 구간마다 더할 수로 둔다.
//
// 증거: PDF 글자(쪽 아래·위에 쓰인 숫자, 가장 믿을 만하다), 정리할 때 AI 가 읽은 쪽마다의 번호(여러 쪽을 한꺼번에 봐서 덜 믿는다),
// 그림을 찾을 때 AI 가 한 쪽씩 보고 읽은 번호(쪽 하나를 보고 읽어 믿을 만하다). 조각(정리 한 번)마다 가장 많이 맞는 차이를 고른다.

/** PDF 쪽 from~to 는 인쇄된 번호 = 쪽 + add */
export type PageLabelSpan = { from: number; to: number; add: number };
export type PageLabels = PageLabelSpan[];

/** 조각 하나의 쪽 번호들: nums[i] = PDF 쪽 start + i 에 인쇄된 번호 (0 이면 없음) */
export type PageEvidence = { start: number; nums: number[] };
/** 쪽 하나를 보고 읽은 번호 */
export type PageAnchor = { page: number; printed: number };

const MAX_PRINTED = 99999;
const MAX_SPANS = 200;

const isPrinted = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= MAX_PRINTED;

/** 표를 세어 가장 많은 차이와 그 표 수 (같으면 먼저 나온 것) */
function mode(votes: number[]): { add: number; n: number } | null {
  const count = new Map<number, number>();
  let best: { add: number; n: number } | null = null;
  for (const a of votes) {
    const n = (count.get(a) ?? 0) + 1;
    count.set(a, n);
    if (!best || n > best.n) best = { add: a, n };
  }
  return best;
}

/** offsetOf 와 같고, 그 차이에 맞는 쪽 수도 돌려준다 */
function offsetVotes(ev: PageEvidence): { add: number; n: number } | null {
  const votes: number[] = [];
  ev.nums.forEach((n, i) => {
    if (isPrinted(n)) votes.push(n - (ev.start + i));
  });
  const best = mode(votes);
  if (!best) return null;
  if (ev.nums.length === 1) return best;
  if (best.n < 2 || best.n * 2 <= votes.length) return null;
  return best;
}

/**
 * 한 조각의 번호들에서 차이(인쇄된 번호 - PDF 쪽)를 고른다. 번호가 있는 쪽의 반 넘게(쪽이 하나뿐이면 그 하나) 같은 차이여야 하고,
 * 쪽이 여럿이면 둘 넘게 맞아야 한다. 못 고르면 null
 */
export function offsetOf(ev: PageEvidence): number | null {
  return offsetVotes(ev)?.add ?? null;
}

type Part = { from: number; to: number; text?: PageEvidence | null; ai?: PageEvidence | null };

/**
 * 조각마다의 증거로 구간을 만든다. 조각마다: PDF 글자의 차이 → (쪽 하나씩 읽은 번호가 둘 넘게 맞으면) 그 차이
 * → AI 가 읽은 차이 (쪽 하나씩 읽은 번호가 하나뿐이면 그것과 맞거나, 셋 넘는 쪽이 맞을 때) → 쪽 하나짜리 조각이면 그 쪽에서 읽은 번호.
 * 차이를 못 고른 조각은 앞뒤 조각의 차이가 같으면 그 차이를 쓴다. 모든 차이가 0 이면(PDF 쪽 = 인쇄된 번호) 빈 목록
 */
export function buildPageLabels(parts: Part[], anchors: PageAnchor[] = []): PageLabels {
  const sorted = [...parts].filter((p) => Number.isInteger(p.from) && Number.isInteger(p.to) && p.from >= 1 && p.to >= p.from).sort((a, b) => a.from - b.from);
  const adds: Array<number | null> = sorted.map((part) => {
    const text = part.text ? offsetOf(part.text) : null;
    if (text !== null) return text;
    const here = anchors.filter((a) => a.page >= part.from && a.page <= part.to && isPrinted(a.printed)).map((a) => a.printed - a.page);
    const anchor = mode(here);
    if (anchor && anchor.n >= 2) return anchor.add;
    const ai = part.ai ? offsetVotes(part.ai) : null;
    if (ai && (!anchor || anchor.add === ai.add || ai.n >= 3)) return ai.add;
    // 쪽 하나에서 읽은 번호 하나만으로는 조각이 쪽 하나일 때만 (잘못 읽으면 조각의 모든 쪽이 틀린다)
    return anchor && part.from === part.to ? anchor.add : null;
  });
  // 못 고른 조각: 앞뒤가 같은 차이면 그 사이도 같다고 본다 (이어진 책의 일부)
  for (let i = 0; i < adds.length; i++) {
    if (adds[i] !== null) continue;
    const prev = adds
      .slice(0, i)
      .reverse()
      .find((a) => a !== null);
    const next = adds.slice(i + 1).find((a) => a !== null);
    if (prev !== undefined && prev !== null && prev === next) adds[i] = prev;
  }
  const spans: PageLabels = [];
  sorted.forEach((part, i) => {
    const add = adds[i];
    if (add === null || add === undefined) return;
    const last = spans[spans.length - 1];
    if (last && last.add === add && last.to + 1 >= part.from) last.to = Math.max(last.to, part.to);
    else spans.push({ from: part.from, to: part.to, add });
  });
  return spans.some((s) => s.add !== 0) ? spans.slice(0, MAX_SPANS) : [];
}

/**
 * 쪽 하나씩 읽은 번호들만으로 PDF 전체(1~pages)의 구간 하나를 만든다 (이미 만든 노트의 '자료 그림 다시 찾기'):
 * 둘 넘게, 읽은 쪽의 반 넘게 같은 차이여야 한다. 못 고르거나 차이가 0 이면 빈 목록
 */
export function labelsFromAnchors(anchors: PageAnchor[], pages: number): PageLabels {
  const seen = new Map<number, number>();
  for (const a of anchors) if (Number.isInteger(a.page) && a.page >= 1 && a.page <= pages && isPrinted(a.printed)) seen.set(a.page, a.printed);
  const best = mode([...seen].map(([p, n]) => n - p));
  if (!best || best.n < 2 || best.n * 2 <= seen.size || best.add === 0) return [];
  return [{ from: 1, to: Math.max(1, pages), add: best.add }];
}

/** 노트 정리의 쪽 번호 구간 (없거나 이상하면 빈 목록) */
export function readPageLabels(body: unknown): PageLabels {
  const raw = body && typeof body === 'object' ? (body as { page_labels?: unknown }).page_labels : null;
  if (!Array.isArray(raw)) return [];
  const out: PageLabels = [];
  for (const s of raw.slice(0, MAX_SPANS)) {
    if (!s || typeof s !== 'object') continue;
    const { from, to, add } = s as Record<string, unknown>;
    if (![from, to, add].every((v) => typeof v === 'number' && Number.isInteger(v))) continue;
    if ((from as number) < 1 || (to as number) < (from as number) || Math.abs(add as number) > MAX_PRINTED) continue;
    out.push({ from: from as number, to: to as number, add: add as number });
  }
  return out;
}

/** PDF 쪽 p 에 인쇄된 번호 (모르면 null) */
export function printedPage(labels: PageLabels | null | undefined, p: number): number | null {
  if (!labels?.length || !Number.isInteger(p)) return null;
  const s = labels.find((x) => p >= x.from && p <= x.to);
  if (!s) return null;
  const n = p + s.add;
  return isPrinted(n) ? n : null;
}

/**
 * 화면에 보일 쪽 이름: 사진은 '사진 3', PDF 는 인쇄된 번호('114쪽'), 인쇄된 번호를 모르면 PDF 쪽('3쪽').
 * 다른 쪽에는 인쇄된 번호가 있는데 이 쪽만 모르면 헷갈리지 않게 'PDF 3쪽'. printed: 그 쪽에서 직접 읽은 번호 (자료 그림)
 */
export function pageName(kind: string, p: number, labels?: PageLabels | null, printed?: number | null): string {
  if (kind === 'image') return `사진 ${p}`;
  const n = isPrinted(printed) ? printed : printedPage(labels, p);
  if (n) return `${n}쪽`;
  return labels?.length ? `PDF ${p}쪽` : `${p}쪽`;
}
