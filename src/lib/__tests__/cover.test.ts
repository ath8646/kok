import { describe, expect, it } from 'vitest';
import { COVER_LIMITS, coverCornerBusy, coverJsonSchema, coverNoteExcerpt, normalizeCover, packCover, readCover } from '@/lib/cover';
import { schemaProps, SCHEMA_PROPS_MAX } from '@/lib/ai/schema-registry';
import { coverPrompt } from '@/lib/ai/prompts';

/** AI 답처럼 모든 칸이 있는 요소 */
const it0 = (o: Record<string, unknown>) => ({
  id: '',
  type: 'point',
  refs: [],
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  r: 0,
  expr: '',
  from: 0,
  to: 0,
  label: '',
  style: 'given',
  marks: 0,
  tone: 'ink',
  ...o,
});
const pt = (id: string, x: number, y: number) => it0({ id, x, y, style: 'muted' });

/** 해와 잎 (오른쪽 위는 비움) */
const SUN_LEAF = {
  alt: '해와 잎',
  view: { x_min: 0, x_max: 15, y_min: 0, y_max: 10 },
  axes: false,
  grid: false,
  items: [
    pt('S', 3, 7),
    it0({ id: 'sun', type: 'circle', refs: ['S'], r: 1.2, tone: 'orange' }),
    pt('A', 7, 2),
    pt('B', 9, 6),
    pt('C', 11, 3),
    it0({ id: 'leaf', type: 'polygon', refs: ['A', 'B', 'C'], tone: 'green', label: '잎' }),
    it0({ id: 'rib', type: 'segment', refs: ['A', 'B'], tone: 'ink' }),
    it0({ id: 'co2', type: 'text', x: 4, y: 2, label: '$CO_2$', tone: 'navy' }),
  ],
};

