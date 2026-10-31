// 자료 공유 파일 올리기 자리: 개수·크기·종류를 요금제대로 검사하고, 정해진 자리에 한 번만 올릴 수 있는 주소를 준다.
// 글을 만들 때 그 자리가 내 것인지 보고(community_uploads), 하루가 지나도 글이 안 된 파일은 청소가 지운다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { COMMUNITY_BUCKET, assertCanWrite, hitShare, postFolder, requireCommunity } from '@/lib/server/share';
import { SHARE_KINDS_TEXT, cleanFileName, shareContentType, shareExt, shareKindOf } from '@/lib/share';
import { josa } from '@/lib/josa';

export const maxDuration = 30;

const Body = z.object({
  /** 화면이 정한 글 번호 (새 글) 또는 고치는 글 */
  postId: z.string().uuid(),
  files: z
    .array(z.object({ key: z.string().max(40), name: z.string().min(1).max(300), size: z.number().int().positive(), preview: z.boolean().optional() }))
    .min(1)
    .max(30),
});

/** 아직 글이 안 된 올리기 자리 수의 끝 (한 사람) */
const PENDING_MAX = 60;
const MB = 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    assertCanWrite(acc);
    const parsed = Body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const b = parsed.data;
    const lim = acc.lim;
    if (b.files.length > lim.shareFiles) throw new UserFacingError('too_many_files', `글 하나에 파일은 ${lim.shareFiles}개까지 붙일 수 있어요.`, 400);
    for (const f of b.files) {
      const kind = shareKindOf(f.name);
      const label = `'${cleanFileName(f.name)}'`;
      if (!kind) throw new UserFacingError('bad_kind', `${josa(label, '은')} 올릴 수 없는 파일이에요. ${SHARE_KINDS_TEXT}만 올릴 수 있어요.`, 400);
      if (f.size > lim.shareFileMb * MB)
        throw new UserFacingError('too_big', `${josa(label, '이')} 너무 커요. 파일 한 개는 ${lim.shareFileMb}MB까지예요.`, 400);
    }
    await hitShare(admin, acc, 'share_upload', 30, 3600, '파일을 너무 많이 올렸어요. 한 시간 뒤에 다시 해 주세요.');
    // 다른 사람의 글 번호로는 올리지 못한다 (이미 있는 글이면 내 글이어야)
    const { data: post, error: pErr } = await admin.from('community_posts').select('author_id').eq('id', b.postId).maybeSingle();
    if (pErr) throw pErr;
    if (post && post.author_id !== acc.userId) throw new UserFacingError('forbidden', '내 글에만 파일을 붙일 수 있어요.', 403);
    const { count, error: cErr } = await admin
      .from('community_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', acc.userId)
      .gte('created_at', new Date(Date.now() - 86400_000).toISOString());
    if (cErr) throw cErr;
    if (!acc.isAdmin && (count ?? 0) + b.files.length * 2 > PENDING_MAX * 2) {
      throw new UserFacingError('upload_pending', '올리고 아직 글로 만들지 않은 파일이 많아요. 잠시 뒤에 다시 해 주세요.', 429);
    }

    const bucket = admin.storage.from(COMMUNITY_BUCKET);
    const out: Array<{ key: string; path: string; token: string; contentType: string; previewPath: string | null; previewToken: string | null }> = [];
    const tickets: Array<{ user_id: string; post_id: string; path: string }> = [];
    for (const f of b.files) {
      const kind = shareKindOf(f.name)!;
      const id = crypto.randomUUID();
      const path = `${postFolder(b.postId)}/${id}.${shareExt(kind, f.name)}`;
      const previewPath = f.preview ? `${postFolder(b.postId)}/${id}.preview.jpg` : null;
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error || !data?.token) throw new UserFacingError('upload_sign', '파일을 올릴 준비를 하지 못했어요. 다시 해 주세요.', 502);
      let previewToken: string | null = null;
      if (previewPath) {
        const pv = await bucket.createSignedUploadUrl(previewPath);
        if (pv.error || !pv.data?.token) throw new UserFacingError('upload_sign', '파일을 올릴 준비를 하지 못했어요. 다시 해 주세요.', 502);
        previewToken = pv.data.token;
        tickets.push({ user_id: acc.userId, post_id: b.postId, path: previewPath });
      }
      tickets.push({ user_id: acc.userId, post_id: b.postId, path });
      out.push({ key: f.key, path, token: data.token, contentType: shareContentType(kind, f.name), previewPath, previewToken });
    }
    const { error: tErr } = await admin.from('community_uploads').insert(tickets);
    if (tErr) throw tErr;
    return Response.json({ ok: true, uploads: out });
  } catch (e) {
    return errorResponse(e);
  }
}
