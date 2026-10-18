// 테마 배경 그림 보기: 내 그림이면 잠깐 쓰는 주소로 보낸다 (CSS 의 background-image 가 이 주소를 쓴다)
import type { NextRequest } from 'next/server';
import { assertUuid, requireUser } from '@/lib/server/auth';
import { adminClient } from '@/lib/supabase/admin';
import { errorResponse } from '@/lib/server/errors';
import { THEME_IMAGES_BUCKET } from '@/lib/server/themes';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/themes/images/[id]'>) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, '그림 번호');
    const user = await requireUser();
    const admin = adminClient();
    const { data, error } = await admin.from('theme_images').select('user_id, path').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || data.user_id !== user.userId) return new Response('not found', { status: 404 });
    const { data: signed, error: sErr } = await admin.storage.from(THEME_IMAGES_BUCKET).createSignedUrls([data.path as string], 3600);
    const url = signed?.[0]?.signedUrl;
    if (sErr || !url) return new Response('not found', { status: 404 });
    // 같은 그림 번호는 내용이 바뀌지 않는다: 30분 동안은 이 주소를 다시 묻지 않게
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'private, max-age=1800' } });
  } catch (e) {
    return errorResponse(e);
  }
}
