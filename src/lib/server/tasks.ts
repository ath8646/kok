// 작은 AI 작업 (그림·문제 다시 만들기, 채점, 문제 고치기) 공통 처리
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateSmallTask } from '@/lib/ai/models';
import { modelForTier, type AiTask, type ModelTier } from '@/lib/settings';
import { assertAiAllowed, charge, type Account, type AppSettings } from './account';
import { AiCallError, callJson, usageOf, type ContentPart } from './claude';
import { UserFacingError } from './errors';

/** 보낼 내용의 대략적인 입력 토큰 수 (한국어는 글자당 약 0.9 토큰 + 시스템 안내·스키마) */
export function contentTokens(content: ContentPart[]): number {
  let chars = 0;
  for (const c of content) if (c.type === 'text') chars += c.text.length;
  return Math.ceil(1500 + chars * 0.9);
}

/** 관리자에게는 AI 가 답을 못 만든 까닭(API 응답)도 보여 준다: 모델 이름·키 같은 운영 설정 문제를 바로 알 수 있게. 학생에게는 짧은 안내만 */
export function adminDetail(acc: Pick<Account, 'isAdmin'>, e: AiCallError): string {
  return acc.isAdmin ? ` [${e.message.slice(0, 220)}]` : '';
}

export async function runTask(
  admin: SupabaseClient,
  acc: Account,
  app: AppSettings,
  t: {
    task: string;
    effortOf: AiTask;
    tier: ModelTier;
    content: ContentPart[];
    schema: Record<string, unknown>;
    maxTokens: number;
    /** 예상 출력 토큰 (에너지 검사용). 입력은 보낼 내용의 길이로 계산한다 */
    outTokens: number;
    /** 글로 세지 못하는 입력 (사진·PDF)의 예상 토큰 */
    extraInputTokens?: number;
    /** 이 값보다 적게는 검사하지 않는다 (0 이면 에너지 검사를 건너뛴다: 이미 검사한 작업의 뒷단계) */
    minEstimate?: number;
    /** 한 번 기다리는 최대 시간. 라우트 제한 시간보다 짧아야 한다 */
    timeoutMs: number;
    sourceId?: string | null;
    /** 공통 지시 대신 쓸 지시 (노트 채팅) */
    system?: string;
    /** 문제 풀기: 먼저 생각하고 답한다 (callJson think) */
    think?: boolean;
    /** 답이 최대 길이에 닿아 잘렸을 때 보여 줄 말 (다시 해도 같으니 '다시 해 주세요' 대신). 없으면 보통 오류 */
    tooLong?: string;
  },
): Promise<unknown> {
  return (await runTaskFull(admin, acc, app, t)).json;
}

/** runTask 와 같고, 쓴 에너지와 모델도 돌려준다 */
export async function runTaskFull(
  admin: SupabaseClient,
  acc: Account,
  app: AppSettings,
  t: Parameters<typeof runTask>[3],
): Promise<{ json: unknown; energy: number; model: string }> {
  const model = modelForTier(app.models, t.tier, acc.canCareful, acc.isAdmin);
  const estimate =
    t.minEstimate === 0
      ? 0
      : Math.max(t.minEstimate ?? 0, estimateSmallTask(model, app.limits.usdPerEnergy, contentTokens(t.content) + (t.extraInputTokens ?? 0), t.outTokens));
  await assertAiAllowed(admin, acc, app, { estimate, rateLimit: true });
  try {
    const res = await callJson({
      model,
      effort: app.models.effort[t.effortOf],
      content: t.content,
      schema: t.schema,
      maxTokens: t.maxTokens,
      timeoutMs: t.timeoutMs,
      maxRetries: 0,
      system: t.system,
      think: t.think,
    });
    const cost = await charge(admin, { acc, task: t.task, model: res.model, usage: res.usage, usdPerEnergy: app.limits.usdPerEnergy, sourceId: t.sourceId });
    return { json: res.json, energy: cost.energy, model: res.model };
  } catch (e) {
    const usage = usageOf(e);
    if (usage) await charge(admin, { acc, task: t.task, model, usage, usdPerEnergy: app.limits.usdPerEnergy, sourceId: t.sourceId });
    if (e instanceof AiCallError) {
      if (e.truncated && t.tooLong) throw new UserFacingError('ai_too_long', t.tooLong, 400);
      if (e.kind === 'refusal') throw new UserFacingError('ai_refusal', '이 내용은 KOK에서 다룰 수 없어요.', 422);
      if (e.kind === 'retryable') throw new UserFacingError('ai_busy', 'AI 서버가 바빠요. 잠시 뒤에 다시 해 주세요.', 503);
      throw new UserFacingError('ai_bad_output', `AI가 답을 제대로 만들지 못했어요. 다시 해 주세요.${adminDetail(acc, e)}`, 502);
    }
    throw e;
  }
}
