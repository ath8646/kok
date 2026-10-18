// 내가 만든 테마 고치기·지우기 (Pro). 지운 테마의 그림은 매일 청소가 지운다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertOwnImage, loadOwnTheme, requireThemes } from '@/lib/server/themes';
import { THEME_NAME_MAX, zThemeSpec } from '@/lib/themes/spec';

const Patch = z.object({
  name: z.string().trim().min(1).max(THEME_NAME_MAX).optional(),
  spec: zThemeSpec.optional(),
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
    await loadOwnTheme(admin, acc.userId, id);
    if (parsed.data.spec) await assertOwnImage(admin, acc.userId, parsed.data.spec.image);
    const patch: Record<string, unknown> = {};
    if (parsed.data.name) patch.name = parsed.data.name;
    if (parsed.data.spec) patch.spec = parsed.data.spec;
    const { data, error } = await admin
      .from('user_themes')
      .update(patch)
      .eq('id', id)
      .eq('user_id', acc.userId)
      .select('id, name, spec, created_at, updated_at')
      .single();
    if (error) throw error;
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
