// 관리자: 숫자 요약, 키 상태, 운영 설정
import { requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { errorResponse } from '@/lib/server/errors';
import { keyHint } from '@/lib/server/claude';
import { kstDayStart, kstMonthStart } from '@/lib/time';

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
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
