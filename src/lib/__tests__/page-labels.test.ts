import { describe, expect, it } from 'vitest';
import { buildPageLabels, offsetOf, pageName, printedPage, readPageLabels } from '@/lib/page-labels';

describe('인쇄된 쪽 번호: 조각 하나의 차이', () => {
  it('번호가 있는 쪽의 반 넘게 같은 차이 (둘 넘게)', () => {
    expect(offsetOf({ start: 1, nums: [114, 115, 0, 117, 999] })).toBe(113);
    expect(offsetOf({ start: 27, nums: [140, 0, 0, 0, 0, 145, 146] })).toBe(113);
    // 한 쪽만 맞으면 모른다 (쪽이 여럿일 때)
    expect(offsetOf({ start: 1, nums: [114, 0, 0, 0] })).toBeNull();
    // 서로 다른 차이가 반반이면 모른다
    expect(offsetOf({ start: 1, nums: [10, 11, 50, 51] })).toBeNull();
    // 쪽 하나짜리는 그 번호
    expect(offsetOf({ start: 5, nums: [42] })).toBe(37);
    expect(offsetOf({ start: 1, nums: [0, 0] })).toBeNull();
  });
});

describe('인쇄된 쪽 번호: 구간 만들기', () => {
  it('PDF 글자 > 쪽 하나씩 읽은 번호(둘 넘게) > AI 가 읽은 번호', () => {
    const parts = [
      { from: 1, to: 13, text: { start: 1, nums: [114, 115, 116, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, ai: { start: 1, nums: Array(13).fill(0) } },
      { from: 14, to: 26, ai: { start: 14, nums: [127, 128, 129, 130, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
    ];
    expect(buildPageLabels(parts)).toEqual([{ from: 1, to: 26, add: 113 }]);
    // AI 가 읽은 번호(셋 아래)와 쪽 하나에서 읽은 번호가 다르면 모른다 (쪽이 여럿인 조각은 쪽 하나의 번호만 믿지 않는다)
    const weak = [{ from: 27, to: 33, ai: { start: 27, nums: [200, 201, 0, 0, 0, 0, 0] } }];
    expect(buildPageLabels(weak, [{ page: 32, printed: 145 }])).toEqual([]);
    expect(buildPageLabels([{ from: 27, to: 33 }], [{ page: 32, printed: 145 }])).toEqual([]);
    // 쪽 하나짜리 조각은 그 쪽에서 읽은 번호로
    expect(buildPageLabels([{ from: 5, to: 5 }], [{ page: 5, printed: 118 }])).toEqual([{ from: 5, to: 5, add: 113 }]);
    // 셋 넘게 맞는 AI 번호는 쪽 하나의 다른 번호보다 믿는다
    const strong = [{ from: 27, to: 33, ai: { start: 27, nums: [140, 141, 142, 143, 0, 0, 0] } }];
    expect(buildPageLabels(strong, [{ page: 32, printed: 999 }])).toEqual([{ from: 27, to: 33, add: 113 }]);
    // 쪽 하나씩 읽은 번호가 둘 넘게 맞으면 그것
    expect(
      buildPageLabels(strong, [
        { page: 30, printed: 300 },
        { page: 31, printed: 301 },
      ]),
    ).toEqual([{ from: 27, to: 33, add: 270 }]);
  });

  it('모르는 조각은 앞뒤 조각이 같은 차이면 채우고, 다르면 비운다', () => {
    const known = (from: number, to: number, add: number) => ({
      from,
      to,
      ai: { start: from, nums: Array.from({ length: to - from + 1 }, (_, i) => from + i + add) },
    });
    const unknown = (from: number, to: number) => ({ from, to, ai: { start: from, nums: Array(to - from + 1).fill(0) } });
    expect(buildPageLabels([known(1, 13, 113), unknown(14, 26), known(27, 33, 113)])).toEqual([{ from: 1, to: 33, add: 113 }]);
    expect(buildPageLabels([known(1, 13, 113), unknown(14, 26), known(27, 33, 50)])).toEqual([
      { from: 1, to: 13, add: 113 },
      { from: 27, to: 33, add: 50 },
    ]);
  });

  it('PDF 쪽과 인쇄된 번호가 같거나 증거가 없으면 빈 목록', () => {
    expect(buildPageLabels([{ from: 1, to: 3, ai: { start: 1, nums: [1, 2, 3] } }])).toEqual([]);
    expect(buildPageLabels([])).toEqual([]);
  });
});

describe('인쇄된 쪽 번호: 화면의 쪽 이름', () => {
  const labels = [{ from: 3, to: 49, add: 111 }];

  it('인쇄된 번호가 있으면 그 번호, 없는 쪽은 PDF 쪽, 구간이 없으면 예전처럼', () => {
    expect(printedPage(labels, 3)).toBe(114);
    expect(printedPage(labels, 2)).toBeNull();
    expect(pageName('pdf', 3, labels)).toBe('114쪽');
    expect(pageName('pdf', 2, labels)).toBe('PDF 2쪽');
    expect(pageName('pdf', 2, [])).toBe('2쪽');
    expect(pageName('pdf', 2)).toBe('2쪽');
    // 그 쪽에서 직접 읽은 번호(자료 그림)가 있으면 그것
    expect(pageName('pdf', 2, [], 77)).toBe('77쪽');
    expect(pageName('image', 2, labels)).toBe('사진 2');
    // 0 이하가 되는 번호는 쓰지 않는다
    expect(printedPage([{ from: 1, to: 9, add: -4 }], 2)).toBeNull();
  });

  it('노트 정리에서 읽기: 모양이 올바른 구간만', () => {
    expect(readPageLabels({ page_labels: [{ from: 1, to: 9, add: 113 }, { from: 5, to: 2, add: 1 }, { from: 1, to: 2 }, 'x'] })).toEqual([
      { from: 1, to: 9, add: 113 },
    ]);
    expect(readPageLabels({})).toEqual([]);
    expect(readPageLabels(null)).toEqual([]);
  });
});
