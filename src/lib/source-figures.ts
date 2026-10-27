// 자료 그림: PDF·사진 속 중요한 그림(지도·그래프·표·연표·도식·사진·작품 …).
// 정리할 때 AI 가 그림과 네 모서리를 찾고(readFoundFigures), 서버가 원본에서 잘라 저장한다(모두).
// Pro 는 지도·그래프·표·연표·도식을 KOK 스타일로 다시 그린다(art). 사진·작품·사료·삽화는 원본만 쓴다
// (다시 그리면 모양이 틀어져 틀린 것을 외우게 될 수 있어서).
// 노트 정리(body.figures)에 두고 개념 카드에 보여 주며, 그림 문제는 그림을 그대로 남긴다(questions.source_figure).
import { z } from 'zod';
import { ART_KINDS, readArt, type Art, type ArtKind } from '@/lib/art/spec';

export const FIG_KINDS = ['map', 'chart', 'table', 'timeline', 'diagram', 'photo', 'artwork', 'document', 'cartoon', 'other'] as const;
export type FigKind = (typeof FIG_KINDS)[number];

export const FIG_KIND_LABEL: Record<FigKind, string> = {
  map: '지도',
  chart: '그래프',
  table: '표',
  timeline: '연표',
  diagram: '도식',
  photo: '사진',
  artwork: '작품',
  document: '사료',
  cartoon: '삽화',
  other: '그림',
};

/** KOK 스타일로 다시 그리는 그림인지 (지도·그래프·표·연표·도식) */
export function canRedraw(kind: FigKind): kind is ArtKind {
  return (ART_KINDS as readonly string[]).includes(kind);
}

/** 자료 하나에서 쓰는 그림 수, AI 한 번(한 조각)에서 찾는 그림 수, 노트 하나(자료를 더해도)에 두는 그림 수 */
export const MAX_FIGURES = 6;
export const MAX_FIGURES_PER_PART = 4;
export const MAX_NOTE_FIGURES = 40;

/** 그림의 네 모서리 (0~1000, 왼쪽 위·오른쪽 위·오른쪽 아래·왼쪽 아래 순서로 x, y) */
export type Corners = [number, number, number, number, number, number, number, number];

export type SourceFigure = {
  /** 노트 안의 번호 ('f1', 'f2' …) */
  id: string;
  kind: FigKind;
  /** 짧은 이름 (자료에 적힌 대로) */
  title: string;
  /** 그림이 보여 주는 것 (글자·이름·숫자·방향): 개념 카드에 보여 주고, 문제를 만들고 검사할 때 쓴다 */
  caption: string;
  /** 시험에서 이 그림으로 물을 만한 것 (문제를 만들 때만 쓴다) */
  asks: string;
  /** 붙은 개념 ('' 이면 개념 없이 '자료 그림'에) */
  key_point_id: string;
  /** 원본 쪽 번호 (사진이면 사진 번호), 모르면 0 */
  page: number;
  /** 그 쪽에 인쇄된 쪽 번호 (책의 쪽, 모르면 없음: 화면에는 이 번호로 보인다, page-labels.ts) */
  printed?: number;
  /** 원본에서 자른 그림 (저장소 경로, `내id/figs/자료id/f1.jpg`) */
  crop: string;
  /** 자른 그림 크기 (자리를 먼저 잡아 두려고) */
  w: number;
  h: number;
  /** KOK 스타일로 다시 그린 그림 (Pro, 지도·그래프·표·연표·도식만) */
  art: Art | null;
};

/** 문제에 남기는 그림 (노트에서 그림을 빼거나 바꿔도 문제는 그대로) */
export type QuestionFigure = Omit<SourceFigure, 'asks' | 'key_point_id'>;

const LIMITS = { title: 60, caption: 400, asks: 300 } as const;

const clean = (s: unknown, n: number) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n);

const zFigKind = z
  .string()
  .transform((v) => v.toLowerCase().trim())
  .pipe(z.enum(FIG_KINDS))
  .catch('other');

const zStored = z.object({
  id: z.string().regex(/^f\d{1,4}$/),
  kind: zFigKind,
  title: z.unknown().optional(),
  caption: z.unknown().optional(),
  asks: z.unknown().optional(),
  key_point_id: z.unknown().optional(),
  page: z.number().int().min(0).max(100000).catch(0),
  printed: z.number().int().min(1).max(99999).optional().catch(undefined),
  // 저장소 경로: 내id/figs/자료id/파일 (다른 곳을 가리키지 않게)
  crop: z.string().regex(/^[0-9a-f-]{36}\/figs\/[0-9a-f-]{36}\/f\d{1,4}\.jpg$/),
  w: z.number().int().min(1).max(10000).catch(800),
  h: z.number().int().min(1).max(10000).catch(600),
  art: z.unknown().optional(),
});

