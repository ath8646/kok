// 화면 꾸미기 (테마마다, Pro): 별표 빛처럼 화면 곳곳에 은은한 빛을 넣는다.
//   A 화면 위 빛(top) · B 핵심 카드 빛(hero) · C 두 색 버튼(buttons) · D1 화면 아래 빛(bottom) · D3 작은 카드 빛 포인트(details)
//   · 떠 있는 아래 메뉴(floatTab) · 아래 메뉴가 비치는 정도(tabSeeThrough) · 빛 색(aura)
// 기본 테마(KOK·블루 …)는 고칠 수 없어서 늘 기본값(A·B·C·D1 켬)이고, 빛 색은 테마마다 맞춘 두 색(PRESET_AURA)을 쓴다.
// 끈 꾸미기는 색의 진하기를 0 으로(버튼은 끝 색을 시작 색과 같게) 적어서, CSS(globals.css '화면 꾸미기')는 늘 같은 규칙을 쓴다.
// 빛 밑에 글자가 오는 곳은 글자가 읽히는 만큼만 진해진다 (glow.ts 와 같은 계산):
//   - 화면 위·아래 빛: 화면 바탕 위에 바로 놓이는 글자는 본문·흐린 글자뿐이다 (포인트 글자는 알약·카드 안에. e2e 가 확인).
//     빛은 화면 끝 바깥에서 가장 진하고 글자가 오는 곳에서는 그 일부만 남는다(AURA_TEXT_SHARE, globals.css 의 모양에서 잰 값).
//     배경 그림이 있으면 그림이 비칠 수 있는 색(backdrop.ts) 위에서도 읽혀야 한다.
//   - 핵심 카드·작은 카드 안 빛: 카드 안 모든 글자(본문 7, 흐린·포인트·초록·빨강·주황 4.5).
//   - 아래 메뉴 안 빛: 메뉴 글자(본문·흐린 글자).
// 두 색 버튼의 끝 색은 버튼 글자가 4.5 이상, + 버튼의 끝 색은 아이콘이 3 이상이 되게 맞춘다.
import { z } from 'zod';
import { GLOW_TONES, type ThemeColor } from '../settings';
import { contrast, ensureContrast, mix, type Mode, type TokenMap } from './colors';
import { blendOk, chroma, glowPair, readable, rgba, textsOn, tintCap } from './glow';

export const zThemeFx = z.object({
  /** A 화면 위에 은은한 빛 */
  top: z.boolean().catch(true),
  /** B 화면마다 가장 중요한 카드(오늘의 KOK, 복습 시작)가 빛난다 */
  hero: z.boolean().catch(true),
  /** C 시작 버튼·고른 칩·아래 메뉴·+ 버튼을 두 가지 색으로 */
  buttons: z.boolean().catch(true),
  /** D1 화면 아래에도 은은한 빛 (아래 메뉴에도) */
  bottom: z.boolean().catch(true),
  /** D3 작은 카드(에너지 막대·공부한 날·바로 가기·최근 노트)에도 빛 포인트 */
  details: z.boolean().catch(false),
  /** 아래 메뉴를 화면 끝에서 띄우기 (폰) */
  floatTab: z.boolean().catch(false),
  /** 아래 메뉴가 비치는 정도: 0 안 비침 ~ 60 유리처럼 */
  tabSeeThrough: z.number().int().min(0).max(60).catch(8),
  /** 빛 색: 테마 색(accent) 또는 별표 빛과 같은 다섯 가지 */
  aura: z.enum(GLOW_TONES).catch('accent'),
  /** 배경 그림 위 글자 둘레에 바탕색 번짐 (덮는 정도를 글자가 잘 보이는 정도보다 낮췄을 때만 뜻이 있다). 기본은 없음 */
  textHalo: z.boolean().catch(false),
});
export type ThemeFx = z.infer<typeof zThemeFx>;

export const DEFAULT_FX: ThemeFx = {
  top: true,
  hero: true,
  buttons: true,
  bottom: true,
  details: false,
  floatTab: false,
  tabSeeThrough: 8,
  aura: 'accent',
  textHalo: false,
};

