// 내가 만든 테마(user_themes.spec)의 모양. 서버가 저장할 때와 화면이 읽을 때 같이 쓴다.
// 화면은 이 값을 CSS 로 바꾸므로, 읽을 때도 늘 여기를 거쳐 색은 #rrggbb, 그림은 번호나 깨끗한 무늬만 남긴다.
import { z } from 'zod';
import { THEME_FONTS, THEME_PAPERS } from '../settings';
import { fitPalette, normalizeHex, type Mode, type Palette } from './colors';
import { DEFAULT_FX, zThemeFx } from './fx';
import { BASE_TOKENS } from './presets';
import { sanitizePatternSvg } from './pattern';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 한 사람이 만들 수 있는 테마 수 */
export const MAX_THEMES = 20;
export const THEME_NAME_MAX = 20;

const zColor = z
  .string()
  .max(20)
  .transform((v, ctx) => {
    const h = normalizeHex(v);
    if (!h) {
      ctx.addIssue({ code: 'custom', message: 'color' });
      return z.NEVER;
    }
    return h;
  });

const zPalette = z.object({ bg: zColor, surface: zColor, accent: zColor });

export const zThemeImage = z.discriminatedUnion('kind', [
  // 올리거나 AI 가 그린 그림 (theme_images 의 번호)
  // ai: AI 가 그린 그림이면 true (설명 없이 '다시 그리기'를 할 수 있다)
  z.object({ kind: z.literal('file'), id: z.string().regex(UUID), ai: z.boolean().optional() }),
  // 반복 무늬 (깨끗하게 다시 만든 SVG)
  z.object({
    kind: z.literal('pattern'),
    svg: z
      .string()
      .max(9000)
      .transform((v, ctx) => {
        const s = sanitizePatternSvg(v);
        if (!s) {
          ctx.addIssue({ code: 'custom', message: 'pattern' });
          return z.NEVER;
        }
        return s;
      }),
  }),
]);
export type ThemeImage = z.infer<typeof zThemeImage>;

export const zThemeSpec = z.object({
  light: zPalette,
  dark: zPalette,
  image: zThemeImage.nullable().default(null),
  /** 그림 위에 바탕색을 얼마나 덮을지 (글자가 잘 보이게). 0.2 ~ 0.92 */
  dim: z.number().min(0.2).max(0.92).default(0.6),
  /** 이 테마를 고르면 같이 바꿀 글꼴·종이 (AI 가 고른 것, 없으면 그대로) */
  font: z.enum(THEME_FONTS).nullable().default(null),
  paper: z.enum(THEME_PAPERS).nullable().default(null),
  /** 화면 꾸미기 (themes/fx.ts). 예전 테마에는 없어서 기본값 (A·B·C·D1 켬) */
  fx: zThemeFx.catch({ ...DEFAULT_FX }),
});
export type ThemeSpec = z.infer<typeof zThemeSpec>;

export const zThemeInput = z.object({
  name: z.string().trim().min(1).max(THEME_NAME_MAX),
  spec: zThemeSpec,
});

/** DB 에서 읽은 spec 을 화면에 쓸 수 있게 (이상하면 null) — 색은 모드에 맞게 다시 맞춘다 */
export function readSpec(raw: unknown): ThemeSpec | null {
  const r = zThemeSpec.safeParse(raw);
  if (!r.success) return null;
  const s = r.data;
  return { ...s, light: fitMode(s.light, 'light'), dark: fitMode(s.dark, 'dark') };
}

function fitMode(p: Palette, mode: Mode): Palette {
  const base = BASE_TOKENS[mode];
  return fitPalette(p, mode, { bg: base['--bg'], surface: base['--surface'], accent: base['--accent'] });
}
