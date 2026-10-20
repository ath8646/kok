import { describe, expect, it } from 'vitest';
import { drawerGroups, initials, matchesSubject, pickerOrder, quickSubjects, type DrawerSubject } from '@/lib/subject-order';

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
let seq = 0;
function sub(name: string, o: Partial<DrawerSubject> = {}): DrawerSubject {
  seq += 1;
  return { id: `s${seq}`, name, position: seq, created_at: day(0), pinned: false, archived: false, used_at: null, ...o };
}

describe('과목 서랍 차례 (subject-order)', () => {
  it('서랍: 고정(내 차례) → 최근 쓴 것 → 보관(이름 차례)', () => {
    const math = sub('수학', { used_at: day(5) });
    const sci = sub('과학', { pinned: true, used_at: day(1) });
    const kor = sub('국어', { used_at: day(9) });
    const his = sub('한국사', { archived: true, used_at: day(10) });
    const eng = sub('영어', { pinned: true });
    const art = sub('미술', { archived: true, pinned: true });
    const g = drawerGroups([math, sci, kor, his, eng, art]);
    expect(g.pinned.map((s) => s.name)).toEqual(['과학', '영어']);
    expect(g.recent.map((s) => s.name)).toEqual(['국어', '수학']);
    // 보관하면 고정이어도 보관 묶음에만
    expect(g.archived.map((s) => s.name)).toEqual(['미술', '한국사']);
  });

  it('자료를 넣은 적이 없으면 만든 때로 최근을 센다', () => {
    const old = sub('옛 과목', { created_at: day(1), used_at: day(2) });
    const fresh = sub('새 과목', { created_at: day(7) });
    expect(drawerGroups([old, fresh]).recent.map((s) => s.name)).toEqual(['새 과목', '옛 과목']);
  });

  it('칩 줄: 고정 모두 + 최근 쓴 것으로 다섯 개까지, 보이는 차례는 고정 → 내 차례 (자료를 넣어도 칩이 자리를 바꾸지 않는다)', () => {
    const list = ['국어', '수학', '영어', '과학', '사회', '역사', '음악', '체육'].map((n, i) => sub(n, { used_at: day(i) }));
    // 최근 다섯: 체육(7) 음악(6) 역사(5) 사회(4) 과학(3) → 내 차례로
    expect(quickSubjects(list).map((s) => s.name)).toEqual(['과학', '사회', '역사', '음악', '체육']);
    const pinned = list.map((s) => (s.name === '국어' ? { ...s, pinned: true } : s));
    expect(quickSubjects(pinned).map((s) => s.name)).toEqual(['국어', '사회', '역사', '음악', '체육']);
    // 고른 과목이 줄에 없으면 끝에 (보관한 과목이어도)
    const archived = pinned.map((s) => (s.name === '영어' ? { ...s, archived: true } : s));
    const eng = archived.find((s) => s.name === '영어')!;
    expect(quickSubjects(archived, 5, eng.id).map((s) => s.name)).toEqual(['국어', '사회', '역사', '음악', '체육', '영어']);
    // 보관한 과목은 고정해도 줄에 안 나온다
    expect(quickSubjects(archived.map((s) => (s.name === '영어' ? { ...s, pinned: true } : s))).map((s) => s.name)).not.toContain('영어');
    // 고정이 다섯 개보다 많으면 고정한 것은 모두
    const many = list.map((s) => ({ ...s, pinned: true }));
    expect(quickSubjects(many)).toHaveLength(8);
  });

  it('고르는 목록: 고정 → 최근, 보관한 과목은 빼되 지금 고른 것은 남긴다', () => {
    const a = sub('가', { used_at: day(1) });
    const b = sub('나', { used_at: day(3), pinned: true });
    const c = sub('다', { used_at: day(5) });
    const d = sub('라', { used_at: day(9), archived: true });
    expect(pickerOrder([a, b, c, d]).map((s) => s.name)).toEqual(['나', '다', '가']);
    expect(pickerOrder([a, b, c, d], d.id).map((s) => s.name)).toEqual(['나', '라', '다', '가']);
  });

  it('찾기: 이름의 한 부분이나 첫 자음 (ㄱㅎ → 과학), 빈칸·대소문자는 상관없다', () => {
    expect(initials('과학 탐구')).toBe('ㄱㅎ ㅌㄱ');
    expect(matchesSubject('과학', 'ㄱㅎ')).toBe(true);
    expect(matchesSubject('과학탐구', 'ㅎㅌ')).toBe(true);
    expect(matchesSubject('과학', '학')).toBe(true);
    expect(matchesSubject('과학', 'ㄱ학')).toBe(true);
    expect(matchesSubject('한국사', 'ㄱㅎ')).toBe(false);
    expect(matchesSubject('English Grammar', 'english g')).toBe(true);
    expect(matchesSubject('수학 Ⅱ', '수학ⅱ')).toBe(true);
    expect(matchesSubject('수학', '')).toBe(true);
    expect(drawerGroups([sub('과학'), sub('국어'), sub('한국사')], 'ㄱ').recent.map((s) => s.name)).toEqual(['과학', '국어', '한국사']);
  });
});
