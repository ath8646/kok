// DB 의 1분 확인(kok_resume_ping, pg_cron·pg_net)이 부른다: 끊긴 자료 처리를 다시 잇는다 (학생이 사이트를 나가 있어도).
// 암호는 DB 안에서 만든 server_values.resume_token (어디에도 적지 않는다): 같을 때만
import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { resumeStalled } from '@/lib/server/kick';

export const maxDuration = 60;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  try {
    const admin = adminClient();
    const { data } = await admin.from('server_values').select('value').eq('key', 'resume_token').maybeSingle();
    const want = typeof data?.value === 'string' ? data.value : '';
    if (want.length < 32 || !same(req.headers.get('x-kok-resume') ?? '', want)) return Response.json({ error: 'forbidden' }, { status: 403 });
    const resumed = await resumeStalled(req.nextUrl.origin);
    return Response.json({ ok: true, resumed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[kok] resume failed', e);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
