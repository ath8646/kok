// 자료 처리를 끝까지 이어서 돌린다. 서버 함수 한 번에 약 4분 반씩 처리하고, 남으면 자기 자신을 다시 부른다(이어 달리기).
// 학생이 화면을 닫거나 사이트를 나가도 서버에서 끝까지 간다. 끊기지 않게:
//  - 다음 요청 부르기는 몇 번 다시 해 본다 (kick)
//  - 서버 함수가 끝나 가는데 단계가 끝나지 않았으면(무언가 멈췄다) 다음 요청을 미리 부른다: 그 요청은 잠금이 풀리길 기다렸다가 잇는다
//  - 서버 오류(DB 등)로 멈추면 조금 뒤 다시 부른다 (DRIVE_ERRORS_MAX 번까지)
//  - 그래도 끊긴 처리는 DB 의 1분 확인(kok_resume_ping → /api/internal/resume)·매일 청소·열린 화면이 다시 잇는다
import 'server-only';
import { DRIVE_ERRORS_MAX, FUNCTION_MS, WATCHDOG_BEFORE_MS } from '@/lib/relay';
import { runSteps } from './pipeline';
import { kick, rememberSite } from './kick';

type DriveOptions = {
  /** 서버 오류로 다시 부른 수 (계속 오류면 멈춘다) */
  tries?: number;
  /** 앞 요청이 멈춘 것을 알고 부른 요청: 잠금이 풀릴 때까지 기다렸다가 잇는다 */
  wait?: boolean;
};

/** startedAt: 요청이 시작된 때 (서버 함수 시간은 after() 앞의 일부터 센다) */
export async function driveSource(id: string, origin: string, startedAt = Date.now(), o: DriveOptions = {}): Promise<void> {
  void rememberSite(origin);
  // 서버 함수가 끝나기 전에 다음 요청을 부를 수 있는 마지막 때
  const until = startedAt + FUNCTION_MS - 1_000;
  /** 서버 함수가 끝나 가서 미리 부른 다음 요청 (받아들였는지) */
  const early: { kicked: Promise<boolean> | null } = { kicked: null };
  const timer = setTimeout(
    () => {
      // 단계가 아직 끝나지 않았다 (무언가 멈췄다): 이 함수가 끊겨도 다음 요청이 잠금이 풀린 뒤 잇는다
      console.warn('[kok] drive: still running near the time limit, calling the next one early', id);
      early.kicked = kick(id, origin, { until, wait: true });
    },
    Math.max(0, startedAt + FUNCTION_MS - WATCHDOG_BEFORE_MS - Date.now()),
  );
  try {
    const outcome = await runSteps(id, startedAt, { wait: o.wait });
    clearTimeout(timer);
    // 미리 부른 요청이 잇는다 (부르지 못했으면 지금 다시)
    if (outcome === 'continue' && !(early.kicked && (await early.kicked))) await kick(id, origin, { until });
  } catch (e) {
    clearTimeout(timer);
    console.error('[kok] drive failed', id, e);
    const tries = (o.tries ?? 0) + 1;
    // 잠깐의 서버 오류일 수 있다: 조금 뒤 다시 (잠금이 남았으면 풀릴 때까지 기다린다). 계속 오류면 멈춘다 (화면·DB 확인이 나중에 잇는다)
    if (tries < DRIVE_ERRORS_MAX && !(early.kicked && (await early.kicked))) await kick(id, origin, { until, tries, wait: true, delayMs: 3_000 * tries });
  }
}
