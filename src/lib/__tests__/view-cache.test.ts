import { afterEach, describe, expect, it } from 'vitest';
import { dropView, readView, writeView } from '@/lib/view-cache';

describe('방금 본 목록 기억 (화면을 오갈 때 바로 보여 주기)', () => {
  afterEach(() => dropView());

  it('같은 계정에만 보여 준다 (다른 계정으로 바꾸면 남의 목록이 보이지 않게)', () => {
    writeView('library', 'user-a', { n: 1 });
    expect(readView('library', 'user-a')).toEqual({ n: 1 });
    expect(readView('library', 'user-b')).toBeUndefined();
    expect(readView('library', null)).toBeUndefined();
  });

  it('5분이 지나면 쓰지 않는다', () => {
    writeView('library', 'user-a', { n: 1 }, 1_000);
    expect(readView('library', 'user-a', 1_000 + 4 * 60_000)).toEqual({ n: 1 });
    expect(readView('library', 'user-a', 1_000 + 6 * 60_000)).toBeUndefined();
  });

  it('지우면 사라진다 (하나만, 또는 모두)', () => {
    writeView('library', 'user-a', { n: 1 });
    writeView('other', 'user-a', { n: 2 });
    dropView('library');
    expect(readView('library', 'user-a')).toBeUndefined();
    expect(readView('other', 'user-a')).toEqual({ n: 2 });
    dropView();
    expect(readView('other', 'user-a')).toBeUndefined();
  });

  it('계정이 없으면 적지 않는다', () => {
    writeView('library', undefined, { n: 1 });
    expect(readView('library', undefined)).toBeUndefined();
  });
});
