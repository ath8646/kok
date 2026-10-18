// 테마 (Pro): 포인트 색, 글꼴, 노트 종이 무늬. <html> 에 data-theme·data-font·data-paper 를 붙이면 globals.css 가 바꾼다.
// 다음에 열 때 기본 색이 잠깐 보이지 않게 브라우저에도 적어 두고, layout 의 작은 글(THEME_BOOT)이 먼저 붙인다.
import type { ThemeColor, ThemeFont, ThemePaper, UserSettings } from './settings';

export type Theme = UserSettings['theme'];

/** 고르는 화면에 보일 이름과 색 (globals.css 의 --accent 와 같은 값) */
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

export const THEME_KEY = 'kok:theme';

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

/** 테마를 화면에 붙인다. null 이면 기본으로 (Pro 가 끝났을 때 등) */
export function applyTheme(t: Theme | null): void {
  if (typeof document === 'undefined') return;
  const d = document.documentElement;
  const set = (name: string, v: string | null) => (v ? d.setAttribute(name, v) : d.removeAttribute(name));
  set('data-theme', t && t.color !== 'default' ? t.color : null);
  set('data-font', t && t.font !== 'default' ? t.font : null);
  set('data-paper', t && t.paper !== 'none' ? t.paper : null);
  if (t) loadThemeFont(t.font);
  try {
    if (t && (t.color !== 'default' || t.font !== 'default' || t.paper !== 'none')) window.localStorage.setItem(THEME_KEY, JSON.stringify(t));
    else window.localStorage.removeItem(THEME_KEY);
  } catch {
    // 저장이 막힌 브라우저: 다음에 열 때 잠깐 기본 색으로 보일 뿐이다
  }
}

/** 로그아웃·탈퇴할 때: 이 기기에 적어 둔 테마를 지운다 */
export function clearTheme(): void {
  applyTheme(null);
}

/**
 * <head> 에서 화면을 그리기 전에 도는 짧은 글: 로그인한 화면이면 적어 둔 테마를 먼저 붙인다.
 * 값은 속성에만 넣으므로(setAttribute) 이상한 값이 와도 아무 일도 하지 않는다.
 */
export const THEME_BOOT = `try{if(/^\\/(home|library|notes|review|wrong|questions|settings|plan|admin)(\\/|$)/.test(location.pathname)){var t=JSON.parse(localStorage.getItem('${THEME_KEY}')||'null');if(t&&typeof t==='object'){var d=document.documentElement;if(typeof t.color==='string'&&t.color!=='default')d.setAttribute('data-theme',t.color);if(typeof t.font==='string'&&t.font!=='default')d.setAttribute('data-font',t.font);if(typeof t.paper==='string'&&t.paper!=='none')d.setAttribute('data-paper',t.paper)}}}catch(e){}`;
