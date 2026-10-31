// 댓글 고치기(쓴 사람·운영자)와 지우기(쓴 사람·갤러리 만든 사람·운영자). 답글이 달린 댓글은 내용만 지운다 ('지운 댓글이에요')
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertCanWrite, loadGallery, loadPost, managesGallery, requireCommunity } from '@/lib/server/share';
import { SHARE_TEXT } from '@/lib/share';

async function loadComment(admin: Parameters<typeof loadPost>[0], id: string) {
  const { data, error } = await admin.from('community_comments').select('id, post_id, parent_id, author_id, deleted').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || data.deleted) throw new UserFacingError('not_found', '댓글을 찾을 수 없어요. 지워졌을 수 있어요.', 404);
  return data as { id: string; post_id: string; parent_id: string | null; author_id: string; deleted: boolean };
}

const Body = z.object({ body: z.string().max(5_000) });

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/share/comments/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '댓글 번호');
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
    const c = await loadComment(admin, id);
    if (c.author_id !== acc.userId && !acc.isAdmin) throw new UserFacingError('forbidden', '내가 쓴 댓글만 고칠 수 있어요.', 403);
    const { error } = await admin.from('community_comments').update({ body: text, edited_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/share/comments/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '댓글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const c = await loadComment(admin, id);
    if (c.author_id !== acc.userId) {
      const post = await loadPost(admin, c.post_id);
      if (!managesGallery(acc, await loadGallery(admin, post.gallery_id))) {
        throw new UserFacingError('forbidden', '내 댓글이나 내가 만든 갤러리의 댓글만 지울 수 있어요.', 403);
      }
    }
    // 답글이 있으면 내용만 지운다 (아래 답글이 갈 곳을 잃지 않게), 없으면 행을 지운다
    const { count, error: rErr } = await admin.from('community_comments').select('id', { count: 'exact', head: true }).eq('parent_id', id).eq('deleted', false);
    if (rErr) throw rErr;
    const { error } = count
      ? await admin.from('community_comments').update({ deleted: true, body: '(지운 댓글)' }).eq('id', id)
      : await admin.from('community_comments').delete().eq('id', id);
    if (error) throw error;
    // 지운 답글의 부모가 이미 지운 댓글이고 남은 답글이 없으면 부모도 지운다
    if (c.parent_id) {
      const { data: parent } = await admin.from('community_comments').select('id, deleted').eq('id', c.parent_id).maybeSingle();
      if (parent?.deleted) {
        const { count: left } = await admin
          .from('community_comments')
          .select('id', { count: 'exact', head: true })
          .eq('parent_id', c.parent_id)
          .eq('deleted', false);
        if (!left) await admin.from('community_comments').delete().eq('id', c.parent_id);
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
