// 댓글·답글 쓰기 (답글은 한 단계만). 익명으로 쓰면 그 글 안에서 '익명1'·'익명(글쓴이)'처럼 보인다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertCanWrite, assertVisible, blockedIds, hitShare, loadPost, requireCommunity, writerName } from '@/lib/server/share';
import { SHARE_TEXT } from '@/lib/share';

const Body = z.object({ body: z.string().max(5_000), parentId: z.string().uuid().nullable().optional(), anonymous: z.boolean().catch(false) });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/share/posts/[id]/comments'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    assertCanWrite(acc);
    const parsed = Body.safeParse(await readJson(req, 10_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const text = parsed.data.body
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) throw new UserFacingError('empty', '댓글을 적어 주세요.', 400);
    if (text.length > SHARE_TEXT.comment) throw new UserFacingError('long', `댓글은 ${SHARE_TEXT.comment.toLocaleString('ko-KR')}자까지예요.`, 400);
    const post = await loadPost(admin, id);
    assertVisible(post, acc);
    if (post.author_id !== acc.userId && !post.anonymous && (await blockedIds(admin, acc.userId)).includes(post.author_id)) {
      throw new UserFacingError('blocked', '차단한 사람의 글에는 댓글을 쓸 수 없어요.', 403);
    }
    let parent: string | null = null;
    if (parsed.data.parentId) {
      const { data: p, error } = await admin.from('community_comments').select('id, post_id, parent_id, deleted').eq('id', parsed.data.parentId).maybeSingle();
      if (error) throw error;
      if (!p || p.post_id !== id) throw new UserFacingError('not_found', '답글을 달 댓글을 찾을 수 없어요.', 404);
      if (p.deleted) throw new UserFacingError('deleted', '지운 댓글에는 답글을 달 수 없어요.', 400);
      // 답글의 답글은 그 댓글 아래 같은 줄에
      parent = (p.parent_id as string | null) ?? (p.id as string);
    }
    const author = writerName(acc, parsed.data.anonymous);
    await hitShare(admin, acc, 'share_comment', 20, 300, '댓글을 너무 빨리 쓰고 있어요. 잠시 뒤에 다시 써 주세요.');
    const { data, error } = await admin
      .from('community_comments')
      .insert({ post_id: id, parent_id: parent, author_id: acc.userId, author_name: author, anonymous: parsed.data.anonymous, body: text })
      .select('id')
      .single();
    if (error) throw error;
    return Response.json({ ok: true, id: data.id });
  } catch (e) {
    return errorResponse(e);
  }
}
