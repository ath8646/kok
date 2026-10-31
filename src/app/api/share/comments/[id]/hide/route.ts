// 운영자: 신고된 댓글 가리기·다시 보이기 (신고가 쌓이면 저절로 가려진다: /api/share/report). 그 댓글의 열린 신고는 가리면 해결·다시 보이면 기각
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { requireCommunity, settleShareReports } from '@/lib/server/share';

const Body = z.object({ hidden: z.boolean() });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/share/comments/[id]/hide'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '댓글 번호');
    const { admin } = await requireAccount({ admin: true });
    await requireCommunity(admin);
    const parsed = Body.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const { data, error } = await admin.from('community_comments').update({ hidden: parsed.data.hidden }).eq('id', id).eq('deleted', false).select('id');
    if (error) throw error;
    if (!data?.length) throw new UserFacingError('not_found', '댓글을 찾을 수 없어요. 지워졌을 수 있어요.', 404);
    await settleShareReports(admin, 'comment', id, parsed.data.hidden);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
