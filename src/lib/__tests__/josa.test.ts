import { describe, expect, it } from 'vitest';
import { josa } from '@/lib/josa';

describe('이름 뒤 조사 (lib/josa.ts)', () => {
  it('끝 글자 받침으로 고른다 (따옴표는 건너뛴다)', () => {
    expect(josa('광합성', '을')).toBe('광합성을');
    expect(josa('세포 호흡', '을')).toBe('세포 호흡을');
    expect(josa("'이차함수'", '을')).toBe("'이차함수'를");
    expect(josa("'민트 테마'", '이')).toBe("'민트 테마'가");
    expect(josa('과학', '은')).toBe('과학은');
    expect(josa('수학', '과')).toBe('수학과');
    expect(josa('국어', '과')).toBe('국어와');
  });

  it('으로/로: 받침이 없거나 ㄹ 받침이면 로', () => {
    expect(josa('과학', '으로')).toBe('과학으로');
    expect(josa('국어', '으로')).toBe('국어로');
    expect(josa('물', '으로')).toBe('물로');
  });

  it('숫자는 읽는 소리로, 영문은 대강', () => {
    expect(josa('버전 1', '을')).toBe('버전 1을');
    expect(josa('버전 2', '을')).toBe('버전 2를');
    expect(josa('3', '으로')).toBe('3으로');
    expect(josa('7', '으로')).toBe('7로');
    expect(josa('Python', '을')).toBe('Python을');
    expect(josa('Java', '을')).toBe('Java를');
    expect(josa('', '을')).toBe('를');
  });
});
