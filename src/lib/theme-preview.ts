// 테마 만들기 화면(ThemeStudio)의 미리보기: 같은 앱의 /theme-preview 를 iframe 으로 띄워 실제 화면과 같은 CSS(카드·버튼·시그니처 모양)로 그린다.
// iframe 은 제 문서라 바깥(지금 쓰는 테마)과 섞이지 않는다. 바깥 → 안: 테마 CSS·<html> 속성·보여 줄 화면·강조할 곳,
// 안 → 바깥: 다 실렸음(ready)·누른 곳(pick). 같은 출처(origin)의 메시지만 받는다.
import type { ThemeFont, ThemePaper } from './settings';
import type { SkinId } from './themes/skins';

/** 미리보기에서 누르거나 강조할 수 있는 곳 */
export const PREVIEW_PARTS = ['page', 'title', 'hero', 'button', 'chips', 'cards', 'star', 'tabbar', 'fab', 'note'] as const;
export type PreviewPart = (typeof PREVIEW_PARTS)[number];

/** 미리보기 화면 */
export type PreviewScreen = 'home' | 'note';

export type PreviewState = {
  /** themeCss 로 만든 테마 CSS (이 앱이 만든 것만) */
  css: string;
  mode: 'light' | 'dark';
  font: ThemeFont;
  paper: ThemePaper;
  skin: SkinId | null;
  motion: boolean;
  /** 배경 그림이 있는지 (data-bg) */
  bg: boolean;
  screen: PreviewScreen;
  /** 강조할 곳 (없으면 null) */
  highlight: PreviewPart | null;
};

export type ToPreview = { kind: 'kok-preview'; state: PreviewState };
export type FromPreview = { kind: 'kok-preview-ready' } | { kind: 'kok-preview-pick'; part: PreviewPart };

export function isPreviewPart(v: unknown): v is PreviewPart {
  return typeof v === 'string' && (PREVIEW_PARTS as readonly string[]).includes(v);
}

/** 미리보기(iframe)가 보낸 메시지인지: 같은 출처, 그 iframe 에서 온 것만 */
export function readFromPreview(e: MessageEvent, frame: HTMLIFrameElement | null): FromPreview | null {
  if (typeof window === 'undefined' || e.origin !== window.location.origin || !frame || e.source !== frame.contentWindow) return null;
  const d = e.data as { kind?: unknown; part?: unknown } | null;
  if (!d || typeof d !== 'object') return null;
  if (d.kind === 'kok-preview-ready') return { kind: 'kok-preview-ready' };
  if (d.kind === 'kok-preview-pick' && isPreviewPart(d.part)) return { kind: 'kok-preview-pick', part: d.part };
  return null;
}

/** 바깥(테마 만들기 화면)이 보낸 메시지인지: 같은 출처, 부모 창에서 온 것만 */
export function readToPreview(e: MessageEvent): PreviewState | null {
  if (typeof window === 'undefined' || e.origin !== window.location.origin || e.source !== window.parent || window.parent === window) return null;
  const d = e.data as { kind?: unknown; state?: Partial<PreviewState> } | null;
  if (!d || d.kind !== 'kok-preview' || !d.state || typeof d.state.css !== 'string' || d.state.css.length > 80_000) return null;
  const s = d.state;
  return {
    css: s.css as string,
    mode: s.mode === 'dark' ? 'dark' : 'light',
    font: (['default', 'round', 'hand', 'serif'] as const).includes(s.font as ThemeFont) ? (s.font as ThemeFont) : 'default',
    paper: (['none', 'lined', 'grid', 'dots'] as const).includes(s.paper as ThemePaper) ? (s.paper as ThemePaper) : 'none',
    skin: typeof s.skin === 'string' && /^[a-z]{1,12}$/.test(s.skin) ? (s.skin as SkinId) : null,
    motion: s.motion !== false,
    bg: s.bg === true,
    screen: s.screen === 'note' ? 'note' : 'home',
    highlight: isPreviewPart(s.highlight) ? s.highlight : null,
  };
}