function readOne(raw: unknown): SourceFigure | null {
  const r = zStored.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  return {
    id: d.id,
    kind: d.kind,
    title: clean(d.title, LIMITS.title),
    caption: clean(d.caption, LIMITS.caption),
    asks: clean(d.asks, LIMITS.asks),
    key_point_id: clean(d.key_point_id, 40),
    page: d.page,
    ...(d.printed ? { printed: d.printed } : {}),
    crop: d.crop,
    w: d.w,
    h: d.h,
    art: d.art && canRedraw(d.kind) ? sameKind(readArt(d.art), d.kind) : null,
  };
}

/** 다시 그린 그림은 그 그림과 같은 종류일 때만 (지도 자리에 표가 오지 않게) */
function sameKind(art: Art | null, kind: FigKind): Art | null {
  return art && art.kind === kind ? art : null;
}

/** 노트 정리(body)의 자료 그림. 모양이 이상한 것은 빼고 읽는다 (예전 노트는 빈 목록) */
export function readFigures(body: unknown): SourceFigure[] {
  const list = body && typeof body === 'object' ? (body as { figures?: unknown }).figures : null;
  if (!Array.isArray(list)) return [];
  const out: SourceFigure[] = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, MAX_NOTE_FIGURES)) {
    const f = readOne(raw);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

/** 문제에 남긴 그림 (없거나 모양이 이상하면 null) */
export function readQuestionFigure(raw: unknown): QuestionFigure | null {
  const f = readOne(raw);
  if (!f) return null;
  const { asks: _a, key_point_id: _k, ...rest } = f;
  void _a;
  void _k;
  return rest;
}

/** 그림 문제에 남길 그림 */
export function questionFigure(f: SourceFigure): QuestionFigure {
  const { asks: _a, key_point_id: _k, ...rest } = f;
  void _a;
  void _k;
  return rest;
}

// ---------------------------------------------------------------- AI 가 찾은 그림
/**
 * 정리할 때 AI 가 찾은 그림 (아직 자리를 찾고 자르기 전). 자리는 쪽을 그림으로 그려 한 장씩 보여 주고 받는다 (figure-locate.ts).
 * printed: AI 가 그 쪽에서 읽은 인쇄된 쪽 번호, hints: 그 번호로 짐작한 PDF 쪽 (AI 가 쪽을 잘못 셌을 때 먼저 볼 쪽),
 * tried: 이미 보여 줬는데 없던 쪽, calls: 찾느라 물어본 수. corners: 예전 정리(0~1000 꼭짓점, 이제 쓰지 않는다)
 */
export type FoundFigure = {
  page: number;
  kind: FigKind;
  title: string;
  caption: string;
  asks: string;
  /** 붙일 개념의 이름 (조각마다 개념 번호가 달라서 이름으로 찾는다) */
  kpTitle: string;
  printed?: number;
  hints?: number[];
  tried?: number[];
  calls?: number;
  corners?: Corners;
};

const zFound = z.object({
  page: z.number().catch(0),
  printed_page: z.number().catch(0),
  kind: zFigKind,
  title: z.unknown().optional(),
  caption: z.unknown().optional(),
  asks: z.unknown().optional(),
  key_point_title: z.unknown().optional(),
});

/**
 * AI 가 찾은 그림을 읽는다: 이 조각의 쪽(사진) 범위 안(벗어나면 가장 가까운 쪽: 그 둘레를 찾아본다), 이름이나 설명이 있는 것,
 * 같은 쪽의 같은 이름은 하나로, max 개까지. range: 이 조각의 원래 쪽(사진) 번호 범위
 */
export function readFoundFigures(raw: unknown, range: { from: number; to: number }, max: number): FoundFigure[] {
  if (!Array.isArray(raw) || max <= 0) return [];
  const out: FoundFigure[] = [];
  for (const item of raw.slice(0, 20)) {
    const r = zFound.safeParse(item);
    if (!r.success) continue;
    const page = Number.isFinite(r.data.page) ? Math.min(range.to, Math.max(range.from, Math.round(r.data.page))) : range.from;
    const title = clean(r.data.title, LIMITS.title);
    const caption = clean(r.data.caption, LIMITS.caption);
    if (!caption && !title) continue;
    if (out.some((f) => f.page === page && f.title === (title || FIG_KIND_LABEL[r.data.kind]) && f.caption === caption)) continue;
    const printed = Math.round(r.data.printed_page);
    out.push({
      page,
      kind: r.data.kind,
      title: title || FIG_KIND_LABEL[r.data.kind],
      caption,
      asks: clean(r.data.asks, LIMITS.asks),
      kpTitle: clean(r.data.key_point_title, 120),
      ...(printed > 0 && printed < 100000 ? { printed } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------- 개념에 붙이기
/** 비교용: 꾸미기 기호·띄어쓰기·문장 부호를 빼고 소문자로 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*\*|==|!!|\$/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

/**
 * 개념 이름으로 개념 번호를 찾는다: 같은 이름 → 한쪽이 다른 쪽을 품음 → 글자 쌍이 많이 겹침 (다이스 계수 0.6 넘게:
 * '백제 전성기' ↔ '백제의 전성기'는 붙고, '고구려의 전성기' ↔ '백제의 전성기'는 붙지 않는다). 없으면 ''
 */
export function matchKeyPoint(title: string, kps: ReadonlyArray<{ id: string; title: string }>): string {
  const t = norm(title);
  if (!t) return '';
  const named = kps.map((k) => ({ id: k.id, n: norm(k.title) })).filter((k) => k.n);
  const exact = named.find((k) => k.n === t);
  if (exact) return exact.id;
  const inside = named.filter((k) => Math.min(k.n.length, t.length) >= 2 && (k.n.includes(t) || t.includes(k.n)));
  if (inside.length === 1) return inside[0].id;
  const tb = bigrams(t);
  let best = '';
  let bestScore = 0.6;
  for (const k of inside.length ? inside : named) {
    const kb = bigrams(k.n);
    let both = 0;
    for (const g of tb) if (kb.has(g)) both++;
    const score = (2 * both) / (tb.size + kb.size);
    if (score > bestScore) {
      bestScore = score;
      best = k.id;
    }
  }
  return best;
}

/** 자른 그림(찾은 그림 + 저장 위치) → 노트에 둘 그림. 개념은 이름으로 붙인다 */
export type CutFigure = FoundFigure & { crop: string; w: number; h: number; art?: Art | null };

export function toSourceFigures(cuts: CutFigure[], kps: ReadonlyArray<{ id: string; title: string }>, firstNumber = 1): SourceFigure[] {
  return cuts.slice(0, MAX_FIGURES).map((c, i) => ({
    id: `f${firstNumber + i}`,
    kind: c.kind,
    title: c.title,
    caption: c.caption,
    asks: c.asks,
    key_point_id: matchKeyPoint(c.kpTitle, kps),
    page: c.page,
    ...(c.printed ? { printed: c.printed } : {}),
    crop: c.crop,
    w: c.w,
    h: c.h,
    art: c.art ?? null,
  }));
}

/** 개념이 없어진 그림은 '자료 그림'으로 (개념을 지웠거나 합치면서 바뀌었을 때) */
export function figuresByKeyPoint(figs: SourceFigure[], kpIds: ReadonlySet<string>): { byKp: Map<string, SourceFigure[]>; loose: SourceFigure[] } {
  const byKp = new Map<string, SourceFigure[]>();
  const loose: SourceFigure[] = [];
  for (const f of figs) {
    if (f.key_point_id && kpIds.has(f.key_point_id)) byKp.set(f.key_point_id, [...(byKp.get(f.key_point_id) ?? []), f]);
    else loose.push(f);
  }
  return { byKp, loose };
}

/** AI 에 보낼 자료 그림 (그림 대신 설명: 문제를 만들고 검사할 때) */
export function figuresForPrompt(figures: SourceFigure[]) {
  return figures.map((f) => ({ id: f.id, kind: f.kind, title: f.title, caption: f.caption, asks: f.asks, key_point_id: f.key_point_id }));
}

/** 원본에서 자른 그림을 두는 폴더 (자료 폴더 밖: 무료 원본 파일을 지울 때 같이 지워지지 않게) */
export function figureFolder(userId: string, sourceId: string): string {
  return `${userId}/figs/${sourceId}`;
}

export function figurePath(userId: string, sourceId: string, n: number): string {
  return `${figureFolder(userId, sourceId)}/f${n}.jpg`;
}
