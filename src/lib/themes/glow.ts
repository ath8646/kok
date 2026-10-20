// 별표 빛: 별표한 카드(노트의 개념·자료함의 자료)에 번지는 두 가지 색 그라데이션. Pro 는 테마에서 색(tone)과 세기(strength)를 고른다.
// - 카드 안에 번지는 빛(--glow-1·--glow-2)은 그 위 글자(본문·흐린 글자·포인트·초록·빨강·주황 글자)가 읽기 좋게(명암비)
//   진하기를 스스로 줄인다. 그래서 밝은 화면은 연한 색이 넓게, 어두운 화면은 아주 옅게 물든다.
// - 테두리(--glow-ring-*)와 카드 밖으로 번지는 빛(--glow-halo)은 글자 밑에 오지 않아서 고른 세기 그대로다.
// - 별(--glow-star-*)은 두 색 그라데이션, 테두리(--glow-star-edge)는 카드와 물든 자리 위에서 3 이상, 별표한 개념 번호 글자(--glow-on)는 두 색 위에서 4.5 이상.
// 값은 모두 검사한 #rrggbb 와 rgba(...) 라서 테마 CSS(css.ts)에 그대로 넣는다.
import { DEFAULT_GLOW, GLOW_TONES, type Glow, type GlowTone } from '../settings';
import { contrast, ensureContrast, fromHsl, mix, onColor, toHsl, toRgb, type Mode, type TokenMap } from './colors';

export const GLOW_TOKENS = [
  '--glow-1',
  '--glow-2',
  '--glow-ring-1',
  '--glow-ring-2',
  '--glow-halo',
  '--glow-star-1',
  '--glow-star-2',
  '--glow-star-edge',
  '--glow-on',
] as const;
export type GlowToken = (typeof GLOW_TOKENS)[number];
export type GlowMap = Record<GlowToken, string>;

/** 정해진 빛 두 색 (밝을 때·어두울 때 같다). 'accent' 는 테마 색으로 만든다 */
export const GLOW_PAIRS: Record<Exclude<GlowTone, 'accent'>, readonly [string, string]> = {
  gold: ['#ffd60a', '#ff9f0a'],
  sunset: ['#ffb36b', '#ff5e8a'],
  aurora: ['#52e5c4', '#8d7bff'],
  ocean: ['#5ac8fa', '#4a86ff'],
  berry: ['#ff7ad9', '#a46bff'],
};

export const GLOW_TONE_INFO: Record<GlowTone, { label: string }> = {
  gold: { label: '골드' },
  sunset: { label: '선셋' },
  aurora: { label: '오로라' },
  ocean: { label: '오션' },
  berry: { label: '베리' },
  accent: { label: '테마 색' },
};

/**
 * 카드 위에 바로 쓰는 초록·빨강·주황 글자 (globals.css 의 --ok·--bad·--warn 과 같다: themes.test.ts 가 확인).
 * 테마 색 칸에는 없어서 여기에도 적는다.
 */
export const SEMANTIC_TEXT: Record<Mode, readonly string[]> = {
  light: ['#047c2d', '#d80309', '#9c5901'],
  dark: ['#30d158', '#fe5c4e', '#ff9f0a'],
};

/** 카드 안 빛의 가장 진한 정도 (세기 100 이면서 글자가 다 읽힐 때) */
const TINT_MAX: Record<Mode, number> = { light: 0.5, dark: 0.4 };
/** 카드 밖으로 번지는 빛의 진하기 (세기 100 일 때) */
const HALO_MAX: Record<Mode, number> = { light: 0.4, dark: 0.55 };

