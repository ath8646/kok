// 자료 지우기 (노트·그림·문제·복습 기록과 올린 파일까지, 노트에 더한 자료와 그 파일도)
import type { NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { deleteOwnSources } from '@/lib/server/delete-sources';

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/sources/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount({ consent: false });
    const n = await deleteOwnSources(admin, acc.userId, [id]);
    if (!n) throw new UserFacingError('not_found', '자료를 찾을 수 없어요.', 404);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
