// 테마 배경 그림을 AI 로 (다시) 그리기 (Pro).
// 설명을 적으면 AI 가 그림 프롬프트(영어)를 만들고(에너지 조금), 안 적으면 이 테마의 AI 그림 프롬프트로 새로 그린다(에너지 없음).
// 그림을 그릴 수 없으면(Cloudflare 설정 안 함·내 하루 몫·오늘 전체 몫) AI 를 부르기 전에 알린다 (에너지를 쓰지 않게).
// 그리다가 실패하면 코드로 만든 무늬를 넣고 알려 준다.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { runTask } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import {
  AI_IMAGES_PER_DAY,
  DIM_IMAGE,
  DIM_PATTERN,
  assertPicturesAllowed,
  fallbackPattern,
  imageFailNote,
  loadOwnTheme,
  makeAiImage,
  pictureRoom,
  requireThemes,
} from '@/lib/server/themes';
import { THEME_SYSTEM, themeImagePrompt, wrap } from '@/lib/ai/prompts';
import { themeImageJsonSchema, zThemeImageAi } from '@/lib/ai/schemas';
import { zThemeSpec, type ThemeImage } from '@/lib/themes/spec';

// AI 프롬프트(최대 30초) + 그림(최대 35초) + 저장
export const maxDuration = 90;

const Body = z.object({
  prompt: z.string().trim().max(200, '200자까지 적을 수 있어요.').optional(),
});

const ROOM_MESSAGE = {
  not_configured: 'AI 그림을 아직 쓸 수 없어요. 사진이나 무늬를 골라 주세요.',
  mine: `AI 그림은 하루 ${AI_IMAGES_PER_DAY}번까지 그릴 수 있어요. 내일 다시 해 주세요.`,
  quota: '오늘 AI 그림 몫을 다 썼어요. 내일 다시 그릴 수 있어요.',
} as const;

export async function POST(req: NextRequest, ctx: RouteContext<'/api/themes/[id]/image'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '테마 번호');
    const { admin, acc } = await requireAccount();
    await requireThemes(admin, acc);
    const parsed = Body.safeParse(await readJson(req, 4_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '보낸 내용이 올바르지 않아요.', 400);
    const app = await getAppSettings(admin);
    assertPicturesAllowed(acc, app);
    const theme = await loadOwnTheme(admin, acc.userId, id);
    const described = parsed.data.prompt?.trim() ?? '';

    // AI(에너지)를 부르기 전에 그림을 그릴 수 있는지 먼저 본다
    const room = await pictureRoom(admin, acc.userId);
    if (room !== 'ok')
      throw new UserFacingError(room === 'not_configured' ? 'no_ai_picture' : 'daily_limit', ROOM_MESSAGE[room], room === 'not_configured' ? 503 : 429);

    // 그림 프롬프트: 새 설명이면 AI 가 영어로 만들고, 없으면 지금 AI 그림의 프롬프트를 다시 쓴다
    let imagePrompt = '';
    if (!described && theme.spec.image?.kind === 'file') {
      const { data } = await admin.from('theme_images').select('prompt').eq('id', theme.spec.image.id).eq('user_id', acc.userId).maybeSingle();
      imagePrompt = typeof data?.prompt === 'string' ? data.prompt : '';
    }
    if (!described && !imagePrompt.trim()) throw new UserFacingError('need_prompt', '어떤 그림을 그릴지 적어 주세요.', 400);
    if (described) {
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
    }

    const made = await makeAiImage(admin, acc, imagePrompt, { strictDaily: true });
    let image: ThemeImage;
    let dim = DIM_IMAGE;
    let note: string | null = null;
    if ('id' in made) image = { kind: 'file', id: made.id, ai: true };
    else {
      image = fallbackPattern(theme.spec, described || imagePrompt);
      dim = DIM_PATTERN;
      note = imageFailNote(made.fail);
    }

    // 그리는 동안 다른 곳에서 색·이름을 고쳤을 수 있다: 그림·덮는 정도만 지금 테마에 넣는다 (읽은 그대로일 때만 저장)
    let current = theme;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) current = await loadOwnTheme(admin, acc.userId, id);
      const spec = zThemeSpec.parse({ ...current.spec, image, dim });
      const { data, error } = await admin
        .from('user_themes')
        .update({ spec })
        .eq('id', id)
        .eq('user_id', acc.userId)
        .eq('updated_at', current.updatedAt)
        .select('id, name, spec, created_at, updated_at')
        .maybeSingle();
      if (error) throw error;
      if (data) return Response.json({ ok: true, theme: data, note });
    }
    throw new UserFacingError('theme_changed', '테마가 계속 바뀌고 있어요. 잠시 뒤에 다시 그려 주세요.', 409);
  } catch (e) {
    return errorResponse(e);
  }
}
