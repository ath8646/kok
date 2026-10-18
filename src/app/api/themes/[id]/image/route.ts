// 테마 배경 그림을 AI 로 (다시) 그리기 (Pro).
// 설명을 적으면 AI 가 그림 프롬프트(영어)를 만들고(에너지 조금), 안 적으면 이 테마의 AI 그림 프롬프트로 새로 그린다(에너지 없음).
// Cloudflare 를 못 쓰면(몫을 다 씀·설정 안 함·실패) 코드로 만든 무늬를 넣고 알려 준다.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { runTask } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { DIM_IMAGE, DIM_PATTERN, fallbackPattern, imageFailNote, loadOwnTheme, makeAiImage, requireThemes } from '@/lib/server/themes';
import { THEME_SYSTEM, themeImagePrompt, wrap } from '@/lib/ai/prompts';
import { themeImageJsonSchema, zThemeImageAi } from '@/lib/ai/schemas';
import { zThemeSpec, type ThemeImage } from '@/lib/themes/spec';

// AI 프롬프트(최대 30초) + 그림(최대 35초) + 저장
export const maxDuration = 90;

const Body = z.object({
  prompt: z.string().trim().max(200, '200자까지 적을 수 있어요.').optional(),
});

export async function POST(req: NextRequest, ctx: RouteContext<'/api/themes/[id]/image'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '테마 번호');
    const { admin, acc } = await requireAccount();
    await requireThemes(admin, acc);
    const parsed = Body.safeParse(await readJson(req, 4_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '보낸 내용이 올바르지 않아요.', 400);
    const theme = await loadOwnTheme(admin, acc.userId, id);
    const described = parsed.data.prompt?.trim() ?? '';

    // 그림 프롬프트: 새 설명이면 AI 가 영어로 만들고, 없으면 지금 AI 그림의 프롬프트를 다시 쓴다
    let imagePrompt = '';
    if (described) {
      const app = await getAppSettings(admin);
      const json = await runTask(admin, acc, app, {
        task: 'theme',
        effortOf: 'theme',
        tier: 'fast',
        system: THEME_SYSTEM,
        content: [textBlock(wrap('request', described)), textBlock(themeImagePrompt())],
        schema: themeImageJsonSchema,
        maxTokens: 400,
        outTokens: 150,
        timeoutMs: 30_000,
      });
      imagePrompt = zThemeImageAi.parse(json).image_prompt;
    } else if (theme.spec.image?.kind === 'file') {
      const { data } = await admin.from('theme_images').select('prompt').eq('id', theme.spec.image.id).eq('user_id', acc.userId).maybeSingle();
      imagePrompt = typeof data?.prompt === 'string' ? data.prompt : '';
    }
    if (!imagePrompt.trim()) throw new UserFacingError('need_prompt', '어떤 그림을 그릴지 적어 주세요.', 400);

    const made = await makeAiImage(admin, acc, imagePrompt, { strictDaily: true });
    let image: ThemeImage;
    let dim = DIM_IMAGE;
    let note: string | null = null;
    if ('id' in made) image = { kind: 'file', id: made.id };
    else {
      image = fallbackPattern(theme.spec, described || imagePrompt);
      dim = DIM_PATTERN;
      note = imageFailNote(made.fail);
    }
    const spec = zThemeSpec.parse({ ...theme.spec, image, dim });
    const { data, error } = await admin
      .from('user_themes')
      .update({ spec })
      .eq('id', id)
      .eq('user_id', acc.userId)
      .select('id, name, spec, created_at, updated_at')
      .single();
    if (error) throw error;
    return Response.json({ ok: true, theme: data, note });
  } catch (e) {
    return errorResponse(e);
  }
}
