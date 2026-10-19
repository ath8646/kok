// 그림 풀이 만들기 (Pro): 문제 하나에 문제 그림과 단계 풀이를 붙인다 (예전 문제·직접 만든 문제)
import type { NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { getAppSettings, getFeatures } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { noteForPrompt } from '@/lib/server/notes';
import { runTaskFull } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { solvePrompt, wrap } from '@/lib/ai/prompts';
import { solveJsonSchema, zNote, zSolve } from '@/lib/ai/schemas';
import { questionsForSolve, readSolution } from '@/lib/figure/solution';
import { THINK_OUT } from '@/lib/ai/models';

// 먼저 생각하고 답해서 조금 오래 걸릴 수 있다 (AI 기다리기는 이보다 짧게)
export const maxDuration = 120;

export async function POST(req: NextRequest, ctx: RouteContext<'/api/questions/[id]/solve'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    if (!acc.canFigures) throw new UserFacingError('pro_only', '그림 풀이는 Pro 기능이에요.', 403);
    if (!(await getFeatures(admin)).figures) {
      throw new UserFacingError('schema_outdated', '그림 풀이를 아직 쓸 수 없어요. 운영자가 준비하고 있어요.', 503);
    }

    const { data: q, error } = await admin
      .from('questions')
      .select('id, user_id, note_id, type, prompt, choices, answer, explanation, steps, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!q || q.user_id !== acc.userId) throw new UserFacingError('not_found', '문제를 찾을 수 없어요.', 404);
    // 이미 풀이가 있으면 에너지를 쓰기 전에 거절한다 (화면도 풀이가 없는 문제에만 버튼을 보여 준다)
    if (q.steps) throw new UserFacingError('already_solved', '이 문제에는 이미 풀이가 있어요.', 409);

    // 내 노트만 (문제의 노트 번호를 믿지 않는다). 직접 만든 문제는 노트가 없을 수 있다
    let note = '';
    if (q.note_id) {
      const { data: n } = await admin.from('notes').select('body').eq('id', q.note_id).eq('user_id', acc.userId).maybeSingle();
      if (n) note = noteForPrompt(zNote.parse(n.body ?? {}), 12_000);
    }

    const app = await getAppSettings(admin);
    const { json, energy } = await runTaskFull(admin, acc, app, {
      task: 'solve',
      effortOf: 'solve',
      tier: acc.settings.models.quiz,
      content: [
        textBlock(wrap('note', note || '(no note)')),
        textBlock(
          wrap(
            'questions',
            JSON.stringify(
              questionsForSolve([
                {
                  type: String(q.type),
                  prompt: String(q.prompt),
                  choices: (q.choices as string[] | null) ?? null,
                  answer: q.answer,
                  explanation: String(q.explanation ?? ''),
                },
              ]),
            ),
          ),
        ),
        textBlock(solvePrompt({ max: 1, single: true })),
      ],
      schema: solveJsonSchema,
      maxTokens: 12_000,
      outTokens: THINK_OUT.solveOne,
      timeoutMs: 105_000,
      think: true,
    });
    const sols = zSolve.parse(json).solutions;
    const solution = readSolution(sols.find((s) => s.index === 0) ?? sols[0]);
    if (!solution) throw new UserFacingError('no_solution', '풀이를 만들지 못했어요. 다시 해 주세요.', 502);

    // 그사이 문제를 고쳤으면 덮어쓰지 않는다 (고친 문제에 맞지 않는 풀이일 수 있다)
    const { data: saved, error: upErr } = await admin
      .from('questions')
      .update({ figure: solution.figure, steps: solution.steps })
      .eq('id', q.id)
      .eq('updated_at', q.updated_at)
      .select('id');
    if (upErr) throw upErr;
    if (!saved?.length) throw new UserFacingError('stale', '그사이 문제가 바뀌어서 풀이를 넣지 못했어요. 다시 해 주세요.', 409);
    return Response.json({ ok: true, figure: solution.figure, steps: solution.steps, energy });
  } catch (e) {
    return errorResponse(e);
  }
}
