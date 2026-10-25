// 저장한 복습 세션 (review_sessions 표, features.sessions): 홈의 'N분 KOK'·복습 탭·오답 다시 풀기의 진행을 DB 에 남겨 두고 이어서 한다.
// 저장하는 것은 고른 문제(plan)와 푼 것(answered)뿐이고, 지금 풀 문제는 열 때마다 여기서 다시 계산한다 (AI 없음):
// 푼 문제는 빼고, 사라진 문제(지움·쉬게 함·복습 끔) 자리는 채우고, 세션을 만든 뒤 새로 생긴 문제는 남은 시간에 맞춰 나눠 넣는다.
import { z } from 'zod';
import { REVIEW_PERIODS, arrange, conceptKey, continuePlan, secondsFor, type ConceptCard, type PlanSubject, type ReviewPeriod, type Seed } from './review-plan';

/** 세션 열쇠: 홈의 오늘 KOK, 복습 탭(오늘·과목 복습), 오답 다시 풀기. 한 사람에 열쇠마다 하나 */
export type SessionKey = 'home' | 'review' | 'wrong';

/** 푼 문제 하나: 맞혔는지, 그때 계획에서 잡은 예상 시간(초: 남은 시간 예산을 셀 때), 푼 때 */
export type Answered = { ok: boolean; sec: number; at: string };

export type SessionRow = {
  key: SessionKey;
  /** 고른 시간(분) */
  minutes: number;
  period: ReviewPeriod;
  subject_id: string | null;
  /** 만들 때의 내 빠르기 (예상 시간이 흔들리지 않게 그대로 쓴다) */
  pace: number;
  /** 만든 날 (KST, YYYY-MM-DD): 홈의 오늘 KOK 은 그날만 */
  day: string;
  /** 고른 문제 (푼 것 포함, 푸는 순서) */
  plan: string[];
  answered: Record<string, Answered>;
  /** 새로 생긴 문제를 마지막으로 나눠 넣은 때 (그 뒤에 만든 문제가 '새 문제') */
  seen_at: string;
  created_at: string;
  updated_at: string;
};

