// 테마 (Pro): 화면 밝기(기기 설정·밝게·어둡게), 밝을 때·어두울 때 쓸 테마(기본 테마나 내가 만든 테마), 글꼴, 노트 종이 무늬, 배경 그림.
// 색은 두 모드의 색 칸을 모두 적은 CSS 를 <style id="kok-theme"> 에 넣어 바꾸고(src/lib/themes/css.ts),
// <html> 에는 data-mode·data-font·data-paper·data-bg 를 붙인다.
// 다음에 열 때 기본 색이 잠깐 보이지 않게 브라우저에도 적어 두고, layout 의 작은 글(THEME_BOOT)이 그리기 전에 먼저 붙인다.
import { THEME_COLORS, type ThemeColor, type ThemeFont, type ThemeMode, type ThemePaper, type UserSettings } from './settings';
import { deriveTokens, type Mode } from './themes/colors';
import { themeCss, type ModeLook } from './themes/css';
import { BASE_TOKENS, presetTokens } from './themes/presets';
import { readSpec, type ThemeSpec } from './themes/spec';

export type Theme = UserSettings['theme'];
/** 내가 만든 테마 (user_themes 행) */
export type CustomTheme = { id: string; name: string; spec: unknown };

/** 고르는 화면에 보일 이름과 색 (기본 테마의 + 버튼 색) */
export const THEME_COLOR_INFO: Record<ThemeColor, { label: string; light: string; dark: string }> = {
  default: { label: '콕 주황', light: '#eb6a0f', dark: '#ff9b45' },
  ocean: { label: '바다', light: '#2b6fe0', dark: '#7cb0ff' },
  forest: { label: '숲', light: '#2f8a43', dark: '#6ccf86' },
  lavender: { label: '라벤더', light: '#7656e0', dark: '#b8a2ff' },
  cherry: { label: '벚꽃', light: '#df3f77', dark: '#ff8db4' },
  mint: { label: '민트', light: '#119c88', dark: '#5adfc8' },
  mocha: { label: '모카', light: '#a46a34', dark: '#e2b388' },
  night: { label: '밤하늘', light: '#4552d6', dark: '#9ca6ff' },
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

/** 한 모드에 보일 모습 (없는 테마·이상한 테마는 기본 테마로) */
export function lookFor(ref: string, mode: Mode): ModeLook {
  const id = customId(ref);
  if (id) {
    const spec = known.get(id)?.spec;
    if (spec) return { tokens: deriveTokens(spec[mode], mode), image: spec.image, dim: spec.dim };
    return { tokens: presetTokens('default', mode), image: null, dim: DEFAULT_DIM };
  }
  const color = ref.slice('preset:'.length) as ThemeColor;
  return { tokens: presetTokens(THEME_COLORS.includes(color) ? color : 'default', mode), image: null, dim: DEFAULT_DIM };
}

export type ResolvedTheme = { mode: ThemeMode; light: ModeLook; dark: ModeLook; font: ThemeFont; paper: ThemePaper; plain: boolean };

export function resolveTheme(t: Theme): ResolvedTheme {
  const light = lookFor(themeRef(t, 'light'), 'light');
  const dark = lookFor(themeRef(t, 'dark'), 'dark');
  // 기본 색 그대로면 CSS 를 넣지 않는다 (globals.css 의 기본 색)
  const plain = themeRef(t, 'light') === 'preset:default' && themeRef(t, 'dark') === 'preset:default';
  return { mode: t.mode, light, dark, font: t.font, paper: t.paper, plain };
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
  if (t && missingCustomIds(t).length && !opts.allowMissing) return false;
  const r = t ? resolveTheme(t) : null;
  set('data-mode', r && r.mode !== 'system' ? r.mode : null);
  set('data-font', r && r.font !== 'default' ? r.font : null);
  set('data-paper', r && r.paper !== 'none' ? r.paper : null);
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
  if (r) loadThemeFont(r.font);
  bumpTheme();
  try {
    if (r && (css || r.mode !== 'system' || r.font !== 'default' || r.paper !== 'none')) {
      window.localStorage.setItem(THEME_KEY, JSON.stringify({ v: 2, mode: r.mode, css, font: r.font, paper: r.paper, bg }));
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
 */
export const THEME_BOOT = `try{if(/^\\/(home|library|notes|review|wrong|questions|settings|plan|admin)(\\/|$)/.test(location.pathname)){var t=JSON.parse(localStorage.getItem('${THEME_KEY}')||'null');if(t&&typeof t==='object'){var d=document.documentElement,w=/^[a-z]{1,12}$/;if(t.mode==='light'||t.mode==='dark')d.setAttribute('data-mode',t.mode);if(typeof t.font==='string'&&w.test(t.font)&&t.font!=='default')d.setAttribute('data-font',t.font);if(typeof t.paper==='string'&&w.test(t.paper)&&t.paper!=='none')d.setAttribute('data-paper',t.paper);if(t.v===2&&typeof t.css==='string'&&t.css&&t.css.length<60000){var s=document.createElement('style');s.id='${STYLE_ID}';s.textContent=t.css;document.head.appendChild(s);if(t.bg===true)d.setAttribute('data-bg','1')}}}}catch(e){}`;
