// 자료 처리 이어 달리기의 시간 규칙 (서버 pipeline·drive 가 쓴다, 시험 relay.test.ts).
// 서버 함수 한 번은 FUNCTION_MS(300초)까지 산다. 단계는 RUN_MS(272초) 안에 끝내고, 남은 시간에 다음 요청을 부른다.
// 잠금은 그 서버 함수가 끝나는 때까지만 잡아서, 함수가 멈추거나 다음 요청을 부르지 못해도 곧 다른 요청이 이어 간다.

/** 서버 함수 한 번의 최대 시간 (자료 처리 라우트의 maxDuration 300초와 같게) */
export const FUNCTION_MS = 300_000;
/** 서버 함수 한 번에서 단계를 끝내야 하는 때 (시작부터, 300초에서 저장·다음 요청 부르기 여유를 뺀 값) */
export const RUN_MS = 272_000;
/** 잠금은 서버 함수가 끝나는 때보다 이만큼 더 (DB 와 서버의 시계가 조금 달라도 두 요청이 같은 단계를 하지 않게) */
export const LOCK_PAD_MS = 10_000;
/** 서버 함수가 끝나기 이만큼 전에도 단계가 끝나지 않았으면(무언가 멈췄다) 다음 요청을 미리 부른다 */
export const WATCHDOG_BEFORE_MS = 12_000;
/** 다른 요청이 잡은 단계가 이 안에 풀리면 기다렸다가 잇는다 (잡은 요청의 서버 함수가 끝나 가거나 멈췄다) */
export const LOCK_WAIT_MS = 45_000;
/** 잠금을 기다리는 동안 이만큼마다 다시 본다 (잡은 요청이 일찍 놓으면 바로 잇게) */
export const LOCK_POLL_MS = 5_000;
/** 정리 중인데 이만큼 아무도 하지 않으면(잠금도 없다) 이어 달리기가 끊긴 것 (DB 의 1분 확인 kok_resume_ping 과 같게: 3분) */
export const STALL_MS = 180_000;
/** 서버 오류(DB 등)로 이어 달리기가 끊길 때 다시 부르는 수 (계속 오류면 멈추고, 화면·청소가 나중에 잇는다) */
export const DRIVE_ERRORS_MAX = 4;

/** 단계를 잡는 시간(초): 이 서버 함수가 끝나는 때 + 여유까지. deadline = 요청이 시작된 때 + RUN_MS */
export function lockSeconds(deadline: number, now: number): number {
  const end = deadline - RUN_MS + FUNCTION_MS + LOCK_PAD_MS;
  return Math.max(30, Math.min(Math.ceil((FUNCTION_MS + LOCK_PAD_MS) / 1000), Math.ceil((end - now) / 1000)));
}

/**
 * 다른 요청이 잡은 단계를 기다릴 시간(ms). 잠금이 maxWait 안에 풀리면 그때까지(0 이면 이미 풀렸다: 바로 다시),
 * 더 오래 잡혀 있으면 null (잡은 요청이 살아 있다: 그 요청이 이어 간다)
 */
export function lockWait(lockedUntil: string | null | undefined, now: number, maxWait: number): number | null {
  if (!lockedUntil) return 0;
  const until = Date.parse(lockedUntil);
  if (!Number.isFinite(until)) return null;
  // 풀린 뒤 조금 더 (DB 시계가 조금 늦어도 바로 잡을 수 있게)
  const ms = until - now + 1_500;
  if (ms <= 0) return 0;
  return ms <= maxWait ? ms : null;
}

/** 한 단계에서 같이 부르는 AI 수 (정리 조각·원래 문제·그림 다시 그리기): KOK_AI_PARALLEL (1~5, 기본 3. 1이면 예전처럼 하나씩) */
export function aiParallel(raw: string | undefined = process.env.KOK_AI_PARALLEL): number {
  const n = Math.round(Number(raw));
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 1 ? Math.min(5, n) : 3;
}

/** 같이 부르는 AI 는 조금씩 늦게 시작한다 (먼저 부른 것이 먼저 들어가, 요청 한도에 걸려도 그 단계의 일은 산다) */
export const STAGGER_MS = 1_200;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
