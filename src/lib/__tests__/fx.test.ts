import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, deriveTokens, fitPalette, mix, type Mode, type TokenMap } from '@/lib/themes/colors';
import { BASE_TOKENS, presetTokens } from '@/lib/themes/presets';
import { GLOW_TONES, THEME_COLORS } from '@/lib/settings';
import { SEMANTIC_TEXT } from '@/lib/themes/glow';
import { AURA_TEXT_SHARE, DEFAULT_FX, FX_NUMBER_TOKENS, FX_TOKENS, fxTokens, isDefaultFx, readFx, type FxMap, type ThemeFx } from '@/lib/themes/fx';
import { themeCss } from '@/lib/themes/css';
import { backdropColors, imageInks, specLook } from '@/lib/themes/backdrop';
import { readSpec } from '@/lib/themes/spec';
import { specLookFx } from '@/lib/theme';

const MODES: Mode[] = ['light', 'dark'];

function randomHex(seed: number): string {
  let s = seed * 7919 + 104729;
  const next = () => {
    s = (s * 7919 + 104729) % 1299709;
    return Math.floor((s / 1299709) * 256);
  };
  return `#${[next(), next(), next()].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** rgba(r, g, b, a) → [#rrggbb, a] */
function parts(v: string): [string, number] {
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(v);
  if (!m) throw new Error(`rgba 가 아니에요: ${v}`);
  return [`#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`, Number(m[4])];
}

/** 바탕 b 위 글자 기준 (원래 바탕에서 이미 모자라면 그보다 나빠지지만 않게) */
const want = (pairs: Array<[string, number]>, b: string): Array<[string, number]> => pairs.map(([c, min]) => [c, Math.min(min, contrast(c, b))]);

function expectReadable(bg: string, texts: Array<[string, number]>, label: string) {
  for (const [c, min] of texts) expect(contrast(c, bg), `${label}: ${c} on ${bg}`).toBeGreaterThanOrEqual(min - 1e-6);
}

/** 두 빛이 글자 자리에서 [가까운, 먼] 비율로 겹친 바탕 (양쪽 모두) */
function stacked(b: string, p: [string, number], q: [string, number], share: readonly [number, number]): string[] {
  const [near, far] = share;
  return [mix(mix(b, p[0], p[1] * near), q[0], q[1] * far), mix(mix(b, q[0], q[1] * near), p[0], p[1] * far)];
}

