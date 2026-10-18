// 관리자: 테스트 플랜 고치기·지우기
// 고치면 지금 그 플랜을 쓰는 사람에게 바로 적용되고, 지우면 그 플랜의 코드도 지워지고 쓰던 사람은 원래 플랜으로 돌아간다
import type { NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { PlanBody, planRow, schemaMissing } from '../shared';

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/admin/plans/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin } = await requireAccount({ admin: true });
    const parsed = PlanBody.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '값이 올바르지 않아요.', 400);
    const { data, error } = await admin.from('custom_plans').update(planRow(parsed.data)).eq('id', id).select('*').maybeSingle();
    if (error) throw schemaMissing(error) ?? error;
    if (!data) throw new UserFacingError('not_found', '플랜을 찾을 수 없어요.', 404);
    return Response.json({ ok: true, plan: data });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/admin/plans/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin } = await requireAccount({ admin: true });
    const { error } = await admin.from('custom_plans').delete().eq('id', id);
    if (error) throw schemaMissing(error) ?? error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
