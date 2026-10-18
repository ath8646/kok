import { describe, expect, it } from 'vitest';
import { LIST_EDGE, LIST_GAP, LIST_MAX_WIDTH, findTyped, listWidthRange, placeList, startsWithTyped, stepEnabled } from '@/lib/select';

// 폰 화면 (390 × 844)
const PHONE = { left: 0, top: 0, width: 390, height: 844 };
const box = (left: number, top: number, width = 200, height = 48) => ({ left, top, right: left + width, bottom: top + height });

describe('select: 목록 자리', () => {
  it('칸 바로 아래에, 칸 왼쪽에 맞춰 놓는다', () => {
    const p = placeList(box(16, 100), PHONE, { width: 200, contentHeight: 150 });
    expect(p.up).toBe(false);
    expect(p.top).toBe(148 + LIST_GAP);
    expect(p.left).toBe(16);
    expect(p.maxHeight).toBe(320);
    expect(p.originX).toBe(100);
  });

  it('아래가 모자라고 위가 더 넓으면 위로 뒤집는다', () => {
    const p = placeList(box(16, 700), PHONE, { width: 200, contentHeight: 300 });
    expect(p.up).toBe(true);
    expect(p.top).toBe(700 - LIST_GAP - 300);
    // 아래 자리가 충분하면 그대로 아래
    expect(placeList(box(16, 400), PHONE, { width: 200, contentHeight: 300 }).up).toBe(false);
  });

  it('높이는 min(320px, 화면 절반)까지, 넘으면 목록 안에서 스크롤', () => {
    expect(placeList(box(16, 40), PHONE, { width: 200, contentHeight: 2000 }).maxHeight).toBe(320);
    const short = { left: 0, top: 0, width: 640, height: 400 };
    expect(placeList(box(16, 20), short, { width: 200, contentHeight: 2000 }).maxHeight).toBe(200);
  });

  it('위아래 모두 좁으면 넓은 쪽에 두고 화면 밖으로 나가지 않는다', () => {
    const tiny = { left: 0, top: 0, width: 390, height: 300 };
    const p = placeList(box(16, 120, 200, 60), tiny, { width: 200, contentHeight: 400 });
    expect(p.top).toBeGreaterThanOrEqual(LIST_EDGE);
    expect(p.top + Math.min(400, p.maxHeight)).toBeLessThanOrEqual(300 - LIST_EDGE);
  });

  it('오른쪽 끝의 칸은 목록을 왼쪽으로 당겨 화면 안 8px 에 둔다', () => {
    const p = placeList(box(250, 100, 124), PHONE, { width: 220, contentHeight: 100 });
    expect(p.left).toBe(390 - LIST_EDGE - 220);
    expect(p.originX).toBe(250 + 62 - p.left);
  });

  it('확대한 화면(보이는 부분이 옮겨짐)에서도 그 안에 둔다', () => {
    const zoomed = { left: 100, top: 300, width: 195, height: 422 };
    const p = placeList(box(90, 320, 120, 40), zoomed, { width: 150, contentHeight: 120 });
    expect(p.left).toBe(100 + LIST_EDGE);
    expect(p.top).toBe(360 + LIST_GAP);
  });

  it('폭은 칸보다 좁지 않고, 길면 360px·화면 안쪽까지', () => {
    expect(listWidthRange(144, PHONE)).toEqual({ min: 144, max: LIST_MAX_WIDTH });
    expect(listWidthRange(358, PHONE)).toEqual({ min: 358, max: 360 });
    expect(listWidthRange(500, { left: 0, top: 0, width: 1280, height: 800 })).toEqual({ min: 500, max: 500 });
    expect(listWidthRange(400, { left: 0, top: 0, width: 320, height: 600 })).toEqual({ min: 304, max: 304 });
  });
});

describe('select: 화살표로 옮기기', () => {
  const items = [{ label: '없음' }, { label: '가', disabled: true }, { label: '나' }, { label: '다', disabled: true }];

  it('고를 수 없는 줄은 건너뛰고, 끝에서는 그대로', () => {
    expect(stepEnabled(items, 0, 1)).toBe(2);
    expect(stepEnabled(items, 2, 1)).toBe(2);
    expect(stepEnabled(items, 2, -1)).toBe(0);
    expect(stepEnabled(items, 0, -1)).toBe(0);
  });

  it('처음·끝 (Home·End)', () => {
    expect(stepEnabled(items, -1, 1)).toBe(0);
    expect(stepEnabled(items, items.length, -1)).toBe(2);
    expect(stepEnabled([{ label: 'x', disabled: true }], -1, 1)).toBe(-1);
  });
});

describe('select: 글자로 찾기', () => {
  const items = [
    { label: '없음' },
    { label: 'Banana' },
    { label: 'apple' },
    { label: '광합성' },
    { label: 'blue', disabled: true },
    { label: '광물' },
    { label: 'berry' },
  ];

  it('대소문자 없이 앞글자로 찾는다', () => {
    expect(findTyped(items, 'a', 0)).toBe(2);
    expect(findTyped(items, 'ber', 0)).toBe(6);
    expect(findTyped(items, 'z', 0)).toBe(-1);
  });

  it('같은 글자를 거듭 치면 다음 것으로, 끝나면 처음으로 돌아간다 (고를 수 없는 줄은 건너뛴다)', () => {
    expect(findTyped(items, 'b', 0)).toBe(1);
    expect(findTyped(items, 'bb', 1)).toBe(6);
    expect(findTyped(items, 'bbb', 6)).toBe(1);
  });

  it('이어서 치면 지금 줄부터 다시 본다', () => {
    expect(findTyped(items, 'ba', 1)).toBe(1);
  });

  it('한글은 첫소리만 쳐도 찾는다', () => {
    expect(startsWithTyped('광합성', 'ㄱ')).toBe(true);
    expect(startsWithTyped('광합성', '광ㅎ')).toBe(true);
    expect(startsWithTyped('광합성', 'ㄴ')).toBe(false);
    expect(findTyped(items, 'ㄱ', 0)).toBe(3);
    expect(findTyped(items, 'ㄱㄱ', 3)).toBe(5);
    expect(findTyped(items, '없', 3)).toBe(0);
  });
});
