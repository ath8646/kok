// 오늘 풀 문제 고르기, 기간·시간으로 고르기, 시험 모드, 연속 기록, 약점 개념 (AI 없이, 화면에서 계산)
import { daysUntil, kstDateString, kstDayStart } from './time';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanCard = {
  question_id: string;
  subject_id: string;
  due: string;
  state: number;
  reps: number;
  lapses: number;
  /** 틀린 횟수 */
  wrong_count?: number;
  last_review: string | null;
  in_wrong_note: boolean;
  /** 연결된 개념의 중요도 */
  importance: 'high' | 'medium' | 'low';
  /** 별표한 개념의 문제 */
  starred?: boolean;
  /** 문제 유형 (푸는 데 드는 시간) */
  type?: string;
  /** 문제를 넣은 때 (기간으로 고르기) */
  created_at?: string;
};

export type PlanSubject = { id: string; exam_date: string | null };

export type PlanOptions = {
  now?: Date;
  dailyMax: number;
  /** 오늘 이미 푼 문제 수 */
  doneToday: number;
  interleave: boolean;
};

/** 시험 모드: 시험까지 남은 날 (0~14일이면 시험 모드, 아니면 null) */
export function examDaysLeft(subject: PlanSubject | undefined, now: Date = new Date()): number | null {
  if (!subject?.exam_date) return null;
  const d = daysUntil(subject.exam_date, now);
  return d >= 0 && d <= 14 ? d : null;
}

/** 시험 모드에서 당겨도 마지막 복습 뒤 적어도 이만큼은 둔다 (같은 날 같은 문제가 계속 나오지 않게) */
export const EXAM_MIN_GAP_MS = 12 * 60 * 60 * 1000;

/** 시험 모드에서 당겨진 복습 날짜. 시험 전까지 적어도 2번 보게 한다 */
export function effectiveDue(card: PlanCard, subject: PlanSubject | undefined, now: Date = new Date()): number {
  const due = Date.parse(card.due);
  const left = examDaysLeft(subject, now);
  if (left === null || !subject?.exam_date) return due;
  const last = card.last_review ? Date.parse(card.last_review) : null;
  // 방금(12시간 안에) 본 문제는 FSRS 일정 그대로 (틀린 문제의 짧은 다시 보기는 FSRS 가 정한다)
  if (last !== null && now.getTime() - last < EXAM_MIN_GAP_MS) return due;
  if (card.reps < 2) return Math.min(due, now.getTime());
  // 시험 날 시작(KST 자정) 전에 다시 볼 차례면 그대로
  const examStart = Date.parse(`${subject.exam_date}T00:00:00+09:00`);
  if (due < examStart) return due;
  // 다음 복습이 시험 뒤라면, 마지막 복습과 시험 사이 가운데로 당긴다 (마지막 복습 뒤 12시간보다 가깝게는 당기지 않는다)
  const base = last ?? now.getTime();
  const pulled = base + Math.max(0, examStart - base) / 2;
  return Math.min(due, Math.max(pulled, base + EXAM_MIN_GAP_MS));
}

function priority(card: PlanCard, subject: PlanSubject | undefined, now: Date): number {
  const imp = card.importance === 'high' ? 3 : card.importance === 'medium' ? 2 : 1;
  const overdueDays = Math.max(0, (now.getTime() - effectiveDue(card, subject, now)) / DAY_MS);
  let p = imp * 10 + Math.min(overdueDays, 30);
  const left = examDaysLeft(subject, now);
  if (left !== null && left <= 3) {
    // 시험 3일 전부터: 틀렸던 문제와 중요도 '상'을 먼저
    if (card.in_wrong_note || card.lapses > 0 || (card.wrong_count ?? 0) > 0) p += 100;
    if (card.importance === 'high') p += 60;
  }
  if (card.state === 0) p -= 5; // 처음 보는 문제는 복습할 문제 뒤로
  return p;
}

/** 오늘 풀 문제 목록 (순서대로) */
export function pickToday<T extends PlanCard>(cards: T[], subjects: PlanSubject[], opts: PlanOptions): T[] {
  const now = opts.now ?? new Date();
  const subj = new Map(subjects.map((s) => [s.id, s]));
  const due = cards.filter((c) => effectiveDue(c, subj.get(c.subject_id), now) <= now.getTime());
  const room = Math.max(0, opts.dailyMax - opts.doneToday);
  const ranked = due
    .map((c) => ({ c, p: priority(c, subj.get(c.subject_id), now) }))
    .sort((a, b) => b.p - a.p || Date.parse(a.c.due) - Date.parse(b.c.due))
    .slice(0, room)
    .map((x) => x.c);
  return arrange(ranked, opts.interleave);
}

