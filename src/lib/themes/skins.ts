// 시그니처 테마 (Pro): 네온·글리치·신스웨이브·터미널·브루탈·스케치북.
// 색만 바꾸는 기본 테마와 달리 모양(카드·버튼·칩·아래 메뉴·제목 글꼴·바탕 그림·움직임)까지 다르다.
// - 모양은 src/app/skins.css 가 <html data-skin="neon"> 로 바꾼다.
// - 색은 여기서 고른 두 색(a·b)으로 모두 만든다. 사람이 어떤 색을 골라도 글자가 읽히게 맞춘다:
//   본문 7, 흐린 글자·포인트·초록·빨강·주황·가지 색 4.5 (바탕·카드·회색 칸, 바탕 그림 위에서도), 버튼 글자 4.5, + 버튼 아이콘 3.
//   skins.test.ts 가 기본 색·모든 고르기 색·아무 색으로 확인한다.
// - 밝기는 테마가 정한다 (네온·글리치·신스웨이브·터미널은 늘 어둡게, 브루탈·스케치북은 늘 밝게).
// - 바탕 그림·테두리·빛에 쓰는 색은 --skin-* 칸 (SKIN_VARS). 값은 모두 여기서 만든 #rrggbb·rgba(...) 라서 테마 CSS 에 그대로 넣는다.
import { SKIN_IDS, type SkinId, type ThemeColor } from '../settings';
import { contrast, ensureContrast, fromHsl, isHex, mix, normalizeHex, onColor, toHsl, type Mode, type Palette, type TokenMap } from './colors';
import type { ModeLook } from './css';
import { DEFAULT_FX, fxTokens, type ThemeFx } from './fx';
import { BRANCH_TEXT, SEMANTIC_TEXT, rgba, tintCap } from './glow';

export { SKIN_IDS, type SkinId };

/** 시그니처 테마의 두 색 */
export type SkinColors = { a: string; b: string };
export type SkinVariant = SkinColors & { label: string };

export type SkinInfo = {
  /** 고르는 화면의 이름 */
  label: string;
  /** 한 줄 설명: 어떤 모양인지 */
  tagline: string;
  /** 늘 이 밝기 */
  mode: Mode;
  /** 두 색의 이름과 어디에 쓰이는지 (테마 고치기에서 보인다) */
  colors: [{ name: string; hint: string }, { name: string; hint: string }];
  /** 고를 수 있는 색 짝 (첫째가 기본) */
  variants: SkinVariant[];
  /** 예전 화면(시그니처 테마를 모르는)이 대신 쓸 기본 테마 */
  legacy: ThemeColor;
  /** 제목 글꼴 이름 (보이는 글) */
  font: string;
  /** 꾸미기 (화면 빛 등): 시그니처 테마가 정한다. 사람은 아래 메뉴 띄우기(floatTab)만 고른다 */
  fx: ThemeFx;
  /** 움직임이 있는지 (설정의 '시그니처 테마 움직임'이 뜻이 있는지) */
  motion: boolean;
};

const OFF: ThemeFx = { ...DEFAULT_FX, top: false, hero: false, buttons: false, bottom: false, details: false, floatTab: false, tabSeeThrough: 0 };

