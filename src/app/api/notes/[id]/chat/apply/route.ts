// 노트 채팅에서 AI 가 넣자고 한 것(문제·노트 내용·용어)을 학생이 [넣기]·[취소]로 정한다. AI 를 다시 부르지 않는다
// save_problem: AI 가 풀어 준 문제를 이 노트의 문제로 넣는다 (그림 풀이도 같이, AI 가 문제를 다시 만들어도 남게 잠가 둔다).
// 한 답에 풀이가 여럿이면 indexes 로 고른 것만 (하나씩·모두 넣기), 없으면 첫 풀이 (예전 화면)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoAppendRunning, loadOwnedNote, updateNoteBody } from '@/lib/server/notes';
import { applyNoteAddition, applyTerms } from '@/lib/note-edit';
import { getFeatures } from '@/lib/server/account';
import { CHAT_SOLUTIONS_MAX, packSolutions, solutionList, type ChatProposal, type ChatSolution, type StoredChatSolution } from '@/lib/chat';

const Body = z.object({
  messageId: z.string().uuid(),
  action: z.enum(['apply', 'cancel', 'save_problem']),
  /** save_problem: 넣을 풀이 번호들 (0부터) */
  indexes: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(CHAT_SOLUTIONS_MAX - 1),
    )
    .min(1)
    .max(CHAT_SOLUTIONS_MAX)
    .optional(),
});

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/chat/apply'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 2_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const { messageId, action } = parsed.data;
    const note = await loadOwnedNote(admin, id, acc.userId);
    if (action === 'save_problem') return Response.json(await saveProblems(admin, acc.userId, note, messageId, parsed.data.indexes ?? [0]));

    const { data: msg, error } = await admin
      .from('chat_messages')
      .select('id, proposal')
      .eq('id', messageId)
      .eq('note_id', note.id)
      .eq('user_id', acc.userId)
      .maybeSingle();
    if (error) throw error;
    const p = (msg?.proposal ?? null) as ChatProposal | null;
    if (!msg || !p || p.kind === 'none') throw new UserFacingError('not_found', '넣을 내용을 찾을 수 없어요.', 404);
    if (p.status !== 'pending') throw new UserFacingError('done', p.status === 'applied' ? '이미 넣었어요.' : '이미 취소했어요.', 409);
    // 노트 글을 바꾸는 것은 자료를 더하는 동안 미룬다 (넣기를 다시 누를 수 있게 그대로 둔다)
    if (action === 'apply' && (p.kind === 'note' || p.kind === 'terms')) await assertNoAppendRunning(admin, note.source_id);

    // 먼저 '정했다'로 바꿔 둔다: 두 번 눌러도(창 두 개 등) 한 번만 넣는다
    const status = action === 'apply' ? 'applied' : 'cancelled';
    const { data: claimed, error: cErr } = await admin
      .from('chat_messages')
      .update({ proposal: { ...p, status } })
      .eq('id', msg.id)
      .eq('proposal->>status', 'pending')
      .select('id');
    if (cErr) throw cErr;
    if (!claimed?.length) throw new UserFacingError('done', '이미 정했어요.', 409);

    let added = 0;
    if (action === 'apply') {
      try {
        if (p.kind === 'questions') {
          const { data, error: qErr } = await admin.rpc('kok_add_questions', { p_note: note.id, p_questions: p.questions, p_replace: false });
          if (qErr) throw qErr;
          added = Number(data ?? p.questions.length);
        } else if (p.kind === 'terms') {
          // 용어: 새 용어는 뒤에, 이미 있는 용어는 뜻만 (읽은 그대로일 때만 저장: updateNoteBody)
          await updateNoteBody(admin, note.id, acc.userId, (cur) => {
            const r = applyTerms(cur.note, p.terms);
            added = r.added;
            return { ...cur.raw, terms: r.note.terms };
          });
        } else {
          // 지금 노트에 더한다. 읽은 뒤 노트가 바뀌었으면(다른 탭, 자료 더하기 마무리) 다시 읽어 더한다 (덮어쓰지 않게)
          await updateNoteBody(admin, note.id, acc.userId, (cur) => ({ ...cur.raw, key_points: applyNoteAddition(cur.note, p.addition).key_points }));
          added = 1;
        }
      } catch (e) {
        // 넣지 못했으면 다시 고를 수 있게 되돌린다
        await admin.from('chat_messages').update({ proposal: p }).eq('id', msg.id);
        throw e;
      }
    }
    return Response.json({ ok: true, status, added });
  } catch (e) {
    return errorResponse(e);
  }
}

type Admin = Awaited<ReturnType<typeof requireAccount>>['admin'];

