// 공유 파일 주소: 받은 글(내 글·운영자)의 파일만, 10분 동안 쓰는 주소. download 면 원래 이름으로 내려받는다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { COMMUNITY_BUCKET, FILE_COLS, assertVisible, loadPost, requireCommunity, signUrls, type FileRow } from '@/lib/server/share';

const Body = z.object({ download: z.boolean().catch(false) });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/share/files/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '파일 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const parsed = Body.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const { data, error } = await admin.from('community_files').select(FILE_COLS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new UserFacingError('not_found', '파일을 찾을 수 없어요.', 404);
    const file = data as FileRow;
    const post = await loadPost(admin, file.post_id);
    assertVisible(post, acc);
    if (post.author_id !== acc.userId && !acc.isAdmin) {
      const { data: got, error: dErr } = await admin
        .from('community_downloads')
        .select('post_id')
        .eq('user_id', acc.userId)
        .eq('post_id', post.id)
        .maybeSingle();
      if (dErr) throw dErr;
      if (!got) throw new UserFacingError('not_unlocked', '먼저 이 자료를 받아 주세요.', 403);
    }
    const urls = await signUrls(admin, COMMUNITY_BUCKET, [file.path], { seconds: 600, download: parsed.data.download ? file.name : undefined });
    const url = urls.get(file.path);
    if (!url) throw new UserFacingError('file_missing', '파일을 찾을 수 없어요. 지워졌을 수 있어요.', 404);
    return Response.json({ ok: true, url, name: file.name, kind: file.kind });
  } catch (e) {
    return errorResponse(e);
  }
}
