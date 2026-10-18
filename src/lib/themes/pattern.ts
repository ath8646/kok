// 배경 무늬 (SVG 반복 무늬)
// - AI 가 그린 무늬는 받은 글을 그대로 쓰지 않고, 허락한 요소·속성·값만 골라 새로 적는다 (스크립트·링크·글자·외부 그림은 모두 빠진다)
// - AI 를 못 쓸 때는 코드로 만든 무늬를 쓴다

const TAGS = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const NUM_ATTRS = new Set([
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'stroke-width',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
]);
const COLOR_ATTRS = new Set(['fill', 'stroke']);
const ENUM_ATTRS: Record<string, Set<string>> = {
  'stroke-linecap': new Set(['butt', 'round', 'square']),
  'stroke-linejoin': new Set(['miter', 'round', 'bevel']),
};

const NUM = /^-?\d{1,5}(\.\d{1,4})?%?$/;
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.\-eE]{1,4000}$/;
const POINTS = /^[0-9 ,.\-]{1,2000}$/;
const TRANSFORM = /^((translate|scale|rotate)\(\s*-?\d{1,5}(\.\d{1,4})?(\s*[, ]\s*-?\d{1,5}(\.\d{1,4})?){0,2}\s*\)\s*){1,3}$/;

export const PATTERN_SIZE = 240;
export const PATTERN_MAX_CHARS = 8000;

/** 속성 값 검사: 쓸 수 있으면 깨끗한 값, 모르는 속성이면 undefined(버림), 값이 틀리면 null */
function cleanValue(name: string, raw: string): string | null | undefined {
  const v = raw.trim().toLowerCase();
  if (NUM_ATTRS.has(name)) return NUM.test(v) ? v : null;
  if (COLOR_ATTRS.has(name)) return v === 'none' || HEX_COLOR.test(v) ? v : null;
  if (ENUM_ATTRS[name]) return ENUM_ATTRS[name].has(v) ? v : null;
  if (name === 'd') return PATH_D.test(raw.trim()) ? raw.trim().replace(/\s+/g, ' ') : null;
  if (name === 'points') return POINTS.test(v) ? v.replace(/\s+/g, ' ') : null;
  if (name === 'transform') return TRANSFORM.test(v) ? v.replace(/\s+/g, ' ') : null;
  return undefined;
}

/**
 * SVG 글 → 안전하게 다시 만든 SVG (240×240). 쓸 만한 모양이 없거나 너무 크면 null.
 * 여는·닫는 태그만 읽고, 그 사이 글자(텍스트·CDATA·주석)는 버린다.
 * 허락하지 않은 요소(그 안의 것까지)와, 색·모양 값이 틀린 요소는 빼고 나머지만 쓴다.
 */