/** 예전 테마(꾸미기 없음)·이상한 값은 기본값으로 */
export function readFx(raw: unknown): ThemeFx {
  const r = zThemeFx.safeParse(raw ?? {});
  return r.success ? r.data : { ...DEFAULT_FX };
}

/** 꾸미기가 기본값인지 */
export function isDefaultFx(fx: ThemeFx | null | undefined): boolean {
  if (!fx) return true;
  return (Object.keys(DEFAULT_FX) as Array<keyof ThemeFx>).every((k) => fx[k] === DEFAULT_FX[k]);
}

/** 기본 테마마다 맞춘 빛 두 색 (포인트 색과 어울리는 짝: KOK 인디고→보라, 블루 파랑→하늘 …) */
export const PRESET_AURA: Record<ThemeColor, Record<Mode, readonly [string, string]>> = {
  default: { light: ['#635aea', '#a35bf6'], dark: ['#6861f1', '#b07cff'] },
  ocean: { light: ['#007aff', '#1fb8f2'], dark: ['#0a84ff', '#32c5ff'] },
  lavender: { light: ['#a85be1', '#e868b8'], dark: ['#ac65e3', '#ee79c4'] },
  cherry: { light: ['#f53071', '#ff8a4c'], dark: ['#f54879', '#ff9a5c'] },
  coral: { light: ['#ef5b36', '#ffb020'], dark: ['#f26644', '#ffbe3d'] },
  forest: { light: ['#9be22d', '#2fcf7a'], dark: ['#c6fb50', '#4be08e'] },
  mint: { light: ['#08beaf', '#3aa8f5'], dark: ['#63e6e2', '#5ab8ff'] },
  mocha: { light: ['#b07a4f', '#e3a36b'], dark: ['#b6875e', '#e6b07c'] },
  night: { light: ['#3f5fd0', '#7b5cff'], dark: ['#567ad9', '#8b6dff'] },
};

export const FX_TOKENS = [
  '--aura-1',
  '--aura-2',
  '--aura-3',
  '--aura-4',
  '--hero-1',
  '--hero-2',
  '--hero-ring-1',
  '--hero-ring-2',
  '--hero-halo',
  '--btn-2',
  '--btn-glow',
  '--fab-2',
  '--fab-glow',
  '--chip-on-1',
  '--chip-on-2',
  '--chip-on-ink',
  '--chip-on-glow',
  '--pill-1',
  '--pill-2',
  '--bar-2',
  '--detail-glow',
  '--detail-tint',
  '--fx-detail',
  '--tab-bg',
  '--tab-line',
  '--tab-edge-1',
  '--tab-edge-2',
  '--tab-glow-1',
  '--tab-glow-2',
  '--tab-float',
  '--tab-ring-1',
  '--tab-ring-2',
  '--tab-ring-3',
  '--tab-shadow',
] as const;
export type FxToken = (typeof FX_TOKENS)[number];
export type FxMap = Record<FxToken, string>;
/** 숫자로 적는 칸 (CSS calc 에 곱한다): 0 또는 1 */
export const FX_NUMBER_TOKENS: readonly FxToken[] = ['--fx-detail', '--tab-float'];

/** 화면 위 빛 [왼쪽 색, 오른쪽 색]·아래 빛·핵심 카드 안 빛·아래 메뉴 안 빛의 가장 진한 정도 (글자가 읽히는 만큼으로 더 줄어든다) */
const AURA_TOP: Record<Mode, [number, number]> = { light: [0.22, 0.18], dark: [0.26, 0.2] };
const AURA_BOTTOM: Record<Mode, [number, number]> = { light: [0.15, 0.13], dark: [0.18, 0.15] };
const HERO_TINT: Record<Mode, [number, number]> = { light: [0.13, 0.07], dark: [0.16, 0.09] };
const TAB_GLOW: Record<Mode, [number, number]> = { light: [0.2, 0.17], dark: [0.24, 0.2] };