export function rgba(hex: string, a: number): string {
  const [r, g, b] = toRgb(hex);
  const v = Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${v <= 0 ? '0' : v >= 1 ? '1' : String(v)})`;
}

/** 색이 얼마나 뚜렷한지 (0 ~ 255): 무채색이면 0 */
export function chroma(hex: string): number {
  const c = toRgb(hex);
  return Math.max(...c) - Math.min(...c);
}

/**
 * '테마 색' 빛의 두 색: + 버튼과 그 아이콘 중 더 뚜렷한 색(라임 테마의 검정 버튼이면 라임)과, 색상을 조금 돌린 밝은 짝.
 * 번호 글자(흰색 또는 검정)가 두 색 모두에서 4.5 이상이 되게 밝기를 맞춘다.
 */
export function accentPair(t: TokenMap): [string, string] {
  const base = chroma(t['--fab-ink']) > chroma(t['--fab']) ? t['--fab-ink'] : t['--fab'];
  const [h, s, l] = toHsl(base);
  const partner = fromHsl(h + 34, Math.min(1, s * 1.05), Math.min(0.9, l + 0.08));
  const ink = onColor(base);
  // 흰 글자면 색을 진하게, 검은 글자면 밝게
  const fit = (c: string) => (contrast(ink, c) >= 4.5 ? c : ensureContrast(c, [ink], 4.5, ink === '#ffffff' ? 'light' : 'dark'));
  return [fit(partner), fit(base)];
}

/** 빛의 두 색 */
export function glowPair(tone: GlowTone, t: TokenMap): [string, string] {
  if (tone === 'accent') return accentPair(t);
  const p = GLOW_PAIRS[tone] ?? GLOW_PAIRS.gold;
  return [p[0], p[1]];
}

/**
 * 바탕(base: 카드면 surface, 화면이면 bg) 위 글자들: 빛 위에서도 이만큼은 읽혀야 한다
 * (원래 바탕에서 이미 모자라면 그보다 나빠지지만 않게)
 */
export function textsOn(t: TokenMap, mode: Mode, base: string = t['--surface']): Array<[string, number]> {
  const want: Array<[string, number]> = [
    [t['--ink'], 7],
    [t['--muted'], 4.5],
    [t['--accent'], 4.5],
    ...SEMANTIC_TEXT[mode].map((c): [string, number] => [c, 4.5]),
  ];
  return want.map(([c, min]) => [c, Math.min(min, contrast(c, base))]);
}

export const readable = (bg: string, texts: Array<[string, number]>) => texts.every(([c, min]) => contrast(c, bg) >= min - 1e-9);

/** 바탕(surface)에 c 를 a 만큼 덮었을 때 글자가 다 읽히는 가장 큰 a */
export function tintCap(surface: string, c: string, texts: Array<[string, number]>, max: number): number {
  if (readable(mix(surface, c, max), texts)) return max;
  let lo = 0;
  let hi = max;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (readable(mix(surface, c, mid), texts)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 두 빛 사이(그라데이션 가운데)의 색까지 읽히는지 (밝은 화면에서는 섞인 색이 두 끝보다 어두울 수 있다) */
export function blendOk(surface: string, c1: string, a1: number, c2: string, a2: number, texts: Array<[string, number]>): boolean {
  const p = mix(surface, c1, a1);
  const q = mix(surface, c2, a2);
  return [0, 0.25, 0.5, 0.75, 1].every((u) => readable(mix(p, q, u), texts));
}

/** 별표 빛 색 칸: 테마 색(t)과 고른 빛(glow) */
export function glowTokens(t: TokenMap, glow: Glow, mode: Mode): GlowMap {
  const tone: GlowTone = GLOW_TONES.includes(glow.tone) ? glow.tone : DEFAULT_GLOW.tone;
  const k = Number.isFinite(glow.strength) ? Math.min(1, Math.max(0, glow.strength / 100)) : DEFAULT_GLOW.strength / 100;
  const [c1, c2] = glowPair(tone, t);
  const surface = t['--surface'];
  const texts = textsOn(t, mode);
  let a1 = tintCap(surface, c1, texts, TINT_MAX[mode]) * k;
  let a2 = tintCap(surface, c2, texts, TINT_MAX[mode]) * k;
  for (let i = 0; i < 20 && !blendOk(surface, c1, a1, c2, a2, texts); i++) {
    a1 *= 0.9;
    a2 *= 0.9;
  }
  // CSS 에 적는 값(소수 셋째 자리)이 찾은 값보다 진해지지 않게 내림
  a1 = Math.floor(a1 * 1000) / 1000;
  a2 = Math.floor(a2 * 1000) / 1000;
  const ring = k > 0 ? 0.3 + 0.7 * k : 0;
  // 별은 빛이 가장 진한 오른쪽 위에 앉는다: 맨 카드와 물든 자리 모두에서 별 테두리가 3 이상
  const under = [surface, mix(surface, c1, a1), mix(surface, c2, a2)];
  const edge = mode === 'light' ? ensureContrast(c2, under, 3, 'light') : ensureContrast(c1, under, 3, 'dark');
  const ink = onColor(c2);
  return {
    '--glow-1': rgba(c1, a1),
    '--glow-2': rgba(c2, a2),
    '--glow-ring-1': rgba(c1, ring),
    '--glow-ring-2': rgba(c2, ring),
    '--glow-halo': rgba(c2, HALO_MAX[mode] * k),
    '--glow-star-1': c1,
    '--glow-star-2': c2,
    '--glow-star-edge': edge,
    // 정해진 빛은 두 색 모두 검은 글자가 4.5 이상, 테마 색 빛은 accentPair 가 맞춘다 (themes.test.ts)
    '--glow-on': ink,
  };
}

/** 고른 빛이 기본(골드, 60)인지 */
export function isDefaultGlow(glow: Glow | undefined | null): boolean {
  return !glow || (glow.tone === DEFAULT_GLOW.tone && glow.strength === DEFAULT_GLOW.strength);
}