export const SKINS: Record<SkinId, SkinInfo> = {
  neon: {
    label: '네온',
    tagline: '어두운 밤, 빛나는 네온관 테두리',
    mode: 'dark',
    colors: [
      { name: '네온 1', hint: '버튼·큰 카드 테두리·제목 빛' },
      { name: '네온 2', hint: '두 번째 빛·고른 칩·아래 메뉴' },
    ],
    variants: [
      { label: '핑크·시안', a: '#ff3ad7', b: '#3ef2ff' },
      { label: '라임·보라', a: '#b6ff3a', b: '#a05cff' },
      { label: '주황·핑크', a: '#ff8a2a', b: '#ff2e9a' },
      { label: '파랑·민트', a: '#4d7cff', b: '#3dffd0' },
    ],
    legacy: 'cherry',
    font: '오르빗',
    // 두 색 그라데이션 버튼은 쓰지 않는다 (네온관은 한 색: skins.css 가 켜진 관으로 그린다)
    fx: { ...DEFAULT_FX, top: true, hero: false, buttons: false, bottom: true, details: true, floatTab: true, tabSeeThrough: 14 },
    motion: true,
  },
  glitch: {
    label: '글리치',
    tagline: '가끔 지직거리는 고장 난 화면',
    mode: 'dark',
    colors: [
      { name: '어긋난 색 1', hint: '버튼·제목의 한쪽 어긋남' },
      { name: '어긋난 색 2', hint: '제목의 다른 쪽 어긋남·테두리' },
    ],
    variants: [
      { label: '레드·시안', a: '#ff2e63', b: '#08f7fe' },
      { label: '노랑·보라', a: '#ffe600', b: '#9b4dff' },
      { label: '초록·핑크', a: '#00ff9f', b: '#ff2bd1' },
      { label: '주황·파랑', a: '#ff7a1a', b: '#1aa3ff' },
    ],
    legacy: 'night',
    font: '도현',
    fx: OFF,
    motion: true,
  },
  synthwave: {
    label: '신스웨이브',
    tagline: '80년대 노을과 끝없는 격자 길',
    mode: 'dark',
    colors: [
      { name: '노을 1', hint: '해 아래쪽·격자·버튼' },
      { name: '노을 2', hint: '해 위쪽·큰 제목' },
    ],
    variants: [
      { label: '노을', a: '#ff4fa3', b: '#ffb340' },
      { label: '바다', a: '#36e2ff', b: '#9a6bff' },
      { label: '레몬', a: '#ffe14d', b: '#ff5f8f' },
      { label: '보라 노을', a: '#c86bff', b: '#ff6bcb' },
    ],
    legacy: 'lavender',
    font: '구기',
    fx: { ...DEFAULT_FX, top: true, hero: false, buttons: true, bottom: false, details: true, floatTab: true, tabSeeThrough: 18 },
    motion: true,
  },
  terminal: {
    label: '터미널',
    tagline: '검은 화면에 깜빡이는 커서',
    mode: 'dark',
    colors: [
      { name: '글자 색', hint: '글자·테두리·버튼' },
      { name: '강조 색', hint: '고른 것·별표처럼 눈에 띄는 곳' },
    ],
    variants: [
      { label: '초록', a: '#33ff66', b: '#ffb000' },
      { label: '호박', a: '#ffb000', b: '#ff5f1f' },
      { label: '하늘', a: '#45e6ff', b: '#ff4fd1' },
      { label: '흰빛', a: '#e8e8e8', b: '#33ff66' },
    ],
    legacy: 'forest',
    font: '나눔고딕코딩',
    fx: OFF,
    motion: true,
  },
  brutal: {
    label: '브루탈',
    tagline: '굵은 검정 테두리, 딱딱한 그림자',
    mode: 'light',
    colors: [
      { name: '채움 색', hint: '버튼·+ 버튼을 칠하는 색' },
      { name: '강조 색', hint: '바탕·고른 칩·큰 카드 그림자' },
    ],
    variants: [
      { label: '노랑·핑크', a: '#ffd23f', b: '#ff6fae' },
      { label: '민트·보라', a: '#59f0c2', b: '#a984ff' },
      { label: '주황·하늘', a: '#ff9b3d', b: '#5cc8ff' },
      { label: '라임·빨강', a: '#c4f542', b: '#ff5a5f' },
    ],
    legacy: 'default',
    font: '검은고딕',
    fx: OFF,
    motion: false,
  },
  sketch: {
    label: '스케치북',
    tagline: '줄 노트에 펜과 형광펜으로',
    mode: 'light',
    colors: [
      { name: '펜 색', hint: '버튼·포인트 글자·테두리' },
      { name: '형광펜 색', hint: '큰 제목 밑줄·고른 칩' },
    ],
    variants: [
      { label: '파랑 펜·노랑', a: '#2457d6', b: '#ffe45c' },
      { label: '빨강 펜·연두', a: '#d33a3a', b: '#c4f76b' },
      { label: '초록 펜·분홍', a: '#1d7f4c', b: '#ffa6d2' },
      { label: '보라 펜·주황', a: '#6a3ad6', b: '#ffbe6b' },
    ],
    legacy: 'ocean',
    font: '나눔손글씨 펜',
    fx: OFF,
    motion: true,
  },
};

/** 이름 + 은/는 (끝 글자에 받침이 있으면 '은': 네온은·글리치는) */
export function topic(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  const batchim = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return `${word}${batchim ? '은' : '는'}`;
}

export function isSkinId(v: unknown): v is SkinId {
  return typeof v === 'string' && (SKIN_IDS as readonly string[]).includes(v);
}

/** 기본 두 색 */
export function skinDefaults(id: SkinId): SkinColors {
  const v = SKINS[id].variants[0];
  return { a: v.a, b: v.b };
}