/**
 * 빛 밑 글자 자리의 진하기 비율 [가까운 빛, 먼 빛] (가장 진한 곳 = 1).
 * globals.css '화면 꾸미기'의 모양(.kok-aura·.kok-hero·.kok-tabbar)에서 잰 값이라, 모양을 바꾸면 같이 고친다:
 * - top: 폰 큰 제목 아래 부제(위에서 약 175px)·노트 제목 아래 줄(약 115px), 넓은 화면 부제(약 125px)·왼쪽 메뉴 글자(약 110px~) → 0.2 이하
 * - bottom: 폰은 아래 메뉴 바로 위(아래에서 약 66px), 넓은 화면은 화면 맨 아래 → 0.5 이하
 * - hero: 카드 안 글자는 빛이 시작하는 오른쪽 위 모서리에서 떨어져 있다 → 0.6
 *   (그래서 빛나는 카드의 오른쪽 위 모서리 가까이에는 카드 바탕 위에 바로 놓이는 색 글자를 두지 않는다)
 * - tab: 아래 메뉴 글자는 빛이 시작하는 아래 모서리 가까이 있다 → 0.85
 */
export const AURA_TEXT_SHARE = {
  top: [0.2, 0.06],
  bottom: [0.5, 0.1],
  hero: [0.6, 0.6],
  tab: [0.85, 0.15],
} as const satisfies Record<string, readonly [number, number]>;

const floor3 = (v: number) => Math.floor(Math.max(0, v) * 1000) / 1000;

/** 빛 두 색: 기본 테마는 맞춘 짝, 내가 만든 테마는 고른 빛 색(테마 색이면 + 버튼 색에서 만든 짝) */
export function auraPair(t: TokenMap, fx: ThemeFx, mode: Mode, preset: ThemeColor | null): [string, string] {
  if (preset && PRESET_AURA[preset]) {
    const p = PRESET_AURA[preset][mode];
    return [p[0], p[1]];
  }
  const [a, b] = glowPair(fx.aura, t);
  // glowPair('accent') 는 [짝, + 버튼 색] 차례라 + 버튼 색을 먼저
  return fx.aura === 'accent' ? [b, a] : [a, b];
}

type Texts = Array<[string, number]>;

/**
 * 두 빛(c1 가장 진한 정도 max[0], c2 max[1])을 같은 비율 k 로 줄여서, 글자 자리(share)의 바탕 색 위에서도 글자가 읽히는 가장 큰 진하기.
 * 바탕(bases)마다 그 바탕의 글자 기준(texts)으로 본다. 한쪽 글자는 c1 이 가깝고(near) c2 가 멀고(far), 반대쪽은 거꾸로.
 * 둘이 섞인 그라데이션 가운데(blendOk)도 본다. 소수 셋째 자리 내림 (CSS 에 적는 값이 찾은 값보다 진해지지 않게).
 */
function pairCap(c1: string, c2: string, max: readonly [number, number], checks: Array<[string, Texts]>, share: readonly [number, number]): [number, number] {
  const [near, far] = share;
  const ok = (k: number) => {
    const a1 = max[0] * k;
    const a2 = max[1] * k;
    return checks.every(
      ([b, texts]) =>
        readable(mix(mix(b, c1, a1 * near), c2, a2 * far), texts) &&
        readable(mix(mix(b, c2, a2 * near), c1, a1 * far), texts) &&
        blendOk(b, c1, a1 * near, c2, a2 * near, texts),
    );
  };
  let k = 1;
  if (!ok(1)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (ok(m)) lo = m;
      else hi = m;
    }
    k = lo;
  }
  return [floor3(max[0] * k), floor3(max[1] * k)];
}

/** 바탕 b 위에서 지켜야 할 글자 (원래 바탕에서 이미 모자라면 그보다 나빠지지만 않게) */
function textsFor(colors: Array<[string, number]>, b: string): Texts {
  return colors.map(([c, min]) => [c, Math.min(min, contrast(c, b))]);
}

