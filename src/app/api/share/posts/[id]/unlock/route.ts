// 자료 받기: 이 글의 파일·노트를 쓸 수 있게 한다. 하루에 받는 글 수는 요금제마다 (한 번 받은 글은 다시 세지 않는다, 내 글·운영자는 세지 않는다)
import type { NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertVisible, blockedIds, loadPost, requireCommunity } from '@/lib/server/share';
import { kstDayStart } from '@/lib/time';

export async function POST(req: NextRequest, ctx: RouteContext<'/api/share/posts/[id]/unlock'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const post = await loadPost(admin, id);
    assertVisible(post, acc);
    if (post.author_id === acc.userId || acc.isAdmin) return Response.json({ ok: true, left: null, daily: acc.lim.downloadsDaily });
    if ((await blockedIds(admin, acc.userId)).includes(post.author_id)) throw new UserFacingError('blocked', '차단한 사람의 글이에요.', 403);
    const limit = acc.lim.downloadsDaily;
    const { data, error } = await admin.rpc('kok_share_unlock', {
      p_user: acc.userId,
      p_post: id,
      p_since: kstDayStart().toISOString(),
      p_limit: limit,
    });
    if (error) throw error;
    const r = data as { result: string; used?: number };
    if (r.result === 'not_found') throw new UserFacingError('not_found', '글을 찾을 수 없어요.', 404);
    // 화면이 요금제 안내(더 많이 받는 요금제)를 같이 보여 준다
    if (r.result === 'limit') throw new UserFacingError('download_limit', `오늘은 자료를 ${limit}개까지 받을 수 있어요. 내일 다시 받을 수 있어요.`, 429);
    const used = r.used ?? 0;
    return Response.json({ ok: true, left: limit === null ? null : Math.max(0, limit - used), daily: limit });
  } catch (e) {
    return errorResponse(e);
  }
}
