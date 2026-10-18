// 오늘 풀 문제 고르기, 시험 모드, 연속 기록, 약점 개념 (AI 없이, 화면에서 계산)
import { daysUntil, kstDateString } from './time';

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
export function pickToday(cards: PlanCard[], subjects: PlanSubject[], opts: PlanOptions): PlanCard[] {
  const now = opts.now ?? new Date();
  const subj = new Map(subjects.map((s) => [s.id, s]));
  const due = cards.filter((c) => effectiveDue(c, subj.get(c.subject_id), now) <= now.getTime());
  const room = Math.max(0, opts.dailyMax - opts.doneToday);
  const ranked = due
    .map((c) => ({ c, p: priority(c, subj.get(c.subject_id), now) }))
    .sort((a, b) => b.p - a.p || Date.parse(a.c.due) - Date.parse(b.c.due))
    .slice(0, room)
    .map((x) => x.c);
  if (!opts.interleave) {
    // 과목끼리 모아서 (우선순위가 높은 과목부터)
    const order: string[] = [];
    for (const c of ranked) if (!order.includes(c.subject_id)) order.push(c.subject_id);
    return order.flatMap((s) => ranked.filter((c) => c.subject_id === s));
  }
  // 섞어 풀기: 과목을 번갈아 낸다
  const groups = new Map<string, PlanCard[]>();
  for (const c of ranked) {
    const g = groups.get(c.subject_id) ?? [];
    g.push(c);
    groups.set(c.subject_id, g);
  }
  const out: PlanCard[] = [];
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
