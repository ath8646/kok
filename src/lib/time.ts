// 한국 시간(KST, UTC+9) 기준 하루·한 달의 시작 시각

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function kstDayStart(now: Date = new Date()): Date {
  const shifted = now.getTime() + KST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - KST_OFFSET_MS);
}

export function kstMonthStart(now: Date = new Date()): Date {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KST_OFFSET_MS);
}

/** 'YYYY-MM-DD' (KST) */
export function kstDateString(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 시험까지 남은 날 (오늘이면 0, 지났으면 음수) */
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const today = Date.parse(kstDateString(now));
  const target = Date.parse(dateStr);
  return Math.round((target - today) / DAY_MS);
}
