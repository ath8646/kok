// 홈(오늘)에 보일 것: 복습 계획, 공부한 날, 최근 노트, 저장한 오늘의 KOK. 한 번에 읽고 기억해 둔다
// (홈에 다시 들어오면 기억해 둔 화면을 바로 보여 주고 뒤에서 새로 읽는다: src/lib/view-cache.ts)
import {
  NOTE_PEEK,
  fetchPlanData,
  fetchRecentPace,
  fetchReviewedSince,
  fetchSession,
  fetchSources,
  fetchStudyDays,
  peekText,
  sb,
  type NotePeek,
  type PlanData,
  type SourceRowWithUnit,
} from './data';
import { paceFrom } from './review-plan';
import type { SessionRow } from './review-session';
import { kstDateString } from './time';
import { viewStamp, writeView, writesSettled } from './view-cache';

/** manual: AI 없이 직접 만든 노트 */
export type Recent = SourceRowWithUnit & { summary: string | null; manual?: boolean };

/** 오늘의 KOK (features.sessions): 저장한 세션(그날 것)과 세션 밖에서 푼 문제, 내 빠르기 (새 계획을 고를 때) */
export type HomeSession = { row: SessionRow | null; reviewed: Map<string, string>; pace: number };

export type HomeData = { plan: PlanData; days: string[]; recent: Recent[]; home: HomeSession | null };

/** 기억해 두는 이름: 날마다 따로 (자정이 지나면 어제 화면을 보여 주지 않는다) */
export function homeViewKey(now = new Date()): string {
  return `home:${kstDateString(now)}`;
}

/** organize: 별표·복습 칸도 읽는다 (features.organize, 홈에서 여러 개 골라 바꿀 때 단추 글을 정한다) */
async function fetchRecent(organize: boolean): Promise<Recent[]> {
  const rows = await fetchSources({ limit: 8, organize });
  const ready = rows.filter((r) => r.status === 'ready').map((r) => r.id);
  const sums = new Map<string, NotePeek>();
  if (ready.length) {
    const { data } = await sb().from('notes').select(NOTE_PEEK).in('source_id', ready);
    for (const n of (data ?? []) as unknown as NotePeek[]) sums.set(n.source_id, n);
  }
  return rows.map((r) => {
    const n = sums.get(r.id);
    return { ...r, summary: n ? peekText(n) : null, manual: n?.manual === 'true' };
  });
}

async function fetchHomeSession(plan: PlanData): Promise<HomeSession> {
  const [row, logs] = await Promise.all([fetchSession('home').catch(() => null), fetchRecentPace().catch(() => [])]);
  const todayRow = row && row.day === kstDateString(new Date()) ? row : null;
  const reviewed = todayRow ? await fetchReviewedSince(todayRow.created_at).catch(() => new Map<string, string>()) : new Map<string, string>();
  const types = new Map(plan.cards.map((c) => [c.question_id, c.type]));
  const pace = paceFrom(logs.map((l) => ({ ms: l.ms, type: l.question_id ? types.get(l.question_id) : null })));
  return { row: todayRow, reviewed, pace };
}

/** 정리 중인 자료 목록을 기억해 두는 이름 (홈·자료함의 정리 목록이 같이 쓴다: ProcessingList) */
export function activeViewKey(subjectId?: string): string {
  return `active:${subjectId ?? ''}`;
}

/** 정리 중인 자료 (queued·processing·error, 20개까지) */
export function loadActive(subjectId?: string): Promise<SourceRowWithUnit[]> {
  return fetchSources({ subjectId, active: true, limit: 20 });
}

/** 어떤 칸이 DB 에 있는지 (me.features): sessions 저장한 세션 표, organize 자료함 정리 칸 */
export type HomeFeatures = { sessions: boolean; organize: boolean };

/** 홈에 보일 것을 모두 읽는다 (복습 계획을 못 읽으면 실패, 공부한 날·최근 노트는 못 읽으면 빈 목록) */
export async function loadHome(f: HomeFeatures): Promise<HomeData> {
  const [plan, days, recent] = await Promise.all([fetchPlanData(), fetchStudyDays(120).catch(() => []), fetchRecent(f.organize).catch(() => [])]);
  const home = f.sessions ? await fetchHomeSession(plan) : null;
  return { plan, days, recent, home };
}

/**
 * 홈으로 갈 것 같을 때(복습을 끝낸 뒤) 홈과 정리 중인 자료 목록을 미리 읽어 기억해 둔다: 홈을 열면 바로 보인다.
 * 진행 중인 저장이 모두 끝난 뒤에 읽는다 (읽는 사이에 또 쓰기가 있었으면 기억하지 않는다)
 */
export function warmHome(owner: string | null | undefined, f: HomeFeatures): void {
  if (!owner) return;
  writesSettled()
    .then(() => {
      const stamp = viewStamp();
      const key = homeViewKey();
      return Promise.all([loadHome(f), loadActive()]).then(([home, active]) => {
        writeView(key, owner, home, { stamp });
        writeView(activeViewKey(), owner, active, { stamp });
      });
    })
    .catch(() => {});
}