/**
 * 어울리는 두 색 아무거나 (테마 만들기의 '아무거나'). 색상환에서 보색 가까이 돌린 짝이고, 밝기·채도는 테마에 맞는 범위에서 고른다
 * (글자가 읽히게 맞추는 것은 buildSkin 이 한다). rand: 0~1 (시험은 정해진 값)
 */
export function randomSkinColors(id: SkinId, rand: () => number = Math.random): SkinColors {
  const h = Math.round(rand() * 360);
  const turn = 140 + Math.round(rand() * 80);
  if (id === 'brutal') return { a: fromHsl(h, 0.9, 0.66), b: fromHsl(h + turn, 0.85, 0.72) };
  if (id === 'sketch') return { a: fromHsl(h, 0.7, 0.38), b: fromHsl(h + turn, 0.95, 0.7) };
  if (id === 'terminal') return { a: fromHsl(h, 1, 0.6), b: fromHsl(h + turn, 1, 0.58) };
  return { a: fromHsl(h, 1, 0.6), b: fromHsl(h + turn, 1, 0.62) };
}

/** 저장된 두 색을 읽는다 (이상하면 기본 색) */
export function readSkinColors(id: SkinId, raw: { a?: unknown; b?: unknown } | null | undefined): SkinColors {
  const d = skinDefaults(id);
  return { a: normalizeHex(raw?.a) ?? d.a, b: normalizeHex(raw?.b) ?? d.b };
}

/** 시그니처 테마 CSS(skins.css)가 쓰는 색 칸. 테마 CSS 에 같이 적는다 (css.ts) */
export const SKIN_VARS = [
  /** 첫째 색 (네온관·버튼·펜 …) */
  '--skin-a',
  /** 둘째 색 */
  '--skin-b',
  /** a·b 를 칠한 곳 위의 글자 (4.5 이상) */
  '--skin-a-ink',
  '--skin-b-ink',
  /** a·b 를 글자로 쓸 때 (바탕·카드·회색 칸에서 4.5 이상) */
  '--skin-a-text',
  '--skin-b-text',
  /** 빛·그림자 */
  '--skin-glow-a',
  '--skin-glow-b',
  /** 카드·버튼 테두리 */
  '--skin-line',
  /** 둘째 바탕 (지평선·띠) */
  '--skin-bg-2',
  /** 바탕 그림 색 (벽돌 줄·주사선·해·격자·망점·줄 노트) */
  '--skin-art-1',
  '--skin-art-2',
  '--skin-art-3',
  /** 딱딱한 그림자·연필 번짐 */
  '--skin-shadow',
  /** 큰 제목 글자 */
  '--skin-title',
  /** 큰 제목 둘째 색 (그라데이션 끝·어긋남) */
  '--skin-title-2',
] as const;
export type SkinVar = (typeof SKIN_VARS)[number];
export type SkinVarMap = Record<SkinVar, string>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 색의 채도·밝기를 범위 안으로 (무채색은 채도를 그대로 둔다: 흰빛 터미널 같은) */
export function tune(hex: string, s: readonly [number, number], l: readonly [number, number]): string {
  const [h, sat, lig] = toHsl(hex);
  return fromHsl(h, sat < 0.08 ? sat : clamp(sat, s[0], s[1]), clamp(lig, l[0], l[1]));
}

const hueOf = (hex: string) => toHsl(hex)[0];
const isGray = (hex: string) => toHsl(hex)[1] < 0.08;

/** 이 모드에서 정해진 색 글자(초록·빨강·주황·가지 색)가 모두 4.5 이상인지 */
function fixedTextsOk(bg: string, mode: Mode): boolean {
  return [...SEMANTIC_TEXT[mode], ...BRANCH_TEXT[mode]].every((t) => contrast(t, bg) >= 4.5);
}

/** 정해진 색 글자가 모두 읽히는 바탕: 모자라면 흰색(밝게)·검정(어둡게) 쪽으로 옮긴다 */
function safeBg(c: string, mode: Mode): string {
  if (fixedTextsOk(c, mode)) return c;
  const to = mode === 'light' ? '#ffffff' : '#000000';
  for (let i = 1; i <= 40; i++) {
    const x = mix(c, to, i / 40);
    if (fixedTextsOk(x, mode)) return x;
  }
  return to;
}

