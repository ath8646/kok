// 테마 (Pro): 화면 밝기(기기 설정·밝게·어둡게), 밝을 때·어두울 때 쓸 테마(기본 테마·시그니처 테마·내가 만든 테마), 글꼴, 노트 종이 무늬,
// 배경 그림, 별표 빛.
// 색은 두 모드의 색 칸(별표 빛 포함)을 모두 적은 CSS 를 <style id="kok-theme"> 에 넣어 바꾸고(src/lib/themes/css.ts),
// <html> 에는 data-mode·data-font·data-paper·data-bg 를 붙인다.
// 시그니처 테마(themes/skins.ts)는 두 모드에 같은 테마를 쓸 때만: 밝기를 그 테마가 정하고(data-mode), 모양은 data-skin 으로
// skins.css 가 바꾼다. 움직임을 끄면 data-motion="off". 따로 고르는 중이면 시그니처 테마 대신 비슷한 기본 테마 색(legacy)을 쓴다.
// 다음에 열 때 기본 색이 잠깐 보이지 않게 브라우저에도 적어 두고, layout 의 작은 글(THEME_BOOT)이 그리기 전에 먼저 붙인다.
import {
  DEFAULT_GLOW,
  THEME_COLORS,
  type Glow,
  type SkinId,
  type ThemeColor,
  type ThemeFont,
  type ThemeMode,
  type ThemePaper,
  type UserSettings,
} from './settings';
import type { Mode } from './themes/colors';
import { backdropColors, imageInks, specLook } from './themes/backdrop';
import { themeCss, type ModeLook } from './themes/css';
import { DEFAULT_FX, fxTokens } from './themes/fx';
import { glowTokens, isDefaultGlow } from './themes/glow';
import { BASE_TOKENS, presetTokens } from './themes/presets';
import { readSpec, type ThemeSpec } from './themes/spec';
import { SKINS, isSkinId, skinDefaults, skinLook, type SkinColors } from './themes/skins';

export type Theme = UserSettings['theme'];
/** 내가 만든 테마 (user_themes 행) */
export type CustomTheme = { id: string; name: string; spec: unknown };

/** 고르는 화면에 보일 이름 (색은 presetTokens 로 그린다) */
export const THEME_COLOR_INFO: Record<ThemeColor, { label: string }> = {
  default: { label: 'KOK' },
  ocean: { label: '블루' },
  lavender: { label: '라벤더' },
  cherry: { label: '핑크' },
  coral: { label: '코럴' },
  forest: { label: '라임' },
  mint: { label: '민트' },
  mocha: { label: '모카' },
  night: { label: '미드나잇' },
};

export const THEME_FONT_INFO: Record<ThemeFont, { label: string; family: string }> = {
  default: { label: '기본', family: "'Pretendard Variable', 'Pretendard', sans-serif" },
  round: { label: '둥근 글씨', family: "'Gowun Dodum', sans-serif" },
  hand: { label: '손글씨', family: "'Gaegu', sans-serif" },
  serif: { label: '바탕', family: "'Gowun Batang', serif" },
};

export const THEME_PAPER_INFO: Record<ThemePaper, { label: string }> = {
  none: { label: '없음' },
  lined: { label: '줄 노트' },
  grid: { label: '모눈' },
  dots: { label: '점' },
};

export const THEME_MODE_INFO: Record<ThemeMode, { label: string }> = {
  system: { label: '기기 설정' },
  light: { label: '밝게' },
  dark: { label: '어둡게' },
};

export const THEME_KEY = 'kok:theme';
const STYLE_ID = 'kok-theme';

/** 테마 글꼴은 고른 사람만 받는다 (글꼴 안내 CSS 를 그때 불러온다) */
const FONT_LOADERS: Record<Exclude<ThemeFont, 'default'>, () => Promise<unknown>> = {
  round: () => import('./theme-fonts/round'),
  hand: () => import('./theme-fonts/hand'),
  serif: () => import('./theme-fonts/serif'),
};

