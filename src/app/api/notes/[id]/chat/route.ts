// 노트 채팅: 노트 내용(과 일반 지식)으로 답한다. 답마다 에너지를 쓰고, 대화는 노트마다 저장한다.
// AI 가 문제·노트에 넣자고 하면 미리보기만 저장하고, 넣기는 학생이 [넣기]를 눌러야 한다 (chat/apply)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings, getFeatures } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { loadOwnedNote, noteForPrompt } from '@/lib/server/notes';
import { runTaskFull } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { CHAT_SYSTEM, chatPrompt, wrap } from '@/lib/ai/prompts';
import { chatJsonSchema, toQuestionRow, zChat, zQuizItem } from '@/lib/ai/schemas';
import type { ChatProposal } from '@/lib/chat';

// AI 답(최대 100초) + 저장
export const maxDuration = 120;

const Body = z.object({
  message: z.string().trim().min(1, '물어볼 내용을 적어 주세요.').max(2000, '한 번에 2,000자까지 물어볼 수 있어요.'),
  tier: z.enum(['fast', 'careful', 'admin']).catch('fast'),
});

/** 대화 기록은 최근 것만 보낸다 (비용) */
const HISTORY_MESSAGES = 12;
const HISTORY_CHARS = 1500;

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/chat'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '보낸 내용이 올바르지 않아요.', 400);
    const { message, tier } = parsed.data;
    const features = await getFeatures(admin);
    if (!features.chat) {
      throw new UserFacingError('schema_outdated', '채팅을 쓰려면 관리자가 Supabase 에서 schema.sql 을 다시 실행해야 해요.', 503);
    }
    const note = await loadOwnedNote(admin, id, acc.userId);
    const app = await getAppSettings(admin);

    const { data: past, error: hErr } = await admin
      .from('chat_messages')
      .select('role, content')
      .eq('note_id', note.id)
      .eq('user_id', acc.userId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_MESSAGES);
    if (hErr) throw hErr;
    const history = (past ?? []).reverse().map((m) => ({ role: m.role as string, content: String(m.content ?? '').slice(0, HISTORY_CHARS) }));

    const s = acc.settings;
    const allow = { allowQuestions: s.chat.allowQuestions, allowNote: s.chat.allowNote };
    const res = await runTaskFull(admin, acc, app, {
      task: 'chat',
      effortOf: 'chat',
      tier,
      system: CHAT_SYSTEM,
      content: [
        textBlock(wrap('note', noteForPrompt(note.note, 16_000))),
        textBlock(wrap('history', JSON.stringify(history))),
        textBlock(wrap('question', message)),
        textBlock(chatPrompt({ ...allow, types: s.quiz.types })),
      ],
      schema: chatJsonSchema,
      maxTokens: 3000,
      outTokens: 700,
      timeoutMs: 100_000,
      sourceId: note.source_id,
    });
    const out = zChat.parse(res.json);

    // 넣자고 한 것: 설정에서 켠 것만, 쓸 수 있는 것만 남긴다
    let proposal: ChatProposal = { kind: 'none', outside: out.outside_note };
    if (out.proposal.kind === 'questions' && allow.allowQuestions) {
      const rows = out.proposal.questions
        .map((q) => zQuizItem.safeParse(q))
        .filter((r) => r.success)
        .map((r) => toQuestionRow(r.data))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .filter((r) => s.quiz.types.includes(r.type))
        .slice(0, 5);
      if (rows.length) proposal = { kind: 'questions', outside: out.outside_note, status: 'pending', questions: rows };
    } else if (out.proposal.kind === 'note' && allow.allowNote && out.proposal.note_addition.text.trim()) {
      const a = out.proposal.note_addition;
      proposal = {
        kind: 'note',
        outside: out.outside_note,
        status: 'pending',
        addition: { key_point_id: a.key_point_id.slice(0, 20), title: a.title.trim().slice(0, 60), text: a.text.trim().slice(0, 1200) },
      };
    }

    const now = Date.now();
    // 화면은 굵은 글씨 같은 꾸밈 기호를 쓰지 않는다 (지시해도 가끔 붙여서 걷어 낸다)
    const reply =
      out.reply
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .trim()
        .slice(0, 8000) || '답을 만들지 못했어요. 다시 물어봐 주세요.';
    const { data: rows, error } = await admin
      .from('chat_messages')
      .insert([
        // 여러 행을 한 번에 넣을 때 빠진 칸은 기본값이 아니라 null 이 되므로 칸을 모두 적는다
        {
          user_id: acc.userId,
          note_id: note.id,
          role: 'user',
          content: message,
          model: null,
          energy: 0,
          proposal: null,
          created_at: new Date(now).toISOString(),
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
        },
      ])
      .select('id, role, content, model, energy, proposal, created_at');
    if (error) throw error;
    return Response.json({ ok: true, messages: rows ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}
