import { describe, expect, it } from 'vitest';
import { contrast, mix, type Mode } from '@/lib/themes/colors';
import { BRANCH_TEXT, SEMANTIC_TEXT, glowTokens } from '@/lib/themes/glow';
import { SKINS, SKIN_IDS, SKIN_VARS, buildSkin, fillPair, isSkinValue, readSkinColors, skinLook, skinPalettes, type SkinColors } from '@/lib/themes/skins';
import { themeCss } from '@/lib/themes/css';
import { DEFAULT_GLOW, GLOW_TONES, THEME_REF } from '@/lib/settings';

/** 같은 seed 면 같은 색 */
function randomHex(seed: number): string {
  let s = seed * 9301 + 49297;
  const next = () => {
    s = (s * 9301 + 49297) % 233280;
    return Math.floor((s / 233280) * 256);
  };
  return `#${[next(), next(), next()].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 시험할 색 짝: 고르기 색 모두 + 아무 색 (검정·흰색·회색 같은 끝 값도) */
function pairs(id: (typeof SKIN_IDS)[number]): SkinColors[] {
  const out: SkinColors[] = SKINS[id].variants.map((v) => ({ a: v.a, b: v.b }));
  for (const [a, b] of [
    ['#000000', '#ffffff'],
    ['#ffffff', '#000000'],
    ['#808080', '#808080'],
    ['#0000ff', '#ff0000'],
    ['#ffff00', '#00ffff'],
    ['#1a1a2e', '#0f3460'],
  ])
    out.push({ a, b });
  for (let i = 0; i < 120; i++) out.push({ a: randomHex(i * 2 + 7), b: randomHex(i * 2 + 8) });
  return out;
}

const atLeast = (fg: string, bg: string, min: number, label: string) => expect(contrast(fg, bg), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min - 1e-9);

describe('시그니처 테마: 어떤 색을 골라도 글자가 잘 보인다', () => {
  for (const id of SKIN_IDS) {
    it(`${SKINS[id].label}: 본문 7, 흐린 글자·포인트·초록·빨강·주황·가지 색 4.5, 버튼 글자 4.5, + 버튼 3`, () => {
      const mode: Mode = SKINS[id].mode;
      for (const c of pairs(id)) {
        const s = buildSkin(id, c);
        const t = s.tokens;
        const label = `${id} ${c.a}/${c.b}`;
        const cards = [t['--bg'], t['--surface'], t['--surface-2']];
        for (const bg of cards) {
          atLeast(t['--ink'], bg, 7, `${label} 본문`);
          atLeast(t['--muted'], bg, 4.5, `${label} 흐린 글자`);
          atLeast(t['--accent'], bg, 4.5, `${label} 포인트 글자`);
          for (const x of SEMANTIC_TEXT[mode]) atLeast(x, bg, 4.5, `${label} 초록·빨강·주황`);
          for (const x of BRANCH_TEXT[mode]) atLeast(x, bg, 4.5, `${label} 가지 색`);
        }
        for (const x of BRANCH_TEXT[mode]) atLeast(x, mix(t['--surface'], x, 0.15), 4.5, `${label} 연한 제 색 위 가지 색`);
        atLeast(t['--accent'], t['--accent-soft'], 4.5, `${label} 연한 포인트 위 포인트`);
        // 바탕 그림 위 (화면 바탕에 바로 놓이는 글자는 본문·흐린 글자뿐)
        for (const bg of s.pageBases) {
          atLeast(t['--ink'], bg, 4.5, `${label} 그림 위 본문`);
          atLeast(t['--muted'], bg, 4.5, `${label} 그림 위 흐린 글자`);
        }
        atLeast(t['--accent-ink'], t['--accent'], 4.5, `${label} 버튼 글자`);
        atLeast(t['--fab-ink'], t['--fab'], 3, `${label} + 버튼 아이콘`);
        // + 버튼 둘레: 바탕과 3 이상 (브루탈은 굵은 검정 테두리가 둘레)
        atLeast(id === 'brutal' ? t['--line'] : t['--fab'], t['--bg'], 3, `${label} + 버튼 둘레`);
        const v = s.vars;
        atLeast(v['--skin-a-ink'], v['--skin-a'], 4.5, `${label} 첫째 색 위 글자`);
        atLeast(v['--skin-b-ink'], v['--skin-b'], 4.5, `${label} 둘째 색 위 글자`);
        for (const bg of cards) {
          atLeast(v['--skin-a-text'], bg, 4.5, `${label} 첫째 색 글자`);
          atLeast(v['--skin-b-text'], bg, 4.5, `${label} 둘째 색 글자`);
        }
        atLeast(v['--skin-title'], t['--bg'], id === 'terminal' ? 7 : 4.5, `${label} 큰 제목`);
        if (id === 'synthwave')
          // 큰 제목은 해 앞에: 해가 비친 바탕 위에서도 그라데이션 두 끝 모두
          for (const bg of s.pageBases) for (const k of ['--skin-title', '--skin-title-2'] as const) atLeast(v[k], bg, 4.5, `${label} 큰 제목 ${k}`);
      }
    });
  }

  it('밝기는 테마가 정한다: 어두운 테마는 어두운 바탕, 밝은 테마는 밝은 바탕', () => {
    for (const id of SKIN_IDS)
      for (const c of pairs(id).slice(0, 30)) {
        const bg = buildSkin(id, c).tokens['--bg'];
        if (SKINS[id].mode === 'dark') expect(contrast(bg, '#000000'), `${id} ${bg}`).toBeLessThan(1.4);
        else expect(contrast(bg, '#ffffff'), `${id} ${bg}`).toBeLessThan(1.4);
      }
  });

  it('브루탈: 버튼(채움 색)은 검은 글자 7 이상, 고른 칩(강조 색)은 4.5 이상', () => {
    for (const c of pairs('brutal')) {
      const v = buildSkin('brutal', c).vars;
      atLeast('#000000', v['--skin-a'], 7, `brutal ${c.a}`);
      atLeast('#000000', v['--skin-b'], 4.5, `brutal ${c.b}`);
    }
  });

  it('스케치북: 형광펜 위 본문 글자 7 이상', () => {
    for (const c of pairs('sketch')) {
      const s = buildSkin('sketch', c);
      atLeast(s.tokens['--ink'], s.vars['--skin-b'], 7, `sketch ${c.b}`);
    }
  });

  it('색 칸은 모두 #rrggbb 또는 rgba(...) (테마 CSS 에 그대로 넣는다)', () => {
    for (const id of SKIN_IDS)
      for (const c of pairs(id).slice(0, 20)) {
        const s = buildSkin(id, c);
        for (const k of SKIN_VARS) expect(isSkinValue(s.vars[k]), `${id} ${k} ${s.vars[k]}`).toBe(true);
        for (const [k, v] of Object.entries(s.tokens)) expect(isSkinValue(v), `${id} ${k} ${v}`).toBe(true);
      }
  });

  it('별표 빛도 카드 안 글자가 읽히는 만큼만', () => {
    for (const id of SKIN_IDS) {
      const mode = SKINS[id].mode;
      for (const c of pairs(id).slice(0, 12))
        for (const tone of GLOW_TONES) {
          const t = buildSkin(id, c).tokens;
          const g = glowTokens(t, { tone, strength: 100 }, mode);
          // 카드 안 빛 (두 끝) 위의 본문
          for (const k of ['--glow-1', '--glow-2'] as const) {
            const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(g[k]);
            expect(m, g[k]).not.toBeNull();
            const hex = `#${[m![1], m![2], m![3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
            atLeast(t['--ink'], mix(t['--surface'], hex, Number(m![4])), Math.min(7, contrast(t['--ink'], t['--surface'])) - 0.02, `${id} ${tone}`);
          }
        }
    }
  });
});

