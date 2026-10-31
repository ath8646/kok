// 댓글 좋아요 켜기·끄기. 돌려주는 값: 지금 좋아요 수
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { hitShare, requireCommunity } from '@/lib/server/share';

const Body = z.object({ on: z.boolean() });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/share/comments/[id]/like'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '댓글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const parsed = Body.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    await hitShare(admin, acc, 'share_like', 120, 60, '너무 빨리 눌렀어요. 잠시 뒤에 다시 해 주세요.');
    const { data, error } = await admin.rpc('kok_share_like', { p_user: acc.userId, p_type: 'comment', p_id: id, p_on: parsed.data.on });
    if (error) throw error;
    if (data === null) throw new UserFacingError('not_found', '댓글을 찾을 수 없어요.', 404);
    return Response.json({ ok: true, likes: Number(data) });
  } catch (e) {
    return errorResponse(e);
  }
}