/** 이 글자 색(ink)이 그 위에서 min 이상 읽히게 c 의 밝기를 맞춘다 */
function fitUnder(c: string, ink: string, min: number): string {
  return contrast(ink, c) >= min ? c : ensureContrast(c, [ink], min, contrast(ink, '#ffffff') < contrast(ink, '#000000') ? 'light' : 'dark');
}

/**
 * 두 색 그라데이션(a → 끝 색)의 끝 색: 그라데이션 어디서든(가운데도) 글자(ink)가 min 이상이게.
 * 모자라면 끝 색을 조금 더 맞추고, 그래도 안 되면 한 색(a) 그대로
 */
function gradientEnd(a: string, b: string, ink: string, min: number): string {
  for (const target of [min, min + 0.2, min + 0.5, min + 1]) {
    const end = fitUnder(b, ink, target);
    if ([0.25, 0.5, 0.75, 1].every((u) => contrast(ink, mix(a, end, u)) >= min)) return end;
  }
  return a;
}

/**
 * 화면 꾸미기 색 칸.
 * t: 테마 색 칸, fx: 꾸미기, preset: 기본 테마면 그 이름(빛 색을 맞춘 짝으로),
 * pageBases: 화면 바탕 위 글자 밑에 올 수 있는 색 (기본은 바탕색 하나, 배경 그림이 있으면 그림이 비친 색들도)
 */