describe('시그니처 테마 고르기·저장', () => {
  it('설정의 테마 이름: skin:<이름> 만 받는다', () => {
    for (const id of SKIN_IDS) expect(THEME_REF.test(`skin:${id}`)).toBe(true);
    expect(THEME_REF.test('skin:foo')).toBe(false);
    expect(THEME_REF.test('skin:')).toBe(false);
  });

  it('저장된 색이 이상하면 기본 색', () => {
    expect(readSkinColors('neon', { a: 'red', b: '#ABC' })).toEqual({ a: SKINS.neon.variants[0].a, b: '#aabbcc' });
    expect(readSkinColors('glitch', null)).toEqual({ a: SKINS.glitch.variants[0].a, b: SKINS.glitch.variants[0].b });
  });

  it('모습: 테마의 밝기, 시그니처 칸, 꾸미기 (아래 메뉴 띄우기만 고른 대로)', () => {
    const look = skinLook('neon', { a: '#ff3ad7', b: '#3ef2ff' }, false);
    expect(look.skin?.id).toBe('neon');
    expect(look.fx?.['--tab-float']).toBe('0');
    expect(skinLook('neon', { a: '#ff3ad7', b: '#3ef2ff' }, true).fx?.['--tab-float']).toBe('1');
    // 테마 CSS 에 시그니처 칸이 들어간다 (두 모드 모두 같은 모습)
    const css = themeCss(look, look);
    for (const k of SKIN_VARS) expect(css.split(`${k}:`).length - 1, k).toBe(3);
  });

  it('예전 화면용 밝을 때·어두울 때 색: 테마 밝기 쪽은 그 테마의 바탕', () => {
    const p = skinPalettes('neon', skinColorsOf('neon'));
    expect(p.dark.bg).toBe(buildSkin('neon', skinColorsOf('neon')).tokens['--bg']);
    expect(p.light.bg).toBe('#f2f2f7');
    const q = skinPalettes('brutal', skinColorsOf('brutal'));
    expect(q.light.bg).toBe(buildSkin('brutal', skinColorsOf('brutal')).tokens['--bg']);
  });

  it('칠한 색 위 글자: 모자라면 칠한 색을 맞춘다', () => {
    for (let i = 0; i < 200; i++) {
      const [fill, ink] = fillPair(randomHex(i + 300));
      expect(contrast(fill, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('별표 빛 기본값으로도 만든다', () => {
    for (const id of SKIN_IDS) expect(() => glowTokens(buildSkin(id, skinColorsOf(id)).tokens, DEFAULT_GLOW, SKINS[id].mode)).not.toThrow();
  });
});

function skinColorsOf(id: (typeof SKIN_IDS)[number]): SkinColors {
  const v = SKINS[id].variants[0];
  return { a: v.a, b: v.b };
}

describe('어울리는 색 아무거나', () => {
  it('테마마다 고른 짝도 글자가 읽히게 맞춰진다', async () => {
    const { randomSkinColors } = await import('@/lib/themes/skins');
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (const id of SKIN_IDS)
      for (let i = 0; i < 40; i++) {
        const c = randomSkinColors(id, rand);
        expect(c.a).toMatch(/^#[0-9a-f]{6}$/);
        const s = buildSkin(id, c);
        expect(contrast(s.tokens['--ink'], s.tokens['--bg'])).toBeGreaterThanOrEqual(7);
        expect(contrast(s.vars['--skin-a-ink'], s.vars['--skin-a'])).toBeGreaterThanOrEqual(4.5);
      }
  });
});

describe('시그니처 테마 이름 + 은/는', () => {
  it('받침이 있으면 은, 없으면 는', async () => {
    const { topic } = await import('@/lib/themes/skins');
    expect(topic('네온')).toBe('네온은');
    expect(topic('글리치')).toBe('글리치는');
    expect(topic('터미널')).toBe('터미널은');
    expect(topic('신스웨이브')).toBe('신스웨이브는');
    expect(topic('스케치북')).toBe('스케치북은');
  });
});
