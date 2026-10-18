// "이상해요" 신고 + AI가 고친 문제 제안 (적용은 화면에서 내가 고른다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { noteExcerpt } from '@/lib/server/notes';
import { runTask } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { fixPrompt, wrap } from '@/lib/ai/prompts';
import { quizJsonSchema, toQuestionRow, zNote, zQuiz, zQuizItem } from '@/lib/ai/schemas';

export const maxDuration = 90;

const Body = z.object({ reason: z.string().min(1).max(1000), fix: z.boolean().catch(true) });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/questions/[id]/report'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '이유를 적어 주세요.', 400);

    const { data: q } = await admin
      .from('questions')
      .select('id, user_id, note_id, key_point_id, type, prompt, choices, answer, accepted, explanation, difficulty, pages, created_by')
      .eq('id', id)
      .maybeSingle();
    if (!q || q.user_id !== acc.userId) throw new UserFacingError('not_found', '문제를 찾을 수 없어요.', 404);

    const { error: rErr } = await admin.from('reports').insert({
      reporter_id: acc.userId,
      target_type: 'question',
      target_id: q.id,
      reason: parsed.data.reason,
    });
    if (rErr) throw rErr;

    if (!parsed.data.fix || !q.note_id) return Response.json({ ok: true, proposal: null });

    // 내 노트만 (문제의 노트 번호를 믿지 않는다)
    const { data: n } = await admin.from('notes').select('body').eq('id', q.note_id).eq('user_id', acc.userId).maybeSingle();
    if (!n) return Response.json({ ok: true, proposal: null });
    const note = zNote.parse(n.body ?? {});
    const app = await getAppSettings(admin);
    try {
      const json = await runTask(admin, acc, app, {
        task: 'fix',
        effortOf: 'check',
        tier: acc.settings.models.quiz,
        content: [
          textBlock(wrap('note', noteExcerpt(note, q.key_point_id))),
          textBlock(
            wrap(
              'question',
              JSON.stringify({
                type: q.type,
                prompt: q.prompt,
                choices: q.choices,
                answer: q.answer,
                accepted: q.accepted,
                explanation: q.explanation,
                key_point_id: q.key_point_id,
              }),
            ),
          ),
          textBlock(wrap('reason', parsed.data.reason)),
          textBlock(fixPrompt()),
        ],
        schema: quizJsonSchema,
        maxTokens: 2000,
        outTokens: 700,
        timeoutMs: 60_000,
      });
      const first = zQuiz.parse(json).questions[0];
      const item = first ? zQuizItem.safeParse(first) : null;
      const row = item?.success ? toQuestionRow({ ...item.data, key_point_id: item.data.key_point_id || q.key_point_id || '' }) : null;
      return Response.json({ ok: true, proposal: row, removeSuggested: !first });
    } catch (e) {
      // 신고는 이미 들어갔다. 고친 문제 제안만 실패했다고 알린다
      const message = e instanceof UserFacingError ? e.message : '고친 문제를 만들지 못했어요.';
      return Response.json({ ok: true, proposal: null, fixError: message });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