/** 칠한 색 c 와 그 위 글자: 글자가 min 이상 읽히게 (모자라면 칠한 색의 밝기를 바꾼다) */
export function fillPair(c: string, min = 4.5): [string, string] {
  const ink = onColor(c);
  if (contrast(ink, c) >= min) return [c, ink];
  // 흰 글자면 칠을 어둡게, 검은 글자면 밝게
  const fill = ensureContrast(c, [ink], min, ink === '#ffffff' ? 'light' : 'dark');
  return [fill, onColor(fill)];
}

type Parts = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  raised: string;
  line: string;
  /** 본문 글자 (맞추기 전) */
  ink: string;
  muted: string;
  /** 글자로 쓰는 포인트·버튼 색 (맞추기 전) */
  accent: string;
  /** 연한 포인트 바탕: 카드에 포인트를 섞는 정도 */
  soft: number;
  /** + 버튼 (없으면 deriveTokens 와 같게) */
  fab?: [string, string];
  paperLine: string;
  paperDot: string;
  /** 화면 바탕 위 글자 밑에 올 수 있는 바탕 그림 색 */
  pageBases: string[];
};

/** 칸들을 글자가 읽히는 색 칸으로 (colors.ts deriveTokens 와 같은 규칙) */
function finish(p: Parts, mode: Mode): TokenMap {
  const bgs = [p.bg, p.surface, p.surface2];
  const ink = ensureContrast(ensureContrast(p.ink, bgs, 7, mode), p.pageBases, 4.5, mode);
  const muted = ensureContrast(p.muted, [...bgs, ...p.pageBases], 4.5, mode);
  const softRaw = mix(p.surface, p.accent, p.soft);
  const accent = ensureContrast(p.accent, [p.bg, p.surface, p.surface2, softRaw, ...p.pageBases], 4.5, mode);
  let accentInk = onColor(accent);
  const button = contrast(accentInk, accent) >= 4.5 ? accent : ensureContrast(accent, [accentInk], 4.5, mode);
  accentInk = onColor(button);
  const fabOk = (c: string) => contrast(onColor(c), c) >= 3 && contrast(c, p.bg) >= 3;
  const [fab, fabInk] = p.fab ?? (fabOk(p.accent) ? [p.accent, onColor(p.accent)] : [button, onColor(button)]);
  return {
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface-2': p.surface2,
    '--surface-3': p.surface3,
    '--raised': p.raised,
    '--line': p.line,
    '--ink': ink,
    '--muted': muted,
    '--accent': button,
    '--accent-soft': softRaw,
    '--accent-ink': accentInk,
    '--fab': fab,
    '--fab-ink': fabInk,
    '--paper-line': p.paperLine,
    '--paper-dot': p.paperDot,
  };
}

export type SkinBuild = {
  tokens: TokenMap;
  vars: SkinVarMap;
  /** 화면 바탕 위 글자 밑에 올 수 있는 색 (바탕색 + 바탕 그림이 비친 색) */
  pageBases: string[];
  /** 화면 빛 두 색 (꾸미기) */
  aura: [string, string];
};

/** a 를 글자로 쓸 때: 바탕·카드·회색 칸에서 min 이상 */
const asText = (c: string, t: Pick<TokenMap, '--bg' | '--surface' | '--surface-2'>, mode: Mode, min = 4.5) =>
  ensureContrast(c, [t['--bg'], t['--surface'], t['--surface-2']], min, mode);

