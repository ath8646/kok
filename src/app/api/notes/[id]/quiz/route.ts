// 문제 다시 만들기: preview(AI가 새 문제를 만들고 검사, 저장 안 함) → apply(바꾸기)
// 잠근 문제, 내가 고친 문제, 내가 만든 문제는 그대로 둔다.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoteHasContent, assertSameVersion, loadOwnedNote, noteForPrompt } from '@/lib/server/notes';
import { runTask } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { checkPrompt, quizPrompt, wrap } from '@/lib/ai/prompts';
import { checkJsonSchema, quizJsonSchema, rowToQuizItem, toQuestionRow, zCheck, zQuestionRowInput, zQuiz, zQuizItem } from '@/lib/ai/schemas';
import { normalizeAnswer } from '@/lib/grading';

// 문제 만들기(최대 140초) + 검사(최대 60초)
export const maxDuration = 300;

const Preview = z.object({ action: z.literal('preview') });
const Apply = z.object({
  action: z.literal('apply'),
  questions: z.array(z.unknown()).max(40),
  /** 미리보기를 만든 노트 버전 (그사이 버전이 바뀌었으면 바꾸지 않는다) */
  version: z.number().int().min(1).optional(),
});

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/quiz'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const body = await readJson(req, 400_000);
    const note = await loadOwnedNote(admin, id, acc.userId);

    const apply = Apply.safeParse(body);
    if (apply.success) {
      assertSameVersion(note, apply.data.version);
      const rows = apply.data.questions
        .map((q) => zQuestionRowInput.safeParse(q))
        .filter((r) => r.success)
        .map((r) => toQuestionRow(rowToQuizItem(r.data)))
        .filter((r): r is NonNullable<typeof r> => !!r);
      if (!rows.length) throw new UserFacingError('empty', '바꿀 문제가 없어요.', 400);
      const { data, error } = await admin.rpc('kok_add_questions', { p_note: note.id, p_questions: rows, p_replace: true });
      if (error) throw error;
      return Response.json({ ok: true, added: Number(data ?? rows.length) });
    }
    if (!Preview.safeParse(body).success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    assertNoteHasContent(note.note);

    const app = await getAppSettings(admin);
    // 지금 버전의 문제만 센다 (다른 버전에만 있는 숨긴 문제는 바뀌지 않는다)
    const { data: existing, error: qErr } = await admin
      .from('questions')
      .select('id, prompt, created_by, locked, edited')
      .eq('note_id', note.id)
      .eq('user_id', acc.userId)
      .neq('status', 'hidden');
    if (qErr) throw qErr;
    const kept = (existing ?? []).filter((q) => q.locked || q.edited || q.created_by === 'user');
    const replaceCount = (existing ?? []).length - kept.length;

    const qs = acc.settings.quiz;
    const json = await runTask(admin, acc, app, {
      task: 'quiz',
      effortOf: 'quiz',
      tier: acc.settings.models.quiz,
      content: [
        textBlock(wrap('note', noteForPrompt(note.note))),
        textBlock(wrap('existing_questions', JSON.stringify(kept.map((q) => q.prompt)))),
        textBlock(quizPrompt({ types: qs.types, mix: qs.mix, language: qs.language, perKeyPoint: qs.perKeyPoint })),
      ],
      schema: quizJsonSchema,
      maxTokens: 8000,
      // 뒤에 이어지는 검사 단계까지 생각해 넉넉히 잡는다
      outTokens: 4300,
      timeoutMs: 140_000,
      sourceId: note.source_id,
    });
    let rows = zQuiz
      .parse(json)
      .questions.map((r) => zQuizItem.safeParse(r))
      .filter((r) => r.success)
      .map((r) => toQuestionRow(r.data))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .filter((r) => qs.types.includes(r.type));
    // 지켜 둔 문제와 같은 문제, 새 문제끼리 겹치는 문제는 뺀다
    const seen = new Set(kept.map((q) => normalizeAnswer(q.prompt)));
    rows = rows
      .filter((r) => {
        const key = normalizeAnswer(r.prompt);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40);

    if (rows.length) {
      try {
        const checked = await runTask(admin, acc, app, {
          task: 'check',
          effortOf: 'check',
          tier: acc.settings.models.quiz,
          content: [
            textBlock(wrap('note', noteForPrompt(note.note))),
            textBlock(wrap('questions', JSON.stringify(rows.map((x, index) => ({ index, ...x }))))),
            textBlock(checkPrompt()),
          ],
          schema: checkJsonSchema,
          maxTokens: 2500,
          outTokens: 800,
          minEstimate: 0, // 이미 문제 만들기에서 검사했다
          timeoutMs: 60_000,
          sourceId: note.source_id,
        });
        const drop = new Set(
          zCheck
            .parse(checked)
            .verdicts.filter((v) => !v.keep)
            .map((v) => v.index),
        );
        rows = rows.filter((_, i) => !drop.has(i));
      } catch (e) {
        // 문제는 이미 만들었고 에너지도 빠졌다. 검사가 안 되면(한도·속도·AI 오류 모두) 검사 없이 보여 준다
        console.warn('[kok] quiz check skipped', e instanceof UserFacingError ? e.code : e);
      }
    }
    return Response.json({ ok: true, preview: rows, replaceCount, keptCount: kept.length, version: note.version });
  } catch (e) {
    return errorResponse(e);
  }
}
