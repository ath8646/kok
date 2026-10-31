import { describe, expect, it } from 'vitest';
import {
  PERIOD_LABEL,
  REVIEW_PERIODS,
  coreScore,
  paceFrom,
  periodCounts,
  periodPool,
  periodStart,
  pickKinds,
  pickToday,
  plansForTimes,
  secondsFor,
  type PlanCard,
} from '@/lib/review-plan';

// 2026-10-18 10:00 KST (일요일)
const now = new Date('2026-10-18T01:00:00Z');
const base: PlanCard = {
  question_id: 'x',
  subject_id: 's1',
  due: '2026-10-25T00:00:00Z',
  state: 2,
  reps: 3,
  lapses: 0,
  wrong_count: 0,
  last_review: '2026-10-10T00:00:00Z',
  in_wrong_note: false,
  importance: 'medium',
  type: 'mcq',
  created_at: '2026-10-01T00:00:00Z',
};
const opts = { now, dailyMax: 50, doneToday: 0, interleave: false };
const card = (id: string, o: Partial<PlanCard & { note_id: string; key_point_id: string }> = {}) => ({
  ...base,
  question_id: id,
  note_id: 'n',
  key_point_id: `k-${id}`,
  ...o,
});

describe('복습 기간', () => {
  it('기간은 KST 자정부터 센다', () => {
    expect(new Date(periodStart('today', now)!).toISOString()).toBe('2026-10-17T15:00:00.000Z');
    expect(new Date(periodStart('3d', now)!).toISOString()).toBe('2026-10-15T15:00:00.000Z');
    expect(new Date(periodStart('7d', now)!).toISOString()).toBe('2026-10-11T15:00:00.000Z');
    expect(new Date(periodStart('30d', now)!).toISOString()).toBe('2026-09-18T15:00:00.000Z');
    expect(periodStart('due', now)).toBeNull();
    expect(periodStart('all', now)).toBeNull();
    expect(REVIEW_PERIODS.map((p) => PERIOD_LABEL[p])).toEqual(['복습할 차례', '오늘', '3일', '1주', '1달', '전체']);
  });

  it('문제를 넣은 날로 고르고, 복습할 차례는 오늘 복습과 같다', () => {
    const cards = [
      card('today', { created_at: '2026-10-17T15:00:00Z' }), // KST 10/18 0시
      card('lastnight', { created_at: '2026-10-17T14:59:59Z' }), // KST 10/17 23:59
      card('d3', { created_at: '2026-10-16T00:00:00Z' }),
      card('d10', { created_at: '2026-10-08T00:00:00Z' }),
      card('old', { created_at: '2026-08-01T00:00:00Z', due: '2026-10-17T00:00:00Z' }),
      card('nodate', { created_at: undefined }),
    ];
    const ids = (p: Parameters<typeof periodPool>[1]) => periodPool(cards, p, opts).map((c) => c.question_id);
    expect(ids('today')).toEqual(['today']);
    expect(ids('3d')).toEqual(['today', 'lastnight', 'd3']);
    expect(ids('7d')).toEqual(['today', 'lastnight', 'd3']);
    expect(ids('30d')).toEqual(['today', 'lastnight', 'd3', 'd10']);
    expect(ids('all')).toHaveLength(6);
    expect(ids('due')).toEqual(pickToday(cards, opts).map((c) => c.question_id));
    expect(ids('due')).toEqual(['old']);
    expect(periodCounts(cards, opts)).toEqual({ due: 1, today: 1, '3d': 3, '7d': 3, '30d': 4, all: 6 });
    // 하루 최대 수를 다 풀었으면 복습할 차례는 없다
    expect(periodPool(cards, 'due', { ...opts, doneToday: 50 })).toHaveLength(0);
  });
});

describe('푸는 데 드는 시간', () => {
  it('유형마다 다르고, 틀릴 것 같은 문제는 조금 더', () => {
    const t = (o: Partial<PlanCard>) => secondsFor({ ...base, ...o });
    expect(t({ type: 'ox' })).toBeLessThan(t({ type: 'mcq' }));
    expect(t({ type: 'mcq' })).toBeLessThan(t({ type: 'short' }));
    expect(t({ in_wrong_note: true })).toBeGreaterThan(t({}));
    expect(t({ type: 'unknown' })).toBe(t({ type: 'mcq' }));
    expect(secondsFor(base, 0.6)).toBeLessThan(secondsFor(base, 1));
  });

  it('내 빠르기: 기록이 적으면 보통, 많으면 가운데 값 (0.6~1.8)', () => {
    const logs = (n: number, ms: number | null, type = 'mcq') => Array.from({ length: n }, () => ({ ms, type }));
    expect(paceFrom([])).toBe(1);
    expect(paceFrom(logs(4, 10_000))).toBe(1);
    expect(paceFrom(logs(30, 10_000))).toBe(0.6);
    expect(paceFrom(logs(30, 30_000))).toBeCloseTo(1.5);
    expect(paceFrom(logs(10, 40_000))).toBeCloseTo(1 + 1 * (10 / 30));
    expect(paceFrom(logs(60, 120_000))).toBe(1.8);
    // 시간이 없거나 모르는 유형, 자리를 비운 기록은 세지 않는다
    expect(paceFrom([...logs(20, null), ...logs(20, 5_000, 'essay'), ...logs(20, 900_000)])).toBe(1);
  });
});