// ------------------------------------------------------------ 테마마다
/** 네온: 고른 색이 물든 아주 어두운 바탕, 벽돌 벽에 네온관 */
function neon(c: SkinColors): SkinBuild {
  const a = tune(c.a, [0.75, 1], [0.55, 0.72]);
  const b = tune(c.b, [0.75, 1], [0.55, 0.72]);
  const h = hueOf(a);
  const sat = isGray(a) ? 0 : 1;
  const bg = safeBg(fromHsl(h, 0.5 * sat, 0.035), 'dark');
  const surface = safeBg(fromHsl(h, 0.42 * sat, 0.075), 'dark');
  const surface2 = safeBg(fromHsl(h, 0.36 * sat, 0.11), 'dark');
  // 벽돌 줄(a)·바닥 빛(b)
  const brick = rgba(a, 0.07);
  const floor = rgba(b, 0.1);
  const pageBases = [bg, mix(bg, a, 0.07), mix(bg, b, 0.1)];
  const tokens = finish(
    {
      bg,
      surface,
      surface2,
      surface3: fromHsl(h, 0.32 * sat, 0.15),
      raised: fromHsl(h, 0.3 * sat, 0.19),
      line: mix(surface, a, 0.3),
      ink: mix('#ffffff', a, 0.05),
      muted: fromHsl(h, 0.22 * sat, 0.74),
      accent: a,
      soft: 0.2,
      paperLine: rgba(a, 0.1),
      paperDot: rgba(a, 0.24),
      pageBases,
    },
    'dark',
  );
  const [aFill, aInk] = fillPair(a);
  const [bFill, bInk] = fillPair(b);
  // 큰 제목: 흰빛이 도는 네온관 (빛이 번진 바탕 위에서도 4.5 이상)
  const title = ensureContrast(mix('#ffffff', a, 0.28), [bg, mix(bg, a, 0.45), mix(bg, b, 0.35)], 4.5, 'dark');
  return {
    tokens,
    pageBases,
    aura: [a, b],
    vars: {
      '--skin-a': aFill,
      '--skin-b': bFill,
      '--skin-a-ink': aInk,
      '--skin-b-ink': bInk,
      '--skin-a-text': asText(a, tokens, 'dark'),
      '--skin-b-text': asText(b, tokens, 'dark'),
      '--skin-glow-a': rgba(a, 0.62),
      '--skin-glow-b': rgba(b, 0.55),
      '--skin-line': rgba(a, 0.42),
      '--skin-bg-2': fromHsl(h, 0.45 * sat, 0.055),
      '--skin-art-1': brick,
      '--skin-art-2': floor,
      '--skin-art-3': rgba(a, 0.16),
      '--skin-shadow': rgba('#000000', 0.55),
      '--skin-title': title,
      '--skin-title-2': rgba(b, 0.5),
    },
  };
}

/** 글리치: 푸른 검정 바탕, 주사선, 두 색이 어긋난 제목 */
function glitch(c: SkinColors): SkinBuild {
  const a = tune(c.a, [0.8, 1], [0.5, 0.62]);
  const b = tune(c.b, [0.8, 1], [0.5, 0.68]);
  const h = hueOf(b);
  const sat = isGray(b) ? 0 : 1;
  const bg = safeBg(fromHsl(h, 0.25 * sat, 0.045), 'dark');
  const surface = safeBg(fromHsl(h, 0.2 * sat, 0.085), 'dark');
  const surface2 = safeBg(fromHsl(h, 0.18 * sat, 0.12), 'dark');
  const scan = rgba('#ffffff', 0.04);
  const pageBases = [bg, mix(bg, '#ffffff', 0.04), mix(bg, b, 0.06)];
  const tokens = finish(
    {
      bg,
      surface,
      surface2,
      surface3: fromHsl(h, 0.16 * sat, 0.16),
      raised: fromHsl(h, 0.14 * sat, 0.2),
      line: fromHsl(h, 0.18 * sat, 0.22),
      ink: mix('#ffffff', b, 0.04),
      muted: fromHsl(h, 0.14 * sat, 0.7),
      accent: a,
      soft: 0.18,
      paperLine: rgba(b, 0.09),
      paperDot: rgba(b, 0.22),
      pageBases,
    },
    'dark',
  );
  const [aFill, aInk] = fillPair(a);
  const [bFill, bInk] = fillPair(b);
  return {
    tokens,
    pageBases,
    aura: [a, b],
    vars: {
      '--skin-a': aFill,
      '--skin-b': bFill,
      '--skin-a-ink': aInk,
      '--skin-b-ink': bInk,
      '--skin-a-text': asText(a, tokens, 'dark'),
      '--skin-b-text': asText(b, tokens, 'dark'),
      '--skin-glow-a': rgba(a, 0.7),
      '--skin-glow-b': rgba(b, 0.7),
      '--skin-line': rgba(b, 0.55),
      '--skin-bg-2': fromHsl(h, 0.3 * sat, 0.07),
      '--skin-art-1': scan,
      '--skin-art-2': rgba(b, 0.06),
      '--skin-art-3': rgba(a, 0.08),
      '--skin-shadow': rgba('#000000', 0.6),
      '--skin-title': tokens['--ink'],
      '--skin-title-2': aFill,
    },
  };
}

/** 두 색 중 차가운 색(청록~보라)의 색상, 없으면 보랏빛 하늘 */
function skyHue(a: string, b: string): number {
  const cool = [a, b].filter((x) => !isGray(x) && hueOf(x) >= 170 && hueOf(x) <= 300);
  if (!cool.length) return 272;
  const h = cool.sort((x, y) => Math.abs(hueOf(x) - 260) - Math.abs(hueOf(y) - 260))[0];
  return clamp(hueOf(h), 225, 290);
}

