// 내가 만든 테마 만들기 (테마 혜택, 시그니처 스타일은 시그니처 테마 혜택도). 색·그림은 서버가 검사하고 넣는다 (학생은 user_themes 를 읽기만 한다)
import type { NextRequest } from 'next/server';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { assertPerk } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertOwnImage, assertThemeRoom, hitThemeWrites, requireThemes, themeInsertError } from '@/lib/server/themes';
import { withSkinPalettes, zThemeInput } from '@/lib/themes/spec';

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireThemes(admin, acc);
    const parsed = zThemeInput.safeParse(await readJson(req, 40_000));
    if (!parsed.success) throw new UserFacingError('bad_theme', '테마 이름이나 색이 올바르지 않아요.', 400);
    const { name } = parsed.data;
    if (parsed.data.spec.skin) assertPerk(acc, 'skins', '시그니처 스타일 테마');
    // 시그니처 테마로 만든 테마는 예전 화면이 쓸 색을 그 테마의 색으로
    const spec = withSkinPalettes(parsed.data.spec);
    await hitThemeWrites(admin, acc.userId);
    // 20개 한도는 DB 도 지킨다 (동시에 여러 번 보내도: user_themes_guard)
    await assertThemeRoom(admin, acc.userId);
    await assertOwnImage(admin, acc.userId, spec.image);
    const { data, error } = await admin
      .from('user_themes')
      .insert({ user_id: acc.userId, name, spec })
      .select('id, name, spec, created_at, updated_at')
      .single();
    if (error) throw themeInsertError(error);
    return Response.json({ ok: true, theme: data });
  } catch (e) {
    return errorResponse(e);
  }
}
