// 고른 테마(밝을 때·어두울 때)를 CSS 글로 바꾼다. <style id="kok-theme"> 에 넣고, 다음에 열 때를 위해 브라우저에도 적어 둔다.
// 값은 모두 이 파일에서 만든 것(검사한 #rrggbb, 정해진 rgba, 검사한 그림 주소)만 들어가서, 이상한 글이 CSS 로 새지 않는다.
import { CORE_TOKENS, isHex, type TokenMap } from './colors';
import { UUID, type ThemeImage } from './spec';
import { PATTERN_SIZE, svgDataUrl } from './pattern';

export type ModeLook = {
  tokens: TokenMap;
  /** 배경 그림 (없으면 null) */
  image: ThemeImage | null;
  /** 그림 위에 바탕색을 덮는 정도 */
  dim: number;
};

const RGBA = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,3})\)$/;

/** 그림을 CSS url() 로. 올린 그림은 우리 서버 주소(로그인한 사람만 받을 수 있다)로 쓴다 */
export function imageCss(img: ThemeImage | null): string {
  if (!img) return 'none';
  if (img.kind === 'file') return UUID.test(img.id) ? `url("/api/themes/images/${img.id}")` : 'none';
  return svgDataUrl(img.svg);
}

function block(look: ModeLook): string {
  const parts: string[] = [];
  for (const k of CORE_TOKENS) {
    const v = look.tokens[k];
    if (isHex(v) || RGBA.test(v)) parts.push(`${k}:${v}`);
  }
  const dim = Number.isFinite(look.dim) ? Math.min(0.92, Math.max(0.2, look.dim)) : 0.6;
  // 사진·AI 그림은 화면을 덮고, 무늬는 작은 조각을 이어 붙인다
  const tile = look.image?.kind === 'pattern';
  parts.push(
    `--theme-image:${imageCss(look.image)}`,
    `--theme-image-size:${tile ? `${PATTERN_SIZE}px` : 'cover'}`,
    `--theme-image-repeat:${tile ? 'repeat' : 'no-repeat'}`,
    `--theme-dim:${dim.toFixed(2)}`,
  );
  return parts.join(';');
}

/**
 * 밝을 때와 어두울 때 테마를 한 번에.
 * - 기본 CSS(globals.css)보다 늘 이기도록 :root:root 로 적는다 (어느 쪽이 먼저 실리든 같다)
 * - 두 모드 모두 모든 칸을 적어서, 밝은 테마의 색이 어두운 화면에 섞이지 않는다
 * - data-mode 가 있으면 그 모드, 없으면 기기 설정을 따른다
 */
export function themeCss(light: ModeLook, dark: ModeLook): string {
  const d = block(dark);
  return `:root:root{${block(light)}}@media (prefers-color-scheme: dark){:root:root:not([data-mode=light]){${d}}}:root:root[data-mode=dark]{${d}}`;
}
