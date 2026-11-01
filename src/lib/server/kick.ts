// 다음 자료 처리 요청 부르기(이어 달리기)와 끊긴 처리 다시 잇기. 파이프라인(pdf.js 등)을 싣지 않아서
// 끊긴 처리를 잇기만 하는 라우트(/api/internal/resume·매일 청소)도 가볍게 쓴다 (실제 처리는 drive.ts → pipeline.ts)
import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { STALL_MS, sleep } from '@/lib/relay';
import { signInternal } from './internal';

type KickOptions = {
  /** 이때까지만 부르기를 해 본다 (서버 함수가 끝나기 전) */
  until?: number;
  tries?: number;
  wait?: boolean;
  /** 처음 부르기 전에 쉬는 시간 */
  delayMs?: number;
};

/**
 * 다음 처리를 새 요청으로 시작한다 (응답은 바로 온다). 부르지 못하면 조금 쉬었다가 두 번 더 해 본다.
 * 받아들였으면 true. 서명·주소가 틀린 거절은 다시 해도 같아서 바로 그만둔다
 */
export async function kick(id: string, origin: string, o: KickOptions = {}): Promise<boolean> {
  const until = o.until ?? Date.now() + 25_000;
  const body = JSON.stringify({ id, ...(o.tries ? { tries: o.tries } : {}), ...(o.wait ? { wait: true } : {}) });
  for (let attempt = 0; attempt < 3; attempt++) {
    const pause = attempt === 0 ? (o.delayMs ?? 0) : attempt === 1 ? 1_000 : 3_000;
    if (pause) await sleep(Math.min(pause, until - Date.now() - 2_000));
    const left = until - Date.now();
    if (left < 1_500) break;
    try {
      const res = await fetch(`${origin}/api/internal/process`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kok-internal': signInternal(id) },
        body,
        signal: AbortSignal.timeout(Math.min(10_000, left)),
        cache: 'no-store',
      });
      if (res.ok) return true;
      console.warn('[kok] kick not accepted', id, res.status);
      if (res.status < 500 && res.status !== 408 && res.status !== 429) return false;
    } catch (e) {
      // 부르기가 늦게 끝났을 뿐 받아들였을 수도 있다: 다시 불러도 잠금이 한 번만 하게 한다
      console.warn('[kok] kick failed', id, attempt + 1, e instanceof Error ? e.message : e);
    }
  }
  return false;
}

/**
 * DB 의 1분 확인(kok_resume_ping)이 끊긴 처리를 이을 때 부를 이 앱의 주소를 적어 둔다 (서버 인스턴스마다 한 번, 바뀌었을 때만).
 * Vercel 이면 실제 서비스 주소, 아니면 이 요청의 주소. 표가 없는 예전 DB 면 넘어간다
 */
let siteKnown: string | null = null;
export async function rememberSite(origin: string): Promise<void> {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = prod ? `https://${prod.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : origin.replace(/\/+$/, '');
  if (!url || siteKnown === url) return;
  siteKnown = url;
  try {
    const { error } = await adminClient().from('server_values').upsert({ key: 'site_url', value: url, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) {
    // 표가 없는 예전 DB (schema.sql 을 다시 실행하기 전): 다음 인스턴스에서 다시 해 본다
    console.warn('[kok] site url not saved', e instanceof Error ? e.message : (e as { message?: string })?.message);
  }
}

/**
 * 끊긴 처리 다시 잇기: 정리 중인데 STALL_MS 넘게 아무도 하지 않는(잠금이 없거나 풀린) 자료를 다시 부른다.
 * DB 의 1분 확인(/api/internal/resume)과 매일 청소가 부른다. 하루 넘게 멈춘 것은 매일 청소가 실패로 바꾼다. 부른 수를 돌려준다
 */
export async function resumeStalled(origin: string, limit = 20): Promise<number> {
  const admin = adminClient();
  const now = Date.now();
  const { data, error } = await admin
    .from('sources')
    .select('id, locked_until')
    .in('status', ['queued', 'processing'])
    .lt('updated_at', new Date(now - STALL_MS).toISOString())
    .gt('updated_at', new Date(now - 86_400_000).toISOString())
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const ids = (data ?? []).filter((r) => !r.locked_until || Date.parse(String(r.locked_until)) < now - 15_000).map((r) => String(r.id));
  if (ids.length) console.warn('[kok] resuming stalled sources', ids.length);
  const accepted = await Promise.all(ids.map((id) => kick(id, origin, { until: Date.now() + 20_000 })));
  return accepted.filter(Boolean).length;
}