/** 푸는 순서: 과목끼리 모으거나(우선순위가 높은 과목부터), 섞어 풀기면 과목을 번갈아 낸다. 과목 안에서는 받은 순서 그대로 */
function arrange<T extends PlanCard>(ranked: T[], interleave: boolean): T[] {
  if (!interleave) {
    const order: string[] = [];
    for (const c of ranked) if (!order.includes(c.subject_id)) order.push(c.subject_id);
    return order.flatMap((s) => ranked.filter((c) => c.subject_id === s));
  }
  const groups = new Map<string, T[]>();
  for (const c of ranked) {
    const g = groups.get(c.subject_id) ?? [];
    g.push(c);
    groups.set(c.subject_id, g);
  }
  const out: T[] = [];
  const lists = [...groups.values()];
  let i = 0;
  while (out.length < ranked.length) {
    const l = lists[i % lists.length];
    const x = l.shift();
    if (x) out.push(x);
    i++;
    if (i > ranked.length * lists.length + 10) break;
  }
  return out;
}

/** 아직 오늘 풀 문제 수 (홈 화면 숫자) */
export function countDueToday(cards: PlanCard[], subjects: PlanSubject[], opts: PlanOptions): number {
  return pickToday(cards, subjects, opts).length;
}

// ------------------------------------------------------------- 기간과 시간으로 고르기
/**
 * 복습 기간. due = 복습할 차례 (FSRS 가 정한 날이 된 문제, 하루 최대 수 안에서 = 오늘 복습).
 * 나머지는 문제를 넣은 날(KST) 기준: 오늘·최근 3일·1주·1달·전체. 날짜가 안 된 문제도 미리 푼다.
 */
export const REVIEW_PERIODS = ['due', 'today', '3d', '7d', '30d', 'all'] as const;
export type ReviewPeriod = (typeof REVIEW_PERIODS)[number];
export const PERIOD_LABEL: Record<ReviewPeriod, string> = { due: '복습할 차례', today: '오늘', '3d': '3일', '7d': '1주', '30d': '1달', all: '전체' };
const PERIOD_DAYS: Record<ReviewPeriod, number | null> = { due: null, today: 1, '3d': 3, '7d': 7, '30d': 30, all: null };

/** 복습 시간(분). 시간은 문제 수만 정한다: 시간이 지나도 고른 문제는 끝까지 푼다 */
export const REVIEW_MINUTES = [5, 15, 30] as const;
export type ReviewMinutes = (typeof REVIEW_MINUTES)[number];

/** 기간이 시작하는 때 (그날 KST 자정). 복습할 차례·전체는 null */
export function periodStart(period: ReviewPeriod, now: Date = new Date()): number | null {
  const days = PERIOD_DAYS[period];
  return days === null ? null : kstDayStart(now).getTime() - (days - 1) * DAY_MS;
}

/** 고른 기간의 문제 (아직 시간으로 자르기 전) */
export function periodPool<T extends PlanCard>(cards: T[], subjects: PlanSubject[], period: ReviewPeriod, opts: PlanOptions): T[] {
  if (period === 'due') return pickToday(cards, subjects, opts);
  const start = periodStart(period, opts.now);
  if (start === null) return cards;
  return cards.filter((c) => !!c.created_at && Date.parse(c.created_at) >= start);
}

/** 기간마다 문제 수 (기간 칩의 숫자) */
export function periodCounts(cards: PlanCard[], subjects: PlanSubject[], opts: PlanOptions): Record<ReviewPeriod, number> {
  const out = {} as Record<ReviewPeriod, number>;
  for (const p of REVIEW_PERIODS) out[p] = periodPool(cards, subjects, p, opts).length;
  return out;
}

/** 읽고 답하는 데 드는 시간(초, 보통 빠르기) */
const ANSWER_SEC: Record<string, number> = { ox: 9, mcq: 20, cloze: 22, short: 30 };
/** 채점과 풀이를 보고 다음으로 넘어가는 시간(초) */
const AFTER_SEC = 12;

/** 틀릴 것 같은 정도: 틀린 문제는 세션 끝에 한 번 더 나온다 */
function wrongChance(c: PlanCard): number {
  if (c.in_wrong_note) return 0.5;
  if (c.lapses > 0 || (c.wrong_count ?? 0) > 0) return 0.35;
  if (c.reps === 0) return 0.3;
  return 0.15;
}

