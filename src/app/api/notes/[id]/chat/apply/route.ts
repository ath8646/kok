// 노트 채팅에서 AI 가 넣자고 한 것(문제·노트 내용)을 학생이 [넣기]·[취소]로 정한다. AI 를 다시 부르지 않는다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoAppendRunning, loadOwnedNote, updateNoteBody } from '@/lib/server/notes';
import { applyNoteAddition } from '@/lib/note-edit';
import type { ChatProposal } from '@/lib/chat';

const Body = z.object({ messageId: z.string().uuid(), action: z.enum(['apply', 'cancel']) });

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
    if (action === 'apply' && p.kind === 'note') await assertNoAppendRunning(admin, note.source_id);

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
