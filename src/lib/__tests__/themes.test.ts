import { describe, expect, it } from 'vitest';
import { contrast, deriveTokens, fitPalette, normalizeHex, CORE_TOKENS, type Mode } from '@/lib/themes/colors';
import { BASE_TOKENS, presetTokens } from '@/lib/themes/presets';
import { readSpec, zThemeSpec } from '@/lib/themes/spec';
import { imageCss, themeCss } from '@/lib/themes/css';
import { CODE_PATTERNS, codePatternSvg, patternInks, sanitizePatternSvg } from '@/lib/themes/pattern';
import { backdropColors, imageInks, specLook } from '@/lib/themes/backdrop';
import { classifyCfError } from '@/lib/themes/cf-errors';
import { sniffImage } from '@/lib/themes/image-sniff';
import { THEME_COLORS } from '@/lib/settings';
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
    expect(css).toContain(':root:root{--bg:#f3f3f6');
    expect(css).toContain('@media (prefers-color-scheme: dark){:root:root:not([data-mode=light]){');
    expect(css).toContain(':root:root[data-mode=dark]{');
    expect(css).toContain('--accent:#1a5fc2');
    expect(css).toContain('--accent:#7cb0ff');
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
  const base: Theme = { color: 'ocean', font: 'default', paper: 'none', mode: 'system', light: null, dark: null };
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
    expect(r.light.tokens['--accent']).toBe('#1a5fc2');
    expect(r.plain).toBe(false);
    expect(resolveTheme({ ...base, color: 'default' }).plain).toBe(true);
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
