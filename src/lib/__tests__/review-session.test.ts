import { describe, expect, it } from 'vitest';
import { continuePlan, plansForTimes, secondsFor, type PlanCard } from '@/lib/review-plan';
import { readSession, resumePlan, sessionProgress, sessionTally, type SessionRow } from '@/lib/review-session';

// 2026-10-18 10:00 KST
const now = new Date('2026-10-18T01:00:00Z');
const base: PlanCard = {
  question_id: 'x',
  subject_id: 's1',
  due: '2026-10-17T00:00:00Z',
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
const subjects = [
  { id: 's1', exam_date: null },
  { id: 's2', exam_date: null },
];
type C = PlanCard & { note_id: string; key_point_id: string };
const card = (id: string, o: Partial<C> = {}): C => ({ ...base, question_id: id, note_id: 'n', key_point_id: `k-${id}`, ...o });
// 틀렸던 문제 1, 별표 1, 중요 2, 그 밖 40 (모두 복습할 차례)
const wrong = card('w', { in_wrong_note: true, lapses: 1 });
const star = card('s', { starred: true });
const high = ['h1', 'h2'].map((id) => card(id, { importance: 'high' }));
const low = Array.from({ length: 40 }, (_, i) => card(`l${String(i).padStart(2, '0')}`, { importance: 'low', subject_id: i % 2 ? 's1' : 's2' }));
const pool: C[] = [...low, ...high, star, wrong];
const cardOf = (id: string) => pool.find((c) => c.question_id === id);
const opts = { subjects, interleave: false, now, cardOf, reviewedSince: new Set<string>() };

const session = (plan: string[], answered: SessionRow['answered'] = {}, seen = '2026-10-18T00:00:00Z') => ({
  plan,
  answered,
  minutes: 5,
  pace: 1,
  seen_at: seen,
});

describe('이어서 풀 문제 (continuePlan)', () => {
  it('푼 것이 없으면 그 시간의 계획과 같다', () => {
    const [p5] = plansForTimes(pool, subjects, [5], { now, interleave: false });
    const c = continuePlan(pool, subjects, 5, { now, interleave: false });
    expect(c.cards.map((x) => x.question_id)).toEqual(p5.cards.map((x) => x.question_id));
    expect(c.seconds).toBe(p5.seconds);
    expect(c.all).toBe(false);
  });

  it('이미 푼 문제의 시간만큼 적게 고르고, 예산이 다 찼으면 하나도 고르지 않는다', () => {
    const p5 = continuePlan(pool, subjects, 5, { now, interleave: false });
    const first = p5.cards.slice(0, 3);
    const seeds = first.map((c) => ({ key: `${c.note_id}:${c.key_point_id}`, sec: secondsFor(c, 1) }));
    const rest = pool.filter((c) => !first.includes(c));
    const more = continuePlan(rest, subjects, 5, { now, interleave: false, seeds });
    expect(more.cards.map((c) => c.question_id)).toEqual(p5.cards.slice(3).map((c) => c.question_id));
    const full = p5.cards.map((c) => ({ key: `${c.note_id}:${c.key_point_id}`, sec: secondsFor(c, 1) }));
    expect(
      continuePlan(
        pool.filter((c) => !p5.cards.includes(c)),
        subjects,
        5,
        { now, interleave: false, seeds: full },
      ).cards,
    ).toEqual([]);
  });
});

describe('저장한 세션 이어서 하기 (resumePlan)', () => {
  const p5 = continuePlan(pool, subjects, 5, { now, interleave: false });
  const ids = p5.cards.map((c) => c.question_id);
  const sec = (id: string) => secondsFor(cardOf(id)!, 1);

  it('푼 문제는 빼고 나머지는 그 순서 그대로: 계획은 바뀌지 않는다', () => {
    const answered = { [ids[0]]: { ok: true, sec: sec(ids[0]), at: '' }, [ids[1]]: { ok: false, sec: sec(ids[1]), at: '' } };
    const r = resumePlan(
      session(ids, answered),
      pool.filter((c) => !answered[c.question_id]),
      opts,
    );
    expect(r.done).toEqual([ids[0], ids[1]]);
    expect(r.remaining.map((c) => c.question_id)).toEqual(ids.slice(2));
    expect(r.plan).toEqual(ids);
    expect(r.changed).toBe(false);
    expect(r.doneSec).toBe(Math.round(sec(ids[0]) + sec(ids[1])));
    expect(sessionProgress(r)).toEqual({ done: 2, total: ids.length, remaining: ids.length - 2 });
  });

  it('계획에 있던 문제를 다른 데서 풀었으면 끝낸 것으로 센다', () => {
    const elsewhere = new Set([ids[2]]);
    const r = resumePlan(
      session(ids),
      pool.filter((c) => c.question_id !== ids[2]),
      { ...opts, reviewedSince: elsewhere },
    );
    expect(r.done).toEqual([ids[2]]);
    expect(r.remaining.map((c) => c.question_id)).toEqual(ids.filter((id) => id !== ids[2]));
    expect(r.changed).toBe(false);
  });

  it('계획에서 사라진 문제(지움·쉬게 함) 자리는 같은 시간 안에서 다른 문제로 채운다', () => {
    const gone = ids[ids.length - 1];
    const r = resumePlan(
      session(ids),
      pool.filter((c) => c.question_id !== gone),
      opts,
    );
    expect(r.done).toEqual([]);
    expect(r.remaining.map((c) => c.question_id)).not.toContain(gone);
    // 하나가 빠진 만큼 채운다 (같은 수)
    expect(r.remaining.length).toBe(ids.length);
    expect(r.changed).toBe(true);
    // 다시 열면 그대로
    const again = resumePlan(
      session(r.plan),
      pool.filter((c) => c.question_id !== gone),
      opts,
    );
    expect(again.changed).toBe(false);
  });

  it('새로 생긴 문제는 남은 문제와 점수로 겨뤄 남은 시간에 나눠 들어간다', () => {
    const seen = '2026-10-18T00:00:00Z';
    // 틀렸던 새 문제(점수 높음)와 덜 중요한 새 문제(점수 낮음)
    const hot = card('new-hot', { in_wrong_note: true, lapses: 2, created_at: '2026-10-18T00:30:00Z' });
    const cold = card('new-cold', { importance: 'low', created_at: '2026-10-18T00:30:00Z' });
    const old = card('old-low', { importance: 'low', created_at: '2026-10-01T00:00:00Z' });
    const answered = { [ids[0]]: { ok: true, sec: sec(ids[0]), at: '' } };
    const r = resumePlan(session(ids, answered, seen), [...pool.filter((c) => c.question_id !== ids[0]), hot, cold, old], opts);
    const rest = r.remaining.map((c) => c.question_id);
    expect(rest).toContain('new-hot');
    expect(rest).not.toContain('new-cold');
    expect(rest).not.toContain('old-low');
    // 시간 예산은 그대로: 전체 수가 크게 늘지 않는다
    expect(r.done.length + r.remaining.length).toBeLessThanOrEqual(ids.length + 1);
    expect(r.changed).toBe(true);
    expect(r.plan[0]).toBe(ids[0]);
  });

  it('DB 행 읽기: 모양이 다르면 없는 셈', () => {
    expect(readSession({ key: 'home' })).toBeNull();
    const row = readSession({
      key: 'home',
      minutes: 5,
      period: 'due',
      subject_id: null,
      pace: 1,
      day: '2026-10-18',
      plan: ['a'],
      answered: { a: { ok: true, sec: 30, at: 'x' } },
      seen_at: 'x',
      created_at: 'x',
      updated_at: 'x',
    });
    expect(row?.plan).toEqual(['a']);
    expect(readSession({ ...row, key: 'other' })).toBeNull();
  });
});

describe('sessionTally (끝 화면의 수)', () => {
  it('틀려서 한 번 더 푼 문제는 한 번만 센다: 5문제에 2개 틀리면 푼 문제 5, 맞힌 수는 처음 답으로', () => {
    const r = (id: string, correct: boolean, enteredWrong = false) => ({ id, correct, graduated: false, enteredWrong });
    const t = sessionTally([r('a', true), r('b', false, true), r('c', true), r('d', false, true), r('e', true), r('b', true), r('d', false), r('d', true)]);
    expect(t).toEqual({ total: 5, right: 3, enteredWrong: 2, graduated: 0 });
  });
  it('졸업은 문제마다 한 번, 빈 목록은 0', () => {
    expect(
      sessionTally([
        { id: 'a', correct: true, graduated: true, enteredWrong: false },
        { id: 'a', correct: true, graduated: true, enteredWrong: false },
      ]),
    ).toEqual({
      total: 1,
      right: 1,
      enteredWrong: 0,
      graduated: 1,
    });
    expect(sessionTally([])).toEqual({ total: 0, right: 0, enteredWrong: 0, graduated: 0 });
  });
});
