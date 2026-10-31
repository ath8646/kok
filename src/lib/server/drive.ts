// 자료 처리를 끝까지 이어서 돌린다. 한 번에 약 2분씩 처리하고, 남으면 자기 자신을 다시 부른다.
import 'server-only';
import { runSteps } from './pipeline';
import { signInternal } from './internal';

/** startedAt: 요청이 시작된 때 (서버 함수 시간은 after() 앞의 일부터 센다) */
export async function driveSource(id: string, origin: string, startedAt = Date.now()): Promise<void> {
  try {
    const outcome = await runSteps(id, startedAt);
    if (outcome === 'continue') await kick(id, origin);
  } catch (e) {
    console.error('[kok] drive failed', id, e);
  }
}

/** 다음 처리를 새 요청으로 시작한다 (응답은 바로 온다) */
export async function kick(id: string, origin: string): Promise<void> {
  try {
    const res = await fetch(`${origin}/api/internal/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kok-internal': signInternal(id) },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) console.warn('[kok] kick not accepted', id, res.status);
  } catch (e) {
    // 실패해도 괜찮다: 화면이 열려 있으면 이어서 부르고, 아니면 다음 접속 때 이어 간다
    console.warn('[kok] kick failed', id, e);
  }
}