/** 문제 하나에 드는 시간(초). pace 는 내 빠르기 (1 = 보통, 작을수록 빠름) */
export function secondsFor(c: PlanCard, pace = 1): number {
  const answer = (ANSWER_SEC[c.type ?? ''] ?? ANSWER_SEC.mcq) * pace;
  return (answer + AFTER_SEC) * (1 + 0.6 * wrongChance(c));
}

/**
 * 내 빠르기: 최근 푼 기록에서 (답하는 데 걸린 시간 ÷ 보통 시간)의 가운데 값.
 * 기록이 적으면 보통(1) 쪽으로 당기고, 0.6~1.8 사이로 둔다 (자리를 비운 기록 몇 개에 흔들리지 않게).
 */
export function paceFrom(logs: Array<{ ms: number | null; type?: string | null }>): number {
  const r = logs
    .filter((l) => typeof l.ms === 'number' && l.ms > 500 && l.ms < 600_000 && !!l.type && !!ANSWER_SEC[l.type])
    .map((l) => (l.ms as number) / 1000 / ANSWER_SEC[l.type as string])
    .sort((a, b) => a - b);
  if (r.length < 5) return 1;
  const n = r.length;
  const mid = n % 2 ? r[(n - 1) / 2] : (r[n / 2 - 1] + r[n / 2]) / 2;
  const w = Math.min(1, n / 30);
  return Math.min(1.8, Math.max(0.6, 1 + (mid - 1) * w));
}

/**
 * 핵심 점수: 짧은 시간에는 이 점수가 높은 문제만 푼다.
 * 복습할 차례가 된 문제, 틀렸던 문제, 중요도 '상'·별표한 개념, 시험이 가까운 과목이 먼저. 방금(12시간 안에) 푼 문제는 맨 뒤로.
 */
export function coreScore(c: PlanCard, subject: PlanSubject | undefined, now: Date = new Date()): number {
  const t = now.getTime();
  let s = 0;
  const due = effectiveDue(c, subject, now);
  if (due <= t) s += 30 + Math.min(10, (t - due) / DAY_MS);
  if (c.in_wrong_note) s += 40;
  else if (c.lapses > 0 || (c.wrong_count ?? 0) > 0) s += 25;
  s += c.importance === 'high' ? 25 : c.importance === 'medium' ? 10 : 0;
  if (c.starred) s += 20;
  const left = examDaysLeft(subject, now);
  if (left !== null) s += left <= 3 ? 30 : 15;
  if (c.reps === 0) s += 8;
  if (c.last_review && t - Date.parse(c.last_review) < EXAM_MIN_GAP_MS) s -= 60;
  return s;
}

/** 같은 개념을 한 번 고를 때마다 그 개념의 다른 문제에서 빼는 점수 (짧은 시간에도 여러 개념을 고루) */
const SAME_CONCEPT_PENALTY = 15;

export type TimedPlan<T> = {
  /** 고른 문제 (푸는 순서) */
  cards: T[];
  /** 예상 시간(초) */
  seconds: number;
  /** 기간의 문제를 모두 넣었는지 */
  all: boolean;
};

type ConceptCard = PlanCard & { note_id?: string | null; key_point_id?: string | null };

/**
 * 시간마다 풀 문제. 핵심 점수 순서(같은 개념이 몰리지 않게)로 한 줄을 세우고, 시간마다 그 앞부분을 자른다
 * (그래서 5분 문제는 늘 15분 문제 안에 있다). 마지막 문제는 절반 넘게 들어가면 넣는다.
 */
export function plansForTimes<T extends ConceptCard>(
  pool: T[],
  subjects: PlanSubject[],
  minutes: readonly number[],
  o: { now?: Date; pace?: number; interleave: boolean },
): TimedPlan<T>[] {
  const now = o.now ?? new Date();
  const subj = new Map(subjects.map((s) => [s.id, s]));
  const rest = pool.map((c) => ({
    c,
    score: coreScore(c, subj.get(c.subject_id), now),
    sec: secondsFor(c, o.pace ?? 1),
    key: c.note_id && c.key_point_id ? `${c.note_id}:${c.key_point_id}` : `q:${c.question_id}`,
    due: Date.parse(c.due),
  }));
  const budgetMax = Math.max(0, ...minutes) * 60;
  const used = new Map<string, number>();
  const line: typeof rest = [];
  let total = 0;
  while (rest.length) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i];
      const v = r.score - SAME_CONCEPT_PENALTY * (used.get(r.key) ?? 0);
      const b = rest[bi];
      if (v > bv || (v === bv && (r.due < b.due || (r.due === b.due && r.c.question_id < b.c.question_id)))) {
        bv = v;
        bi = i;
      }
    }
    const best = rest[bi];
    if (line.length && total + best.sec / 2 > budgetMax) break;
    rest.splice(bi, 1);
    line.push(best);
    total += best.sec;
    used.set(best.key, (used.get(best.key) ?? 0) + 1);
  }
  return minutes.map((m) => {
    const picked: typeof line = [];
    let t = 0;
    for (const r of line) {
      if (picked.length && t + r.sec / 2 > m * 60) break;
      picked.push(r);
      t += r.sec;
    }
    return {
      cards: arrange(
        picked.map((p) => p.c),
        o.interleave,
      ),
      seconds: Math.round(t),
      all: picked.length === pool.length,
    };
  });
}