export function loadThemeFont(font: ThemeFont): void {
  if (font === 'default') return;
  FONT_LOADERS[font]().catch(() => {
    // 글꼴을 못 받으면 기본 글꼴로 보인다
  });
}

/** 시그니처 테마의 제목 글꼴 (그 테마를 쓰는 사람만 받는다) */
const SKIN_FONT_LOADERS: Record<SkinId, () => Promise<unknown>> = {
  neon: () => import('./theme-fonts/skin-neon'),
  glitch: () => import('./theme-fonts/skin-glitch'),
  synthwave: () => import('./theme-fonts/skin-synthwave'),
  terminal: () => import('./theme-fonts/skin-terminal'),
  brutal: () => import('./theme-fonts/skin-brutal'),
  sketch: () => import('./theme-fonts/skin-sketch'),
};

export function loadSkinFont(id: SkinId | null | undefined): void {
  if (!id || !isSkinId(id)) return;
  SKIN_FONT_LOADERS[id]().catch(() => {
    // 글꼴을 못 받으면 기본 글꼴로 보인다
  });
}

// ------------------------------------------------------------ 테마 고르기 → 색
/** 이 모드에 쓰는 테마: 따로 고른 것이 없으면 예전 한 가지 테마 색 */
export function themeRef(t: Theme, mode: Mode): string {
  return t[mode] ?? `preset:${t.color}`;
}

/** 'custom:<번호>' → 번호 (아니면 null) */
export function customId(ref: string): string | null {
  return ref.startsWith('custom:') ? ref.slice(7) : null;
}

/** 이 테마 설정이 쓰는 내가 만든 테마 번호들 */
export function customIds(t: Theme): string[] {
  return [...new Set((['light', 'dark'] as const).map((m) => customId(themeRef(t, m))).filter((x): x is string => !!x))];
}

// 읽어 온 내가 만든 테마 (화면 어디서든 같은 것을 쓴다)
const known = new Map<string, { name: string; spec: ThemeSpec | null }>();

/** 읽어 온 테마를 기억한다 (색·그림은 readSpec 으로 검사한 것만) */
export function rememberCustomThemes(rows: CustomTheme[]): void {
  for (const r of rows) known.set(r.id, { name: r.name, spec: readSpec(r.spec) });
}

export function forgetCustomTheme(id: string): void {
  known.delete(id);
}

/** 아직 읽지 않은 내가 만든 테마 번호 */
export function missingCustomIds(t: Theme): string[] {
  return customIds(t).filter((id) => !known.has(id));
}

export function knownCustomTheme(id: string): { name: string; spec: ThemeSpec | null } | undefined {
  return known.get(id);
}

const DEFAULT_DIM = 0.6;

/** 기본 테마 한 모드의 모습 (꾸미기는 기본값, 빛 색은 테마마다 맞춘 짝) */
function presetLook(color: ThemeColor, mode: Mode): ModeLook {
  const tokens = presetTokens(color, mode);
  return { tokens, image: null, dim: DEFAULT_DIM, fx: fxTokens(tokens, DEFAULT_FX, mode, color) };
}

/**
 * 내가 만든 테마 한 모드의 모습 (테마 고치기 미리보기도 같은 계산).
 * 그림이 있으면 글자가 잘 보이게 덮는 정도와 글자 색을 맞추고(themes/backdrop.ts), 꾸미기는 그 테마의 것이며
 * 화면 위·아래 빛은 그림이 비친 색 위에서도 글자가 읽히는 만큼만
 */
export function specLookFx(spec: ThemeSpec, mode: Mode): ModeLook {
  const look = specLook(spec, mode);
  // 직접 낮춘 테마도 빛은 글자 색을 맞춘 덮는 정도로 (바탕 위 글자는 둘레의 바탕색이 받쳐 준다)
  const seen = look.image ? backdropColors(imageInks(look.image), spec[mode].bg, look.readDim ?? look.dim) : [];
  return { ...look, fx: fxTokens(look.tokens, spec.fx, mode, null, seen) };
}

