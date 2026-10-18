// 관리자: 계정 정지/풀기, Pro 켜기/끄기, 테스트 플랜 끝내기
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

const Body = z.object({
  banned: z.boolean().optional(),
  proDays: z.number().int().min(0).max(3650).optional(),
  /** true: 켜져 있는 테스트 플랜을 바로 끝낸다 (원래 플랜으로 돌아감) */
  endCustomPlan: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/admin/users/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount({ admin: true });
    const parsed = Body.safeParse(await readJson(req, 2_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '값이 올바르지 않아요.', 400);
    const b = parsed.data;
    if (b.banned && id === acc.userId) throw new UserFacingError('self', '자기 계정은 정지할 수 없어요.', 400);
    const patch: Record<string, unknown> = {};
    if (typeof b.banned === 'boolean') patch.banned = b.banned;
    if (typeof b.proDays === 'number') {
      if (b.proDays === 0) {
        patch.plan = 'free';
        patch.pro_until = null;
      } else {
        patch.plan = 'pro';
        patch.pro_until = new Date(Date.now() + b.proDays * 86400_000).toISOString();
      }
    }
    if (b.endCustomPlan) {
      patch.custom_plan_id = null;
      patch.custom_plan_start = null;
      patch.custom_plan_until = null;
    }
    if (!Object.keys(patch).length) return Response.json({ ok: true });
    const { error } = await admin.from('profiles').update(patch).eq('id', id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
