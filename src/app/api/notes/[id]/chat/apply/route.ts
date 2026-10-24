// 노트 채팅에서 AI 가 넣자고 한 것(문제·노트 내용·용어)을 학생이 [넣기]·[취소]로 정한다. AI 를 다시 부르지 않는다
// save_problem: AI 가 풀어 준 문제를 이 노트의 문제로 넣는다 (그림 풀이도 같이, AI 가 문제를 다시 만들어도 남게 잠가 둔다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoAppendRunning, loadOwnedNote, updateNoteBody } from '@/lib/server/notes';
import { applyNoteAddition, applyTerms } from '@/lib/note-edit';
import { getFeatures } from '@/lib/server/account';
import type { ChatProposal, ChatSolution } from '@/lib/chat';

const Body = z.object({ messageId: z.string().uuid(), action: z.enum(['apply', 'cancel', 'save_problem']) });

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
    if (action === 'save_problem') return Response.json(await saveProblem(admin, acc.userId, note, messageId));

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

/** AI 가 풀어 준 문제를 이 노트의 문제로 넣는다. 먼저 '넣었다'로 바꿔 두어 두 번 눌러도 한 번만 넣는다 */
async function saveProblem(
  admin: Awaited<ReturnType<typeof requireAccount>>['admin'],
  userId: string,
  note: Awaited<ReturnType<typeof loadOwnedNote>>,
  messageId: string,
): Promise<{ ok: true; status: 'saved'; added: number; questionId: string }> {
  const features = await getFeatures(admin);
  if (!features.chatFiles) throw new UserFacingError('not_found', '넣을 문제를 찾을 수 없어요.', 404);
  const { data: msg, error } = await admin
    .from('chat_messages')
    .select('id, solution')
    .eq('id', messageId)
    .eq('note_id', note.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const sol = (msg?.solution ?? null) as ChatSolution | null;
  if (!msg || !sol?.question) throw new UserFacingError('not_found', '넣을 문제를 찾을 수 없어요.', 404);
  if (sol.saved) throw new UserFacingError('done', '이미 넣었어요.', 409);
  const { data: claimed, error: cErr } = await admin
    .from('chat_messages')
    .update({ solution: { ...sol, saved: true } })
    .eq('id', msg.id)
    .is('solution->saved', null)
    .select('id');
  if (cErr) throw cErr;
  if (!claimed?.length) throw new UserFacingError('done', '이미 넣었어요.', 409);
  try {
    const q = sol.question;
    const kp = q.key_point_id && note.note.key_points.some((k) => k.id === q.key_point_id) ? q.key_point_id : null;
    const withFigures = features.figures;
    const { data: row, error: qErr } = await admin
      .from('questions')
      .insert({
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
      })
      .select('id')
      .single();
    if (qErr || !row) throw qErr ?? new Error('question insert failed');
    const { error: cardErr } = await admin
      .from('cards')
      .insert({ question_id: row.id, user_id: userId, subject_id: note.subject_id, due: new Date().toISOString() });
    if (cardErr) {
      await admin.from('questions').delete().eq('id', row.id);
      throw cardErr;
    }
    return { ok: true, status: 'saved', added: 1, questionId: row.id as string };
  } catch (e) {
    // 넣지 못했으면 다시 누를 수 있게 되돌린다
    await admin.from('chat_messages').update({ solution: sol }).eq('id', msg.id);
    throw e;
  }
}
