// 요금제 표: 무료·Pro·Max 의 값과 혜택 (관리자가 고친 그대로). 요금제 화면이 읽는다
import { requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { errorResponse } from '@/lib/server/errors';

export async function GET() {
  try {
    const { admin } = await requireAccount({ consent: false });
    const app = await getAppSettings(admin);
    return Response.json({ ok: true, plans: app.plans, freeFileDays: app.limits.freeFileDays }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
