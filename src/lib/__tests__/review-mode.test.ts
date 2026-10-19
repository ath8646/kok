import { describe, expect, it } from 'vitest';
import { practiceFrom, practiceHref, rememberPracticeFrom, reviewModeFrom, reviewModeKey } from '@/lib/review-mode';

const q = (s: string) => new URLSearchParams(s);

describe('복습 주소 읽기', () => {
  it('주소마다 복습 방법', () => {
    expect(reviewModeFrom(q(''))).toEqual({ kind: 'today' });
    expect(reviewModeFrom(q('subject=s1'))).toEqual({ kind: 'subject', id: 's1' });
    expect(reviewModeFrom(q('mode=wrong'))).toEqual({ kind: 'wrong' });
    expect(reviewModeFrom(q('kp=n1:kp3'))).toEqual({ kind: 'kp', note: 'n1', kp: 'kp3' });
    // 예전 '이 노트 문제 풀기' 주소는 노트 id 로 찾는 노트 문제 풀기
    expect(reviewModeFrom(q('note=n1'))).toEqual({ kind: 'practice', by: 'note', id: 'n1' });
  });
  it('모르는 값은 오늘 복습, 과목이 먼저', () => {
    expect(reviewModeFrom(q('mode=other'))).toEqual({ kind: 'today' });
    expect(reviewModeFrom(q('kp=nocolon'))).toEqual({ kind: 'today' });
    expect(reviewModeFrom(q('subject=s1&note=n1'))).toEqual({ kind: 'subject', id: 's1' });
  });
  it('방법이 같으면 같은 열쇠', () => {
    expect(reviewModeKey(reviewModeFrom(q('kp=n1:a')))).toBe(reviewModeKey({ kind: 'kp', note: 'n1', kp: 'a' }));
    expect(reviewModeKey({ kind: 'today' })).not.toBe(reviewModeKey({ kind: 'wrong' }));
  });
});

describe('노트 문제 풀기', () => {
  it('주소', () => {
    expect(practiceHref('abc')).toBe('/notes/abc/practice?from=note');
  });
  it('남겨 둔 노트 제목은 그 노트에서만', () => {
    rememberPracticeFrom('s1', '광합성');
    expect(practiceFrom('s1')).toEqual({ title: '광합성' });
    expect(practiceFrom('s2')).toBeNull();
    rememberPracticeFrom('s2', '세포');
    expect(practiceFrom('s1')).toBeNull();
  });
});