/** 신스웨이브: 보랏빛 밤하늘, 줄무늬 해, 지평선의 격자 */
function synthwave(c: SkinColors): SkinBuild {
  const a = tune(c.a, [0.75, 1], [0.55, 0.68]);
  const b = tune(c.b, [0.8, 1], [0.55, 0.68]);
  const h = skyHue(a, b);
  const bg = safeBg(fromHsl(h, 0.62, 0.075), 'dark');
  const surface = safeBg(fromHsl(h, 0.48, 0.115), 'dark');
  const surface2 = safeBg(fromHsl(h, 0.42, 0.155), 'dark');
  // 지평선 쪽 하늘 (a 색이 비친), 해(b → a)는 옅게, 격자는 a
  const horizon = safeBg(mix(fromHsl(h, 0.6, 0.1), a, 0.12), 'dark');
  // 해는 노을처럼 또렷하게 (그 앞의 큰 제목·글자는 아래 pageBases 로 맞춘다)
  const sun = 0.3;
  const grid = 0.3;
  const pageBases = [bg, horizon, mix(bg, b, sun), mix(horizon, a, sun), mix(horizon, a, grid)];
  const tokens = finish(
    {
      bg,
      surface,
      surface2,
      surface3: fromHsl(h, 0.38, 0.19),
      raised: fromHsl(h, 0.36, 0.23),
      line: mix(surface, a, 0.25),
      ink: mix('#ffffff', b, 0.06),
      muted: fromHsl(h, 0.3, 0.76),
      accent: a,
      soft: 0.2,
      paperLine: rgba(a, 0.1),
      paperDot: rgba(a, 0.24),
      pageBases,
    },
    'dark',
  );
  const [aFill, aInk] = fillPair(a);
  const [bFill, bInk] = fillPair(b);
  // 큰 제목: b → a 그라데이션. 큰 제목은 해 앞에 놓여서 해가 비친 바탕(pageBases) 위에서도 두 끝 모두 4.5 이상
  const t1 = ensureContrast(b, pageBases, 4.5, 'dark');
  const t2 = ensureContrast(a, pageBases, 4.5, 'dark');
  return {
    tokens,
    pageBases,
    aura: [a, b],
    vars: {
      '--skin-a': aFill,
      '--skin-b': bFill,
      '--skin-a-ink': aInk,
      '--skin-b-ink': bInk,
      '--skin-a-text': asText(a, tokens, 'dark'),
      '--skin-b-text': asText(b, tokens, 'dark'),
      '--skin-glow-a': rgba(a, 0.6),
      '--skin-glow-b': rgba(b, 0.55),
      '--skin-line': rgba(a, 0.45),
      '--skin-bg-2': horizon,
      '--skin-art-1': rgba(b, sun),
      '--skin-art-2': rgba(a, sun),
      '--skin-art-3': rgba(a, grid),
      '--skin-shadow': rgba(fromHsl(h, 0.8, 0.03), 0.7),
      '--skin-title': t1,
      '--skin-title-2': t2,
    },
  };
}

/** 터미널: 형광 글자가 물든 검정 화면, 주사선 */
function terminal(c: SkinColors): SkinBuild {
  const a = tune(c.a, [0.6, 1], [0.5, 0.7]);
  const b = tune(c.b, [0.6, 1], [0.5, 0.7]);
  const h = hueOf(a);
  const sat = isGray(a) ? 0 : 1;
  const bg = safeBg(fromHsl(h, 0.55 * sat, 0.025), 'dark');
  const surface = safeBg(fromHsl(h, 0.45 * sat, 0.055), 'dark');
  const surface2 = safeBg(fromHsl(h, 0.38 * sat, 0.085), 'dark');
  const pageBases = [bg, mix(bg, a, 0.06)];
  const tokens = finish(
    {
      bg,
      surface,
      surface2,
      surface3: fromHsl(h, 0.32 * sat, 0.12),
      raised: fromHsl(h, 0.3 * sat, 0.15),
      line: mix(surface, a, 0.34),
      ink: mix(a, '#ffffff', 0.42),
      muted: mix(a, bg, 0.36),
      accent: a,
      soft: 0.16,
      paperLine: rgba(a, 0.09),
      paperDot: rgba(a, 0.22),
      pageBases,
    },
    'dark',
  );
  const [aFill, aInk] = fillPair(a);
  const [bFill, bInk] = fillPair(b);
  return {
    tokens,
    pageBases,
    aura: [a, b],
    vars: {
      '--skin-a': aFill,
      '--skin-b': bFill,
      '--skin-a-ink': aInk,
      '--skin-b-ink': bInk,
      '--skin-a-text': asText(a, tokens, 'dark'),
      '--skin-b-text': asText(b, tokens, 'dark'),
      '--skin-glow-a': rgba(a, 0.5),
      '--skin-glow-b': rgba(b, 0.45),
      '--skin-line': rgba(a, 0.5),
      '--skin-bg-2': fromHsl(h, 0.5 * sat, 0.04),
      '--skin-art-1': rgba(a, 0.06),
      '--skin-art-2': rgba('#000000', 0.55),
      '--skin-art-3': rgba(a, 0.05),
      '--skin-shadow': rgba(a, 0.22),
      // 큰 제목은 형광 글자 그대로 (본문처럼 7 이상)
      '--skin-title': asText(a, tokens, 'dark', 7),
      '--skin-title-2': rgba(a, 0.45),
    },
  };
}