/** 기본 테마 한 모드의 모습 (밖에서도: 새 테마를 기본 테마에서 시작할 때 미리보기) */
export function presetLookFx(color: ThemeColor, mode: Mode): ModeLook {
  return presetLook(color, mode);
}

/** 시그니처 테마 한 벌: 어느 테마·두 색·아래 메뉴 띄우기 (내가 만든 테마면 그 테마가 고른 것) */
export type SkinPick = { id: SkinId; colors: SkinColors; floatTab: boolean | null };

/** 이 테마가 시그니처 테마인지 ('skin:neon' 이나 시그니처 테마로 만든 내 테마). 아니면 null */
export function skinOf(ref: string): SkinPick | null {
  if (ref.startsWith('skin:')) {
    const id = ref.slice('skin:'.length);
    return isSkinId(id) ? { id, colors: skinDefaults(id), floatTab: null } : null;
  }
  const cid = customId(ref);
  const spec = cid ? known.get(cid)?.spec : null;
  if (spec?.skin) return { id: spec.skin.id, colors: { a: spec.skin.a, b: spec.skin.b }, floatTab: spec.fx.floatTab };
  return null;
}

/** 시그니처 테마의 모습 */
export function skinPickLook(p: SkinPick): ModeLook {
  return skinLook(p.id, p.colors, p.floatTab);
}

/** 두 모드에 같은 시그니처 테마를 쓰는지 (그때만 시그니처 테마의 모양·밝기로) */
export function activeSkin(t: Theme): SkinPick | null {
  const light = themeRef(t, 'light');
  return light === themeRef(t, 'dark') ? skinOf(light) : null;
}

/**
 * 한 모드에 보일 모습 (없는 테마·이상한 테마는 기본 테마로).
 * 시그니처 테마는 그 테마의 밝기에서만 시그니처 모습이고, 다른 밝기(따로 고를 때)는 비슷한 기본 테마(legacy)·내 테마의 예전 화면용 색
 */
export function lookFor(ref: string, mode: Mode): ModeLook {
  const skin = skinOf(ref);
  if (skin && SKINS[skin.id].mode === mode) return skinPickLook(skin);
  const id = customId(ref);
  if (id) {
    const spec = known.get(id)?.spec;
    if (spec) return specLookFx(spec, mode);
    return presetLook('default', mode);
  }
  if (ref.startsWith('skin:')) {
    const sid = ref.slice('skin:'.length);
    return presetLook(isSkinId(sid) ? SKINS[sid].legacy : 'default', mode);
  }
  const color = ref.slice('preset:'.length) as ThemeColor;
  return presetLook(THEME_COLORS.includes(color) ? color : 'default', mode);
}

export type ResolvedTheme = {
  /** 화면 밝기 (시그니처 테마면 그 테마가 정한 밝기) */
  mode: ThemeMode;
  light: ModeLook;
  dark: ModeLook;
  font: ThemeFont;
  paper: ThemePaper;
  plain: boolean;
  /** 쓰는 시그니처 테마 (없으면 null) */
  skin: SkinId | null;
  /** 시그니처 테마의 움직임 */
  motion: boolean;
};

/** 한 모드의 모습에 별표 빛을 더한다 (빛은 그 테마의 카드·글자 색에 맞춘다). 테마 만들기 미리보기도 쓴다 */
export function withGlow(look: ModeLook, glow: Glow, mode: Mode): ModeLook {
  return { ...look, glow: glowTokens(look.tokens, glow, mode) };
}

