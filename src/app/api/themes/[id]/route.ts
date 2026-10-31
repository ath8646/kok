// 내가 만든 테마 고치기·지우기 (Pro). 지운 테마의 그림은 매일 청소가 지운다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertPerk } from '@/lib/server/account';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertOwnImage, hitThemeWrites, loadOwnTheme, requireThemes } from '@/lib/server/themes';
import { THEME_NAME_MAX, withSkinPalettes, zThemeSpec } from '@/lib/themes/spec';

const Patch = z.object({
  name: z.string().trim().min(1).max(THEME_NAME_MAX).optional(),
  spec: zThemeSpec.optional(),
  /** 화면이 읽은 updated_at: 그 뒤에 다른 곳(다른 기기·그림 그리기)에서 바뀌었으면 덮어쓰지 않는다 */
  updatedAt: z.string().max(64).optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/themes/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '테마 번호');
    const { admin, acc } = await requireAccount();
    await requireThemes(admin, acc);
    const parsed = Patch.safeParse(await readJson(req, 40_000));
    if (!parsed.success || (!parsed.data.name && !parsed.data.spec)) throw new UserFacingError('bad_theme', '테마 이름이나 색이 올바르지 않아요.', 400);
    await hitThemeWrites(admin, acc.userId);
    const cur = await loadOwnTheme(admin, acc.userId, id);
    if (parsed.data.spec) await assertOwnImage(admin, acc.userId, parsed.data.spec.image);
    const patch: Record<string, unknown> = {};
    if (parsed.data.name) patch.name = parsed.data.name;
    if (parsed.data.spec) {
      // 시그니처 테마를 모르는 예전 화면이 글꼴·종이만 바꿔 보낸 spec 에는 skin 칸이 없다: 지우지 않고 그대로 둔다 (null 은 '보통 테마로')
      const next = parsed.data.spec.skin === undefined && cur.spec.skin ? { ...parsed.data.spec, skin: cur.spec.skin } : parsed.data.spec;
      // 시그니처 스타일로 새로 바꾸거나 다른 시그니처 테마로 바꾸는 것만 막는다 (예전에 만든 테마의 이름·색 고치기는 그대로 된다)
      if (next.skin && next.skin.id !== cur.spec.skin?.id) assertPerk(acc, 'skins', '시그니처 스타일 테마');
      patch.spec = withSkinPalettes(next);
    }
    let q = admin.from('user_themes').update(patch).eq('id', id).eq('user_id', acc.userId);
    if (parsed.data.updatedAt) q = q.eq('updated_at', parsed.data.updatedAt);
    const { data, error } = await q.select('id, name, spec, created_at, updated_at').maybeSingle();
    if (error) throw error;
    if (!data) throw new UserFacingError('theme_changed', '다른 곳에서 이 테마가 바뀌었어요. 닫고 다시 열어 주세요.', 409);
    return Response.json({ ok: true, theme: data });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/themes/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '테마 번호');
    // 지우기는 Pro 가 끝나도 할 수 있다 (내 것을 치울 수 있게)
    const { admin, acc } = await requireAccount();
    const { error } = await admin.from('user_themes').delete().eq('id', id).eq('user_id', acc.userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
