// 관리자: 숫자 요약, 키 상태, 운영 설정
import { requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { errorResponse } from '@/lib/server/errors';
import { keyHint } from '@/lib/server/claude';
import { kstDayStart, kstMonthStart } from '@/lib/time';
import { cloudflareReady } from '@/lib/server/cloudflare';

export async function GET() {
  try {
    const { admin } = await requireAccount({ admin: true });
    const app = await getAppSettings(admin, true);
    const { data: stats, error } = await admin.rpc('kok_admin_stats', {
      p_month_start: kstMonthStart().toISOString(),
      p_day_start: kstDayStart().toISOString(),
    });
    if (error) throw error;
    const hint = keyHint();
    // 끊긴 자료 처리 다시 잇기: DB 의 1분 확인(pg_cron·pg_net)이 최근에 돌았는지, 부를 이 앱의 주소를 알고 있는지 (표가 없는 예전 DB 면 꺼짐)
    const { data: values } = await admin.from('server_values').select('key, value, updated_at').in('key', ['resume_ping_at', 'site_url']);
    const pingAt = values?.find((r) => r.key === 'resume_ping_at')?.updated_at as string | undefined;
    const resume = {
      on: !!pingAt && Date.now() - Date.parse(pingAt) < 5 * 60_000,
      site: !!values?.some((r) => r.key === 'site_url' && r.value),
    };
    return Response.json(
      {
        ok: true,
        stats,
        key: { connected: !!hint, hint },
        settings: app,
        env: {
          supabaseSecret: !!process.env.SUPABASE_SECRET_KEY,
          adminEmails: !!process.env.ADMIN_EMAILS,
          cronSecret: !!process.env.CRON_SECRET,
          // 테마 AI 그림 (없으면 무늬로 대신한다)
          cloudflare: cloudflareReady(),
          resume,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
