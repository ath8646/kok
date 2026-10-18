// Claude API 호출 (서버 전용). JSON 스키마로 답을 받아 검사한다.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { Usage } from '@/lib/ai/models';
import type { Effort } from '@/lib/settings';
import { COMMON_SYSTEM } from '@/lib/ai/prompts';
import { UserFacingError } from './errors';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new UserFacingError('no_api_key', 'AI 키가 아직 설정되지 않았어요. 관리자에게 알려 주세요.', 503);
  }
  if (!client) client = new Anthropic({ apiKey, maxRetries: 1, timeout: 150_000 });
  return client;
}

export type ContentPart = Anthropic.Messages.ContentBlockParam;

export class AiCallError extends Error {
  /** 답이 최대 길이(max_tokens)에 닿아 잘렸다 */
  truncated = false;
  constructor(
    public kind: 'retryable' | 'refusal' | 'bad_output' | 'fatal',
    message: string,
  ) {
    super(message);
  }
}

function thinkingFor(model: string): Anthropic.Messages.ThinkingConfigParam | undefined {
  if (model.startsWith('claude-haiku-5')) return { type: 'disabled' };
  if (model.startsWith('claude-sonnet-5')) return { type: 'between_tools' };
  return undefined; // Opus·Fable 은 생각(adaptive)이 항상 켜져 있다
}

export type JsonCall = {
  model: string;
  effort: Effort;
  content: ContentPart[];
  schema: Record<string, unknown>;
  maxTokens: number;
  /** 한 번 부를 때 기다리는 최대 시간 (기본 150초) */
  timeoutMs?: number;
  /** SDK 자동 재시도 횟수 (기본 1). 자료 처리는 단계마다 따로 다시 하므로 0 */
  maxRetries?: number;
  /** 공통 지시(COMMON_SYSTEM) 대신 쓸 지시 (노트 채팅) */
  system?: string;
};

export type JsonResult = { json: unknown; usage: Usage; model: string };

export async function callJson(req: JsonCall): Promise<JsonResult> {
  const anthropic = getClient();
  const thinking = thinkingFor(req.model);
  let res: Anthropic.Messages.Message;
  try {
    res = await anthropic.messages.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system ?? COMMON_SYSTEM,
        messages: [{ role: 'user', content: req.content }],
        output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
        ...(thinking ? { thinking } : {}),
      },
      { timeout: req.timeoutMs ?? 150_000, maxRetries: req.maxRetries ?? 1 },
    );
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    if (e instanceof Anthropic.APIError) {
      const status = e.status ?? 0;
      const msg = String(e.message ?? '');
      if (status === 401 || status === 403) {
        throw new UserFacingError('ai_key_invalid', 'AI 키가 맞지 않아요. 관리자에게 알려 주세요.', 503);
      }
      if (/credit balance|billing|spend limit|usage limit/i.test(msg)) {
        throw new UserFacingError('ai_budget', 'AI 사용 한도에 닿았어요. 관리자에게 알려 주세요.', 503);
      }
      if (status === 429 || status === 529 || status >= 500 || status === 0) {
        throw new AiCallError('retryable', `AI 서버가 바빠요 (${status}).`);
      }
      throw new AiCallError('fatal', `AI 요청 오류 (${status}): ${msg.slice(0, 200)}`);
    }
    throw new AiCallError('retryable', 'AI 서버에 연결하지 못했어요.');
  }

  const usage: Usage = {
    input_tokens: res.usage?.input_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: res.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: res.usage?.cache_read_input_tokens ?? 0,
  };

  if (res.stop_reason === 'refusal') {
    const err = new AiCallError('refusal', '이 자료는 콕에서 다룰 수 없는 내용이 있어서 정리하지 못했어요.');
    (err as AiCallError & { usage?: Usage }).usage = usage;
    throw err;
  }
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') {
    const err = new AiCallError('bad_output', 'AI 답이 비어 있어요.');
    (err as AiCallError & { usage?: Usage }).usage = usage;
    throw err;
  }
  if (res.stop_reason === 'max_tokens') {
    const err = new AiCallError('bad_output', 'AI 답이 너무 길어서 잘렸어요.');
    err.truncated = true;
    (err as AiCallError & { usage?: Usage }).usage = usage;
    throw err;
  }
  try {
    return { json: JSON.parse(text.text), usage, model: res.model ?? req.model };
  } catch {
    const err = new AiCallError('bad_output', 'AI 답을 읽지 못했어요.');
    (err as AiCallError & { usage?: Usage }).usage = usage;
    throw err;
  }
}

export function usageOf(e: unknown): Usage | null {
  if (e && typeof e === 'object' && 'usage' in e) return (e as { usage: Usage }).usage ?? null;
  return null;
}

export function pdfBlock(bytes: Uint8Array): ContentPart {
  return {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') },
  };
}

export function imageBlock(bytes: Uint8Array, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): ContentPart {
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') },
  };
}

export function textBlock(text: string): ContentPart {
  return { type: 'text', text };
}

/** API 키가 동작하는지 아주 짧게 시험한다 (관리자 화면) */
export async function testKey(model: string): Promise<{ ok: true; model: string } | { ok: false; message: string }> {
  try {
    const anthropic = getClient();
    const thinking = thinkingFor(model);
    const res = await anthropic.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      ...(thinking ? { thinking } : {}),
    });
    return { ok: true, model: res.model ?? model };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof Anthropic.APIError) return { ok: false, message: `${e.status ?? ''} ${String(e.message).slice(0, 160)}` };
    return { ok: false, message: '연결하지 못했어요.' };
  }
}

export function keyHint(): string | null {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return null;
  return `…${k.slice(-4)}`;
}
