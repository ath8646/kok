// 공유받은 노트를 내 자료함에 넣기 (AI·에너지 없이): 받은 글(내 글·운영자는 그대로)만. 고른 과목에 새 노트 + 문제(복습 카드)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertVisible, hitShare, importSharedNote, loadPost, requireCommunity } from '@/lib/server/share';

export const maxDuration = 60;

const Body = z.object({ subjectId: z.string().uuid() });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/share/posts/[id]/import'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const parsed = Body.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '넣을 과목을 골라 주세요.', 400);
    const post = await loadPost(admin, id);
    assertVisible(post, acc);
    if (!post.has_note) throw new UserFacingError('no_note', '이 글에는 노트가 없어요.', 400);
    if (post.author_id !== acc.userId && !acc.isAdmin) {
      const { data: got, error } = await admin.from('community_downloads').select('post_id').eq('user_id', acc.userId).eq('post_id', id).maybeSingle();
      if (error) throw error;
      if (!got) throw new UserFacingError('not_unlocked', '먼저 이 자료를 받아 주세요.', 403);
    }
    const { data: subject } = await admin.from('subjects').select('id').eq('id', parsed.data.subjectId).eq('user_id', acc.userId).maybeSingle();
    if (!subject) throw new UserFacingError('no_subject', '과목을 찾을 수 없어요.', 404);
    await hitShare(admin, acc, 'share_import', 30, 3600, '노트를 너무 많이 넣었어요. 한 시간 뒤에 다시 해 주세요.');
    const r = await importSharedNote(admin, acc, post, subject.id);
    return Response.json({ ok: true, sourceId: r.sourceId, noteId: r.noteId });
  } catch (e) {
    return errorResponse(e);
  }
}
