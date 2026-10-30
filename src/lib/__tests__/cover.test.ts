import { describe, expect, it } from 'vitest';
import {
  COVER_ITEMS,
  COVER_KINDS,
  COVER_OUT_TYPICAL,
  coverCornerBusy,
  coverJsonSchema,
  coverNoteExcerpt,
  normalizeCover,
  packCover,
  readCover,
  type CoverV1,
} from '@/lib/cover';
import { schemaProps, SCHEMA_PROPS_MAX } from '@/lib/ai/schema-registry';
import { coverPrompt } from '@/lib/ai/prompts';
import { estimateCover, estimateSmallTask } from '@/lib/ai/models';

/** AI 답처럼 모든 칸이 있는 글 하나 */
const item = (text: string, o: Record<string, unknown> = {}) => ({ text, sub: '', key: false, side: '', ...o });
const BLANK = { view: { x_min: 0, x_max: 0, y_min: 0, y_max: 0 }, axes: false, items: [] };
/** AI 답처럼 모든 칸이 있는 표지 */
const answer = (o: Record<string, unknown>) => ({ kind: 'hub', title: '', left: '', right: '', items: [], figure: BLANK, alt: '설명', ...o });

/** 그래프·도형 요소 (모든 칸) */
const fig = (o: Record<string, unknown>) => ({
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
  ...o,
});

