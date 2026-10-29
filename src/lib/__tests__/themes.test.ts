import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, deriveTokens, fitPalette, mix, normalizeHex, toRgb, CORE_TOKENS, type Mode, type TokenMap } from '@/lib/themes/colors';
import { BASE_TOKENS, presetTokens } from '@/lib/themes/presets';
import { readSpec, zThemeSpec } from '@/lib/themes/spec';
import { imageCss, themeCss } from '@/lib/themes/css';
import { CODE_PATTERNS, codePatternSvg, patternInks, sanitizePatternSvg } from '@/lib/themes/pattern';
import { backdropColors, imageInks, specLook } from '@/lib/themes/backdrop';
import { classifyCfError } from '@/lib/themes/cf-errors';
import { sniffImage } from '@/lib/themes/image-sniff';
import { DEFAULT_GLOW, GLOW_TONES, THEME_COLORS, zUserSettings } from '@/lib/settings';
import { BRANCH_TEXT, GLOW_TOKENS, SEMANTIC_TEXT, glowPair, glowTokens, type GlowMap } from '@/lib/themes/glow';
import { customIds, lookFor, rememberCustomThemes, resolveTheme, themeRef, type Theme } from '@/lib/theme';

const MODES: Mode[] = ['light', 'dark'];

/** 같은 seed 면 같은 색 */
function randomHex(seed: number): string {
  let s = seed * 9301 + 49297;
  const next = () => {
    s = (s * 9301 + 49297) % 233280;
    return Math.floor((s / 233280) * 256);
  };
  return `#${[next(), next(), next()].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

describe('테마 색: 어떤 색을 골라도 글자가 잘 보인다', () => {
  it('바탕·카드·포인트를 아무렇게나 골라도 명암비를 지킨다', () => {
    for (let i = 0; i < 300; i++) {
      for (const mode of MODES) {
        const base = BASE_TOKENS[mode];
        const p = fitPalette({ bg: randomHex(i), surface: randomHex(i + 1000), accent: randomHex(i + 2000) }, mode, {
          bg: base['--bg'],
          surface: base['--surface'],
          accent: base['--accent'],
        });
        const t = deriveTokens(p, mode);
        for (const k of CORE_TOKENS) expect(t[k], `${mode} ${k}`).toBeTruthy();
        for (const bg of [t['--bg'], t['--surface'], t['--surface-2']]) {
          expect(contrast(t['--ink'], bg), `ink ${mode} ${i}`).toBeGreaterThanOrEqual(7);
          expect(contrast(t['--muted'], bg), `muted ${mode} ${i}`).toBeGreaterThanOrEqual(4.5);
        }
        for (const bg of [t['--bg'], t['--surface'], t['--accent-soft']]) {
          expect(contrast(t['--accent'], bg), `accent ${mode} ${i} ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(t['--accent-ink'], t['--accent']), `accent-ink ${mode} ${i}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--fab-ink'], t['--fab']), `fab-ink ${mode} ${i}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('밝은 모드에 어두운 바탕을 고르면 밝게, 어두운 모드에 흰 바탕을 고르면 어둡게 맞춘다', () => {
    const light = fitPalette({ bg: '#101010', surface: '#202020', accent: '#ff0000' }, 'light', { bg: '#ffffff', surface: '#ffffff', accent: '#000000' });
    expect(contrast(light.bg, '#000000')).toBeGreaterThan(15);
    const dark = fitPalette({ bg: '#ffffff', surface: '#fafafa', accent: '#ff0000' }, 'dark', { bg: '#000000', surface: '#000000', accent: '#ffffff' });
    expect(contrast(dark.bg, '#ffffff')).toBeGreaterThan(15);
  });

  it('색 글은 #rrggbb 로 (모르는 값은 null)', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('1a5fc2')).toBe('#1a5fc2');
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#12345g')).toBeNull();
    expect(normalizeHex('#1a5fc2;}body{display:none')).toBeNull();
  });
});