/**
 * 채팅 답의 풀이들을 바꾼다 (넣었다는 표시). 읽은 뒤 다른 요청이 바꿨으면(rev 가 다르면) 다시 읽어 바꾼다:
 * 두 창에서 같이 눌러도, 한 답의 두 문제를 잇달아 눌러도 표시가 서로 지워지지 않는다
 */
async function changeSolutions<T>(
  admin: Admin,
  userId: string,
  noteId: string,
  messageId: string,
  change: (list: ChatSolution[]) => { list: ChatSolution[]; result: T },
): Promise<{ before: ChatSolution[]; result: T }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: msg, error } = await admin
      .from('chat_messages')
      .select('id, solution')
      .eq('id', messageId)
      .eq('note_id', noteId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    const stored = (msg?.solution ?? null) as StoredChatSolution | null;
    const list = solutionList(stored);
    if (!msg || !list.length) throw new UserFacingError('not_found', '넣을 문제를 찾을 수 없어요.', 404);
    const { list: next, result } = change(list);
    const rev = typeof stored?.rev === 'number' ? stored.rev : null;
    const update = admin
      .from('chat_messages')
      .update({ solution: packSolutions(next, (rev ?? 0) + 1) })
      .eq('id', msg.id);
    const { data: done, error: uErr } = await (rev === null ? update.is('solution->rev', null) : update.eq('solution->>rev', String(rev))).select('id');
    if (uErr) throw uErr;
    if (done?.length) return { before: list, result };
  }
  throw new UserFacingError('busy', '다른 곳에서 바꾸고 있어요. 잠시 뒤에 다시 눌러 주세요.', 409);
}

/**
 * AI 가 풀어 준 문제들(indexes 번째 풀이)을 이 노트의 문제로 넣는다. 먼저 '넣었다'로 바꿔 두어 두 번 눌러도 한 번만 넣고,
 * 넣지 못하면 표시를 되돌린다. 이미 넣은 풀이는 건너뛰고, 고른 것을 모두 넣었으면 409
 */
async function saveProblems(
  admin: Admin,
  userId: string,
  note: Awaited<ReturnType<typeof loadOwnedNote>>,
  messageId: string,
  indexes: number[],
): Promise<{ ok: true; status: 'saved'; added: number; saved: number[]; questionIds: string[] }> {
  const features = await getFeatures(admin);
  if (!features.chatFiles) throw new UserFacingError('not_found', '넣을 문제를 찾을 수 없어요.', 404);
  const { before, result: fresh } = await changeSolutions(admin, userId, note.id, messageId, (list) => {
    const want = [...new Set(indexes)].filter((i) => !!list[i]?.question).sort((a, b) => a - b);
    if (!want.length) throw new UserFacingError('not_found', '넣을 문제를 찾을 수 없어요.', 404);
    const todo = want.filter((i) => !list[i].saved);
    if (!todo.length) throw new UserFacingError('done', '이미 넣었어요.', 409);
    return { list: list.map((s, i) => (todo.includes(i) ? { ...s, saved: true } : s)), result: todo };
  });
  try {
    const withFigures = features.figures;
    const rows = fresh.map((i) => {
      const sol = before[i];
      const q = sol.question!;
      const kp = q.key_point_id && note.note.key_points.some((k) => k.id === q.key_point_id) ? q.key_point_id : null;
      return {
        user_id: userId,
        note_id: note.id,
        subject_id: note.subject_id,
        key_point_id: kp,
        type: q.type,
        prompt: q.prompt,
        choices: q.choices,
        answer: q.answer,
        accepted: q.accepted,
        explanation: q.explanation,
        difficulty: q.difficulty,
        pages: [],
        created_by: 'ai',
        // 노트 문제를 AI 로 다시 만들어도 지워지지 않게
        locked: true,
        ...(withFigures ? { figure: sol.figure, steps: sol.steps.length ? sol.steps : null } : {}),
      };
    });
    const { data: made, error: qErr } = await admin.from('questions').insert(rows).select('id');
    if (qErr || !made || made.length !== rows.length) throw qErr ?? new Error('question insert failed');
    const ids = made.map((r) => r.id as string);
    const due = new Date().toISOString();
    const { error: cardErr } = await admin
      .from('cards')
      .insert(ids.map((qid) => ({ question_id: qid, user_id: userId, subject_id: note.subject_id, due })));
    if (cardErr) {
      await admin.from('questions').delete().in('id', ids);
      throw cardErr;
    }
    return { ok: true, status: 'saved', added: ids.length, saved: fresh, questionIds: ids };
  } catch (e) {
    // 넣지 못했으면 다시 누를 수 있게 이번에 바꾼 표시만 되돌린다
    await changeSolutions(admin, userId, note.id, messageId, (list) => ({
      list: list.map((s, i) => (fresh.includes(i) ? { ...s, saved: undefined } : s)),
      result: null,
    })).catch((err) => console.warn('[kok] chat save mark not restored', err));
    throw e;
  }
}