describe('표지 그림 v2 (lib/cover.ts)', () => {
  it('연표: 글을 다듬고(번호·끝 문장 부호), 같은 글은 하나만, 가장 중요한 것은 처음 하나만', () => {
    const c = normalizeCover(
      answer({
        kind: 'timeline',
        items: [
          item('1. 조선 건국.', { sub: '1392' }),
          item('임진왜란', { sub: '1592', key: true }),
          item('임진왜란', { sub: '1592' }),
          item('병자호란!', { sub: '1636', key: true }),
        ],
      }),
    )!;
    expect(c.kind).toBe('timeline');
    expect(c.items.map((i) => i.text)).toEqual(['조선 건국', '임진왜란', '병자호란']);
    expect(c.items.map((i) => i.key)).toEqual([false, true, false]);
    expect(c.items[0].sub).toBe('1392');
    // 모양에 쓰지 않는 칸은 비운다
    expect(c.title).toBe('');
    expect(c.figure).toBeNull();
  });

  it('모양마다 글 수: 적으면 표지가 아니고, 많으면 앞에서부터', () => {
    for (const kind of COVER_KINDS) {
      if (kind === 'figure' || kind === 'compare' || kind === 'formula') continue;
      const [min, max] = COVER_ITEMS[kind];
      const many = Array.from({ length: max + 3 }, (_, k) => item(`낱말${k}`));
      const c = normalizeCover(answer({ kind, title: '전체', items: many }))!;
      expect(c.items.length).toBe(max);
      expect(normalizeCover(answer({ kind, title: '전체', items: many.slice(0, min - 1) }))).toBeNull();
    }
    expect(normalizeCover(answer({ kind: 'spiral', items: [item('a'), item('b')] }))).toBeNull();
    expect(normalizeCover(null)).toBeNull();
    expect(normalizeCover({ kind: 'flow', items: 'x' })).toBeNull();
  });

  it('구조·핵심어·공식은 전체 이름(title)이 있어야 한다', () => {
    for (const kind of ['tree', 'hub'] as const) {
      expect(normalizeCover(answer({ kind, title: '', items: [item('가'), item('나')] }))).toBeNull();
      expect(normalizeCover(answer({ kind, title: '전체', items: [item('가'), item('나')] }))).not.toBeNull();
    }
    expect(normalizeCover(answer({ kind: 'formula', title: '' }))).toBeNull();
    const f = normalizeCover(answer({ kind: 'formula', title: 'E_k = \\frac{1}{2}mv^2', items: [item('m', { sub: '질량', key: true })] }))!;
    // 공식은 다듬지 않는다 (끝의 2 같은 글자도 그대로), 가장 중요한 것은 없다
    expect(f.title).toBe('E_k = \\frac{1}{2}mv^2');
    expect(f.items[0]).toEqual({ text: 'm', sub: '질량', key: false, side: '' });
  });

  it('비교: 두 이름과 양쪽에 하나씩은 있어야 하고, 한쪽에 셋까지, 쪽이 없는 글은 뺀다', () => {
    const c = normalizeCover(
      answer({
        kind: 'compare',
        left: '광합성',
        right: '세포 호흡',
        items: [
          item('엽록체', { side: 'left', key: true }),
          item('빛 흡수', { side: 'left' }),
          item('저장', { side: 'left' }),
          item('넷째', { side: 'left' }),
          item('쪽 없음'),
          item('미토콘드리아', { side: 'right' }),
        ],
      }),
    )!;
    expect(c.items.map((i) => `${i.side}:${i.text}`)).toEqual(['left:엽록체', 'left:빛 흡수', 'left:저장', 'right:미토콘드리아']);
    expect(c.items.every((i) => !i.key)).toBe(true);
    expect(normalizeCover(answer({ kind: 'compare', left: '가', right: '', items: [item('a', { side: 'left' }), item('b', { side: 'right' })] }))).toBeNull();
    expect(normalizeCover(answer({ kind: 'compare', left: '가', right: '나', items: [item('a', { side: 'left' }), item('b', { side: 'left' })] }))).toBeNull();
  });

  it('그래프·도형: 좌표축이 있으면 그래프 하나도 그림, 도형은 선·도형이 둘은 있어야, 이름은 넷까지', () => {
    const graph = {
      view: { x_min: -2, x_max: 4, y_min: -2, y_max: 4 },
      axes: true,
      items: [fig({ id: 'f', type: 'function', expr: 'x^2-2x', from: -1, to: 3, label: 'y' }), fig({ id: 'v', x: 1, y: -1, label: '꼭짓점' })],
    };
    const g = normalizeCover(answer({ kind: 'figure', title: '무시', items: [item('무시')], figure: graph }))!;
    expect(g.figure?.items.map((i) => i.id)).toEqual(['f', 'v']);
    expect(g.title).toBe('');
    expect(g.items).toEqual([]);
    expect(normalizeCover(answer({ kind: 'figure', figure: { ...graph, axes: false } }))).toBeNull();
    const many = Array.from({ length: 8 }, (_, k) => fig({ id: `p${k}`, x: k * 0.4, y: 1, label: `P${k}` }));
    const named = normalizeCover(answer({ kind: 'figure', figure: { ...graph, items: [...graph.items, ...many] } }))!;
    expect(named.figure!.items.filter((i) => i.label).length).toBe(4);
    expect(normalizeCover(answer({ kind: 'figure', figure: BLANK }))).toBeNull();
  });

  it('저장 모양은 작고(빈 칸 없이), 읽으면 같은 표지다', () => {
    const c = normalizeCover(answer({ kind: 'flow', items: [item('빛 흡수'), item('포도당 합성', { key: true, sub: '결과' })] }))!;
    const packed = packCover(c);
    const json = JSON.stringify(packed);
    expect(json).toBe('{"v":2,"kind":"flow","items":[{"text":"빛 흡수"},{"text":"포도당 합성","sub":"결과","key":true}],"alt":"설명"}');
    expect(readCover(JSON.parse(json))).toEqual(c);
    const g = normalizeCover(
      answer({
        kind: 'figure',
        figure: { view: { x_min: 0, x_max: 4, y_min: 0, y_max: 3 }, axes: true, items: [fig({ id: 'f', type: 'function', expr: 'x', from: 0, to: 3 })] },
      }),
    )!;
    expect(readCover(JSON.parse(JSON.stringify(packCover(g))))).toEqual(g);
    expect(readCover({ v: 3, kind: 'flow' })).toBeNull();
    expect(readCover(null)).toBeNull();
  });

  it('예전 표지(v1)도 그대로 읽고, v2 는 늘 오른쪽 위를 비워 두고 그린다', () => {
    const pt = (id: string, x: number, y: number) => fig({ id, x, y, style: 'muted' });
    const v1 = {
      v: 1,
      alt: '해와 잎',
      view: { x_min: 0, x_max: 15, y_min: 0, y_max: 10 },
      items: [
        pt('S', 3, 7),
        fig({ id: 'sun', type: 'circle', refs: ['S'], r: 1.2 }),
        pt('A', 7, 2),
        pt('B', 9, 6),
        pt('C', 11, 3),
        fig({ id: 'leaf', type: 'polygon', refs: ['A', 'B', 'C'] }),
      ],
      tones: { sun: 'orange', leaf: 'green', ghost: 'red', S: 'neon' },
    };
    const old = readCover(v1) as CoverV1;
    expect(old.v).toBe(1);
    expect(old.tones).toEqual({ sun: 'orange', leaf: 'green' });
    expect(coverCornerBusy(old)).toBe(false);
    const corner = readCover({ ...v1, items: [...v1.items, pt('Z1', 12.5, 8.6), pt('Z2', 14, 9.2), fig({ id: 'z', type: 'segment', refs: ['Z1', 'Z2'] })] })!;
    expect(coverCornerBusy(corner)).toBe(true);
    expect(coverCornerBusy(normalizeCover(answer({ kind: 'hub', title: '가', items: [item('a'), item('b')] }))!)).toBe(false);
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
    expect(
      coverNoteExcerpt({ summary: 'x'.repeat(9000), key_points: Array.from({ length: 30 }, () => ({ title: 'y'.repeat(200) })) }).length,
    ).toBeLessThanOrEqual(4000);
  });

  it('답 모양은 문법 한도 안이고, 지시는 모든 모양과 짧은 낱말·가장 중요한 것을 말한다. 예상 에너지는 보통 답 길이로', () => {
    expect(schemaProps(coverJsonSchema)).toBeLessThanOrEqual(SCHEMA_PROPS_MAX);
    const p = coverPrompt();
    for (const kind of COVER_KINDS) expect(p).toContain(`  - ${kind}:`);
    expect(p).toContain('at most 6 Korean characters');
    expect(p).toContain('key: true for exactly one item');
    expect(estimateCover('claude-sonnet-5-5', 0.01)).toBe(estimateSmallTask('claude-sonnet-5-5', 0.01, 4000, COVER_OUT_TYPICAL));
  });
});