const zAnswered = z.object({ ok: z.boolean().catch(false), sec: z.number().min(0).max(600).catch(32), at: z.string().catch('') });
const zRow = z.object({
  key: z.enum(['home', 'review', 'wrong']),
  minutes: z.number().int().min(1).max(120),
  period: z.enum(REVIEW_PERIODS).catch('due'),
  subject_id: z.string().nullable().catch(null),
  pace: z.number().min(0.3).max(3).catch(1),
  day: z.string(),
  plan: z.array(z.string()).max(500).catch([]),
  answered: z.record(z.string(), zAnswered).catch({}),
  seen_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** DB 행 읽기 (모양이 다르면 null: 없는 셈) */
export function readSession(row: unknown): SessionRow | null {
  const r = zRow.safeParse(row);
  return r.success ? r.data : null;
}

/** 문제를 못 찾을 때(지운 문제) 쓰는 예상 시간(초) */
const FALLBACK_SEC = 32;

export type ResumeResult<T> = {
  /** 끝낸 문제 (이 세션에서 푼 것 + 계획에 있던 문제를 다른 데서 푼 것) */
  done: string[];
  /** 지금 풀 문제 (푸는 순서) */
  remaining: T[];
  /** 새 계획 (끝낸 것 + 남은 것). 저장된 것과 다르면 changed */
  plan: string[];
  changed: boolean;
  /** 끝낸 문제의 예상 시간 합(초): 남은 시간 안내 */
  doneSec: number;
};

/**
 * 저장한 세션으로 지금 풀 문제를 정한다.
 * - 끝낸 것: 이 세션에서 답한 문제 + 계획에 있던 문제 가운데 세션을 만든 뒤 다른 데서 푼 문제(reviewedSince)
 * - 남은 것: 계획에 있고 아직 풀 수 있는(pool 에 있는) 문제. 사라진 문제 자리는 같은 시간 예산 안에서 다른 문제로 채운다
 * - 새 문제: seen_at 뒤에 만든 문제는 남은 문제와 핵심 점수로 겨뤄 남은 시간에 나눠 들어간다 (계획이 바뀌면 changed)
 */
export function resumePlan<T extends ConceptCard>(
  s: Pick<SessionRow, 'plan' | 'answered' | 'minutes' | 'pace' | 'seen_at'>,
  pool: T[],
  o: { subjects: PlanSubject[]; interleave: boolean; now?: Date; cardOf: (qid: string) => ConceptCard | undefined; reviewedSince: Set<string> },
): ResumeResult<T> {
  const now = o.now ?? new Date();
  const planSet = new Set(s.plan);
  const byId = new Map(pool.map((c) => [c.question_id, c]));
  const done: Array<{ id: string; seed: Seed }> = [];
  const doneIds = new Set<string>();
  const addDone = (id: string, sec: number) => {
    if (doneIds.has(id)) return;
    doneIds.add(id);
    done.push({ id, seed: { key: conceptKey(o.cardOf(id)), sec } });
  };
  for (const id of s.plan) {
    const a = s.answered[id];
    if (a) addDone(id, a.sec);
    else if (o.reviewedSince.has(id)) {
      const c = o.cardOf(id);
      addDone(id, c ? secondsFor(c, s.pace) : FALLBACK_SEC);
    }
  }
  // 계획에 없는데 답한 것(있어서는 안 되지만)도 끝낸 것으로
  for (const [id, a] of Object.entries(s.answered)) addDone(id, a.sec);
  const seeds = done.map((d) => d.seed);
  const opts = { now, pace: s.pace, interleave: o.interleave };

  const keep = s.plan.filter((id) => !doneIds.has(id) && byId.has(id)).map((id) => byId.get(id)!);
  const seenAt = Date.parse(s.seen_at);
  const newcomers = pool.filter((c) => !planSet.has(c.question_id) && !doneIds.has(c.question_id) && !!c.created_at && Date.parse(c.created_at) > seenAt);

  let remaining: T[];
  if (newcomers.length) {
    // 새 문제는 남은 문제와 같이 점수로 겨룬다 (남은 시간 예산 안에서)
    remaining = continuePlan([...keep, ...newcomers], o.subjects, s.minutes, { ...opts, seeds }).cards;
  } else {
    // 계획에서 사라진 문제가 있어 시간이 남으면 다른 문제로 채운다 (가득 차 있으면 아무것도 더하지 않는다)
    const rest = pool.filter((c) => !planSet.has(c.question_id) && !doneIds.has(c.question_id));
    const keepSeeds: Seed[] = keep.map((c) => ({ key: conceptKey(c), sec: secondsFor(c, s.pace) }));
    const extra = rest.length ? continuePlan(rest, o.subjects, s.minutes, { ...opts, seeds: [...seeds, ...keepSeeds] }).cards : [];
    remaining = extra.length ? arrange([...keep, ...extra], o.interleave) : keep;
  }
  // 새 계획: 저장된 차례는 그대로 두고(끝낸 것·남은 것만 남기고), 새로 들어온 문제는 뒤에 붙인다
  const stay = new Set([...doneIds, ...remaining.map((c) => c.question_id)]);
  const plan = [
    ...s.plan.filter((id) => stay.has(id)),
    ...done.map((d) => d.id).filter((id) => !planSet.has(id)),
    ...remaining.map((c) => c.question_id).filter((id) => !planSet.has(id)),
  ];
  const changed = plan.length !== s.plan.length || plan.some((id, i) => id !== s.plan[i]);
  return { done: done.map((d) => d.id), remaining, plan, changed, doneSec: Math.round(seeds.reduce((t, x) => t + x.sec, 0)) };
}

/** 세션의 진행: 끝낸 수와 전체 수 (홈의 고리·'X문제 남았어요') */
export function sessionProgress<T>(r: ResumeResult<T>): { done: number; total: number; remaining: number } {
  return { done: r.done.length, total: r.done.length + r.remaining.length, remaining: r.remaining.length };
}