/** 꾸미기 색 칸이 약속을 지키는지: 화면 빛·카드 빛·메뉴 빛 아래 글자, 두 색 버튼·칩·메뉴 칸·+ 버튼 */
function checkFx(t: TokenMap, f: FxMap, fx: ThemeFx, mode: Mode, label: string, pageBases: string[] = []) {
  for (const k of FX_TOKENS) {
    const v = f[k];
    if (FX_NUMBER_TOKENS.includes(k)) expect(v, `${label} ${k}`).toMatch(/^[01]$/);
    else expect(v, `${label} ${k}`).toMatch(/^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,3})\))$/);
  }
  const page: Array<[string, number]> = [
    [t['--ink'], 7],
    [t['--muted'], 4.5],
  ];
  const bases = [t['--bg'], ...pageBases];
  // 화면 위·아래 빛: 글자 자리 비율로 겹쳐도 본문·흐린 글자가 읽힌다
  for (const b of bases) {
    for (const bg of stacked(b, parts(f['--aura-1']), parts(f['--aura-2']), AURA_TEXT_SHARE.top)) expectReadable(bg, want(page, b), `${label} top`);
    for (const bg of stacked(b, parts(f['--aura-3']), parts(f['--aura-4']), AURA_TEXT_SHARE.bottom)) expectReadable(bg, want(page, b), `${label} bottom`);
  }
  // 핵심 카드 안 빛: 카드 안 모든 글자 (두 색 사이 그라데이션도)
  const s = t['--surface'];
  const card: Array<[string, number]> = [
    [t['--ink'], 7],
    [t['--muted'], 4.5],
    [t['--accent'], 4.5],
    ...SEMANTIC_TEXT[mode].map((c): [string, number] => [c, 4.5]),
  ];
  const [h1, a1] = parts(f['--hero-1']);
  const [h2, a2] = parts(f['--hero-2']);
  const [n1] = AURA_TEXT_SHARE.hero;
  for (const u of [0, 0.25, 0.5, 0.75, 1]) expectReadable(mix(mix(s, h1, a1 * n1), mix(s, h2, a2 * n1), u), want(card, s), `${label} hero ${u}`);
  // 작은 카드 빛
  const [dt, da] = parts(f['--detail-tint']);
  expectReadable(mix(s, dt, da), want(card, s), `${label} detail`);
  // 두 색 버튼·고른 칩: 글자 4.5, + 버튼 아이콘 3 (그라데이션 가운데도), 아래 메뉴 고른 칸의 아이콘 3, 공부한 날 체크 3
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    expect(contrast(t['--accent-ink'], mix(t['--accent'], f['--btn-2'], u)), `${label} btn ${u}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--fab-ink'], mix(t['--fab'], f['--fab-2'], u)), `${label} fab ${u}`).toBeGreaterThanOrEqual(3);
  }
  for (const k of ['--chip-on-1', '--chip-on-2'] as const) expect(contrast(f['--chip-on-ink'], f[k]), `${label} ${k}`).toBeGreaterThanOrEqual(4.5);
  for (const k of ['--pill-1', '--pill-2'] as const) expect(contrast(t['--accent'], f[k]), `${label} ${k}`).toBeGreaterThanOrEqual(3);
  if (fx.details) expect(contrast(t['--fab-ink'], f['--bar-2']), `${label} bar-2`).toBeGreaterThanOrEqual(3);
  // 아래 메뉴 안 빛: 메뉴 바탕(비치는 정도만큼 아래가 보이는) 위 메뉴 글자
  const see = fx.tabSeeThrough / 100;
  const g1 = parts(f['--tab-glow-1']);
  const g2 = parts(f['--tab-glow-2']);
  const under = [
    ...bases.flatMap((b) => [b, mix(mix(b, parts(f['--aura-3'])[0], parts(f['--aura-3'])[1]), parts(f['--aura-4'])[0], parts(f['--aura-4'])[1])]),
    s,
  ];
  for (const b of under) {
    const base = mix(b, s, 1 - see);
    for (const bg of stacked(base, g1, g2, AURA_TEXT_SHARE.tab)) expectReadable(bg, want(page, base), `${label} tab`);
  }
}

const VARIANTS: ThemeFx[] = [
  DEFAULT_FX,
  { ...DEFAULT_FX, details: true, floatTab: true, tabSeeThrough: 60 },
  { top: false, hero: false, buttons: false, bottom: false, details: false, floatTab: false, tabSeeThrough: 0, aura: 'accent', textHalo: false },
  ...GLOW_TONES.filter((t) => t !== 'accent').map((aura): ThemeFx => ({ ...DEFAULT_FX, details: true, aura })),
];

describe('화면 꾸미기 (themes/fx.ts)', () => {
  it('기본 테마 9가지 × 밝게·어둡게 × 꾸미기: 빛 아래 글자가 읽히고 버튼·칩·메뉴 칸이 보인다', () => {
    for (const c of THEME_COLORS)
      for (const mode of MODES)
        for (const fx of [DEFAULT_FX, VARIANTS[1], VARIANTS[2]]) {
          const t = presetTokens(c, mode);
          checkFx(t, fxTokens(t, fx, mode, c), fx, mode, `${c} ${mode}`);
        }
  });

  it('내가 만든 테마 (아무 색 × 빛 색 × 꾸미기)도 같은 약속을 지킨다', () => {
    for (let i = 0; i < 400; i++)
      for (const mode of MODES) {
        const base = BASE_TOKENS[mode];
        const p = fitPalette({ bg: randomHex(i), surface: randomHex(i + 500), accent: randomHex(i + 900) }, mode, {
          bg: base['--bg'],
          surface: base['--surface'],
          accent: base['--accent'],
        });
        const t = deriveTokens(p, mode);
        const fx = VARIANTS[i % VARIANTS.length];
        checkFx(t, fxTokens(t, fx, mode, null), fx, mode, `custom ${i} ${mode}`);
      }
  });

  it('배경 그림이 있으면 그림이 비친 색 위에서도 글자가 읽힌다 (사진·무늬)', () => {
    for (let i = 0; i < 24; i++) {
      const spec = readSpec({
        light: { bg: randomHex(i + 40), surface: randomHex(i + 41), accent: randomHex(i + 42) },
        dark: { bg: randomHex(i + 43), surface: randomHex(i + 44), accent: randomHex(i + 45) },
        image: { kind: 'file', id: '0f0e0d0c-0b0a-4908-8706-050403020100' },
        dim: 0.3 + (i % 6) / 10,
        fx: VARIANTS[i % VARIANTS.length],
      });
      expect(spec).not.toBeNull();
      if (!spec) continue;
      for (const mode of MODES) {
        const look = specLookFx(spec, mode);
        const seen = backdropColors(imageInks(spec.image), spec[mode].bg, specLook(spec, mode).dim);
        expect(look.fx).toBeTruthy();
        checkFx(look.tokens, look.fx as FxMap, spec.fx, mode, `image ${i} ${mode}`, seen);
      }
    }
  });

  it('끈 꾸미기는 보이지 않는다 (빛 0, 버튼 끝 색 = 시작 색, 칩은 예전처럼 검정·흰색)', () => {
    for (const mode of MODES) {
      const t = BASE_TOKENS[mode];
      const f = fxTokens(t, VARIANTS[2], mode, 'default');
      for (const k of [
        '--aura-1',
        '--aura-2',
        '--aura-3',
        '--aura-4',
        '--hero-1',
        '--hero-2',
        '--hero-ring-1',
        '--hero-halo',
        '--tab-glow-1',
        '--tab-glow-2',
        '--tab-edge-1',
        '--detail-tint',
        '--detail-glow',
        '--chip-on-glow',
        '--tab-shadow',
        '--tab-ring-1',
      ] as const)
        expect(parts(f[k])[1], `${mode} ${k}`).toBe(0);
      expect(f['--btn-2']).toBe(t['--accent']);
      expect(f['--fab-2']).toBe(t['--fab']);
      expect([f['--chip-on-1'], f['--chip-on-2'], f['--chip-on-ink']]).toEqual([t['--ink'], t['--ink'], t['--surface']]);
      expect([f['--pill-1'], f['--pill-2']]).toEqual([t['--accent-soft'], t['--accent-soft']]);
      expect([f['--fx-detail'], f['--tab-float']]).toEqual(['0', '0']);
      expect(f['--tab-bg']).toBe(`rgba(${mode === 'light' ? '255, 255, 255' : '28, 28, 30'}, 1)`);
    }
  });

  it('기본 꾸미기는 A·B·C·D1 만 켜져 있고(글자 뒤 번짐은 없음), 예전 테마·이상한 값은 기본값으로 읽는다', () => {
    expect(DEFAULT_FX).toEqual({
      top: true,
      hero: true,
      buttons: true,
      bottom: true,
      details: false,
      floatTab: false,
      tabSeeThrough: 8,
      aura: 'accent',
      textHalo: false,
    });
    expect(readFx(undefined)).toEqual(DEFAULT_FX);
    expect(readFx({ top: 'yes', tabSeeThrough: 99, aura: 'rainbow' })).toEqual(DEFAULT_FX);
    expect(readFx({ details: true, tabSeeThrough: 40 })).toEqual({ ...DEFAULT_FX, details: true, tabSeeThrough: 40 });
    expect(isDefaultFx(DEFAULT_FX)).toBe(true);
    expect(isDefaultFx({ ...DEFAULT_FX, floatTab: true })).toBe(false);
    // 꾸미기가 없던 예전 테마
    const old = readSpec({ light: { bg: '#f2f2f7', surface: '#ffffff', accent: '#6057e7' }, dark: { bg: '#000000', surface: '#1c1c1e', accent: '#888aff' } });
    expect(old?.fx).toEqual(DEFAULT_FX);
  });

  it('테마 CSS 에 꾸미기 칸이 들어가고, 숫자 칸은 0·1 만', () => {
    const light = { tokens: BASE_TOKENS.light, image: null, dim: 0.6, fx: fxTokens(BASE_TOKENS.light, { ...DEFAULT_FX, floatTab: true }, 'light', 'default') };
    const dark = { tokens: BASE_TOKENS.dark, image: null, dim: 0.6, fx: fxTokens(BASE_TOKENS.dark, DEFAULT_FX, 'dark', 'default') };
    const css = themeCss(light, dark);
    expect(css).toContain('--tab-float:1');
    expect(css).toContain(`--aura-1:${light.fx['--aura-1']}`);
    // 이상한 값은 넣지 않는다
    const bad = themeCss({ ...light, fx: { ...light.fx, '--tab-float': '2', '--aura-1': 'red;}body{x:y' } }, dark);
    expect(bad).not.toContain('--tab-float:2');
    expect(bad).not.toContain('body{');
  });

  it('globals.css 의 기본 꾸미기 = 기본 테마(KOK)의 기본 꾸미기 (밝게·어둡게 두 곳)', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const vars = (block: string) => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const light = vars(css.slice(css.indexOf(':root {'), css.indexOf('/* 어두운 화면')));
    const darkStart = css.indexOf(":root[data-mode='dark'] {");
    const dark = vars(css.slice(darkStart, css.indexOf('}', darkStart)));
    const media = vars(css.slice(css.indexOf('@media (prefers-color-scheme: dark) {', css.indexOf('/* 어두운 화면')), darkStart));
    for (const [mode, got] of [
      ['light', light],
      ['dark', dark],
      ['dark', media],
    ] as const) {
      const f = fxTokens(BASE_TOKENS[mode], DEFAULT_FX, mode, 'default');
      for (const k of FX_TOKENS) expect(got[k], `${mode} ${k}`).toBe(f[k]);
    }
  });

  it('밝은 기본 테마도 화면 위 빛이 보일 만큼은 있다 (글자 때문에 너무 옅어지지 않게 맞춘 값)', () => {
    for (const c of THEME_COLORS) {
      const f = fxTokens(presetTokens(c, 'light'), DEFAULT_FX, 'light', c);
      expect(parts(f['--aura-1'])[1], c).toBeGreaterThanOrEqual(0.12);
      expect(parts(f['--tab-glow-1'])[1], c).toBeGreaterThanOrEqual(0.08);
    }
  });
});