const WHITE = '#ffffff';
const BLACK = '#000000';

/** 브루탈: 강조 색이 살짝 물든 밝은 바탕, 흰 카드에 굵은 검정 테두리와 딱딱한 그림자 */
function brutal(c: SkinColors): SkinBuild {
  // 칠하는 색은 검은 글자가 7 이상 (버튼·+ 버튼), 강조 색은 검은 글자가 4.5 이상 (고른 칩)
  const a = ensureContrast(tune(c.a, [0.55, 1], [0.45, 0.78]), [BLACK], 7, 'dark');
  const b = ensureContrast(tune(c.b, [0.5, 1], [0.5, 0.8]), [BLACK], 4.5, 'dark');
  const fixed = [...SEMANTIC_TEXT.light, ...BRANCH_TEXT.light].map((x): [string, number] => [x, 4.5]);
  const texts: Array<[string, number]> = [[BLACK, 7], ...fixed];
  // 바탕: 강조 색을 글자가 읽히는 만큼만 (16% 까지), 회색 칸: 채움 색을 (24% 까지)
  const bg = mix(WHITE, b, tintCap(WHITE, b, texts, 0.16));
  const surface2 = mix(WHITE, a, tintCap(WHITE, a, texts, 0.24));
  // 바탕 망점 (검정)
  const dots = 0.13;
  const pageBases = [bg, mix(bg, BLACK, dots)];
  const soft = mix(WHITE, b, 0.16);
  const tokens = finish(
    {
      bg: safeBg(bg, 'light'),
      surface: WHITE,
      surface2: safeBg(surface2, 'light'),
      surface3: mix(WHITE, a, 0.45),
      raised: WHITE,
      line: BLACK,
      ink: BLACK,
      muted: '#3d3d45',
      // 글자로 쓰는 포인트는 강조 색을 진하게 (버튼은 skins.css 가 채움 색으로 칠한다)
      accent: ensureContrast(b, [bg, WHITE, soft, ...pageBases], 4.5, 'light'),
      soft: 0.16,
      fab: [a, BLACK],
      paperLine: rgba(BLACK, 0.12),
      paperDot: rgba(BLACK, 0.28),
      pageBases,
    },
    'light',
  );
  return {
    tokens,
    pageBases,
    aura: [a, b],
    vars: {
      '--skin-a': a,
      '--skin-b': b,
      '--skin-a-ink': BLACK,
      '--skin-b-ink': BLACK,
      '--skin-a-text': asText(a, tokens, 'light'),
      '--skin-b-text': asText(b, tokens, 'light'),
      '--skin-glow-a': rgba(a, 0.5),
      '--skin-glow-b': rgba(b, 0.5),
      '--skin-line': BLACK,
      '--skin-bg-2': b,
      '--skin-art-1': rgba(BLACK, dots),
      '--skin-art-2': rgba(BLACK, 0.06),
      '--skin-art-3': rgba(a, 0.5),
      '--skin-shadow': BLACK,
      '--skin-title': BLACK,
      '--skin-title-2': b,
    },
  };
}

