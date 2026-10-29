// 테마 만들기의 쉬운 색 고르기: 포인트 색 하나 + 바탕 느낌(맑은 회색·따뜻하게·차갑게·포인트 물들이기)으로 밝을 때·어두울 때 색을 모두 만든다.
// 글자 명암비는 colors.ts deriveTokens 가 맞춘다 (여기서는 바탕·카드·포인트만).
import { fitPalette, mix, normalizeHex, type Mode, type Palette } from './colors';
import { BASE_TOKENS } from './presets';

export const BASE_TONES = ['gray', 'warm', 'cool', 'tint'] as const;
export type BaseTone = (typeof BASE_TONES)[number];

export const BASE_TONE_INFO: Record<BaseTone, { label: string; hint: string }> = {
  gray: { label: '맑은 회색', hint: '애플 앱처럼 깔끔한 회색 바탕' },
  warm: { label: '따뜻하게', hint: '종이처럼 살짝 따뜻한 바탕' },
  cool: { label: '차갑게', hint: '푸른빛이 도는 바탕' },
  tint: { label: '포인트 물들이기', hint: '바탕에 포인트 색이 살짝' },
};

/** 고르기 쉬운 포인트 색 (맑은 색) */
export const ACCENT_SWATCHES = [
  '#635aea',
  '#007aff',
  '#32ade6',
  '#08beaf',
  '#34c759',
  '#9be22d',
  '#ffb300',
  '#ff9500',
  '#ef5b36',
  '#f53071',
  '#a85be1',
  '#996845',
] as const;

const SURFACES: Record<Exclude<BaseTone, 'tint'>, Record<Mode, { bg: string; surface: string }>> = {
  gray: { light: { bg: '#f2f2f7', surface: '#ffffff' }, dark: { bg: '#000000', surface: '#1c1c1e' } },
  warm: { light: { bg: '#f5f1ec', surface: '#fffdfa' }, dark: { bg: '#0d0b09', surface: '#1e1b18' } },
  cool: { light: { bg: '#eff1f7', surface: '#ffffff' }, dark: { bg: '#05070f', surface: '#121729' } },
};

const base = (m: Mode): Palette => ({ bg: BASE_TOKENS[m]['--bg'], surface: BASE_TOKENS[m]['--surface'], accent: BASE_TOKENS[m]['--accent'] });

/** 포인트 색 하나와 바탕 느낌으로 두 모드의 색 */
export function paletteFromColor(accent: string, tone: BaseTone): Record<Mode, Palette> {
  const a = normalizeHex(accent) ?? BASE_TOKENS.light['--fab'];
  const pick = (m: Mode): Partial<Palette> => {
    if (tone !== 'tint') return { ...SURFACES[tone][m], accent: a };
    return m === 'light'
      ? { bg: mix('#f4f4f7', a, 0.1), surface: mix('#ffffff', a, 0.025), accent: a }
      : { bg: mix('#000000', a, 0.07), surface: mix('#1c1c1e', a, 0.1), accent: a };
  };
  return { light: fitPalette(pick('light'), 'light', base('light')), dark: fitPalette(pick('dark'), 'dark', base('dark')) };
}

/** 지금 색이 어느 바탕 느낌인지 (포인트 색은 밝을 때 것으로 본다). 직접 고른 색이면 null */
export function toneOf(p: Record<Mode, Palette>): BaseTone | null {
  for (const tone of BASE_TONES) {
    const want = paletteFromColor(p.light.accent, tone);
    if ((['light', 'dark'] as const).every((m) => want[m].bg === p[m].bg && want[m].surface === p[m].surface)) return tone;
  }
  return null;
}
