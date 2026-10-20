// 노트 채팅: 노트 내용(과 일반 지식)으로 답한다. 답마다 에너지를 쓰고, 대화는 노트마다 저장한다.
// 사진·파일을 붙여 물어볼 수 있다 (문제를 보내면 단계로 풀어 준다. Pro 는 그림 풀이, 붙인 파일도 보관).
// AI 가 문제·노트에 넣자고 하면 미리보기만 저장하고, 넣기는 학생이 [넣기]를 눌러야 한다 (chat/apply)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings, getFeatures, limitsFor } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { loadOwnedNote, noteForPrompt } from '@/lib/server/notes';
import { runTaskFull } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import {
  chatAttachmentMetas,
  chatFileBlocks,
  chatFolderIdsOfNotes,
  historyLine,
  readChatFiles,
  removeChatFolders,
  zChatAttachments,
} from '@/lib/server/chat-input';
import { readChatAnswer } from '@/lib/chat-solution';
import { CHAT_SYSTEM, chatPrompt, wrap } from '@/lib/ai/prompts';
import { noteChatJsonSchema, toQuestionRow, zChat, zQuizItem } from '@/lib/ai/schemas';
import { FILE_ONLY_CONTENT, type ChatAttachmentMeta, type ChatProposal, type ChatSolution } from '@/lib/chat';
import { THINK_OUT } from '@/lib/ai/models';

// AI 답(최대 100초, 먼저 생각하고 답한다) + 저장
export const maxDuration = 120;

const Body = z.object({
  message: z.string().trim().max(2000, '한 번에 2,000자까지 물어볼 수 있어요.').catch(''),
  tier: z.enum(['fast', 'careful', 'admin']).catch('fast'),
  attachments: zChatAttachments,
});

