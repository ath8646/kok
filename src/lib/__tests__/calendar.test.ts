import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dayLabel, isDay, monthGrid, shortDayLabel, weekday } from '@/lib/calendar';

describe('달력 계산 (lib/calendar.ts)', () => {
  it('날짜 글을 읽고 없는 날은 받지 않는다', () => {
    expect(isDay('2026-10-30')).toBe(true);
    expect(isDay('2026-02-29')).toBe(false);
    expect(isDay('2028-02-29')).toBe(true);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('')).toBe(false);
    expect(isDay(null)).toBe(false);
  });

  it('날·달 더하기 (그 달에 없는 날은 끝 날로)', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('달력은 일요일부터 여섯 줄, 그 달의 1일이 첫 줄에', () => {
    const g = monthGrid(2026, 11);
    expect(g).toHaveLength(6);
    expect(g.every((w) => w.length === 7)).toBe(true);
    // 2026년 11월 1일은 일요일
    expect(weekday('2026-11-01')).toBe(0);
    expect(g[0][0]).toBe('2026-11-01');
    const oct = monthGrid(2026, 10);
    // 2026년 10월 1일은 목요일: 첫 줄은 9월 27일(일)부터
    expect(oct[0][0]).toBe('2026-09-27');
    expect(oct[0][4]).toBe('2026-10-01');
  });

  it('읽어 주는 이름', () => {
    expect(dayLabel('2026-11-18')).toBe('2026년 11월 18일 수요일');
    expect(shortDayLabel('2026-11-01')).toBe('11월 1일 일요일');
  });
});
