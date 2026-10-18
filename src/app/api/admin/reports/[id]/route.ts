// 관리자: 신고 처리 (해결/기각, 문제 쉬게 하기)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

const Body = z.object({ status: z.enum(['resolved', 'dismissed', 'open']), suspendQuestion: z.boolean().optional() });

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/admin/reports/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const rid = Number(id);
    if (!Number.isInteger(rid) || rid <= 0) throw new UserFacingError('bad_id', '번호가 올바르지 않아요.', 400);
    const { admin } = await requireAccount({ admin: true });
    const parsed = Body.safeParse(await readJson(req, 2_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '값이 올바르지 않아요.', 400);
    const { data: rep } = await admin.from('reports').select('id, target_type, target_id').eq('id', rid).maybeSingle();
    if (!rep) throw new UserFacingError('not_found', '신고를 찾을 수 없어요.', 404);
    const { error } = await admin
      .from('reports')
      .update({ status: parsed.data.status, resolved_at: parsed.data.status === 'open' ? null : new Date().toISOString() })
      .eq('id', rid);
    if (error) throw error;
    if (parsed.data.suspendQuestion && rep.target_type === 'question' && rep.target_id) {
      await admin.from('questions').update({ status: 'suspended' }).eq('id', rep.target_id);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
