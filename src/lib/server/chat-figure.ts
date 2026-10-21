// 채팅 풀이의 그림 (Pro): 풀이(글 단계)가 나온 뒤 두 번째 호출로 문제 그림과 단계마다 add·focus 를 받아 풀이에 붙인다.
// 한 호출에 그림까지 넣으면 structured outputs 의 스키마 한도("compiled grammar is too large")에 걸려서 따로 부른다.
// 그림은 더해 주는 것이라 실패해도(시간·에너지 부족 포함) 풀이는 그대로 간다
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelTier } from '@/lib/settings';
import type { ChatSolution } from '@/lib/chat';
import { chatFigurePrompt, wrap } from '@/lib/ai/prompts';
import { chatFigureJsonSchema } from '@/lib/ai/schemas';
import { withChatFigure } from '@/lib/chat-solution';
import { CHAT_FIGURE_OUT } from '@/lib/ai/models';
import { UserFacingError } from './errors';
import { runTaskFull } from './tasks';
import { textBlock, type ContentPart } from './claude';
import type { Account, AppSettings } from './account';

/** 그림 호출에 남겨 둘 최소 시간 (이보다 적게 남으면 그림 없이 답한다) */
const MIN_MS = 12_000;
/** 그림 호출 한 번의 최대 시간 */
const MAX_MS = 45_000;

/**
 * 풀이에 그림을 붙인다. leftMs: 라우트 제한 시간까지 남은 시간. 돌려주는 energy 는 그림 호출에 쓴 에너지 (실패·건너뜀은 0)
 */
export async function drawChatFigure(
  admin: SupabaseClient,
  acc: Account,
  app: AppSettings,
  o: {
    tier: ModelTier;
    solution: ChatSolution;
    leftMs: number;
    sourceId?: string | null;
    /** 학생이 붙인 사진·파일 (그림이 있는 문제를 원래 그림대로 그리게) */
    files?: ContentPart[];
    filesTokens?: number;
  },
): Promise<{ solution: ChatSolution; energy: number }> {
  const { solution } = o;
  if (!solution.steps.length || o.leftMs < MIN_MS) return { solution, energy: 0 };
  try {
    const steps = solution.steps.map((s, index) => ({ index, text: s.text }));
    const res = await runTaskFull(admin, acc, app, {
      task: 'chat',
      effortOf: 'solve',
      tier: o.tier,
      content: [
        ...(o.files ?? []),
        textBlock(wrap('problem', solution.problem || '(the problem is in the steps)')),
        textBlock(wrap('steps', JSON.stringify(steps))),
        textBlock(chatFigurePrompt()),
      ],
      schema: chatFigureJsonSchema,
      maxTokens: 8_000,
      outTokens: CHAT_FIGURE_OUT,
      extraInputTokens: o.filesTokens ?? 0,
      timeoutMs: Math.min(MAX_MS, o.leftMs),
      sourceId: o.sourceId ?? null,
    });
    return { solution: withChatFigure(solution, res.json), energy: res.energy };
  } catch (e) {
    // 에너지 부족·바쁨·못 그림: 풀이는 그대로 (까닭은 기록에)
    console.warn('[kok] chat figure skipped', e instanceof UserFacingError ? e.code : e);
    return { solution, energy: 0 };
  }
}