export function resolveTheme(t: Theme): ResolvedTheme {
  const glow = t.glow ?? DEFAULT_GLOW;
  const motion = t.motion !== false;
  const skin = activeSkin(t);
  if (skin) {
    // 시그니처 테마: 그 테마의 밝기로 고정하고, 두 모드 모두 같은 모습 (기기 설정이 바뀌어도 그대로)
    const mode = SKINS[skin.id].mode;
    const look = withGlow(skinPickLook(skin), glow, mode);
    return { mode, light: look, dark: look, font: t.font, paper: t.paper, plain: false, skin: skin.id, motion };
  }
  const light = withGlow(lookFor(themeRef(t, 'light'), 'light'), glow, 'light');
  const dark = withGlow(lookFor(themeRef(t, 'dark'), 'dark'), glow, 'dark');
  // 기본 색·기본 빛 그대로면 CSS 를 넣지 않는다 (globals.css 의 기본 색)
  const plain = themeRef(t, 'light') === 'preset:default' && themeRef(t, 'dark') === 'preset:default' && isDefaultGlow(glow);
  return { mode: t.mode, light, dark, font: t.font, paper: t.paper, plain, skin: null, motion };
}

/** 내가 만든 테마를 읽기 전에 정할 수 있는 화면 밝기 (시그니처 테마는 그 밝기). 아직 모르면 null */
function modeBeforeLoad(t: Theme): ThemeMode | null {
  const light = themeRef(t, 'light');
  if (light !== themeRef(t, 'dark')) return t.mode;
  const cid = customId(light);
  if (cid && !known.has(cid)) return null;
  const skin = skinOf(light);
  return skin ? SKINS[skin.id].mode : t.mode;
}

/** 주소창·상태 막대 색: 고정한 모드가 있으면 그 바탕색, 아니면 모드마다 */
function setThemeColorMeta(r: ResolvedTheme | null) {
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const forDark = (m.getAttribute('media') ?? '').includes('dark');
    if (!r) {
      m.setAttribute('content', forDark ? BASE_TOKENS.dark['--bg'] : BASE_TOKENS.light['--bg']);
      continue;
    }
    const look = r.mode === 'light' ? r.light : r.mode === 'dark' ? r.dark : forDark ? r.dark : r.light;
    m.setAttribute('content', look.tokens['--bg']);
  }
}

/**
 * 테마를 화면에 붙인다. null 이면 기본으로 (Pro 가 끝났을 때 등).
 * 내가 만든 테마를 아직 읽지 않았으면 붙이지 않고 false (먼저 rememberCustomThemes. 지워진 테마는 allowMissing 으로 기본 색).
 */
export function applyTheme(t: Theme | null, opts: { allowMissing?: boolean } = {}): boolean {
  if (typeof document === 'undefined') return false;
  const d = document.documentElement;
  const set = (name: string, v: string | null) => (v ? d.setAttribute(name, v) : d.removeAttribute(name));
  // 글꼴·종이·움직임은 내가 만든 테마를 읽지 못해도 바로 붙인다
  set('data-font', t && t.font !== 'default' ? t.font : null);
  set('data-paper', t && t.paper !== 'none' ? t.paper : null);
  set('data-motion', t && t.motion === false ? 'off' : null);
  // 화면 밝기도 바로 (시그니처 테마인지 아직 모르는 내 테마면 지난번 그대로 두고 읽은 뒤에)
  const early = t ? modeBeforeLoad(t) : 'system';
  if (early) set('data-mode', early !== 'system' ? early : null);
  if (t) loadThemeFont(t.font);
  if (t && missingCustomIds(t).length && !opts.allowMissing) {
    // 색·밝기는 읽은 뒤에 (그동안은 THEME_BOOT 가 붙인 지난번 모습 그대로: 시그니처 테마면 그 밝기)
    bumpTheme();
    return false;
  }
  const r = t ? resolveTheme(t) : null;
  set('data-mode', r && r.mode !== 'system' ? r.mode : null);
  set('data-skin', r?.skin ?? null);
  if (r?.skin) loadSkinFont(r.skin);
  const bg = !!r && (!!r.light.image || !!r.dark.image);
  set('data-bg', bg ? '1' : null);
  // 예전 방식의 속성은 지운다
  d.removeAttribute('data-theme');
  const css = r && !r.plain ? themeCss(r.light, r.dark) : '';
  let style = document.getElementById(STYLE_ID);
  if (css) {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  } else style?.remove();
  setThemeColorMeta(r && (!r.plain || r.mode !== 'system') ? r : null);
  bumpTheme();
  try {
    if (r && (css || r.mode !== 'system' || r.font !== 'default' || r.paper !== 'none' || !r.motion)) {
      window.localStorage.setItem(
        THEME_KEY,
        JSON.stringify({ v: 2, mode: r.mode, css, font: r.font, paper: r.paper, bg, skin: r.skin ?? undefined, motion: r.motion ? undefined : false }),
      );
    } else window.localStorage.removeItem(THEME_KEY);
  } catch {
    // 저장이 막힌 브라우저: 다음에 열 때 잠깐 기본 색으로 보일 뿐이다
  }
  return true;
}