describe('표지 그림 (lib/cover.ts)', () => {
  it('AI 답을 그릴 수 있는 그림과 요소마다 색으로 (ink 는 적지 않는다)', () => {
    const c = normalizeCover(SUN_LEAF)!;
    expect(c).not.toBeNull();
    expect(c.alt).toBe('해와 잎');
    expect(c.figure.items.map((i) => i.id)).toEqual(['S', 'sun', 'A', 'B', 'C', 'leaf', 'rib', 'co2']);
    expect(c.tones).toEqual({ sun: 'orange', leaf: 'green', co2: 'navy' });
  });

  it('없는 색 이름·없는 요소의 색은 버린다', () => {
    const c = normalizeCover({ ...SUN_LEAF, items: [...SUN_LEAF.items.slice(0, 2), ...SUN_LEAF.items.slice(2).map((x) => ({ ...x, tone: 'gold' }))] })!;
    expect(c.tones).toEqual({ sun: 'orange' });
    const saved = readCover({ ...packCover(c), tones: { sun: 'orange', ghost: 'red', leaf: 'neon' } })!;
    expect(saved.tones).toEqual({ sun: 'orange' });
  });

  it('선·도형이 둘보다 적으면 표지가 아니다 (글·점만 있는 답)', () => {
    expect(normalizeCover({ ...SUN_LEAF, items: [pt('P', 1, 1), it0({ id: 't', type: 'text', x: 3, y: 3, label: '광합성' })] })).toBeNull();
    expect(normalizeCover(null)).toBeNull();
    expect(normalizeCover({ items: 'x' })).toBeNull();
  });

  it('이름은 상자·글이 아닌 요소에서 앞의 몇 개만 남긴다 (설명 그림이 되지 않게)', () => {
    const many = Array.from({ length: 9 }, (_, k) => it0({ id: `p${k}`, x: k + 1, y: 2, label: `P${k}` }));
    const c = normalizeCover({ ...SUN_LEAF, items: [...SUN_LEAF.items, ...many] })!;
    const named = c.figure.items.filter((i) => i.label && i.type !== 'box' && i.type !== 'text');
    expect(named.length).toBe(COVER_LIMITS.labels);
    // 글 요소의 이름은 그대로 (글이 곧 요소다)
    expect(c.figure.items.find((i) => i.id === 'co2')?.label).toBe('$CO_2$');
  });

  it('요소는 COVER_LIMITS.items 개까지', () => {
    const many = Array.from({ length: 40 }, (_, k) => pt(`q${k}`, (k % 14) + 0.5, 5));
    const c = normalizeCover({ ...SUN_LEAF, items: [...SUN_LEAF.items, ...many] })!;
    expect(c.figure.items.length).toBeLessThanOrEqual(COVER_LIMITS.items);
  });

  it('저장 모양은 작고, 읽으면 같은 그림이다', () => {
    const c = normalizeCover(SUN_LEAF)!;
    const packed = packCover(c);
    const json = JSON.stringify(packed);
    expect(json.length).toBeLessThan(JSON.stringify(SUN_LEAF).length / 2);
    expect(json).not.toContain('"expr":""');
    expect(json).not.toContain('"style":"given"');
    const back = readCover(JSON.parse(json))!;
    expect(back.figure).toEqual(c.figure);
    expect(back.tones).toEqual(c.tones);
    expect(back.alt).toBe(c.alt);
    // 예전 모양·다른 값은 표지가 아니다
    expect(readCover({ ...packed, v: 2 })).toBeNull();
    expect(readCover(null)).toBeNull();
  });

  it('그림이 오른쪽 위 단추 자리까지 닿는지', () => {
    expect(coverCornerBusy(normalizeCover(SUN_LEAF)!)).toBe(false);
    const corner = normalizeCover({ ...SUN_LEAF, items: [...SUN_LEAF.items, pt('Z1', 12.5, 8.6), pt('Z2', 14, 9.2), it0({ id: 'z', type: 'segment', refs: ['Z1', 'Z2'] })] })!;
    expect(coverCornerBusy(corner)).toBe(true);
    // 큰 원이 모서리까지 퍼져도
    const big = normalizeCover({ ...SUN_LEAF, items: [pt('O', 9, 6), it0({ id: 'ring', type: 'circle', refs: ['O'], r: 3.8 }), ...SUN_LEAF.items] })!;
    expect(coverCornerBusy(big)).toBe(true);
  });

  it('AI 에게 보낼 노트 줄임: 과목·제목·요약·개념·공식·용어, 꾸미기 기호 없이', () => {
    const text = coverNoteExcerpt(
      {
        title: '광합성',
        summary: '**식물**이 ==빛==으로 양분을 만든다',
        key_points: [{ title: '엽록체', explanation: '빛을 받아 !!포도당!!을 만든다' }, { title: '' }],
        formulas: [{ latex: '6CO_2 + 6H_2O \\to C_6H_{12}O_6 + 6O_2', label: '광합성 식' }],
        terms: [{ term: '기공', meaning: '잎의 구멍' }],
      },
      '과학',
    );
    expect(text).toContain('subject: 과학');
    expect(text).toContain('title: 광합성');
    expect(text).toContain('summary: 식물이 빛으로 양분을 만든다');
    expect(text).toContain('- 엽록체: 빛을 받아 포도당을 만든다');
    expect(text).toContain('formula: 광합성 식 6CO_2');
    expect(text).toContain('terms: 기공');
    expect(text).not.toMatch(/\*\*|==|!!/);
    expect(coverNoteExcerpt({ summary: 'x'.repeat(9000), key_points: Array.from({ length: 30 }, () => ({ title: 'y'.repeat(200) })) }).length).toBeLessThanOrEqual(4000);
  });

  it('답 모양은 문법 한도 안이고, 지시는 틀·비울 모서리·색을 말한다', () => {
    expect(schemaProps(coverJsonSchema)).toBeLessThanOrEqual(SCHEMA_PROPS_MAX);
    const p = coverPrompt();
    expect(p).toContain('x_min 0, x_max 15, y_min 0, y_max 10');
    expect(p).toContain('top-right corner');
    expect(p).toContain('tone:');
  });
});
