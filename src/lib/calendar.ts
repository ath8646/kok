// 달력 계산 ('YYYY-MM-DD' 글로만: 기기 시간대와 상관없이 같은 날). 날짜 고르기 창(components/DatePicker.tsx)이 쓴다.

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 'YYYY-MM-DD' → UTC 자정 시각 (틀린 글이면 NaN) */
function utc(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return NaN;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 2026-02-31 처럼 없는 날은 받지 않는다
  return new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
}

export function isDay(s: string | null | undefined): s is string {
  return typeof s === 'string' && !Number.isNaN(utc(s));
}

function fromUtc(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** 년·월(1~12)·일 → 'YYYY-MM-DD' */
export function dayString(y: number, m: number, d: number): string {
  return fromUtc(Date.UTC(y, m - 1, d));
}

/** 년·월(1~12) */
export function monthOf(s: string): { y: number; m: number } {
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) };
}

export function addDays(s: string, n: number): string {
  return fromUtc(utc(s) + n * DAY_MS);
}

/** n 달 뒤의 같은 날 (그 달에 없는 날이면 그 달의 끝 날: 1월 31일 + 1달 = 2월 28일) */
export function addMonths(s: string, n: number): string {
  const { y, m } = monthOf(s);
  const d = Number(s.slice(8, 10));
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return dayString(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last));
}

/** 요일 (0 일요일 … 6 토요일) */
export function weekday(s: string): number {
  return new Date(utc(s)).getUTCDay();
}

/** 그 달의 6주(일요일부터) 42칸: 달력의 높이가 달마다 바뀌지 않게 늘 여섯 줄 */
export function monthGrid(y: number, m: number): string[][] {
  const first = dayString(y, m, 1);
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/** '2026년 11월 18일 수요일' */
export function dayLabel(s: string): string {
  const { y, m } = monthOf(s);
  return `${y}년 ${m}월 ${Number(s.slice(8, 10))}일 ${WEEKDAYS[weekday(s)]}요일`;
}

/** 달력 칸의 이름 ('11월 18일 수요일') */
export function shortDayLabel(s: string): string {
  const { m } = monthOf(s);
  return `${m}월 ${Number(s.slice(8, 10))}일 ${WEEKDAYS[weekday(s)]}요일`;
}
