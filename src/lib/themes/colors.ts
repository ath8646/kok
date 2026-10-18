// 테마 색 계산 (화면·서버·시험이 같이 쓴다): 명암비, 섞기, 바탕·카드·포인트 색에서 나머지 색 만들기.
// 사람이 고르거나 AI 가 만든 색도 여기를 거쳐 글자가 잘 보이는 값으로 맞춘다.

export type Mode = 'light' | 'dark';
/** 테마 하나의 한 모드(밝게·어둡게) 색: 바탕, 카드, 포인트 */
export type Palette = { bg: string; surface: string; accent: string };

const HEX = /^#[0-9a-f]{6}$/;

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

/** '#ABC' · '#aabbcc' · 'aabbcc' → '#aabbcc' (알 수 없으면 null) */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX.test(s) ? s : null;
}

type Rgb = [number, number, number];

export function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const c = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG 상대 밝기 */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 명암비 (1 ~ 21) */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** a 와 b 를 t(0~1) 만큼 섞는다 */
export function mix(a: string, b: string, t: number): string {
  const p = toRgb(a);
  const q = toRgb(b);
  return toHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}

export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 글자 색 fg 를 모든 바탕 bgs 에서 명암비 min 이상이 되게 밝기만 바꾼다
 * (밝은 모드는 어둡게, 어두운 모드는 밝게). 색깔(색상·채도)은 그대로 둔다.
 */
export function ensureContrast(fg: string, bgs: string[], min: number, mode: Mode): string {
  const ok = (c: string) => bgs.every((b) => contrast(c, b) >= min);
  if (ok(fg)) return fg;
  const [h, s, l] = toHsl(fg);
  for (let i = 1; i <= 100; i++) {
    const nl = mode === 'light' ? l - (l * i) / 100 : l + ((1 - l) * i) / 100;
    const c = fromHsl(h, s, clamp(nl, 0, 1));
    if (ok(c)) return c;
  }
  return mode === 'light' ? '#000000' : '#ffffff';
}

/** 바탕·카드 색을 모드에 맞는 밝기·채도 안으로 (밝은 모드에 어두운 바탕이 오지 않게) */
export function fitSurface(hex: string, mode: Mode, kind: 'bg' | 'surface'): string {
  const [h, s, l] = toHsl(hex);
  if (mode === 'light') {
    const [lo, hi] = kind === 'bg' ? [0.9, 0.98] : [0.96, 1];
    return fromHsl(h, Math.min(s, 0.45), clamp(l, lo, hi));
  }
  const [lo, hi] = kind === 'bg' ? [0, 0.09] : [0.07, 0.17];
  return fromHsl(h, Math.min(s, 0.35), clamp(l, lo, hi));
}

/** 사람이 고르거나 AI 가 만든 색을 쓸 수 있는 색으로 맞춘다 (모르는 값은 fallback) */
export function fitPalette(p: Partial<Record<keyof Palette, unknown>> | null | undefined, mode: Mode, fallback: Palette): Palette {
  const bg = fitSurface(normalizeHex(p?.bg) ?? fallback.bg, mode, 'bg');
  const surface = fitSurface(normalizeHex(p?.surface) ?? fallback.surface, mode, 'surface');
  const accent = normalizeHex(p?.accent) ?? fallback.accent;
  return { bg, surface, accent };
}

const INK: Record<Mode, { ink: string; muted: string }> = {
  light: { ink: '#17171a', muted: '#6b6b74' },
  dark: { ink: '#f2f2f4', muted: '#9c9ca6' },
};

/** 버튼 위 글자: 흰색과 검은색 중 더 잘 보이는 쪽 */
export function onColor(bg: string): string {
  return contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111';
}

/** 화면에 쓰는 색 칸 이름 (테마가 바꾸는 것) */
export const CORE_TOKENS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--surface-3',
  '--raised',
  '--line',
  '--ink',
  '--muted',
  '--accent',
  '--accent-soft',
  '--accent-ink',
  '--fab',
  '--fab-ink',
  '--paper-line',
  '--paper-dot',
] as const;
export type CoreToken = (typeof CORE_TOKENS)[number];
export type TokenMap = Record<CoreToken, string>;

/**
 * 바탕·카드·포인트 색에서 화면에 쓰는 색 칸(--bg, --surface …)을 모두 만든다.
 * 글자(포인트 글자 포함)는 바탕·카드·연한 포인트 바탕 위에서 명암비 4.5 이상(본문 글자는 7 이상), 버튼 글자도 4.5 이상,
 * + 버튼은 아이콘과 바탕 모두 3 이상이 되게 맞춘다.
 * backdrops: 배경 그림이 있을 때 화면 바탕 대신 글자 밑에 올 수 있는 색들 (src/lib/themes/backdrop.ts). 여기서도 4.5 이상.
 */
export function deriveTokens(p: Palette, mode: Mode, backdrops: string[] = []): TokenMap {
  const light = mode === 'light';
  const base = INK[mode];
  const { bg, surface } = p;
  const surface2 = mix(surface, base.ink, light ? 0.06 : 0.07);
  const surface3 = mix(surface, base.ink, light ? 0.1 : 0.12);
  const line = mix(surface, base.ink, light ? 0.11 : 0.09);
  const raised = light ? surface : mix(surface, base.ink, 0.16);
  const ink = ensureContrast(ensureContrast(base.ink, [bg, surface, surface2], 7, mode), backdrops, 4.5, mode);
  const muted = ensureContrast(base.muted, [bg, surface, surface2, ...backdrops], 4.5, mode);
  const softRaw = mix(surface, p.accent, light ? 0.1 : 0.2);
  // 글자로 쓰는 포인트 색: 바탕·카드·연한 포인트 바탕(·그림 위) 모두에서 4.5 이상
  const accent = ensureContrast(p.accent, [bg, surface, softRaw, ...backdrops], 4.5, mode);
  const accentSoft = softRaw;
  // 버튼: 포인트 색 바탕 위 글자가 4.5 이상 (안 되면 포인트 색을 더 진하게·밝게)
  let accentInk = onColor(accent);
  const button = contrast(accentInk, accent) >= 4.5 ? accent : ensureContrast(accent, [accentInk], 4.5, mode);
  accentInk = onColor(button);
  // + 버튼은 고른 색 그대로가 예쁘다: 아이콘이 3 이상이고 바탕(·그림 위)과도 3 이상 차이 나면 그대로, 아니면 글자용 포인트 색
  const fabOk = (c: string) => contrast(onColor(c), c) >= 3 && [bg, ...backdrops].every((b) => contrast(c, b) >= 3);
  const fab = fabOk(p.accent) ? p.accent : button;
  return {
    '--bg': bg,
    '--surface': surface,
    '--surface-2': surface2,
    '--surface-3': surface3,
    '--raised': raised,
    '--line': line,
    '--ink': ink,
    '--muted': muted,
    '--accent': button,
    '--accent-soft': accentSoft,
    '--accent-ink': accentInk,
    '--fab': fab,
    '--fab-ink': onColor(fab),
    '--paper-line': light ? 'rgba(40, 60, 110, 0.085)' : 'rgba(255, 255, 255, 0.07)',
    '--paper-dot': light ? 'rgba(40, 60, 110, 0.2)' : 'rgba(255, 255, 255, 0.16)',
  };
}
