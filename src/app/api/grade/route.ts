// 단답형 AI 채점 (자동 채점이 틀렸다고 할 때만 부른다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { noteExcerpt } from '@/lib/server/notes';
import { runTask } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { gradePrompt, wrap } from '@/lib/ai/prompts';
import { gradeJsonSchema, zGrade, zNote } from '@/lib/ai/schemas';

export const maxDuration = 60;

const Body = z.object({ questionId: z.string().uuid(), answer: z.string().min(1).max(500) });

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const { questionId, answer } = parsed.data;

    const { data: q } = await admin
      .from('questions')
      .select('id, user_id, note_id, key_point_id, type, prompt, answer, accepted, explanation')
      .eq('id', questionId)
      .maybeSingle();
    if (!q || q.user_id !== acc.userId) throw new UserFacingError('not_found', '문제를 찾을 수 없어요.', 404);
    if (q.type !== 'short' && q.type !== 'cloze') throw new UserFacingError('bad_type', 'AI 채점은 단답형만 해요.', 400);

    let excerpt = '{}';
    if (q.note_id) {
      // 내 노트만 (문제의 노트 번호를 믿지 않는다)
      const { data: n } = await admin.from('notes').select('body').eq('id', q.note_id).eq('user_id', acc.userId).maybeSingle();
      if (n) excerpt = noteExcerpt(zNote.parse(n.body ?? {}), q.key_point_id);
    }
    const app = await getAppSettings(admin);
    const json = await runTask(admin, acc, app, {
      task: 'grade',
      effortOf: 'grade',
      tier: acc.settings.models.grade,
      content: [
        textBlock(wrap('question', q.prompt)),
        textBlock(wrap('model_answer', JSON.stringify({ answer: q.answer, also_accepted: q.accepted, explanation: q.explanation }))),
        textBlock(wrap('note', excerpt)),
        textBlock(wrap('answer', answer)),
        textBlock(gradePrompt()),
      ],
      schema: gradeJsonSchema,
      maxTokens: 1000,
      outTokens: 400,
      timeoutMs: 45_000,
    });
    const g = zGrade.parse(json);
    return Response.json({
      ok: true,
      result: g.result,
      score: Math.max(0, Math.min(1, g.score)),
      feedback: g.feedback.slice(0, 300),
      missing: g.missing_points.slice(0, 5),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