/** 로그아웃·탈퇴할 때: 이 기기에 적어 둔 테마를 지운다 */
export function clearTheme(): void {
  known.clear();
  applyTheme(null);
}

// 테마가 바뀐 것을 CSS 변수를 읽어 쓰는 곳(마인드맵 등)에 알린다
let themeVersion = 0;
const listeners = new Set<() => void>();
function bumpTheme() {
  themeVersion++;
  for (const l of listeners) l();
}

/** 테마·화면 밝기가 바뀌면 cb (useSyncExternalStore 용) */
export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  mq?.addEventListener('change', cb);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener('change', cb);
  };
}

/** 지금 테마를 나타내는 글 (바뀌면 달라진다) */
export function themeSnapshot(): string {
  return `${currentMode()}:${themeVersion}`;
}

/** 지금 화면이 어두운지 (고정한 모드를 먼저 보고, 없으면 기기 설정) */
export function currentMode(): Mode {
  if (typeof document === 'undefined') return 'light';
  const m = document.documentElement.getAttribute('data-mode');
  if (m === 'light' || m === 'dark') return m;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * <head> 에서 화면을 그리기 전에 도는 짧은 글: 로그인한 화면이면 적어 둔 테마를 먼저 붙인다.
 * 속성 값은 정해진 모양만 넣고, CSS 는 이 앱이 만든 것만 (applyTheme 이 적은 것) 넣는다. 예전 모양(v 없음)은 글꼴·종이만 쓴다.
 * 시그니처 테마(data-skin)는 그 색 CSS 가 있을 때만 붙인다 (모양만 바뀌고 색이 기본으로 보이지 않게).
 * 제목 글꼴은 화면 글(applyTheme)이 불러온다: 그동안은 기본 글꼴로 보인다.
 */
export const THEME_BOOT = `try{if(/^\\/(home|library|notes|review|wrong|questions|settings|plan|admin)(\\/|$)/.test(location.pathname)){var t=JSON.parse(localStorage.getItem('${THEME_KEY}')||'null');if(t&&typeof t==='object'){var d=document.documentElement,w=/^[a-z]{1,12}$/;if(t.mode==='light'||t.mode==='dark')d.setAttribute('data-mode',t.mode);if(typeof t.font==='string'&&w.test(t.font)&&t.font!=='default')d.setAttribute('data-font',t.font);if(typeof t.paper==='string'&&w.test(t.paper)&&t.paper!=='none')d.setAttribute('data-paper',t.paper);if(t.motion===false)d.setAttribute('data-motion','off');if(t.v===2&&typeof t.css==='string'&&t.css&&t.css.length<60000){var s=document.createElement('style');s.id='${STYLE_ID}';s.textContent=t.css;document.head.appendChild(s);if(t.bg===true)d.setAttribute('data-bg','1');if(typeof t.skin==='string'&&w.test(t.skin))d.setAttribute('data-skin',t.skin)}}}}catch(e){}`;
