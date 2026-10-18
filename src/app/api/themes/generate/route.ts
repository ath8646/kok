// AI 로 테마 만들기 (Pro): 학생이 적은 느낌으로 밝을 때·어두울 때 색, 글꼴, 종이, 배경 그림을 만든다.
// 그림은 Cloudflare(무료 몫) → 안 되면 AI 가 그린 무늬 → 그것도 안 되면 코드로 만든 무늬.
// 색은 글자가 잘 보이게 서버가 다시 맞춘다 (fitPalette). 만든 테마는 바로 저장해서 돌려준다.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { runTaskFull } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { cloudflareReady } from '@/lib/server/cloudflare';
import {
  AI_THEMES_PER_DAY,
  DIM_IMAGE,
  DIM_PATTERN,
  assertThemeRoom,
  fallbackPattern,
  hitDaily,
  imageFailNote,
  makeAiImage,
  requireThemes,
} from '@/lib/server/themes';
import { THEME_SYSTEM, themeDesignPrompt, wrap } from '@/lib/ai/prompts';
import { themeJsonSchema, zThemeAi } from '@/lib/ai/schemas';
import { fitPalette } from '@/lib/themes/colors';
import { BASE_TOKENS } from '@/lib/themes/presets';
import { sanitizePatternSvg } from '@/lib/themes/pattern';
import { THEME_NAME_MAX, zThemeSpec, type ThemeImage } from '@/lib/themes/spec';

// AI 답(최대 50초) + 그림(최대 35초) + 저장
export const maxDuration = 120;

const Body = z.object({
  prompt: z.string().trim().min(2, '어떤 느낌인지 두 글자 이상 적어 주세요.').max(200, '200자까지 적을 수 있어요.'),
  image: z.boolean().catch(true),
});

const base = (m: 'light' | 'dark') => ({ bg: BASE_TOKENS[m]['--bg'], surface: BASE_TOKENS[m]['--surface'], accent: BASE_TOKENS[m]['--accent'] });

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireThemes(admin, acc);
    const parsed = Body.safeParse(await readJson(req, 4_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '보낸 내용이 올바르지 않아요.', 400);
    const { prompt, image } = parsed.data;
    await assertThemeRoom(admin, acc.userId);
    await hitDaily(admin, acc.userId, 'theme_ai', AI_THEMES_PER_DAY, `AI 테마는 하루 ${AI_THEMES_PER_DAY}개까지 만들 수 있어요. 내일 다시 해 주세요.`);
    const app = await getAppSettings(admin);

    // Cloudflare 를 못 쓰면 처음부터 AI 에게 무늬도 그려 달라고 한다 (한 번만 부르게)
    const wantPattern = image && !cloudflareReady();
    const res = await runTaskFull(admin, acc, app, {
      task: 'theme',
      effortOf: 'theme',
      tier: 'fast',
      system: THEME_SYSTEM,
      content: [textBlock(wrap('request', prompt)), textBlock(themeDesignPrompt({ pattern: wantPattern }))],
      schema: themeJsonSchema,
      maxTokens: wantPattern ? 3500 : 900,
      outTokens: wantPattern ? 2200 : 500,
      timeoutMs: 50_000,
    });
    const ai = zThemeAi.parse(res.json);
    const light = fitPalette(ai.light, 'light', base('light'));
    const dark = fitPalette(ai.dark, 'dark', base('dark'));
    const name = (ai.name.trim() || prompt).slice(0, THEME_NAME_MAX);

    let img: ThemeImage | null = null;
    let dim = DIM_IMAGE;
    let note: string | null = null;
    if (image) {
      const made = ai.image_prompt.trim() ? await makeAiImage(admin, acc, ai.image_prompt) : { fail: 'failed' as const };
      if ('id' in made) img = { kind: 'file', id: made.id };
      else {
        const svg = ai.pattern_svg ? sanitizePatternSvg(ai.pattern_svg) : null;
        img = svg ? { kind: 'pattern', svg } : fallbackPattern({ light }, prompt);
        dim = DIM_PATTERN;
        // Cloudflare 를 아예 안 쓰는 곳에서는 무늬가 원래 방법이라 알리지 않는다
        note = made.fail === 'not_configured' ? null : imageFailNote(made.fail);
      }
    }

    const spec = zThemeSpec.parse({ light, dark, image: img, dim, font: ai.font, paper: ai.paper });
    const { data, error } = await admin
      .from('user_themes')
      .insert({ user_id: acc.userId, name, spec })
      .select('id, name, spec, created_at, updated_at')
      .single();
    if (error) throw error;
    return Response.json({ ok: true, theme: data, summary: ai.summary.slice(0, 200), note, energy: res.energy });
  } catch (e) {
    return errorResponse(e);
  }
}