/** 스케치북: 흰 줄 노트(파란 줄·빨간 여백 줄), 펜 글씨와 형광펜 */
function sketch(c: SkinColors): SkinBuild {
  const bg = '#fbfbf8';
  const ruled = '#5b8bd9';
  const margin = '#e0565b';
  // 줄·여백 줄·종이 결(검은 잡티 5.5%: skins.css)
  const pageBases = [bg, mix(bg, ruled, 0.2), mix(bg, margin, 0.38), mix(bg, '#000000', 0.055)];
  const ink = '#1d2026';
  // 형광펜: 그 위 본문 글자가 7 이상
  const b = ensureContrast(tune(c.b, [0.6, 1], [0.58, 0.82]), [ink], 7, 'dark');
  const pen = tune(c.a, [0.45, 1], [0.28, 0.5]);
  const tokens = finish(
    {
      bg,
      surface: WHITE,
      surface2: '#f2f2ed',
      surface3: '#e6e6df',
      raised: WHITE,
      line: '#d9d9d1',
      ink,
      muted: '#595d66',
      accent: pen,
      soft: 0.1,
      paperLine: rgba(ruled, 0.2),
      paperDot: rgba(ruled, 0.36),
      pageBases,
    },
    'light',
  );
  const a = tokens['--accent'];
  return {
    tokens,
    pageBases,
    aura: [a, b],
    vars: {
      '--skin-a': a,
      '--skin-b': b,
      '--skin-a-ink': tokens['--accent-ink'],
      '--skin-b-ink': ink,
      '--skin-a-text': a,
      '--skin-b-text': asText(mix(b, ink, 0.45), tokens, 'light'),
      '--skin-glow-a': rgba(a, 0.35),
      '--skin-glow-b': rgba(b, 0.85),
      '--skin-line': rgba(ink, 0.82),
      '--skin-bg-2': '#f4f4ef',
      '--skin-art-1': rgba(ruled, 0.2),
      '--skin-art-2': rgba(margin, 0.38),
      '--skin-art-3': rgba(a, 0.12),
      '--skin-shadow': rgba('#1a1a24', 0.16),
      '--skin-title': ink,
      '--skin-title-2': b,
    },
  };
}

const BUILD: Record<SkinId, (c: SkinColors) => SkinBuild> = { neon, glitch, synthwave, terminal, brutal, sketch };

const cache = new Map<string, SkinBuild>();

/** 시그니처 테마의 색 칸 (같은 색이면 같은 결과를 기억한다) */
export function buildSkin(id: SkinId, colors: SkinColors): SkinBuild {
  const c = readSkinColors(id, colors);
  const key = `${id}:${c.a}:${c.b}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = BUILD[id](c);
    if (cache.size > 64) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}

/** 시그니처 테마의 꾸미기: 정해진 값에 사람이 고른 아래 메뉴 띄우기만 */
export function skinFx(id: SkinId, floatTab?: boolean | null): ThemeFx {
  const fx = SKINS[id].fx;
  return typeof floatTab === 'boolean' ? { ...fx, floatTab } : { ...fx };
}

/** 시그니처 테마 한 벌의 모습 (모드는 테마가 정한 밝기) */
export function skinLook(id: SkinId, colors: SkinColors, floatTab?: boolean | null): ModeLook {
  const s = buildSkin(id, colors);
  const mode = SKINS[id].mode;
  return {
    tokens: s.tokens,
    image: null,
    dim: 0.6,
    fx: fxTokens(s.tokens, skinFx(id, floatTab), mode, null, s.pageBases, s.aura),
    skin: { id, vars: s.vars },
  };
}

/**
 * 시그니처 테마로 만든 내 테마를 예전 화면(시그니처 테마를 모르는)이 읽을 때 쓸 밝을 때·어두울 때 색.
 * 테마의 밝기 쪽은 그 테마의 바탕·카드·포인트, 다른 쪽은 기본 색에 포인트만
 */
export function skinPalettes(id: SkinId, colors: SkinColors): Record<Mode, Palette> {
  const s = buildSkin(id, colors);
  const t = s.tokens;
  const mine: Palette = { bg: t['--bg'], surface: t['--surface'], accent: t['--fab'] };
  const other: Palette =
    SKINS[id].mode === 'dark'
      ? { bg: '#f2f2f7', surface: '#ffffff', accent: ensureContrast(t['--accent'], ['#ffffff', '#f2f2f7'], 4.5, 'light') }
      : { bg: '#000000', surface: '#1c1c1e', accent: ensureContrast(t['--accent'], ['#000000', '#1c1c1e'], 4.5, 'dark') };
  return SKINS[id].mode === 'dark' ? { light: other, dark: mine } : { light: mine, dark: other };
}

/** 칸 값이 테마 CSS 에 넣어도 되는 모양인지 */
export function isSkinValue(v: string): boolean {
  return isHex(v) || /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,3})\)$/.test(v);
}
