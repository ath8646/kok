// 과목 지우기 (자료 파일까지)
import type { NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { removeFolder } from '@/lib/server/files';
import { removeChatFolders } from '@/lib/server/chat-input';

export const maxDuration = 120;

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/subjects/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount({ consent: false });
    const { data: subj } = await admin.from('subjects').select('id, user_id').eq('id', id).maybeSingle();
    if (!subj || subj.user_id !== acc.userId) throw new UserFacingError('not_found', '과목을 찾을 수 없어요.', 404);
    const { data: sources } = await admin.from('sources').select('id').eq('subject_id', id).eq('user_id', acc.userId);
    for (const s of sources ?? []) await removeFolder(admin, `${acc.userId}/${s.id}`);
    // 노트 채팅에 보관한 사진·파일 (Pro)
    await removeChatFolders(
      admin,
      acc.userId,
      (sources ?? []).map((s) => s.id as string),
    );
    const { error } = await admin.from('subjects').delete().eq('id', id).eq('user_id', acc.userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
