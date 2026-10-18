// 관리자: 테스트 플랜 목록과 만들기. 플랜은 코드(쿠폰)로 나눠 준다
import type { NextRequest } from 'next/server';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { PlanBody, planRow, schemaMissing } from './shared';

export async function GET() {
  try {
    const { admin } = await requireAccount({ admin: true });
    const { data: plans, error } = await admin.from('custom_plans').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw schemaMissing(error) ?? error;
    const nowIso = new Date().toISOString();
    // 지금 이 플랜을 쓰는 사람 수, 만든 코드 수
    const [{ data: users }, { data: codes }] = await Promise.all([
      admin.from('profiles').select('custom_plan_id').not('custom_plan_id', 'is', null).gt('custom_plan_until', nowIso).limit(10000),
      admin.from('coupons').select('plan_id, used, max_uses').not('plan_id', 'is', null).limit(10000),
    ]);
    const active = new Map<string, number>();
    for (const u of users ?? []) active.set(u.custom_plan_id as string, (active.get(u.custom_plan_id as string) ?? 0) + 1);
    const codeCount = new Map<string, { codes: number; used: number }>();
    for (const c of codes ?? []) {
      const k = c.plan_id as string;
      const cur = codeCount.get(k) ?? { codes: 0, used: 0 };
      codeCount.set(k, { codes: cur.codes + 1, used: cur.used + Number(c.used ?? 0) });
    }
    return Response.json({
      ok: true,
      plans: (plans ?? []).map((p) => ({
        ...p,
        active_users: active.get(p.id as string) ?? 0,
        codes: codeCount.get(p.id as string)?.codes ?? 0,
        redeemed: codeCount.get(p.id as string)?.used ?? 0,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin } = await requireAccount({ admin: true });
    const parsed = PlanBody.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '값이 올바르지 않아요.', 400);
    const { data, error } = await admin.from('custom_plans').insert(planRow(parsed.data)).select('*').single();
    if (error) throw schemaMissing(error) ?? error;
    return Response.json({ ok: true, plan: data });
  } catch (e) {
    return errorResponse(e);
  }
}