describe('시간마다 풀 문제', () => {
  // 틀렸던 문제 1, 별표 1, 같은 개념의 중요 문제 3, 방금 푼 문제 1, 그 밖 60
  const wrong = card('w', { in_wrong_note: true, lapses: 1 });
  const star = card('s', { starred: true });
  const h = ['h1', 'h2', 'h3'].map((id) => card(id, { importance: 'high', key_point_id: 'same' }));
  const recent = card('r', { importance: 'high', last_review: '2026-10-18T00:30:00Z', due: '2026-10-17T00:00:00Z' });
  const low = Array.from({ length: 60 }, (_, i) => card(`l${String(i).padStart(2, '0')}`, { importance: 'low', subject_id: i % 2 ? 's1' : 's2' }));
  const pool = [...low, recent, ...h, star, wrong];

  it('짧을수록 적게, 짧은 시간의 문제는 늘 긴 시간 문제 안에', () => {
    const [p5, p15, p30] = plansForTimes(pool, [5, 15, 30], { now, interleave: false });
    expect(p5.cards.length).toBeGreaterThanOrEqual(6);
    expect(p5.cards.length).toBeLessThan(p15.cards.length);
    expect(p15.cards.length).toBeLessThan(p30.cards.length);
    const ids15 = new Set(p15.cards.map((c) => c.question_id));
    const ids30 = new Set(p30.cards.map((c) => c.question_id));
    expect(p5.cards.every((c) => ids15.has(c.question_id))).toBe(true);
    expect(p15.cards.every((c) => ids30.has(c.question_id))).toBe(true);
    // 시간 안에 (마지막 문제는 절반 넘게 들어가면 넣는다)
    expect(p5.seconds).toBeLessThanOrEqual(300 + 40);
    expect(p30.seconds).toBeLessThanOrEqual(1800 + 40);
    expect(p5.all || p15.all || p30.all).toBe(false);
  });

  it('5분에는 핵심 문제만: 틀렸던 문제·별표·중요 개념, 같은 개념은 몰리지 않게, 방금 푼 문제는 빼고', () => {
    const [p5] = plansForTimes(pool, [5], { now, interleave: false });
    const ids = p5.cards.map((c) => c.question_id);
    expect(ids).toEqual(expect.arrayContaining(['w', 's', 'h1', 'h2']));
    expect(ids).not.toContain('r');
    // 같은 개념 셋째 문제(25-30)는 다른 개념(0)보다 뒤
    expect(ids).not.toContain('h3');
  });

  it('기간의 문제가 다 들어가면 전부', () => {
    const small = [wrong, star, ...h];
    const plans = plansForTimes(small, [5, 15, 30], { now, interleave: true });
    expect(plans.every((p) => p.all && p.cards.length === 5)).toBe(true);
    expect(plansForTimes([], [5], { now, interleave: true })[0]).toEqual({ cards: [], seconds: 0, all: true });
  });

  it('핵심 점수와 고른 문제 나누기', () => {
    expect(coreScore(wrong, now)).toBeGreaterThan(coreScore(star, now));
    expect(coreScore(star, now)).toBeGreaterThan(coreScore(low[0], now));
    expect(coreScore(recent, now)).toBeLessThan(coreScore(low[0], now));
    const due = card('due', { due: '2026-10-17T00:00:00Z' });
    const fresh = card('new', { reps: 0, state: 0 });
    expect(pickKinds([wrong, star, h[0], due, fresh, low[0]], now)).toEqual({ wrong: 1, key: 2, due: 1, new: 1, again: 1 });
  });
});

describe('복습 설정', () => {
  it('예전 세션 길이(5·10·25분)는 가까운 복습 시간(5·15·30분)으로', async () => {
    const { readUserSettings } = await import('@/lib/settings');
    expect(readUserSettings({ review: { session: 25 } }).review.minutes).toBe(30);
    expect(readUserSettings({ review: { session: 10 } }).review.minutes).toBe(15);
    expect(readUserSettings({ review: { session: 5, dailyMax: 80 } }).review).toMatchObject({ minutes: 5, dailyMax: 80, period: 'due' });
    // 새로 고른 시간이 있으면 그것
    expect(readUserSettings({ review: { minutes: 15, session: 25 } }).review.minutes).toBe(15);
    // 이상한 값은 기본으로
    expect(readUserSettings({ review: { minutes: 7, period: 'week' } }).review).toMatchObject({ minutes: 5, period: 'due' });
    expect(readUserSettings({}).review).toMatchObject({ minutes: 5, period: 'due', dailyMax: 50 });
    expect(readUserSettings({ review: { period: '7d' } }).review.period).toBe('7d');
  });
});
