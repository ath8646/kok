// 갤러리 하나: 보기(GET), 고치기(PATCH: 만든 사람·운영자 — 이름·소개·분류), 지우기(DELETE: 운영자, 만든 사람은 다른 사람의 글이 없을 때만)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { GALLERY_COLS, assertCanWrite, galleryView, loadGallery, managesGallery, removePostFiles, requireCommunity, type GalleryRow } from '@/lib/server/share';
import { GALLERY_CATEGORIES, SHARE_TEXT, galleryKey, galleryNameProblem } from '@/lib/share';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/share/galleries/[id]'>) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, '갤러리 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const g = await loadGallery(admin, id);
    const { data: fav } = await admin.from('community_favs').select('gallery_id').eq('user_id', acc.userId).eq('gallery_id', id).maybeSingle();
    return Response.json(
      { ok: true, gallery: galleryView(g, acc, new Set(fav ? [id] : [])), manage: managesGallery(acc, g) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

const Patch = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2_000).optional(),
  category: z.enum(GALLERY_CATEGORIES).optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/share/galleries/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '갤러리 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    assertCanWrite(acc);
    const parsed = Patch.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const g = await loadGallery(admin, id);
    if (!managesGallery(acc, g)) throw new UserFacingError('forbidden', '내가 만든 갤러리만 고칠 수 있어요.', 403);
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      const name = parsed.data.name.replace(/\s+/g, ' ').trim();
      const problem = galleryNameProblem(name, acc.isAdmin);
      if (problem) throw new UserFacingError('bad_name', problem, 400);
      patch.name = name;
      patch.name_key = galleryKey(name);
    }
    if (parsed.data.description !== undefined) {
      const d = parsed.data.description.replace(/\s+/g, ' ').trim();
      if (d.length > SHARE_TEXT.galleryDesc) throw new UserFacingError('long_desc', `소개는 ${SHARE_TEXT.galleryDesc}자까지예요.`, 400);
      patch.description = d;
    }
    if (parsed.data.category) patch.category = parsed.data.category;
    if (!Object.keys(patch).length) return Response.json({ ok: true });
    const { data, error } = await admin.from('community_galleries').update(patch).eq('id', id).select(GALLERY_COLS).single();
    if (error) {
      if (error.code === '23505') throw new UserFacingError('duplicate', '같은 이름의 갤러리가 이미 있어요.', 409);
      throw error;
    }
    return Response.json({ ok: true, gallery: galleryView(data as GalleryRow, acc, new Set()) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/share/galleries/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '갤러리 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const g = await loadGallery(admin, id);
    if (!managesGallery(acc, g)) throw new UserFacingError('forbidden', '내가 만든 갤러리만 지울 수 있어요.', 403);
    const { data: posts, error } = await admin.from('community_posts').select('id, author_id').eq('gallery_id', id).limit(5000);
    if (error) throw error;
    // 만든 사람은 다른 사람의 글이 있는 갤러리를 지울 수 없다 (그 사람들의 자료가 같이 없어지지 않게)
    if (!acc.isAdmin && (posts ?? []).some((p) => p.author_id !== acc.userId)) {
      throw new UserFacingError('has_posts', '다른 사람의 글이 있는 갤러리는 지울 수 없어요. 운영자에게 문의해 주세요.', 409);
    }
    const { error: dErr } = await admin.from('community_galleries').delete().eq('id', id);
    if (dErr) throw dErr;
    await removePostFiles(admin, (posts ?? []) as Array<{ id: string; author_id: string }>);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