/** 대화 기록은 최근 것만 보낸다 (비용) */
const HISTORY_MESSAGES = 12;
const HISTORY_CHARS = 1500;
/** 글 없이 파일만 보냈을 때 */
const FILE_ONLY_MESSAGE = '붙인 파일을 보고 답해 줘. 문제가 있으면 풀어 줘.';

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/chat'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    // 사진·PDF 를 base64 로 받는다 (Vercel 요청 한도 4.5MB 안)
    const parsed = Body.safeParse(await readJson(req, 4_600_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '보낸 내용이 올바르지 않아요.', 400);
    const { tier } = parsed.data;
    if (!parsed.data.message && !parsed.data.attachments.length) throw new UserFacingError('bad_body', '물어볼 내용을 적어 주세요.', 400);
    const features = await getFeatures(admin);
    if (!features.chat) {
      throw new UserFacingError('schema_outdated', '채팅을 쓰려면 관리자가 Supabase 에서 schema.sql 을 다시 실행해야 해요.', 503);
    }
    const note = await loadOwnedNote(admin, id, acc.userId);
    const app = await getAppSettings(admin);
    const files = await readChatFiles(parsed.data.attachments, limitsFor(acc, app.limits).pdfPages);
    const message = parsed.data.message || FILE_ONLY_MESSAGE;
    // 풀이 칸(chatFiles)이 있는 DB 에서만 단계 풀이를 받는다. 그림은 Pro
    const solve = features.chatFiles;
    const figures = solve && acc.canFigures;

    const { data: past, error: hErr } = await admin
      .from('chat_messages')
      .select(solve ? 'role, content, attachments, solution' : 'role, content')
      .eq('note_id', note.id)
      .eq('user_id', acc.userId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_MESSAGES);
    if (hErr) throw hErr;
    const rows = (past ?? []) as unknown as Array<{ role: string; content: string; attachments?: ChatAttachmentMeta[] | null; solution?: ChatSolution | null }>;
    const history = rows.reverse().map((m) => ({ role: m.role, content: historyLine({ ...m, content: String(m.content ?? '') }, HISTORY_CHARS) }));

    const s = acc.settings;
    const allow = { allowQuestions: s.chat.allowQuestions, allowNote: s.chat.allowNote };
    const attached = chatFileBlocks(files);
    const res = await runTaskFull(admin, acc, app, {
      task: 'chat',
      // 사진·파일로 보낸 문제는 풀이 노력으로 (먼저 생각하고 답한다)
      effortOf: files.length ? 'solve' : 'chat',
      tier,
      system: CHAT_SYSTEM,
      content: [
        textBlock(wrap('note', noteForPrompt(note.note, 16_000))),
        textBlock(wrap('history', JSON.stringify(history))),
        ...attached.blocks,
        textBlock(wrap('question', message)),
        textBlock(chatPrompt({ ...allow, types: s.quiz.types, solve: solve ? { figures } : undefined })),
      ],
      schema: noteChatJsonSchema({ solve, figures }),
      maxTokens: 16_000,
      outTokens: files.length ? THINK_OUT.chatSolve : THINK_OUT.chat,
      extraInputTokens: attached.tokens,
      timeoutMs: 100_000,
      sourceId: note.source_id,
      think: true,
    });
    const out = zChat.parse(res.json);
    // 풀이를 읽고 마지막 단계·넣을 문제의 정답·답 글이 같은 답을 말하게 맞춘다 (화면은 굵은 글씨 같은 꾸밈 기호를 쓰지 않아서 걷어 낸다)
    const { solution, reply, check } = readChatAnswer(out.reply, solve ? out.solution : undefined, { figures });
    if (check !== 'none') console.warn(`[kok] chat: steps and question disagreed (${check})`);

    // 넣자고 한 것: 설정에서 켠 것만, 쓸 수 있는 것만 남긴다
    let proposal: ChatProposal = { kind: 'none', outside: out.outside_note };
    if (out.proposal.kind === 'questions' && allow.allowQuestions) {
      const qs = out.proposal.questions
        .map((q) => zQuizItem.safeParse(q))
        .filter((r) => r.success)
        .map((r) => toQuestionRow(r.data))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .filter((r) => s.quiz.types.includes(r.type))
        .slice(0, 5);
      if (qs.length) proposal = { kind: 'questions', outside: out.outside_note, status: 'pending', questions: qs };
    } else if (out.proposal.kind === 'note' && allow.allowNote && out.proposal.note_addition.text.trim()) {
      const a = out.proposal.note_addition;
      proposal = {
        kind: 'note',
        outside: out.outside_note,
        status: 'pending',
        addition: { key_point_id: a.key_point_id.slice(0, 20), title: a.title.trim().slice(0, 60), text: a.text.trim().slice(0, 1200) },
      };
    }

    // 붙인 파일: Pro 는 보관(노트를 지우면 같이 지운다), 아니면 이름만
    const attachments =
      solve && files.length ? await chatAttachmentMetas(admin, files, acc.keepFiles ? { userId: acc.userId, sourceId: note.source_id } : null) : null;

    const now = Date.now();
    // 여러 행을 한 번에 넣을 때 빠진 칸은 기본값이 아니라 null 이 되므로 칸을 모두 적는다
    const extra = (a: ChatAttachmentMeta[] | null, sol: ChatSolution | null) => (solve ? { attachments: a, solution: sol } : {});
    const { data: saved, error } = await admin
      .from('chat_messages')
      .insert([
        {
          user_id: acc.userId,
          note_id: note.id,
          role: 'user',
          content: parsed.data.message || FILE_ONLY_CONTENT,
          model: null,
          energy: 0,
          proposal: null,
          created_at: new Date(now).toISOString(),
          ...extra(attachments, null),
        },
        {
          user_id: acc.userId,
          note_id: note.id,
          role: 'assistant',
          content: reply,
          model: res.model,
          energy: Math.round(res.energy * 1000) / 1000,
          proposal,
          created_at: new Date(now + 1).toISOString(),
          ...extra(null, solution),
        },
      ])
      .select(
        solve ? 'id, role, content, model, energy, proposal, created_at, attachments, solution' : 'id, role, content, model, energy, proposal, created_at',
      );
    if (error) throw error;
    return Response.json({ ok: true, messages: saved ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 대화 모두 지우기: 기록과 보관한 사진·파일 (학생은 저장소 파일을 지울 수 없어서 서버가 한다) */
export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/chat'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const note = await loadOwnedNote(admin, id, acc.userId);
    // 합친 노트의 채팅에는 합쳐진 노트의 폴더(chat/그 노트의 자료 번호/)에 보관한 파일도 있다: 기록을 지우기 전에 찾아 둔다
    const folders = [note.source_id, ...(await chatFolderIdsOfNotes(admin, acc.userId, [note.id]))];
    const { error } = await admin.from('chat_messages').delete().eq('note_id', note.id).eq('user_id', acc.userId);
    if (error) throw error;
    try {
      await removeChatFolders(admin, acc.userId, folders);
    } catch (e) {
      console.warn('[kok] chat files not removed', e);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