export function fxTokens(t: TokenMap, fx: ThemeFx, mode: Mode, preset: ThemeColor | null = null, pageBases: string[] = []): FxMap {
  const [c1, c2] = auraPair(t, fx, mode, preset);
  const bg = t['--bg'];
  const surface = t['--surface'];
  const ink = t['--ink'];
  const muted = t['--muted'];
  const bases = [...new Set([bg, ...pageBases])];
  // 화면 바탕 위에 바로 놓이는 글자: 본문 7, 흐린 글자 4.5
  const pageTexts: Array<[string, number]> = [
    [ink, 7],
    [muted, 4.5],
  ];
  const pageChecks = bases.map((b): [string, Texts] => [b, textsFor(pageTexts, b)]);

  // A·D1: 화면 위·아래 빛
  const [t1, t2] = fx.top ? pairCap(c1, c2, AURA_TOP[mode], pageChecks, AURA_TEXT_SHARE.top) : [0, 0];
  const [b1, b2] = fx.bottom ? pairCap(c2, c1, AURA_BOTTOM[mode], pageChecks, AURA_TEXT_SHARE.bottom) : [0, 0];

  // B: 핵심 카드 (카드 안 빛 + 테두리 + 카드 밖 빛). 카드 안 글자는 무엇이든 올 수 있다
  const onCard = textsOn(t, mode, surface);
  const [h1, h2] = fx.hero ? pairCap(c2, c1, HERO_TINT[mode], [[surface, onCard]], AURA_TEXT_SHARE.hero) : [0, 0];
  const ring = fx.hero ? 0.75 : 0;

  // C: 두 색 버튼. 버튼 글자(--accent-ink)가 끝 색에서도 4.5 이상, + 버튼 아이콘은 3 이상. 포인트가 무채색이면(라임의 검정) 한 색 그대로
  const accent = t['--accent'];
  const accentInk = t['--accent-ink'];
  const fab = t['--fab'];
  const fabInk = t['--fab-ink'];
  const colorful = chroma(accent) >= 24;
  const btn2 = fx.buttons && colorful ? gradientEnd(accent, c2, accentInk, 4.5) : accent;
  const fab2 = fx.buttons && chroma(fab) >= 24 ? gradientEnd(fab, c2, fabInk, 3) : fab;
  const glowColor = colorful ? btn2 : c2;
  // 아래 메뉴의 고른 칸: 아이콘(포인트 색)이 3 이상 보이는 만큼만 물든다
  const pillA = fx.buttons ? floor3(tintCap(surface, accent, [[accent, 3]], 0.16)) : 0;
  const pillB = fx.buttons ? floor3(tintCap(surface, c2, [[accent, 3]], mode === 'light' ? 0.2 : 0.24)) : 0;

  // D3: 작은 카드 빛 포인트 (카드 안 빛은 글자가 읽히는 만큼만)
  const tint = fx.details ? floor3(tintCap(surface, c2, onCard, mode === 'light' ? 0.1 : 0.12)) : 0;

  // 아래 메뉴: 비치는 정도, 위 끝 빛 줄·안쪽 빛(D1), 떠 있으면 빛 테두리와 빛 그림자 (끝 선은 없앤다)
  const see = Math.min(60, Math.max(0, Math.round(fx.tabSeeThrough))) / 100;
  const float = fx.floatTab;
  // 메뉴 바탕: 화면 바탕(아래 빛이 비친)·카드 위에 메뉴 색을 (1 - see) 만큼 덮은 색
  const tabBases = [...new Set([...bases.flatMap((b) => [b, mix(mix(b, c2, b1), c1, b2)]), surface].map((b) => mix(b, surface, 1 - see)))];
  const [g1, g2] = fx.bottom
    ? pairCap(
        c2,
        c1,
        TAB_GLOW[mode],
        tabBases.map((b): [string, Texts] => [b, textsFor(pageTexts, b)]),
        AURA_TEXT_SHARE.tab,
      )
    : [0, 0];

  return {
    '--aura-1': rgba(c1, t1),
    '--aura-2': rgba(c2, t2),
    '--aura-3': rgba(c2, b1),
    '--aura-4': rgba(c1, b2),
    '--hero-1': rgba(c2, h1),
    '--hero-2': rgba(c1, h2),
    '--hero-ring-1': rgba(c2, ring),
    '--hero-ring-2': rgba(c1, ring * 0.75),
    '--hero-halo': rgba(c2, fx.hero ? (mode === 'light' ? 0.55 : 0.6) : 0),
    '--btn-2': btn2,
    // 큰 시작 버튼 그림자: 두 색 버튼이면 끝 색으로, 아니면 포인트 색으로 (그림자는 늘 있다)
    '--btn-glow': rgba(fx.buttons ? glowColor : accent, mode === 'light' ? 0.75 : 0.6),
    '--fab-2': fab2,
    '--fab-glow': rgba(fx.buttons ? c2 : fab, fx.buttons ? 0.55 : 0.35),
    '--chip-on-1': fx.buttons ? accent : ink,
    '--chip-on-2': fx.buttons ? btn2 : ink,
    '--chip-on-ink': fx.buttons ? accentInk : surface,
    '--chip-on-glow': rgba(glowColor, fx.buttons ? 0.6 : 0),
    '--pill-1': fx.buttons ? mix(surface, accent, pillA) : t['--accent-soft'],
    '--pill-2': fx.buttons ? mix(surface, c2, pillB) : t['--accent-soft'],
    // 공부한 날 동그라미에는 체크 아이콘(+ 버튼 아이콘 색)이 올라가서 3 이상
    '--bar-2': fx.details ? gradientEnd(fab, c2, fabInk, 3) : fab,
    '--detail-glow': rgba(c2, fx.details ? 0.55 : 0),
    '--detail-tint': rgba(c2, tint),
    '--fx-detail': fx.details ? '1' : '0',
    '--tab-bg': rgba(surface, 1 - see),
    '--tab-line': float ? rgba(t['--line'], 0) : t['--line'],
    '--tab-edge-1': rgba(c1, fx.bottom && !float ? 0.5 : 0),
    '--tab-edge-2': rgba(c2, fx.bottom && !float ? 0.5 : 0),
    '--tab-glow-1': rgba(c2, g1),
    '--tab-glow-2': rgba(c1, g2),
    '--tab-float': float ? '1' : '0',
    '--tab-ring-1': rgba(c2, float ? 0.7 : 0),
    '--tab-ring-2': rgba(c1, float ? 0.45 : 0),
    '--tab-ring-3': rgba(t['--line'], float ? 0.8 : 0),
    '--tab-shadow': rgba(c2, float ? (mode === 'light' ? 0.5 : 0.6) : 0),
  };
}
