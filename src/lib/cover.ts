// 자료함 카드의 표지 그림 (Pro): 노트 내용에 맞게 AI 가 문제 그림과 같은 설계도(Figure)로 그리고, 앱이 테마 색으로 그린다.
// 요소마다 색(tone)이 붙고, 저장은 sources.cover (서버만 쓴다). 화면은 components/CoverArt.tsx
import { ART_TONES } from '@/lib/art/spec';
import { FIG_STYLES, FIG_TYPES, normalizeFigure, type Figure } from '@/lib/figure/spec';
import { frameMapper, sampleFunction, textWidth, type Pt } from '@/lib/figure/layout';
import { stripMarks } from '@/lib/richtext';

/** 요소의 색: ink 는 글자 색, 나머지는 다시 그린 그림과 같은 색 이름 (components/art/shared TONE_VAR) */
export const COVER_TONES = ['ink', ...ART_TONES] as const;
export type CoverTone = (typeof COVER_TONES)[number];

export type Cover = {
  v: 1;
  figure: Figure;
  /** 요소 번호 → 색 (없으면 ink) */
  tones: Record<string, CoverTone>;
  /** 화면 읽기용 짧은 설명 */
  alt: string;
};

/** AI 가 그리는 틀: 가로 15 × 세로 10 (카드 위 칸의 비율). 오른쪽 위는 별·⋯ 단추 자리라 비워 두게 한다 */
export const COVER_VIEW = { x_min: 0, x_max: 15, y_min: 0, y_max: 10 } as const;
/** 화면에 그릴 크기 (SVG 좌표). 카드 위 칸(폰에서 약 173×120)에 맞춰 줄어들 때 글자가 11px 쯤 되게 */
export const COVER_FRAME = { w: 210, h: 140, pad: 8 } as const;
export const COVER_LIMITS = { items: 28, labels: 5, label: 14, alt: 80 } as const;
/** 답 길이: 요소 28개 × 약 60토큰 + 여유 */
export const COVER_OUT_TOKENS = 4000;

// ---------------------------------------------------------------- AI 에게 줄 JSON 스키마 (24칸)
type JsonSchema = Record<string, unknown>;
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
function obj(properties: Record<string, unknown>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export const coverJsonSchema: JsonSchema = obj({
  alt: str,
  view: obj({ x_min: num, x_max: num, y_min: num, y_max: num }),
  axes: { type: 'boolean' },
  grid: { type: 'boolean' },
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
      tone: { type: 'string', enum: [...COVER_TONES] },
    }),
  },
});

// ---------------------------------------------------------------- 검사
type Raw = Record<string, unknown>;
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isTone = (v: unknown): v is CoverTone => typeof v === 'string' && (COVER_TONES as readonly string[]).includes(v);

/**
 * 받은 표지(AI 답 또는 저장한 값)가 그릴 만하면 Cover, 아니면 null.
 * 글자가 많으면 표지가 아니라 설명 그림이 되어서, 상자·글이 아닌 요소의 이름은 앞의 COVER_LIMITS.labels 개까지만 남긴다
 */
export function normalizeCover(raw: unknown): Cover | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const rawItems = Array.isArray(r.items) ? (r.items.filter((x) => x && typeof x === 'object') as Raw[]).slice(0, COVER_LIMITS.items) : [];
  let named = 0;
  const items: Raw[] = rawItems.map((it) => {
    const type = String(it.type ?? '');
    let label = text(it.label, COVER_LIMITS.label);
    if (label && type !== 'box' && type !== 'text') {
      if (named >= COVER_LIMITS.labels) label = '';
      else named++;
    }
    return { ...it, label };
  });
  const figure = normalizeFigure({ view: r.view, axes: r.axes === true, grid: r.grid === true, items, include: true });
  if (!figure) return null;
  // 선·도형이 둘은 있어야 그림이다 (점 몇 개나 글만 있는 것은 빼고)
  const drawn = figure.items.filter((i) => i.type !== 'point' && i.type !== 'text');
  if (drawn.length < 2) return null;
  const ids = new Set(figure.items.map((i) => i.id));
  const tones: Record<string, CoverTone> = {};
  // 저장한 값은 tones 칸, AI 답은 요소마다 tone
  const saved = r.tones && typeof r.tones === 'object' ? (r.tones as Raw) : {};
  for (const [id, t] of Object.entries(saved)) if (ids.has(id) && isTone(t) && t !== 'ink') tones[id] = t;
  for (const it of items) {
    const id = text(it.id, 16);
    if (ids.has(id) && !(id in tones) && isTone(it.tone) && it.tone !== 'ink') tones[id] = it.tone;
  }
  return { v: 1, figure, tones, alt: text(r.alt, COVER_LIMITS.alt) };
}

/** DB 에서 읽은 값 (표지가 없거나 예전 모양이면 null) */
export function readCover(v: unknown): Cover | null {
  if (!v || typeof v !== 'object' || (v as Raw).v !== 1) return null;
  return normalizeCover(v);
}

/** 카드의 별·⋯ 단추가 놓이는 곳 (틀의 오른쪽 위, 틀 크기에 대한 비율) */
const CORNER = { x: 0.66, y: 0.3 } as const;

/**
 * 그림이 오른쪽 위 단추 자리까지 닿는지 (닿으면 카드가 단추 뒤에 옅은 바탕을 깐다).
 * 점·선의 끝과 가운데·도형의 꼭짓점·원과 상자의 테두리·그래프를 틀 좌표로 옮겨 본다 (대략)
 */
export function coverCornerBusy(c: Cover): boolean {
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
        // 글 너비는 틀 좌표 → 그림 좌표로 (상자는 w·h 를 정했으면 그 크기)
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
        // 선분·다각형·화살표·호·각: 쓰는 점과 이웃한 두 점의 가운데
        const ref = i.refs.map(at).filter((p): p is Pt => !!p);
        pts.push(...ref);
        for (let k = 1; k < ref.length; k++) pts.push({ x: (ref[k - 1].x + ref[k].x) / 2, y: (ref[k - 1].y + ref[k].y) / 2 });
      }
    }
    if (pts.some(hit)) return true;
  }
  return false;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * 저장할 모양: 0·빈 글·빈 목록·기본 스타일 칸은 빼서 작게 (자료함은 모든 카드의 표지를 한 번에 읽는다).
 * 읽을 때 normalizeFigure 가 빠진 칸을 기본값으로 채운다
 */
export function packCover(c: Cover): Record<string, unknown> {
  const items = c.figure.items.map((i) => {
    const out: Record<string, unknown> = { id: i.id, type: i.type };
    if (i.refs.length) out.refs = i.refs;
    for (const k of ['x', 'y', 'w', 'h', 'r', 'from', 'to'] as const) if (i[k]) out[k] = round(i[k]);
    if (i.expr) out.expr = i.expr;
    if (i.label) out.label = i.label;
    if (i.style !== 'given') out.style = i.style;
    if (i.marks) out.marks = i.marks;
    return out;
  });
  const v = c.figure.view;
  return {
    v: 1,
    alt: c.alt,
    view: { x_min: round(v.x_min), x_max: round(v.x_max), y_min: round(v.y_min), y_max: round(v.y_max) },
    ...(c.figure.axes ? { axes: true } : {}),
    ...(c.figure.grid ? { grid: true } : {}),
    items,
    tones: c.tones,
  };
}

/** AI 에게 보낼 노트 줄임: 과목·제목·요약·개념(이름과 설명 앞부분)·공식·용어 이름 (표지는 핵심만 알면 된다. 꾸미기 기호는 뺀다) */
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
