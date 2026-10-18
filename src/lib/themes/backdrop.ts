// 배경 그림이 있을 때 글자가 잘 보이게 하기.
// 화면은 그림 위에 바탕색을 dim 만큼 덮는다(globals.css 의 body::after). 그래도 그림의 가장 어두운 곳·밝은 곳이 비쳐서
// 그 위에 놓인 글자(큰 제목, 부제, 포인트 글자 …)가 흐려질 수 있다. 그래서
//   1) 그림에서 나올 수 있는 색(사진·AI 그림은 무엇이든 될 수 있어 검정·흰색, 무늬는 실제로 칠하는 색)을 알아내고
//   2) 덮은 뒤 가장 어두운 곳이 너무 어둡지(밝은 모드) / 가장 밝은 곳이 너무 밝지(어두운 모드) 않을 만큼 dim 을 올리고
//   3) 그 색들 위에서도 글자 명암비가 4.5 이상이 되게 글자 색을 맞춘다 (deriveTokens 의 backdrops).
import { deriveTokens, luminance, mix, type Mode } from './colors';
import type { ModeLook } from './css';
import { patternInks, type Ink } from './pattern';
import type { ThemeImage, ThemeSpec } from './spec';

export const MIN_DIM = 0.2;
export const MAX_DIM = 0.92;
/** 밝은 모드: 그림을 덮은 뒤 가장 어두운 곳의 밝기가 이 이상 (이보다 어두우면 회색 글자가 묻힌다) */
const LIGHT_FLOOR = 0.45;
/** 어두운 모드: 가장 밝은 곳의 밝기가 이 이하 */
const DARK_CEIL = 0.06;

/** 그림에서 나올 수 있는 색 */
export function imageInks(image: ThemeImage | null): Ink[] {
  if (!image) return [];
  if (image.kind === 'file') {
    return [
      { color: '#000000', alpha: 1 },
      { color: '#ffffff', alpha: 1 },
    ];
  }
  return patternInks(image.svg);
}

/** 그림 위에 bg 를 dim 만큼 덮은 뒤 글자 밑에 올 수 있는 색들 */
export function backdropColors(inks: Ink[], bg: string, dim: number): string[] {
  return inks.map((k) => mix(bg, mix(bg, k.color, k.alpha), 1 - dim));
}

function readable(colors: string[], mode: Mode): boolean {
  return mode === 'light' ? colors.every((c) => luminance(c) >= LIGHT_FLOOR) : colors.every((c) => luminance(c) <= DARK_CEIL);
}

/** 고른 dim 을 이 모드에서 글자가 잘 보일 만큼 올린다 (두 자리) */
export function fitDim(inks: Ink[], bg: string, mode: Mode, dim: number): number {
  const start = Number.isFinite(dim) ? Math.min(MAX_DIM, Math.max(MIN_DIM, dim)) : 0.6;
  for (let d = Math.round(start * 100); d < MAX_DIM * 100; d++) {
    if (readable(backdropColors(inks, bg, d / 100), mode)) return d / 100;
  }
  return MAX_DIM;
}

/** 내가 만든 테마의 한 모드 모습: 색 칸, 그림, 실제로 덮는 정도 */
export function specLook(spec: ThemeSpec, mode: Mode): ModeLook {
  const palette = spec[mode];
  const inks = imageInks(spec.image);
  if (!inks.length) return { tokens: deriveTokens(palette, mode), image: null, dim: spec.dim };
  const dim = fitDim(inks, palette.bg, mode, spec.dim);
  return { tokens: deriveTokens(palette, mode, backdropColors(inks, palette.bg, dim)), image: spec.image, dim };
}
