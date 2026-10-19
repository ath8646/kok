// 개념(마인드맵 가지)마다 얼마나 기억하는지: 그 개념 문제들의 복습 카드로 정한다 (화면 공통, 시험 있음)
export type MemoryStatus = 'weak' | 'due' | 'new' | 'good';

export type MemoryInfo = {
  status: MemoryStatus;
  /** 이 개념의 문제 수 (복습에 나오는 것만) */
  total: number;
  /** 오답노트에 있는 문제 수 */
  wrong: number;
  /** 복습할 때가 된 문제 수 */
  due: number;
  /** 아직 한 번도 안 푼 문제 수 */
  fresh: number;
};

export const MEMORY_LABEL: Record<MemoryStatus, string> = {
  weak: '헷갈려요',
  due: '복습할 때예요',
  new: '아직 안 풀었어요',
  good: '잘 기억해요',
};

/** 화면 색 (ok·warn·bad 는 테마 색을 따른다) */
export const MEMORY_TONE: Record<MemoryStatus, 'bad' | 'warn' | 'plain' | 'ok'> = {
  weak: 'bad',
  due: 'warn',
  new: 'plain',
  good: 'ok',
};

/**
 * 개념 번호 → 기억 상태. 틀린 문제(오답노트)가 있으면 '헷갈려요', 복습할 때가 된 문제가 있으면 '복습할 때예요',
 * 모두 안 풀었으면 '아직 안 풀었어요', 아니면 '잘 기억해요'. 문제가 없는 개념은 목록에 없다
 */
export function keyPointMemory(
  questions: Array<{ id: string; key_point_id: string | null; status: string }>,
  cards: Map<string, { in_wrong_note: boolean; due: string; reps: number }>,
  now: number = Date.now(),
): Map<string, MemoryInfo> {
  const out = new Map<string, MemoryInfo>();
  for (const q of questions) {
    if (!q.key_point_id || q.status !== 'active') continue;
    const c = cards.get(q.id);
    const m = out.get(q.key_point_id) ?? { status: 'new', total: 0, wrong: 0, due: 0, fresh: 0 };
    m.total += 1;
    if (!c || c.reps === 0) m.fresh += 1;
    else {
      if (c.in_wrong_note) m.wrong += 1;
      if (Date.parse(c.due) <= now) m.due += 1;
    }
    out.set(q.key_point_id, m);
  }
  for (const m of out.values()) m.status = m.wrong > 0 ? 'weak' : m.due > 0 ? 'due' : m.fresh === m.total ? 'new' : 'good';
  return out;
}
