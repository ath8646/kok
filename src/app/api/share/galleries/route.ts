// 갤러리 목록·찾기(GET: 분류·이름)와 만들기(POST: 누구나, 요금제마다 만들 수 있는 수). 만든 사람은 그 갤러리의 글·댓글을 지울 수 있다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { GALLERY_COLS, assertCanWrite, galleryView, hitShare, requireCommunity, type GalleryRow } from '@/lib/server/share';
import { GALLERY_CATEGORIES, SHARE_TEXT, galleryKey, galleryNameProblem, galleryQuery } from '@/lib/share';

export async function GET(req: NextRequest) {
  try {
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const sp = req.nextUrl.searchParams;
    const category = sp.get('category');
    const q = galleryQuery(sp.get('q') ?? '');
    const sort = sp.get('sort');
    let query = admin.from('community_galleries').select(GALLERY_COLS).limit(60);
    if (category && (GALLERY_CATEGORIES as readonly string[]).includes(category)) query = query.eq('category', category);
    if (q) query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
    query =
      sort === 'new'
        ? query.order('created_at', { ascending: false })
        : query.order('post_count', { ascending: false }).order('created_at', { ascending: true });
    const [{ data, error }, { data: favs, error: fErr }] = await Promise.all([
      query,
      admin.from('community_favs').select('gallery_id').eq('user_id', acc.userId),
    ]);
    if (error) throw error;
    if (fErr) throw fErr;
    const favSet = new Set((favs ?? []).map((f) => String(f.gallery_id)));
    return Response.json(
      { ok: true, galleries: ((data ?? []) as GalleryRow[]).map((g) => galleryView(g, acc, favSet)) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({
  name: z.string().max(200),
  description: z.string().max(2_000).catch(''),
  category: z.enum(GALLERY_CATEGORIES),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    assertCanWrite(acc);
    const parsed = Body.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '분류를 골라 주세요.', 400);
    const name = parsed.data.name.replace(/\s+/g, ' ').trim();
    const problem = galleryNameProblem(name, acc.isAdmin);
    if (problem) throw new UserFacingError('bad_name', problem, 400);
    const description = parsed.data.description.replace(/\s+/g, ' ').trim();
    if (description.length > SHARE_TEXT.galleryDesc) throw new UserFacingError('long_desc', `소개는 ${SHARE_TEXT.galleryDesc}자까지예요.`, 400);
    const max = acc.lim.galleries;
    if (max !== null) {
      const { count, error } = await admin.from('community_galleries').select('id', { count: 'exact', head: true }).eq('owner_id', acc.userId);
      if (error) throw error;
      if ((count ?? 0) >= max) {
        throw new UserFacingError(
          'gallery_limit',
          max
            ? `지금 요금제에서는 갤러리를 ${max}개까지 만들 수 있어요. 안 쓰는 갤러리를 지우거나 요금제를 바꿔 주세요.`
            : '지금 요금제에서는 갤러리를 만들 수 없어요.',
          403,
        );
      }
    }
    await hitShare(admin, acc, 'share_gallery', 3, 86400, '갤러리는 하루에 3개까지 만들 수 있어요. 내일 다시 만들어 주세요.');
    const key = galleryKey(name);
    const { data, error } = await admin
      .from('community_galleries')
      .insert({ name, name_key: key, description, category: parsed.data.category, owner_id: acc.userId })
      .select(GALLERY_COLS)
      .single();
    if (error) {
      if (error.code === '23505') throw new UserFacingError('duplicate', '같은 이름의 갤러리가 이미 있어요. 찾아서 들어가 보세요.', 409);
      throw error;
    }
    // 만든 갤러리는 즐겨찾기에도 넣는다 (자료 공유 첫 화면 위에 보이게)
    await admin.from('community_favs').insert({ user_id: acc.userId, gallery_id: data.id });
    return Response.json({ ok: true, gallery: galleryView(data as GalleryRow, acc, new Set([String(data.id)])) });
  } catch (e) {
    return errorResponse(e);
  }
}
