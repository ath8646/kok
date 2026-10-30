// 자료함 카드의 표지 그림 (Pro). 저장은 sources.cover (서버만 쓴다), 화면은 components/CoverArt.tsx.
//
// v2 (지금): AI 는 '어떤 모양의 표지인지'(연표·흐름·구조·순환·비교·핵심어·공식·그림)와 짧은 글만 고르고,
// 자리·크기·색은 앱이 정해 둔 디자인으로 그린다 (lib/cover-layout.ts). AI 에게 좌표를 맡기면 글이 도형 밖으로 넘치고
// 요소가 겹치고 색이 제멋대로라, 표지마다 모양이 들쭉날쭉했다. 색은 과목 색 하나(+ 비교는 짝 색)라 같은 과목 카드끼리 어울린다.
// 수학·과학의 그래프·도형만 문제 그림과 같은 설계도(figure)를 받아 앱이 빈자리에 맞춰 그린다.
//
// v1 (예전): AI 가 문제 그림 설계도에 좌표·색을 직접 적은 것. 이미 그린 표지는 그대로 읽어 그린다.
import { ART_TONES } from '@/lib/art/spec';
import { FIG_STYLES, FIG_TYPES, normalizeFigure, type FigItem, type Figure } from '@/lib/figure/spec';
import { frameMapper, sampleFunction, textWidth, type Pt } from '@/lib/figure/layout';
import { stripMarks } from '@/lib/richtext';

// ================================================================ v2: 정해 둔 디자인
/**
 * 표지의 모양.
 * timeline 연표(때와 사건) · flow 흐름(과정·원인과 결과) · tree 구조(전체와 부분·분류) · cycle 순환 · compare 둘 비교 ·
 * hub 핵심어(가운데 개념과 둘레의 낱말) · formula 공식 · figure 그래프·도형
 */
export const COVER_KINDS = ['timeline', 'flow', 'tree', 'cycle', 'compare', 'hub', 'formula', 'figure'] as const;
export type CoverKind = (typeof COVER_KINDS)[number];
export const COVER_SIDES = ['', 'left', 'right'] as const;
export type CoverSide = (typeof COVER_SIDES)[number];

/** 글 하나: text 큰 글(사건·단계·부분·낱말·기호), sub 작은 글(때·덧말·뜻), key 가장 중요한 것, side 비교의 왼쪽·오른쪽 */
export type CoverItem = { text: string; sub: string; key: boolean; side: CoverSide };

export type CoverV2 = {
  v: 2;
  kind: CoverKind;
  /** 구조의 전체·핵심어의 가운데·순환의 이름·공식(LaTeX) */
  title: string;
  /** 비교하는 두 이름 */
  left: string;
  right: string;
  items: CoverItem[];
  /** kind figure 의 그래프·도형 */
  figure: Figure | null;
  /** 화면 읽기용 짧은 설명 */
  alt: string;
};

/** 모양마다 글 수 [적어도, 많아야]: 적으면 표지를 만들지 않고, 많으면 앞에서부터 */
export const COVER_ITEMS: Record<CoverKind, readonly [number, number]> = {
  timeline: [2, 5],
  flow: [2, 4],
  tree: [2, 4],
  cycle: [3, 5],
  compare: [2, 6],
  hub: [2, 5],
  formula: [0, 3],
  figure: [0, 0],
};
/** 글 길이 끝 (지시는 더 짧게 쓰라고 한다: 넘친 글은 화면이 줄이거나 … 로 자른다) */
export const COVER_TEXT = { text: 14, sub: 12, title: 16, formula: 60, alt: 80, figureLabels: 4 } as const;

// ================================================================ v1: 예전 표지 (읽기만)
/** 요소의 색: ink 는 글자 색, 나머지는 다시 그린 그림과 같은 색 이름 (components/art/shared TONE_VAR) */
export const COVER_TONES = ['ink', ...ART_TONES] as const;
export type CoverTone = (typeof COVER_TONES)[number];

export type CoverV1 = {
  v: 1;
  figure: Figure;
  /** 요소 번호 → 색 (없으면 ink) */
  tones: Record<string, CoverTone>;
  alt: string;
};

export type Cover = CoverV1 | CoverV2;

