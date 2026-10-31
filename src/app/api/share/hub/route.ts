// 자료 공유 첫 화면: 즐겨찾는 갤러리, 인기 갤러리, 새 글·인기 글, 오늘 받을 수 있는 수
import { requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { GALLERY_COLS, blockedIds, galleryView, requireCommunity, summaries, type GalleryRow, type PostRow } from '@/lib/server/share';
import { kstDayStart } from '@/lib/time';

export async function GET() {
  try {
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const blocked = await blockedIds(admin, acc.userId);
    const list = (sort: 'new' | 'hot', limit: number) =>
      admin.rpc('kok_share_posts', {
        p_gallery: null,
        p_words: null,
        p_kind: null,
        p_sort: sort,
        p_author: null,
        p_exclude: blocked.length ? blocked : null,
        p_hidden: false,
        p_limit: limit,
        p_offset: 0,
      });
    const [favs, popular, fresh, hot, used] = await Promise.all([
      admin.from('community_favs').select('gallery_id, created_at').eq('user_id', acc.userId).order('created_at').limit(50),
      admin.from('community_galleries').select(GALLERY_COLS).order('post_count', { ascending: false }).order('created_at').limit(12),
      list('new', 12),
      list('hot', 6),
      admin
        .from('community_downloads')
        .select('post_id', { count: 'exact', head: true })
        .eq('user_id', acc.userId)
        .gte('created_at', kstDayStart().toISOString()),
    ]);
    for (const r of [favs, popular, fresh, hot, used]) if (r.error) throw r.error;
    const favIds = (favs.data ?? []).map((f) => String(f.gallery_id));
    const favSet = new Set(favIds);
    const { data: favRows, error: gErr } = favIds.length
      ? await admin.from('community_galleries').select(GALLERY_COLS).in('id', favIds)
      : { data: [], error: null };
    if (gErr) throw gErr;
    const byId = new Map(((favRows ?? []) as GalleryRow[]).map((g) => [g.id, g]));
    const limit = acc.lim.downloadsDaily;
    return Response.json(
      {
        ok: true,
        favorites: favIds
          .map((id) => byId.get(id))
          .filter((g): g is GalleryRow => !!g)
          .map((g) => galleryView(g, acc, favSet)),
        popular: ((popular.data ?? []) as GalleryRow[]).map((g) => galleryView(g, acc, favSet)),
        recent: await summaries(admin, (fresh.data ?? []) as PostRow[], acc),
        hot: await summaries(
          admin,
          ((hot.data ?? []) as PostRow[]).filter((p) => p.like_count + p.download_count > 0),
          acc,
        ),
        downloads: { left: limit === null ? null : Math.max(0, limit - (used.count ?? 0)), daily: limit },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