/** 고른 문제가 어떤 문제인지 (먼저 해당하는 하나로 센다) */
export type PickKind = 'wrong' | 'key' | 'due' | 'new' | 'again';
export const PICK_KIND_LABEL: Record<PickKind, string> = {
  wrong: '틀렸던 문제',
  key: '중요한 개념',
  due: '복습할 차례',
  new: '처음 푸는 문제',
  again: '다시 보기',
};

export function pickKinds(cards: PlanCard[], subjects: PlanSubject[], now: Date = new Date()): Record<PickKind, number> {
  const subj = new Map(subjects.map((s) => [s.id, s]));
  const out: Record<PickKind, number> = { wrong: 0, key: 0, due: 0, new: 0, again: 0 };
  for (const c of cards) {
    if (c.in_wrong_note || c.lapses > 0 || (c.wrong_count ?? 0) > 0) out.wrong++;
    else if (c.starred || c.importance === 'high') out.key++;
    else if (effectiveDue(c, subj.get(c.subject_id), now) <= now.getTime()) out.due++;
    else if (c.reps === 0) out.new++;
    else out.again++;
  }
  return out;
}

// ------------------------------------------------------------- 연속 기록
/**
 * 공부한 날(KST 'YYYY-MM-DD') 목록으로 연속 기록을 센다.
 * 한 주(월~일)에 2번까지는 쉬어도 기록이 이어진다. 오늘은 아직 끝나지 않았으니 빠져도 끊지 않는다.
 */
export function streakInfo(days: string[], now: Date = new Date()): { streak: number; restUsedThisWeek: number; studiedToday: boolean } {
  const set = new Set(days);
  const today = kstDateString(now);
  const studiedToday = set.has(today);
  const dayOf = (offset: number) => kstDateString(new Date(now.getTime() - offset * DAY_MS));
  const weekKey = (dateStr: string) => {
    const t = Date.parse(`${dateStr}T00:00:00Z`);
    const dow = (new Date(t).getUTCDay() + 6) % 7; // 월=0
    return new Date(t - dow * DAY_MS).toISOString().slice(0, 10);
  };
  const restByWeek = new Map<string, number>(); // 쉬는 날로 쓴 날 수 (기록 안쪽만)
  const tryRest = new Map<string, number>();
  let streak = 0;
  let pending: string[] = [];
  for (let off = studiedToday ? 0 : 1; off < 400; off++) {
    const d = dayOf(off);
    if (set.has(d)) {
      streak += 1 + pending.length;
      for (const p of pending) restByWeek.set(weekKey(p), (restByWeek.get(weekKey(p)) ?? 0) + 1);
      pending = [];
      continue;
    }
    const wk = weekKey(d);
    const used = tryRest.get(wk) ?? 0;
    if (used >= 2) break;
    tryRest.set(wk, used + 1);
    pending.push(d);
  }
  // 기록 앞쪽에 남은 쉬는 날(pending)은 기록에 넣지 않는다
  const restUsedThisWeek = Math.min(2, restByWeek.get(weekKey(today)) ?? 0);
  return { streak, restUsedThisWeek, studiedToday };
}

// ------------------------------------------------------------- 약점 개념
export type WrongItem = {
  question_id: string;
  note_id: string | null;
  key_point_id: string | null;
  lapses: number;
};

export type WeakConcept = { note_id: string; key_point_id: string; count: number; lapses: number; questionIds: string[] };

export function weakConcepts(items: WrongItem[], limit = 5): WeakConcept[] {
  const m = new Map<string, WeakConcept>();
  for (const it of items) {
    if (!it.note_id || !it.key_point_id) continue;
    const key = `${it.note_id}:${it.key_point_id}`;
    const w = m.get(key) ?? { note_id: it.note_id, key_point_id: it.key_point_id, count: 0, lapses: 0, questionIds: [] };
    w.count++;
    w.lapses += it.lapses;
    w.questionIds.push(it.question_id);
    m.set(key, w);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.lapses - a.lapses).slice(0, limit);
}
