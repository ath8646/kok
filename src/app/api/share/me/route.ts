// 내 활동: 받은 자료(최근), 내가 만든 갤러리, 오늘 받을 수 있는 수 (내 글은 /api/share/posts?mine=1, 차단 목록은 /api/share/blocks)
import { requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { GALLERY_COLS, POST_COLS, galleryView, requireCommunity, summaries, type GalleryRow, type PostRow } from '@/lib/server/share';
import { kstDayStart } from '@/lib/time';

export async function GET() {
  try {
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const [got, mineG, favs, used] = await Promise.all([
      admin.from('community_downloads').select('post_id, created_at').eq('user_id', acc.userId).order('created_at', { ascending: false }).limit(40),
      admin.from('community_galleries').select(GALLERY_COLS).eq('owner_id', acc.userId).order('created_at', { ascending: false }),
      admin.from('community_favs').select('gallery_id').eq('user_id', acc.userId),
      admin
        .from('community_downloads')
        .select('post_id', { count: 'exact', head: true })
        .eq('user_id', acc.userId)
        .gte('created_at', kstDayStart().toISOString()),
    ]);
    for (const r of [got, mineG, favs, used]) if (r.error) throw r.error;
    const ids = (got.data ?? []).map((d) => String(d.post_id));
    const { data: posts, error } = ids.length ? await admin.from('community_posts').select(POST_COLS).in('id', ids) : { data: [], error: null };
    if (error) throw error;
    const byId = new Map(((posts ?? []) as PostRow[]).filter((p) => !p.hidden).map((p) => [p.id, p]));
    const ordered = ids.map((id) => byId.get(id)).filter((p): p is PostRow => !!p);
    const favSet = new Set((favs.data ?? []).map((f) => String(f.gallery_id)));
    const limit = acc.lim.downloadsDaily;
    return Response.json(
      {
        ok: true,
        received: await summaries(admin, ordered, acc),
        galleries: ((mineG.data ?? []) as GalleryRow[]).map((g) => galleryView(g, acc, favSet)),
        galleryLimit: acc.lim.galleries,
        downloads: { left: limit === null ? null : Math.max(0, limit - (used.count ?? 0)), daily: limit },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
