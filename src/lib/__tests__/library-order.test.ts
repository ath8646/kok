import { describe, expect, it } from 'vitest';
import { bulkLabels, flattenOrder, libraryOrder, withPositions, type Orderable } from '@/lib/library-order';

const row = (id: string, day: number, more: Partial<Orderable> = {}): Orderable => ({
  id,
  created_at: `2026-10-${String(day).padStart(2, '0')}T09:00:00Z`,
  ...more,
});
const ids = (list: Orderable[]) => list.map((x) => x.id);

describe('자료함 카드 순서', () => {
  it('별표한 자료가 먼저, 그다음은 새 자료 먼저 (예전처럼)', () => {
    const list = [row('a', 1), row('b', 3), row('c', 2, { starred: true }), row('d', 4)];
    expect(ids(libraryOrder(list, false))).toEqual(['c', 'd', 'b', 'a']);
  });

  it('과목 안에서는 내가 정한 순서를 따르고, 번호가 없는 새 자료는 맨 앞', () => {
    const list = [row('a', 1, { position: 1 }), row('b', 2, { position: 0 }), row('new', 9), row('c', 3, { position: 2 })];
    expect(ids(libraryOrder(list, true))).toEqual(['new', 'b', 'a', 'c']);
  });

  it('정한 순서가 있어도 별표한 자료가 먼저 (별표끼리도 정한 순서)', () => {
    const list = [
      row('a', 1, { position: 0 }),
      row('s1', 2, { position: 3, starred: true }),
      row('b', 3, { position: 1 }),
      row('s2', 4, { position: 2, starred: true }),
    ];
    expect(ids(libraryOrder(list, true))).toEqual(['s2', 's1', 'a', 'b']);
  });

  it('전체 보기(과목을 고르지 않음)에서는 정한 순서를 쓰지 않는다 (과목마다 번호가 따로라서)', () => {
    const list = [row('a', 1, { position: 0 }), row('b', 2, { position: 5 })];
    expect(ids(libraryOrder(list, false))).toEqual(['b', 'a']);
  });

  it('칸이 없는 예전 목록(별표·번호 없음)도 예전 순서 그대로', () => {
    const list = [row('a', 1), row('b', 2), row('c', 3)];
    expect(ids(libraryOrder(list, true))).toEqual(['c', 'b', 'a']);
  });

  it('같은 때 넣은 자료는 번호(id) 순서로 늘 같게, 받은 목록은 바꾸지 않는다', () => {
    const list = [row('z', 1), row('y', 1), row('x', 1)];
    expect(ids(libraryOrder(list, true))).toEqual(['x', 'y', 'z']);
    expect(ids(list)).toEqual(['z', 'y', 'x']);
  });
});

describe('순서 바꾸기', () => {
  it('묶음(단원 × 별표)마다 옮긴 결과를 보이는 차례 그대로 이어 붙인다', () => {
    expect(flattenOrder([[{ id: 's1' }], [{ id: 'b' }, { id: 'a' }], [], [{ id: 'c' }]])).toEqual(['s1', 'b', 'a', 'c']);
  });

  it('새 순서대로 0, 1, 2 … 번호를 붙이고, 순서에 없는 자료(다른 과목)는 그대로 둔다', () => {
    const list = [row('a', 1, { position: 0 }), row('b', 2), row('other', 3, { position: 7 })];
    const next = withPositions(list, ['b', 'a']);
    expect(next.map((x) => [x.id, x.position])).toEqual([
      ['a', 1],
      ['b', 0],
      ['other', 7],
    ]);
    expect(list[1].position).toBeUndefined();
  });

  it('번호를 붙인 뒤 다시 정렬하면 옮긴 순서 그대로 보인다', () => {
    const list = [row('a', 1), row('b', 2), row('c', 3, { starred: true }), row('d', 4)];
    const order = ['c', 'a', 'd', 'b'];
    expect(ids(libraryOrder(withPositions(list, order), true))).toEqual(order);
  });
});

describe('여러 개 고르기: 한꺼번에 할 일', () => {
  it('하나라도 별표가 없으면 별표하기, 모두 별표면 별표 빼기', () => {
    expect(bulkLabels([{ starred: true }, { starred: false }]).star).toBe(true);
    expect(bulkLabels([{ starred: true }, { starred: true }]).star).toBe(false);
  });

  it('하나라도 복습을 끈 자료가 있으면 복습에 넣기, 모두 복습에 있으면(칸이 없는 예전 자료 포함) 복습 끄기', () => {
    expect(bulkLabels([{ in_review: true }, { in_review: false }]).review).toBe(true);
    expect(bulkLabels([{ in_review: true }, {}]).review).toBe(false);
  });

  it('아무것도 고르지 않았을 때 이름은 별표 · 복습 끄기 (단추는 꺼져 있다)', () => {
    expect(bulkLabels([])).toEqual({ star: true, review: false });
  });
});