export function sanitizePatternSvg(input: string): string | null {
  if (typeof input !== 'string' || input.length > 20_000) return null;
  // 주석·CDATA 는 통째로 버린다 (안에 든 태그 모양을 읽지 않게)
  const src = input.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const out: string[] = [];
  const stack: string[] = [];
  let skip = 0; // 버리는 요소 안에 있는 깊이
  let shapes = 0;
  let sawSvg = false;
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClose = m[4] === '/';
    if (skip) {
      if (selfClose) continue;
      if (closing) skip--;
      else skip++;
      continue;
    }
    if (closing) {
      if (stack[stack.length - 1] !== tag) return null;
      stack.pop();
      out.push(`</${tag}>`);
      continue;
    }
    if (tag === 'svg') {
      if (sawSvg || stack.length || selfClose) return null;
      sawSvg = true;
      out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PATTERN_SIZE}" height="${PATTERN_SIZE}" viewBox="0 0 ${PATTERN_SIZE} ${PATTERN_SIZE}">`);
      stack.push('svg');
      continue;
    }
    if (!stack.length) return null;
    if (!TAGS.has(tag)) {
      if (!selfClose) skip = 1;
      continue;
    }
    const attrs: string[] = [];
    let bad = false;
    const attrRe = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    for (let a = attrRe.exec(m[3]); a; a = attrRe.exec(m[3])) {
      const name = a[1].toLowerCase();
      const value = cleanValue(name, a[3] ?? a[4] ?? '');
      if (value === undefined) continue;
      if (value === null) {
        // 색·모양이 틀리면 엉뚱하게(검게) 그려지니 그 요소를 뺀다
        bad = true;
        break;
      }
      attrs.push(`${name}="${value}"`);
    }
    if (bad) {
      if (!selfClose) skip = 1;
      continue;
    }
    if (tag !== 'g') shapes++;
    out.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClose ? '/>' : '>'}`);
    if (!selfClose) stack.push(tag);
  }
  if (skip || stack.length || !sawSvg || !shapes) return null;
  const svg = out.join('');
  return svg.length <= PATTERN_MAX_CHARS ? svg : null;
}

/** 무늬에서 칠해질 수 있는 색과 그 진하기 (0~1) */
export type Ink = { color: string; alpha: number };

function opacityOf(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

function hex6(v: string): string {
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

/**
 * 깨끗하게 다시 만든 무늬 SVG 에서 칠해지는 색을 모두 찾는다 (글자가 그 위에서도 잘 보이게 색을 맞출 때 쓴다).
 * fill 이 없으면 SVG 기본값인 검정으로 칠해지고, fill·stroke·fill-opacity·stroke-opacity 는 g 에서 물려받으며, opacity 는 곱해진다.
 * 같은 색이면 가장 진한 것만 남긴다.
 */
export function patternInks(svg: string): Ink[] {
  type Ctx = { fill: string; stroke: string; fillOpacity: number; strokeOpacity: number; opacity: number };
  const stack: Ctx[] = [{ fill: '#000000', stroke: 'none', fillOpacity: 1, strokeOpacity: 1, opacity: 1 }];
  const inks = new Map<string, number>();
  const add = (color: string, alpha: number) => {
    if (color === 'none' || alpha <= 0) return;
    const c = hex6(color);
    inks.set(c, Math.max(inks.get(c) ?? 0, alpha));
  };
  for (const m of svg.matchAll(/<(\/?)([a-z]+)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, rawAttrs, self] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = new Map([...rawAttrs.matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]] as const));
    const parent = stack[stack.length - 1];
    const ctx: Ctx = {
      fill: attrs.get('fill') ?? parent.fill,
      stroke: attrs.get('stroke') ?? parent.stroke,
      fillOpacity: opacityOf(attrs.get('fill-opacity'), parent.fillOpacity),
      strokeOpacity: opacityOf(attrs.get('stroke-opacity'), parent.strokeOpacity),
      opacity: parent.opacity * opacityOf(attrs.get('opacity'), 1),
    };
    if (tag !== 'svg' && tag !== 'g') {
      // 선(line)은 안을 칠하지 않는다
      if (tag !== 'line') add(ctx.fill, ctx.opacity * ctx.fillOpacity);
      const sw = attrs.get('stroke-width');
      if (sw === undefined || parseFloat(sw) > 0) add(ctx.stroke, ctx.opacity * ctx.strokeOpacity);
    }
    if (!self) stack.push(ctx);
  }
  return [...inks].map(([color, alpha]) => ({ color, alpha }));
}

/** CSS background-image 에 넣을 주소 */
export function svgDataUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ------------------------------------------------------------ 코드로 만든 무늬
export const CODE_PATTERNS = ['dots', 'grid', 'waves', 'diagonal', 'confetti', 'petals'] as const;
export type CodePattern = (typeof CODE_PATTERNS)[number];

/** 작은 난수 (같은 seed 면 같은 무늬) */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** 포인트 색 두 가지로 은은한 반복 무늬를 만든다 (240×240, 이어 붙여도 이음새가 없다) */
export function codePatternSvg(kind: CodePattern, a: string, b: string, seed = 1): string {
  const S = PATTERN_SIZE;
  const rand = rng(seed);
  const shapes: string[] = [];
  switch (kind) {
    case 'dots':
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const cx = x * 60 + (y % 2 ? 30 : 0) + 15;
          shapes.push(`<circle cx="${cx % S}" cy="${y * 60 + 15}" r="${(y + x) % 3 ? 3 : 4.5}" fill="${(x + y) % 2 ? a : b}" opacity="0.35"/>`);
        }
      break;
    case 'grid':
      for (let i = 0; i <= 4; i++) {
        shapes.push(`<line x1="0" y1="${i * 60}" x2="${S}" y2="${i * 60}" stroke="${a}" stroke-width="1" opacity="0.18"/>`);
        shapes.push(`<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="${S}" stroke="${a}" stroke-width="1" opacity="0.18"/>`);
      }
      shapes.push(`<circle cx="120" cy="120" r="3" fill="${b}" opacity="0.4"/>`);
      break;
    case 'waves':
      for (let i = 0; i < 4; i++) {
        const y = i * 60 + 30;
        shapes.push(
          `<path d="M0 ${y} Q30 ${y - 14} 60 ${y} T120 ${y} T180 ${y} T240 ${y}" fill="none" stroke="${i % 2 ? b : a}" stroke-width="2" stroke-linecap="round" opacity="0.25"/>`,
        );
      }
      break;
    case 'diagonal':
      for (let i = -4; i <= 4; i++) {
        const o = i * 60;
        shapes.push(`<line x1="${o}" y1="0" x2="${o + S}" y2="${S}" stroke="${i % 2 ? b : a}" stroke-width="6" stroke-linecap="round" opacity="0.12"/>`);
      }
      break;
    case 'confetti':
      for (let i = 0; i < 18; i++) {
        // 가장자리에 걸치면 이어 붙일 때 잘려 보이니 안쪽에만 둔다
        const x = r1(12 + rand() * (S - 24));
        const y = r1(12 + rand() * (S - 24));
        const rot = Math.round(rand() * 180);
        const c = i % 2 ? a : b;
        shapes.push(`<rect x="${x}" y="${y}" width="10" height="4" rx="2" fill="${c}" opacity="0.3" transform="rotate(${rot} ${x} ${y})"/>`);
      }
      break;
    case 'petals':
      for (let i = 0; i < 10; i++) {
        const x = r1(12 + rand() * (S - 24));
        const y = r1(12 + rand() * (S - 24));
        const rot = Math.round(rand() * 360);
        shapes.push(`<ellipse cx="${x}" cy="${y}" rx="7" ry="3.5" fill="${i % 3 ? a : b}" opacity="0.28" transform="rotate(${rot} ${x} ${y})"/>`);
      }
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${shapes.join('')}</svg>`;
}