/** v1 을 그리는 SVG 좌표 크기 (v1 의 그림 틀은 가로 15 × 세로 10) */
export const COVER_FRAME = { w: 210, h: 140, pad: 8 } as const;
/** 답 길이 끝: figure 가 가장 길다 (요소 16개 × 약 60토큰 + 여유). 다른 모양은 300토큰 안팎 */
export const COVER_OUT_TOKENS = 3000;
/** 예상 에너지에 쓰는 보통 답 길이 (그래프가 아닌 표지 + 그래프 표지를 섞어 넉넉히. ai/models.ts 의 estimateCover 와 같게) */
export const COVER_OUT_TYPICAL = 900;

// ---------------------------------------------------------------- AI 에게 줄 JSON 스키마 (32칸)
type JsonSchema = Record<string, unknown>;
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
function obj(properties: Record<string, unknown>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/** kind 를 맨 앞에: AI 는 칸 차례대로 쓰니, 모양을 먼저 정하고 그 모양에 맞는 글을 쓴다. alt 는 맨 끝 (다 정한 뒤 설명) */
export const coverJsonSchema: JsonSchema = obj({
  kind: { type: 'string', enum: [...COVER_KINDS] },
  title: str,
  left: str,
  right: str,
  items: {
    type: 'array',
    items: obj({ text: str, sub: str, key: { type: 'boolean' }, side: { type: 'string', enum: [...COVER_SIDES] } }),
  },
  figure: obj({
    view: obj({ x_min: num, x_max: num, y_min: num, y_max: num }),
    axes: { type: 'boolean' },
    items: {
      type: 'array',
      items: obj({
        id: str,
        type: { type: 'string', enum: [...FIG_TYPES] },
        refs: { type: 'array', items: str },
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
        marks: { type: 'integer' },
      }),
    },
  }),
  alt: str,
});

// ---------------------------------------------------------------- 검사
type Raw = Record<string, unknown>;
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** 표지 글: 끝의 문장 부호·번호 매김을 걷는다 ("1. 빛 흡수." → "빛 흡수") */
const word = (v: unknown, max: number): string =>
  text(v, max * 2)
    .replace(/^(\d+[.)]|[①-⑳]|[-•·]\s)\s*/, '')
    .replace(/[\s.,;:!?。…]+$/u, '')
    .slice(0, max)
    .trim();
const isTone = (v: unknown): v is CoverTone => typeof v === 'string' && (COVER_TONES as readonly string[]).includes(v);

/**
 * 그래프·도형 (v1 표지와 v2 의 figure): 이름이 많으면 설명 그림이 되어서 상자·글이 아닌 요소의 이름은 앞의 몇 개만.
 * 선·도형이 minDrawn 개는 있어야 그림이다 (점 몇 개나 글만 있는 것은 빼고. 좌표축이 있으면 그래프 하나도 그림)
 */
function coverFigure(raw: unknown, maxItems: number, maxLabels: number, minDrawn = 2): Figure | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const rawItems = Array.isArray(r.items) ? (r.items.filter((x) => x && typeof x === 'object') as Raw[]).slice(0, maxItems) : [];
  let named = 0;
  const items: Raw[] = rawItems.map((it) => {
    const type = String(it.type ?? '');
    let label = text(it.label, 14);
    if (label && type !== 'box' && type !== 'text') {
      if (named >= maxLabels) label = '';
      else named++;
    }
    return { ...it, label };
  });
  const figure = normalizeFigure({ view: r.view, axes: r.axes === true, grid: r.grid === true, items, include: true });
  if (!figure) return null;
  const drawn = figure.items.filter((i) => i.type !== 'point' && i.type !== 'text');
  return drawn.length >= (figure.axes ? 1 : minDrawn) ? figure : null;
}

/**
 * AI 답(v2)이 그릴 만하면 CoverV2, 아니면 null (카드에는 예전처럼 한 줄 요약).
 * 모양마다 글 수·꼭 있어야 할 글(구조의 전체, 비교의 두 이름, 공식)을 보고, 가장 중요한 것(key)은 하나만 남긴다
 */
