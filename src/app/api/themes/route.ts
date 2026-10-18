// 내가 만든 테마 만들기 (Pro). 색·그림은 서버가 검사하고 넣는다 (학생은 user_themes 를 읽기만 한다)
import type { NextRequest } from 'next/server';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertOwnImage, assertThemeRoom, requireThemes } from '@/lib/server/themes';
import { zThemeInput } from '@/lib/themes/spec';

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireThemes(admin, acc);
    const parsed = zThemeInput.safeParse(await readJson(req, 40_000));
    if (!parsed.success) throw new UserFacingError('bad_theme', '테마 이름이나 색이 올바르지 않아요.', 400);
    const { name, spec } = parsed.data;
    await assertThemeRoom(admin, acc.userId);
    await assertOwnImage(admin, acc.userId, spec.image);
    const { data, error } = await admin
      .from('user_themes')
      .insert({ user_id: acc.userId, name, spec })
      .select('id, name, spec, created_at, updated_at')
      .single();
    if (error) throw error;
    return Response.json({ ok: true, theme: data });
  } catch (e) {
    return errorResponse(e);
  }
}