describe('기본 테마', () => {
  it('모든 테마가 두 모드의 모든 칸을 적는다', () => {
    for (const c of THEME_COLORS)
      for (const mode of MODES) {
        const t = presetTokens(c, mode);
        for (const k of CORE_TOKENS) expect(t[k], `${c} ${mode} ${k}`).toMatch(/^(#[0-9a-f]{6}|rgba\(.+\))$/);
      }
  });

  it('글자로 쓰는 포인트 색은 바탕·카드·연한 포인트 바탕에서 4.5 이상', () => {
    for (const c of THEME_COLORS)
      for (const mode of MODES) {
        const t = presetTokens(c, mode);
        for (const bg of [t['--bg'], t['--surface'], t['--accent-soft']]) expect(contrast(t['--accent'], bg), `${c} ${mode}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--accent-ink'], t['--accent']), `${c} ${mode} button`).toBeGreaterThanOrEqual(4.5);
      }
  });

  it('본문 글자는 7 이상, 흐린 글자는 4.5 이상 (바탕·카드·회색 칸), + 버튼 아이콘은 3 이상', () => {
    for (const c of THEME_COLORS)
      for (const mode of MODES) {
        const t = presetTokens(c, mode);
        for (const bg of [t['--bg'], t['--surface'], t['--surface-2']]) {
          expect(contrast(t['--ink'], bg), `${c} ${mode} ink`).toBeGreaterThanOrEqual(7);
          expect(contrast(t['--muted'], bg), `${c} ${mode} muted`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(t['--fab-ink'], t['--fab']), `${c} ${mode} fab`).toBeGreaterThanOrEqual(3);
      }
  });

  it('초록·빨강·주황 글자는 카드·바탕·회색 칸에서 4.5 이상', () => {
    for (const c of THEME_COLORS)
      for (const mode of MODES) {
        const t = presetTokens(c, mode);
        for (const ink of SEMANTIC_TEXT[mode])
          for (const bg of [t['--bg'], t['--surface'], t['--surface-2']]) expect(contrast(ink, bg), `${c} ${mode} ${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
  });
});

/** globals.css 의 한 블록에서 '--이름: 값' 을 읽는다 */
function cssVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe('globals.css 의 기본 색 = 기본 테마(KOK) + 기본 별표 빛', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const light = cssVars(css.slice(css.indexOf(':root {'), css.indexOf('/* 어두운 화면')));
  const darkStart = css.indexOf(":root[data-mode='dark'] {");
  const dark = cssVars(css.slice(darkStart, css.indexOf('}', darkStart)));
  const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark) {', css.indexOf('/* 어두운 화면')), darkStart);
  const both = { light, dark };

  it('색 칸이 기본 테마와 같다 (밝게·어둡게, 어두운 화면 두 곳 모두)', () => {
    for (const mode of MODES) for (const k of CORE_TOKENS) expect(both[mode][k], `${mode} ${k}`).toBe(BASE_TOKENS[mode][k]);
    expect(cssVars(media)).toEqual(dark);
  });

  it('별표 빛 칸이 기본 빛(골드, 60)과 같다', () => {
    for (const mode of MODES) {
      const g = glowTokens(BASE_TOKENS[mode], DEFAULT_GLOW, mode);
      for (const k of GLOW_TOKENS) expect(both[mode][k], `${mode} ${k}`).toBe(g[k]);
    }
  });

  it('가지·과목 색(--b1~8)은 글자로도 쓰니 모든 기본 테마의 바탕·카드·회색 칸과 연한 제 색 위에서 4.5 이상', () => {
    for (const mode of MODES)
      for (let i = 1; i <= 8; i++) {
        const b = both[mode][`--b${i}`];
        expect(b, `${mode} --b${i}`).toMatch(/^#[0-9a-f]{6}$/);
        for (const c of THEME_COLORS) {
          const t = presetTokens(c, mode);
          for (const bg of [t['--bg'], t['--surface'], t['--surface-2'], mix(t['--surface'], b, 0.15)])
            expect(contrast(b, bg), `${mode} --b${i} on ${c} ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
  });

  it('초록·빨강·주황 글자가 glow.ts 의 SEMANTIC_TEXT 와 같다', () => {
    for (const mode of MODES) expect([both[mode]['--ok'], both[mode]['--bad'], both[mode]['--warn']]).toEqual([...SEMANTIC_TEXT[mode]]);
  });

  it('가지·과목 색이 glow.ts 의 BRANCH_TEXT 와 같다 (시그니처 테마가 이 색으로 바탕을 맞춘다)', () => {
    for (const mode of MODES) expect([1, 2, 3, 4, 5, 6, 7, 8].map((i) => both[mode][`--b${i}`])).toEqual([...BRANCH_TEXT[mode]]);
  });
});

/** rgba(r, g, b, a) → [#rrggbb, a] */
function rgbaParts(v: string): [string, number] {
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(v);
  if (!m) throw new Error(`rgba 가 아니에요: ${v}`);
  const hex = `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
  return [hex, Number(m[4])];
}

/** 카드 안 빛 위에서 글자가 읽히는지: 두 끝과 그 사이(그라데이션) 모두 */
function checkGlowText(t: TokenMap, g: GlowMap, mode: Mode, label: string) {
  const [c1, a1] = rgbaParts(g['--glow-1']);
  const [c2, a2] = rgbaParts(g['--glow-2']);
  const p = mix(t['--surface'], c1, a1);
  const q = mix(t['--surface'], c2, a2);
  const texts: Array<[string, number]> = [
    [t['--ink'], 7],
    [t['--muted'], 4.5],
    [t['--accent'], 4.5],
    ...SEMANTIC_TEXT[mode].map((c): [string, number] => [c, 4.5]),
  ];
  for (const u of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]) {
    const bg = mix(p, q, u);
    for (const [ink, min] of texts) {
      const need = Math.min(min, contrast(ink, t['--surface']));
      expect(contrast(ink, bg), `${label} ${ink} on ${bg}`).toBeGreaterThanOrEqual(need - 0.02);
    }
  }
}

describe('별표 빛', () => {
  it('모든 테마·모드·빛·세기에서 카드 안 글자가 읽히고, 별 테두리는 3 이상, 번호 글자는 두 색 위에서 4.5 이상', () => {
    for (const c of THEME_COLORS)
      for (const mode of MODES)
        for (const tone of GLOW_TONES)
          for (const strength of [0, 25, 60, 100]) {
            const t = presetTokens(c, mode);
            const g = glowTokens(t, { tone, strength }, mode);
            const label = `${c} ${mode} ${tone} ${strength}`;
            for (const k of GLOW_TOKENS) expect(g[k], `${label} ${k}`).toMatch(/^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,3})\))$/);
            checkGlowText(t, g, mode, label);
            // 별은 빛이 가장 진한 자리에 앉는다: 맨 카드와 물든 자리 모두에서 별 테두리 3 이상
            const [c1, a1] = rgbaParts(g['--glow-1']);
            const [c2, a2] = rgbaParts(g['--glow-2']);
            for (const bg of [t['--surface'], mix(t['--surface'], c1, a1), mix(t['--surface'], c2, a2)])
              expect(contrast(g['--glow-star-edge'], bg), `${label} edge on ${bg}`).toBeGreaterThanOrEqual(3);
            for (const stop of [g['--glow-star-1'], g['--glow-star-2']])
              expect(contrast(g['--glow-on'], stop), `${label} on ${stop}`).toBeGreaterThanOrEqual(4.5);
          }
  });

  it('내가 만든 테마(아무 색)에서도 카드 안 글자가 읽힌다', () => {
    for (let i = 0; i < 120; i++)
      for (const mode of MODES) {
        const base = BASE_TOKENS[mode];
        const p = fitPalette({ bg: randomHex(i + 31), surface: randomHex(i + 1031), accent: randomHex(i + 2031) }, mode, {
          bg: base['--bg'],
          surface: base['--surface'],
          accent: base['--accent'],
        });
        const t = deriveTokens(p, mode);
        const tone = GLOW_TONES[i % GLOW_TONES.length];
        const g = glowTokens(t, { tone, strength: 100 }, mode);
        checkGlowText(t, g, mode, `custom ${i} ${mode} ${tone}`);
        for (const stop of [g['--glow-star-1'], g['--glow-star-2']])
          expect(contrast(g['--glow-on'], stop), `custom ${i} ${mode} ${tone} on`).toBeGreaterThanOrEqual(4.5);
      }
  });

  it('세기 0 이면 빛이 모두 투명하고 (별만), 세기가 크면 더 진하다', () => {
    const t = presetTokens('default', 'light');
    const off = glowTokens(t, { tone: 'aurora', strength: 0 }, 'light');
    for (const k of ['--glow-1', '--glow-2', '--glow-ring-1', '--glow-ring-2', '--glow-halo'] as const) expect(off[k].endsWith(', 0)'), k).toBe(true);
    const soft = glowTokens(t, { tone: 'aurora', strength: 30 }, 'light');
    const strong = glowTokens(t, { tone: 'aurora', strength: 90 }, 'light');
    expect(rgbaParts(strong['--glow-1'])[1]).toBeGreaterThan(rgbaParts(soft['--glow-1'])[1]);
    expect(rgbaParts(strong['--glow-ring-2'])[1]).toBeGreaterThan(rgbaParts(soft['--glow-ring-2'])[1]);
    expect(rgbaParts(strong['--glow-halo'])[1]).toBeGreaterThan(rgbaParts(soft['--glow-halo'])[1]);
  });

  it("'테마 색' 빛은 라임 테마의 검정 버튼 대신 라임을 쓴다", () => {
    const [, c2] = glowPair('accent', presetTokens('forest', 'light'));
    expect(toRgb(c2)[1]).toBeGreaterThan(200);
  });

  it('예전 설정(빛 없음)·이상한 값은 기본 빛으로 읽는다', () => {
    const old = zUserSettings.parse({ theme: { color: 'ocean', font: 'default', paper: 'none', mode: 'system', light: null, dark: null } });
    expect(old.theme.glow).toEqual(DEFAULT_GLOW);
    expect(old.theme.color).toBe('ocean');
    const odd = zUserSettings.parse({ theme: { color: 'nope', glow: { tone: 'rainbow', strength: 400 } } });
    expect(odd.theme.color).toBe('default');
    expect(odd.theme.glow).toEqual(DEFAULT_GLOW);
    expect(zUserSettings.parse({ theme: { glow: { tone: 'berry', strength: 35 } } }).theme.glow).toEqual({ tone: 'berry', strength: 35 });
  });
});

const goodSpec = {
  light: { bg: '#f6f2ed', surface: '#ffffff', accent: '#8a5524' },
  dark: { bg: '#0b0806', surface: '#17140f', accent: '#e2b388' },
  image: null,
  dim: 0.5,
};

describe('내가 만든 테마의 모양 (서버가 저장할 때·화면이 읽을 때)', () => {
  it('올바른 테마는 그대로, 빠진 칸은 기본값', () => {
    const s = zThemeSpec.parse({ ...goodSpec, dim: undefined });
    expect(s.dim).toBe(0.6);
    expect(s.font).toBeNull();
    expect(s.light.accent).toBe('#8a5524');
  });

  it('이상한 색·그림·덮기 정도는 받지 않는다', () => {
    expect(zThemeSpec.safeParse({ ...goodSpec, light: { ...goodSpec.light, accent: 'red;}' } }).success).toBe(false);
    expect(zThemeSpec.safeParse({ ...goodSpec, image: { kind: 'file', id: '../../etc/passwd' } }).success).toBe(false);
    expect(zThemeSpec.safeParse({ ...goodSpec, image: { kind: 'url', url: 'https://evil.example/x.png' } }).success).toBe(false);
    expect(zThemeSpec.safeParse({ ...goodSpec, dim: 5 }).success).toBe(false);
    expect(zThemeSpec.safeParse({ ...goodSpec, image: { kind: 'pattern', svg: '<script>alert(1)</script>' } }).success).toBe(false);
  });

  it('무늬는 깨끗하게 다시 만든 SVG 로 저장한다', () => {
    const s = zThemeSpec.parse({
      ...goodSpec,
      image: { kind: 'pattern', svg: '<svg width="10"><circle cx="10" cy="10" r="4" fill="#AABBCC" onload="alert(1)"/><script>x</script></svg>' },
    });
    expect(s.image?.kind).toBe('pattern');
    const svg = s.image && s.image.kind === 'pattern' ? s.image.svg : '';
    expect(svg).toContain('<circle cx="10" cy="10" r="4" fill="#aabbcc"/>');
    expect(svg).not.toMatch(/script|onload|alert/);
  });

  it('읽을 때는 모드에 맞는 색으로 다시 맞춘다 (DB 에 이상한 값이 있어도)', () => {
    expect(readSpec({ ...goodSpec, light: { bg: '#000000', surface: '#000000', accent: '#ffffff' } })?.light.bg).not.toBe('#000000');
    expect(readSpec({ nope: true })).toBeNull();
    expect(readSpec(null)).toBeNull();
  });
});

describe('테마 CSS', () => {
  const look = (mode: Mode, image: Parameters<typeof imageCss>[0] = null) => ({ tokens: presetTokens('ocean', mode), image, dim: 0.5 });

  it('두 모드를 모두 적고, data-mode 를 따른다', () => {
    const css = themeCss(look('light'), look('dark'));
    expect(css).toContain(':root:root{--bg:#f2f2f7');
    expect(css).toContain('@media (prefers-color-scheme: dark){:root:root:not([data-mode=light]){');
    expect(css).toContain(':root:root[data-mode=dark]{');
    expect(css).toContain('--accent:#0168db');
    expect(css).toContain('--accent:#4da3ff');
    expect(css).not.toContain('--glow-');
  });

  it('별표 빛이 있으면 두 모드 모두 빛 칸을 적는다', () => {
    const withGlow = (mode: Mode) => ({ ...look(mode), glow: glowTokens(presetTokens('ocean', mode), { tone: 'berry', strength: 80 }, mode) });
    const css = themeCss(withGlow('light'), withGlow('dark'));
    for (const k of GLOW_TOKENS) expect(css.split(`${k}:`).length - 1, k).toBe(3);
    const bad = { ...withGlow('light'), glow: { ...withGlow('light').glow, '--glow-1': 'red;}body{display:none' } };
    expect(themeCss(bad, withGlow('dark'))).not.toContain('display:none');
  });

  it('색 칸에는 검사한 값만 들어간다 (CSS 를 깨는 글은 빠진다)', () => {
    const bad = { ...presetTokens('default', 'light'), '--accent': '#fff;}body{display:none' };
    const css = themeCss({ tokens: bad, image: null, dim: 0.5 }, look('dark'));
    expect(css).not.toContain('display:none');
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
  });

  it('그림 주소: 올린 그림은 우리 서버 주소, 무늬는 data 주소, 이상한 번호는 none', () => {
    expect(imageCss({ kind: 'file', id: '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b' })).toBe('url("/api/themes/images/0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b")');
    expect(imageCss({ kind: 'file', id: 'x") ; } body {' })).toBe('none');
    const p = imageCss({ kind: 'pattern', svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>' });
    expect(p.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(p.slice(5, -2)).not.toContain('"');
    const css = themeCss(look('light', { kind: 'pattern', svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>' }), look('dark'));
    expect(css).toContain('--theme-image-repeat:repeat');
    expect(css).toContain('--theme-image-size:240px');
  });
});

describe('배경 무늬 SVG 거르기', () => {
  it('허락한 모양만 남기고 스크립트·링크·글자·외부 그림은 뺀다', () => {
    const svg = sanitizePatternSvg(
      `<svg viewBox="0 0 10 10"><!-- <script>bad()</script> --><g transform="rotate(10 5 5)"><rect x="1" y="1" width="4" height="4" fill="#123456" style="x"/><text>hi</text><image href="https://x"/><path d="M0 0 L5 5" stroke="#abc" onclick="x()"/></g><foreignObject><div>x</div></foreignObject></svg>`,
    )!;
    expect(svg).toBeTruthy();
    expect(svg).toContain('<rect x="1" y="1" width="4" height="4" fill="#123456"/>');
    expect(svg).toContain('<path d="M0 0 L5 5" stroke="#abc"/>');
    expect(svg).not.toMatch(/script|text|image|href|onclick|foreignObject|style|div/i);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"')).toBe(true);
  });

  it('색이 틀린 모양은 빼고 (검게 그려지지 않게), 모양이 하나도 없으면 null', () => {
    expect(sanitizePatternSvg('<svg><circle r="3" fill="url(#g)"/></svg>')).toBeNull();
    expect(sanitizePatternSvg('<svg><circle r="3" fill="url(#g)"/><circle r="2" fill="#ffffff"/></svg>')).toContain('<circle r="2" fill="#ffffff"/>');
    expect(sanitizePatternSvg('no svg here')).toBeNull();
    expect(sanitizePatternSvg('<svg><svg><circle r="1"/></svg></svg>')).toBeNull();
    expect(sanitizePatternSvg('<svg><circle r="1"/>')).toBeNull();
    expect(sanitizePatternSvg('<svg>' + '<circle r="1"/>'.repeat(2000) + '</svg>')).toBeNull();
  });

  it('코드로 만든 무늬는 모두 거르기를 그대로 통과한다', () => {
    for (const k of CODE_PATTERNS) {
      const svg = codePatternSvg(k, '#1a5fc2', '#ffd93d', 7);
      expect(sanitizePatternSvg(svg), k).toBe(svg);
    }
  });
});

describe('그림 파일 확인 (앞부분 바이트)', () => {
  it('PNG·JPEG·WebP 의 크기를 읽고, 그 밖은 null', () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58]);
    expect(sniffImage(png)).toEqual({ mime: 'image/png', width: 800, height: 600 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(jpg)).toEqual({ mime: 'image/jpeg', width: 640, height: 480 });
    const webp = new Uint8Array(32);
    webp.set(
      [...'RIFF'].map((c) => c.charCodeAt(0)),
      0,
    );
    webp.set(
      [...'WEBPVP8X'].map((c) => c.charCodeAt(0)),
      8,
    );
    webp.set([0x1f, 0x03, 0x00, 0x57, 0x02, 0x00], 24);
    expect(sniffImage(webp)).toEqual({ mime: 'image/webp', width: 800, height: 600 });
    expect(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe('밝을 때·어두울 때 테마 고르기', () => {
  const base: Theme = { color: 'ocean', font: 'default', paper: 'none', mode: 'system', light: null, dark: null, glow: { ...DEFAULT_GLOW }, motion: true };
  const id = '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b';

  it('따로 고르지 않았으면 예전 한 가지 테마를 두 모드에 쓴다', () => {
    expect(themeRef(base, 'light')).toBe('preset:ocean');
    expect(themeRef(base, 'dark')).toBe('preset:ocean');
    expect(themeRef({ ...base, dark: 'preset:night' }, 'dark')).toBe('preset:night');
    expect(customIds({ ...base, light: `custom:${id}`, dark: `custom:${id}` })).toEqual([id]);
  });

  it('내가 만든 테마는 읽어 온 뒤에 쓰고, 지워진 테마는 기본 색', () => {
    const t = { ...base, dark: `custom:${id}` };
    expect(lookFor(`custom:${id}`, 'dark').tokens['--accent']).toBe(presetTokens('default', 'dark')['--accent']);
    rememberCustomThemes([{ id, name: '모카', spec: goodSpec }]);
    const r = resolveTheme(t);
    expect(r.dark.tokens['--bg']).not.toBe(BASE_TOKENS.dark['--bg']);
    expect(r.light.tokens['--accent']).toBe('#0168db');
    expect(r.plain).toBe(false);
    expect(resolveTheme({ ...base, color: 'default' }).plain).toBe(true);
    // 별표 빛만 바꿔도 테마 CSS 를 넣는다 (빛 칸은 두 모드 모두)
    const glowOnly = resolveTheme({ ...base, color: 'default', glow: { tone: 'ocean', strength: 40 } });
    expect(glowOnly.plain).toBe(false);
    expect(glowOnly.dark.glow?.['--glow-star-2']).toBe('#4a86ff');
  });

  it('시그니처 테마: 두 모드에 같게 쓰면 그 테마의 밝기·모양, 따로 고르면 비슷한 기본 테마 색', () => {
    const neon = resolveTheme({ ...base, mode: 'light', light: 'skin:neon', dark: 'skin:neon' });
    expect(neon.skin).toBe('neon');
    expect(neon.mode).toBe('dark');
    expect(neon.light).toBe(neon.dark);
    expect(neon.dark.skin?.id).toBe('neon');
    expect(neon.dark.glow).toBeDefined();
    const brutal = resolveTheme({ ...base, mode: 'dark', light: 'skin:brutal', dark: 'skin:brutal' });
    expect(brutal.mode).toBe('light');
    // 따로 고르면 시그니처 모습은 그 테마의 밝기 쪽에서도 쓰지 않는다 (모양은 한 가지라서)
    const mixed = resolveTheme({ ...base, light: 'preset:mint', dark: 'skin:neon' });
    expect(mixed.skin).toBeNull();
    expect(mixed.mode).toBe('system');
    // 다른 밝기 쪽은 비슷한 기본 테마 (네온 → 핑크)
    expect(lookFor('skin:neon', 'light').tokens['--accent']).toBe(presetTokens('cherry', 'light')['--accent']);
    // 움직임을 끈 설정
    expect(resolveTheme({ ...base, motion: false }).motion).toBe(false);
  });

  it('시그니처 테마로 만든 내 테마는 그 색으로, 예전 설정(움직임 없음)은 움직임 켬', () => {
    const sid = '1b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b';
    rememberCustomThemes([{ id: sid, name: '내 네온', spec: { ...goodSpec, skin: { id: 'glitch', a: '#ffe600', b: '#9b4dff' } } }]);
    const r = resolveTheme({ ...base, light: `custom:${sid}`, dark: `custom:${sid}` });
    expect(r.skin).toBe('glitch');
    expect(r.dark.skin?.vars['--skin-a']).toBe('#ffe600');
    const old = zUserSettings.parse({ theme: { color: 'mint', light: 'skin:terminal', dark: 'skin:nope' } }).theme;
    expect(old.motion).toBe(true);
    expect(old.light).toBe('skin:terminal');
    expect(old.dark).toBeNull();
  });
});

describe('배경 그림 위에서도 글자가 잘 보인다', () => {
  const check = (spec: Parameters<typeof specLook>[0], label: string) => {
    for (const mode of MODES) {
      const look = specLook(spec, mode);
      const t = look.tokens;
      const backs = backdropColors(imageInks(spec.image), t['--bg'], look.dim);
      expect(look.dim, `${label} ${mode} dim`).toBeGreaterThanOrEqual(spec.dim - 1e-9);
      expect(look.dim, `${label} ${mode} dim max`).toBeLessThanOrEqual(0.92);
      for (const b of backs) {
        expect(contrast(t['--ink'], b), `${label} ${mode} ink on ${b}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--muted'], b), `${label} ${mode} muted on ${b}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--accent'], b), `${label} ${mode} accent on ${b}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--fab'], b), `${label} ${mode} fab on ${b}`).toBeGreaterThanOrEqual(3);
      }
      // 그림이 없는 곳(바탕·카드)에서도 그대로
      for (const bg of [t['--bg'], t['--surface']]) {
        expect(contrast(t['--ink'], bg)).toBeGreaterThanOrEqual(7);
        expect(contrast(t['--muted'], bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--accent'], bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t['--fab'], t['--bg']), `${label} ${mode} fab on bg`).toBeGreaterThanOrEqual(3);
      expect(contrast(t['--accent-ink'], t['--accent'])).toBeGreaterThanOrEqual(4.5);
    }
  };

  it('사진·AI 그림(검정·흰색 어느 쪽이든)은 덮는 정도를 올리고 글자 색을 맞춘다', () => {
    for (let i = 0; i < 200; i++) {
      const spec = readSpec({
        light: { bg: randomHex(i), surface: randomHex(i + 1), accent: randomHex(i + 2) },
        dark: { bg: randomHex(i + 3), surface: randomHex(i + 4), accent: randomHex(i + 5) },
        image: { kind: 'file', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
        dim: 0.2 + (i % 8) * 0.1 > 0.92 ? 0.92 : 0.2 + (i % 8) * 0.1,
      })!;
      check(spec, `file ${i}`);
      // 사진은 적어도 0.7 은 덮는다
      for (const mode of MODES) expect(specLook(spec, mode).dim).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('직접 고른 덮는 정도는 그대로 (사진은 50%까지): 테마 색은 그대로 두고, 글자 둘레 바탕색 번짐은 꾸미기 스위치(기본 없음)로', () => {
    const base = {
      light: { bg: '#f6eeec', surface: '#fffaf9', accent: '#8b3a0e' },
      dark: { bg: '#140d0b', surface: '#241b18', accent: '#f0a070' },
      image: { kind: 'file', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    };
    const auto = readSpec({ ...base, dim: 0.6 })!;
    const exact = readSpec({ ...base, dim: 0.5, dimExact: true, fx: { textHalo: true } })!;
    const plain = readSpec({ ...base, dim: 0.5, dimExact: true })!;
    const autoId = '1f8fad5b-d9cb-469f-a165-70867728950e';
    const exactId = '2f8fad5b-d9cb-469f-a165-70867728950e';
    rememberCustomThemes([
      { id: autoId, name: '자동', spec: auto },
      { id: exactId, name: '직접', spec: exact },
    ]);
    for (const mode of MODES) {
      const a = specLook(auto, mode);
      const e = specLook(exact, mode);
      // 직접 고르지 않은 테마는 예전처럼 글자가 잘 보이는 정도까지 올려 덮는다
      expect(a.dim).toBeGreaterThan(0.7);
      expect(a.halo).toBe(false);
      expect(e.dim).toBe(0.5);
      expect(e.halo).toBe(true);
      expect(e.readDim).toBe(a.dim);
      // 스위치를 켜지 않으면(기본) 둘레 없이 그대로 덮는다
      expect(specLook(plain, mode)).toMatchObject({ dim: 0.5, readDim: a.dim, halo: false });
      expect(specLook(plain, mode).tokens).toEqual(a.tokens);
      // 글자 색·빛은 잘 보이는 정도에 맞춘 그대로 (검정·흰색으로 몰리지 않는다)
      expect(e.tokens).toEqual(a.tokens);
      expect(lookFor(`custom:${exactId}`, mode).fx).toEqual(lookFor(`custom:${autoId}`, mode).fx);
    }
    // 사진은 50% 밑으로 내려가지 않고, 잘 보이는 정도 이상이면 둘레가 없다
    expect(specLook(readSpec({ ...base, dim: 0.3, dimExact: true })!, 'light').dim).toBe(0.5);
    for (const mode of MODES)
      expect(specLook(readSpec({ ...base, dim: 0.9, dimExact: true, fx: { textHalo: true } })!, mode)).toMatchObject({ dim: 0.9, halo: false });
    // 테마 CSS: 둘레가 필요하고 스위치를 켰을 때만 --theme-halo
    expect(themeCss(specLook(exact, 'light'), specLook(exact, 'dark'))).toContain('--theme-halo:0 0 1px var(--bg),0 0 2px var(--bg)');
    expect(themeCss(specLook(plain, 'light'), specLook(plain, 'dark'))).toContain('--theme-halo:none');
    expect(themeCss(specLook(auto, 'light'), specLook(auto, 'dark'))).toContain('--theme-halo:none');
    expect(themeCss(specLook(auto, 'light'), specLook(auto, 'dark'))).not.toContain('0 0 1px');
    // 그 밖의 값은 받지 않는다
    expect(zThemeSpec.safeParse({ ...base, dim: 0.5, dimExact: 'yes' }).success).toBe(false);
  });

  it('무늬는 실제로 칠하는 색만큼만 덮는다 (옅은 무늬는 그대로, 진한 무늬는 더 덮는다)', () => {
    const light = readSpec({
      light: { bg: '#f3f3f6', surface: '#ffffff', accent: '#b84c08' },
      dark: { bg: '#000000', surface: '#17171a', accent: '#ff9b45' },
      image: { kind: 'pattern', svg: codePatternSvg('dots', '#b84c08', '#e8b48a', 3) },
      dim: 0.3,
    })!;
    check(light, 'code dots');
    expect(specLook(light, 'light').dim).toBeLessThan(0.7);
    const heavy = readSpec({
      light: { bg: '#f3f3f6', surface: '#ffffff', accent: '#b84c08' },
      dark: { bg: '#000000', surface: '#17171a', accent: '#ff9b45' },
      // fill 이 없으면 검정으로 칠해진다
      image: { kind: 'pattern', svg: '<svg><rect x="0" y="0" width="100" height="100"/><circle cx="50" cy="50" r="20" fill="#ffffff"/></svg>' },
      dim: 0.2,
    })!;
    check(heavy, 'heavy');
    expect(specLook(heavy, 'light').dim).toBeGreaterThan(0.6);
    for (let i = 0; i < 120; i++) {
      const a = randomHex(i + 7);
      const b = randomHex(i + 8);
      const spec = readSpec({
        light: { bg: randomHex(i), surface: randomHex(i + 1), accent: randomHex(i + 2) },
        dark: { bg: randomHex(i + 3), surface: randomHex(i + 4), accent: randomHex(i + 5) },
        image: { kind: 'pattern', svg: codePatternSvg(CODE_PATTERNS[i % CODE_PATTERNS.length], a, b, i + 1) },
        dim: 0.2 + (i % 5) * 0.1,
      })!;
      check(spec, `pattern ${i}`);
    }
  });

  it('무늬 색 읽기: 물려받기·진하기 곱하기·선은 안을 칠하지 않음', () => {
    const inks = patternInks(
      '<svg><g fill="#112233" opacity="0.5"><circle cx="1" cy="1" r="1" fill-opacity="0.5"/><g opacity="0.5"><rect width="1" height="1" fill="#abc"/></g></g>' +
        '<line x1="0" y1="0" x2="1" y2="1" stroke="#ff0000" opacity="0.2"/><path d="M0 0L1 1" fill="none" stroke="#00ff00" stroke-width="0"/></svg>',
    );
    const by = Object.fromEntries(inks.map((k) => [k.color, k.alpha]));
    expect(by['#112233']).toBeCloseTo(0.25);
    expect(by['#aabbcc']).toBeCloseTo(0.25);
    expect(by['#ff0000']).toBeCloseTo(0.2);
    expect(by['#000000']).toBeUndefined();
    expect(by['#00ff00']).toBeUndefined();
  });
});

describe('Cloudflare 오류 나누기', () => {
  it('3036 은 오늘 몫을 다 씀, 3040(잠깐 바쁨)과 그 밖은 실패', () => {
    expect(classifyCfError({ errors: [{ code: 3036, message: 'Account limited' }] })).toBe('quota');
    expect(classifyCfError({ errors: [{ message: 'you have used up your daily free allocation of 10,000 neurons' }] })).toBe('quota');
    expect(classifyCfError({ errors: [{ code: 3040, message: 'Capacity temporarily exceeded, please try again.' }] })).toBe('failed');
    expect(classifyCfError({ errors: [{ code: 3007, message: 'Timeout' }] })).toBe('failed');
    expect(classifyCfError(null)).toBe('failed');
  });
});

describe('색 하나로 만드는 테마 (테마 만들기의 포인트 색·바탕 느낌)', () => {
  it('포인트 색과 바탕 느낌으로 두 모드의 색을 만들고, 지금 색이 어느 느낌인지 알아본다', async () => {
    const { ACCENT_SWATCHES, BASE_TONES, paletteFromColor, toneOf } = await import('@/lib/themes/palette-from');
    for (const c of [...ACCENT_SWATCHES, '#111111', '#ffffff', randomHex(7)])
      for (const tone of BASE_TONES) {
        const p = paletteFromColor(c, tone);
        // 밝을 때는 밝은 바탕, 어두울 때는 어두운 바탕 (fitPalette)
        expect(contrast(p.light.bg, '#ffffff')).toBeLessThan(1.3);
        expect(contrast(p.dark.bg, '#000000')).toBeLessThan(1.6);
        expect(toneOf(p), `${c} ${tone}`).toBe(tone);
        for (const mode of MODES) {
          const t = deriveTokens(p[mode], mode);
          expect(contrast(t['--ink'], t['--bg'])).toBeGreaterThanOrEqual(7);
          expect(contrast(t['--accent-ink'], t['--accent'])).toBeGreaterThanOrEqual(4.5);
        }
      }
    // 직접 고른 바탕이면 느낌이 없다
    const p = paletteFromColor('#635aea', 'gray');
    expect(toneOf({ ...p, light: { ...p.light, bg: '#e9f0ff' } })).toBeNull();
  });
});