export function normalizeCover(raw: unknown): CoverV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const kind = r.kind as CoverKind;
  if (!COVER_KINDS.includes(kind)) return null;
  const alt = text(r.alt, COVER_TEXT.alt);
  if (kind === 'figure') {
    const figure = coverFigure(r.figure, 24, COVER_TEXT.figureLabels);
    return figure ? { v: 2, kind, title: '', left: '', right: '', items: [], figure, alt } : null;
  }
  const title = kind === 'formula' ? text(r.title, COVER_TEXT.formula) : word(r.title, COVER_TEXT.title);
  const left = kind === 'compare' ? word(r.left, COVER_TEXT.title) : '';
  const right = kind === 'compare' ? word(r.right, COVER_TEXT.title) : '';
  const [min, max] = COVER_ITEMS[kind];
  const seen = new Set<string>();
  const items: CoverItem[] = [];
  const perSide = { left: 0, right: 0 };
  let keyed = false;
  for (const it of Array.isArray(r.items) ? (r.items as unknown[]) : []) {
    if (!it || typeof it !== 'object') continue;
    const x = it as Raw;
    const t = kind === 'formula' ? text(x.text, COVER_TEXT.text) : word(x.text, COVER_TEXT.text);
    if (!t) continue;
    const side: CoverSide = kind === 'compare' ? (x.side === 'left' || x.side === 'right' ? x.side : '') : '';
    if (kind === 'compare') {
      if (!side || perSide[side] >= 3) continue;
      perSide[side]++;
    }
    const dup = `${side}|${t}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    // 가장 중요한 것은 하나만 (비교·공식은 없다)
    const key = x.key === true && !keyed && kind !== 'compare' && kind !== 'formula';
    if (key) keyed = true;
    items.push({ text: t, sub: word(x.sub, COVER_TEXT.sub), key, side });
    if (items.length >= max) break;
  }
  if (items.length < min) return null;
  if ((kind === 'tree' || kind === 'hub' || kind === 'formula') && !title) return null;
  if (kind === 'compare' && (!left || !right || !perSide.left || !perSide.right)) return null;
  return { v: 2, kind, title, left, right, items, figure: null, alt };
}

/** v1 표지 (저장해 둔 예전 표지를 읽을 때만) */
function normalizeCoverV1(r: Raw): CoverV1 | null {
  const figure = coverFigure(r, 28, 5);
  if (!figure) return null;
  const ids = new Set(figure.items.map((i) => i.id));
  const tones: Record<string, CoverTone> = {};
  const saved = r.tones && typeof r.tones === 'object' ? (r.tones as Raw) : {};
  for (const [id, t] of Object.entries(saved)) if (ids.has(id) && isTone(t) && t !== 'ink') tones[id] = t;
  return { v: 1, figure, tones, alt: text(r.alt, COVER_TEXT.alt) };
}

/** DB 에서 읽은 값 (표지가 없거나 읽을 수 없으면 null) */
export function readCover(v: unknown): Cover | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Raw;
  if (r.v === 2) return normalizeCover(r);
  if (r.v === 1) return normalizeCoverV1(r);
  return null;
}

// ---------------------------------------------------------------- 저장 모양 (작게: 자료함은 모든 카드의 표지를 한 번에 읽는다)
const round = (n: number) => Math.round(n * 100) / 100;

/** 그림 요소: 0·빈 글·빈 목록·기본 스타일 칸은 뺀다 (읽을 때 normalizeFigure 가 기본값으로 채운다) */
function packItems(items: FigItem[]): Record<string, unknown>[] {
  return items.map((i) => {
    const out: Record<string, unknown> = { id: i.id, type: i.type };
    if (i.refs.length) out.refs = i.refs;
    for (const k of ['x', 'y', 'w', 'h', 'r', 'from', 'to'] as const) if (i[k]) out[k] = round(i[k]);
    if (i.expr) out.expr = i.expr;
    if (i.label) out.label = i.label;
    if (i.style !== 'given') out.style = i.style;
    if (i.marks) out.marks = i.marks;
    return out;
  });
}

export function packCover(c: CoverV2): Record<string, unknown> {
  const out: Record<string, unknown> = { v: 2, kind: c.kind };
  if (c.title) out.title = c.title;
  if (c.left) out.left = c.left;
  if (c.right) out.right = c.right;
  if (c.items.length)
    out.items = c.items.map((i) => ({ text: i.text, ...(i.sub ? { sub: i.sub } : {}), ...(i.key ? { key: true } : {}), ...(i.side ? { side: i.side } : {}) }));
  if (c.figure) {
    const v = c.figure.view;
    out.figure = {
      view: { x_min: round(v.x_min), x_max: round(v.x_max), y_min: round(v.y_min), y_max: round(v.y_max) },
      ...(c.figure.axes ? { axes: true } : {}),
      items: packItems(c.figure.items),
    };
  }
  out.alt = c.alt;
  return out;
}

// ---------------------------------------------------------------- 카드의 별·⋯ 단추 자리
/** v1: 카드의 별·⋯ 단추가 놓이는 곳 (틀의 오른쪽 위, 틀 크기에 대한 비율) */
const CORNER = { x: 0.66, y: 0.3 } as const;

/**
 * 그림이 오른쪽 위 단추 자리까지 닿는지 (닿으면 카드가 단추 뒤에 옅은 바탕을 깐다).
 * v2 는 늘 그 자리를 비워 두고 그린다 (cover-layout). v1 은 점·선·도형을 틀 좌표로 옮겨 본다 (대략)
 */
export function coverCornerBusy(c: Cover): boolean {
  if (c.v === 2) return false;
  const f = c.figure;
  const m = frameMapper(f, COVER_FRAME);
  const cx = COVER_FRAME.w * CORNER.x;
  const cy = COVER_FRAME.h * CORNER.y;
  const hit = (p: Pt) => m.px(p.x) >= cx && m.py(p.y) <= cy;
  const byId = new Map(f.items.map((i) => [i.id, i]));
  const at = (id: string): Pt | null => {
    const i = byId.get(id);
    return i ? { x: i.x, y: i.y } : null;
  };
  for (const i of f.items) {
    const hidden = i.type === 'point' && i.style === 'muted' && !i.label;
    if (hidden) continue;
    const pts: Pt[] = [];
    switch (i.type) {
      case 'point':
        pts.push({ x: i.x, y: i.y });
        break;
      case 'text':
      case 'box': {
        const hw = i.type === 'box' && i.w > 0 ? i.w / 2 : (textWidth(i.label, 13) / 2 + 8) / m.sx;
        const hh = i.type === 'box' && i.h > 0 ? i.h / 2 : 14 / m.sy;
        pts.push({ x: i.x + hw, y: i.y + hh }, { x: i.x - hw, y: i.y + hh }, { x: i.x + hw, y: i.y - hh });
        break;
      }
      case 'circle': {
        const c0 = at(i.refs[0]);
        if (!c0) break;
        const thru = i.refs[1] ? at(i.refs[1]) : null;
        const r = thru ? Math.hypot(thru.x - c0.x, thru.y - c0.y) : i.r;
        for (let k = 0; k < 16; k++) pts.push({ x: c0.x + Math.cos((k / 16) * Math.PI * 2) * r, y: c0.y + Math.sin((k / 16) * Math.PI * 2) * r });
        break;
      }
      case 'function':
        for (const line of sampleFunction(i.expr, i.from, i.to, f.view, 48)) pts.push(...line);
        break;
      default: {
        const ref = i.refs.map(at).filter((p): p is Pt => !!p);
        pts.push(...ref);
        for (let k = 1; k < ref.length; k++) pts.push({ x: (ref[k - 1].x + ref[k].x) / 2, y: (ref[k - 1].y + ref[k].y) / 2 });
      }
    }
    if (pts.some(hit)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- AI 에게 보낼 노트 줄임
/** 과목·제목·요약·개념(이름과 설명 앞부분)·공식·용어 이름 (표지는 핵심만 알면 된다. 꾸미기 기호는 뺀다) */
export function coverNoteExcerpt(
  note: { title?: unknown; summary?: unknown; key_points?: unknown; formulas?: unknown; terms?: unknown },
  subject = '',
): string {
  const plain = (v: unknown, max: number) => text(typeof v === 'string' ? stripMarks(v) : '', max);
  const lines: string[] = [];
  if (subject) lines.push(`subject: ${plain(subject, 40)}`);
  const t = plain(note.title, 120);
  if (t) lines.push(`title: ${t}`);
  const s = plain(note.summary, 400);
  if (s) lines.push(`summary: ${s}`);
  const kps = Array.isArray(note.key_points) ? (note.key_points as Raw[]).slice(0, 12) : [];
  for (const kp of kps) {
    const title = plain(kp?.title, 80);
    if (!title) continue;
    const ex = plain(kp?.explanation, 140);
    lines.push(`- ${title}${ex ? `: ${ex}` : ''}`);
  }
  const formulas = Array.isArray(note.formulas) ? (note.formulas as Raw[]).slice(0, 6) : [];
  for (const f of formulas) {
    const line = [plain(f?.label, 40), text(f?.latex, 100)].filter(Boolean).join(' ');
    if (line) lines.push(`formula: ${line}`);
  }
  const terms = Array.isArray(note.terms) ? (note.terms as Raw[]).map((x) => plain(x?.term, 30)).filter(Boolean) : [];
  if (terms.length) lines.push(`terms: ${terms.slice(0, 12).join(', ')}`);
  return lines.join('\n').slice(0, 4000);
}
