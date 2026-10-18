// 자료 지우기 (노트·그림·문제·복습 기록과 올린 파일까지)
import type { NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { removeFolder } from '@/lib/server/files';

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/sources/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount({ consent: false });
    const { data: src } = await admin.from('sources').select('id, user_id').eq('id', id).maybeSingle();
    if (!src || src.user_id !== acc.userId) throw new UserFacingError('not_found', '자료를 찾을 수 없어요.', 404);
    await removeFolder(admin, `${acc.userId}/${id}`);
    const { error } = await admin.from('sources').delete().eq('id', id).eq('user_id', acc.userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
