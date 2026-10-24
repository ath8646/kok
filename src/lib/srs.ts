// 간격 반복 (FSRS, ts-fsrs). 카드 상태는 cards 표의 칸 + fsrs(json) 에 나눠 저장한다.
import { fsrs, createEmptyCard, TypeConvert, type Card, type FSRS, type Grade, type State } from 'ts-fsrs';

const cache = new Map<number, FSRS>();

export function scheduler(retention = 0.9): FSRS {
  const r = Math.min(0.97, Math.max(0.7, retention));
  const key = Math.round(r * 1000);
  let s = cache.get(key);
  if (!s) {
    s = fsrs({ request_retention: r, enable_fuzz: true, maximum_interval: 3650 });
    cache.set(key, s);
  }
  return s;
}

export type StoredCard = {
  due: string;
  state: number;
  reps: number;
  lapses: number;
  last_review: string | null;
  fsrs: Record<string, unknown>;
};

export function toCard(row: StoredCard, now: Date): Card {
  const f = row.fsrs ?? {};
  if (!row.reps && !f.stability) return createEmptyCard(now);
  return TypeConvert.card({
    due: row.due,
    stability: Number(f.stability ?? 0),
    difficulty: Number(f.difficulty ?? 0),
    elapsed_days: Number(f.elapsed_days ?? 0),
    scheduled_days: Number(f.scheduled_days ?? 0),
    learning_steps: Number(f.learning_steps ?? 0),
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ?? undefined,
  });
}

export function fromCard(c: Card): StoredCard {
  return {
    due: c.due.toISOString(),
    state: c.state as number,
    reps: c.reps,
    lapses: c.lapses,
    last_review: c.last_review ? c.last_review.toISOString() : null,
    fsrs: {
      stability: c.stability,
      difficulty: c.difficulty,
      elapsed_days: c.elapsed_days,
      scheduled_days: c.scheduled_days,
      learning_steps: c.learning_steps,
    },
  };
}

/** 한 번 푼 결과로 다음 상태를 계산한다 */
export function reviewCard(row: StoredCard, rating: 1 | 2 | 3 | 4, now: Date, retention = 0.9): StoredCard {
  const s = scheduler(retention);
  const { card } = s.next(toCard(row, now), now, rating as Grade);
  return fromCard(card);
}

/** 다음 복습까지 남은 시간 (화면 표시용) */
export function dueLabel(dueIso: string, now: Date = new Date()): string {
  const ms = Date.parse(dueIso) - now.getTime();
  if (ms <= 60_000) return '곧';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}분 뒤`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 뒤`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}일 뒤`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}달 뒤`;
  return `${Math.round(mo / 12)}년 뒤`;
}
