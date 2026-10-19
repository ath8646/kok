// 홈 AI 채팅: 노트 없이 아무 과목이나 묻고, 사진·파일로 보낸 문제를 단계로 풀어 준다 (Pro 는 그림 풀이).
// 대화는 저장하지 않는다 (화면이 들고 있다가 홈을 떠나면 사라진다). 답마다 에너지를 쓴다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings, limitsFor } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { runTaskFull } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { chatFileBlocks, readChatFiles, zChatAttachments } from '@/lib/server/chat-input';
import { readChatAnswer } from '@/lib/chat-solution';
import { HOME_CHAT_SYSTEM, homeChatPrompt, wrap } from '@/lib/ai/prompts';
import { homeChatJsonSchema, zHomeChat } from '@/lib/ai/schemas';
import type { HomeChatReply } from '@/lib/chat';
import { THINK_OUT } from '@/lib/ai/models';

// AI 답(최대 100초, 먼저 생각하고 답한다)
export const maxDuration = 120;

const Body = z.object({
  message: z.string().trim().max(4000, '한 번에 4,000자까지 물어볼 수 있어요.').catch(''),
  tier: z.enum(['fast', 'careful', 'admin']).catch('fast'),
  // 지금까지의 대화 (최근 것만 보낸다, 화면이 들고 있는 것이라 길이를 다시 자른다)
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']).catch('user'),
        content: z
          .string()
          .catch('')
          .transform((s) => s.slice(0, 8000)),
      }),
    )
    .catch([])
    .transform((a) => a.slice(-40)),
  attachments: zChatAttachments,
});

const HISTORY_MESSAGES = 12;
const HISTORY_CHARS = 1500;
const FILE_ONLY_MESSAGE = '붙인 파일을 보고 답해 줘. 문제가 있으면 풀어 줘.';

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 4_600_000));
    if (!parsed.success) throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '보낸 내용이 올바르지 않아요.', 400);
    const { tier } = parsed.data;
    if (!parsed.data.message && !parsed.data.attachments.length) throw new UserFacingError('bad_body', '물어볼 내용을 적어 주세요.', 400);
    const app = await getAppSettings(admin);
    const files = await readChatFiles(parsed.data.attachments, limitsFor(acc, app.limits).pdfPages);
    const message = parsed.data.message || FILE_ONLY_MESSAGE;
    // 그림으로 보는 단계 풀이는 Pro (무료는 글 단계)
    const figures = acc.canFigures;
    const history = parsed.data.history.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS) }));
    const attached = chatFileBlocks(files);

    const res = await runTaskFull(admin, acc, app, {
      task: 'ask',
      effortOf: 'solve',
      tier,
      system: HOME_CHAT_SYSTEM,
      content: [
        textBlock(wrap('history', JSON.stringify(history))),
        ...attached.blocks,
        textBlock(wrap('question', message)),
        textBlock(homeChatPrompt({ figures })),
      ],
      schema: homeChatJsonSchema(figures),
      maxTokens: 16_000,
      outTokens: THINK_OUT.chatSolve,
      extraInputTokens: attached.tokens,
      timeoutMs: 100_000,
      think: true,
    });
    const out = zHomeChat.parse(res.json);
    // 풀이를 읽고 마지막 단계·넣을 문제의 정답·답 글이 같은 답을 말하게 맞춘다 (꾸밈 기호도 걷어 낸다)
    const { solution, reply, check } = readChatAnswer(out.reply, out.solution, { figures });
    if (check !== 'none') console.warn(`[kok] ask: steps and question disagreed (${check})`);
    const body: HomeChatReply = { reply, solution, energy: Math.round(res.energy * 1000) / 1000, model: res.model };
    return Response.json({ ok: true, ...body });
  } catch (e) {
    return errorResponse(e);
  }
}
