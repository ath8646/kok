// 갤러리 즐겨찾기 켜기·끄기 (자료 공유 첫 화면 위에 보인다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { loadGallery, requireCommunity } from '@/lib/server/share';

const Body = z.object({ on: z.boolean() });
const FAVS_MAX = 50;

export async function POST(req: NextRequest, ctx: RouteContext<'/api/share/galleries/[id]/fav'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '갤러리 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const parsed = Body.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    await loadGallery(admin, id);
    if (parsed.data.on) {
      const { count } = await admin.from('community_favs').select('gallery_id', { count: 'exact', head: true }).eq('user_id', acc.userId);
      if ((count ?? 0) >= FAVS_MAX) throw new UserFacingError('fav_limit', `즐겨찾기는 ${FAVS_MAX}개까지예요.`, 400);
      const { error } = await admin
        .from('community_favs')
        .upsert({ user_id: acc.userId, gallery_id: id }, { onConflict: 'user_id,gallery_id', ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { error } = await admin.from('community_favs').delete().eq('user_id', acc.userId).eq('gallery_id', id);
      if (error) throw error;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
