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

/**
 * 생각을 끄는 설정 (think 가 아닐 때). Haiku 5.5 는 끌 수 있고(effort high 까지), Sonnet 5.5 는 도구 사이에서만 생각하는 것이 가장 적은 설정,
 * Opus·Fable 은 끌 수 없어서 undefined (모델 기본값 adaptive)
 */
function thinkingFor(model: string): Anthropic.Messages.ThinkingConfigParam | undefined {
  if (model.startsWith('claude-haiku-5')) return { type: 'disabled' };
  if (model.startsWith('claude-sonnet-5')) return { type: 'between_tools' };
  return undefined;
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  };
}

/** 오류에 그때까지 쓴 토큰을 붙인다 (usageOf 로 읽어 실패한 호출도 에너지를 받는다) */
function withUsage<E>(e: E, usage: Usage): E {
  if (e && typeof e === 'object') (e as E & { usage?: Usage }).usage = usage;
  return e;
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
  /** 문제 풀기: 빠른·꼼꼼 모델도 먼저 생각하고 답한다 (모델 기본값인 adaptive, 양은 effort 로 정해진다) */
  think?: boolean;
};

export type JsonResult = { json: unknown; usage: Usage; model: string };

/**
 * JSON 답을 한 번 받는다. think 면 모델 기본값(adaptive 생각)으로 먼저 생각하고 답하고, 아니면 생각을 끈다(thinkingFor).
 * 먼저 생각하게 한 호출이 답을 못 만들면(답이 비었거나 요청이 거절됨) 생각을 끄고 한 번 더 부른다:
 * Haiku 5.5 는 가끔 답을 생각 안에만 쓰고 글 없이 턴을 끝낸다(문서의 알려진 동작). 첫 호출의 사용량은 더해서 돌려준다
 */
export async function callJson(req: JsonCall): Promise<JsonResult> {
  const anthropic = getClient();
  const off = thinkingFor(req.model);
  const started = Date.now();
  const budget = req.timeoutMs ?? 150_000;
  try {
    return await callOnce(anthropic, req, req.think ? undefined : off, budget);
  } catch (e) {
    // 두 번째 호출도 같은 시간 안에 (라우트 제한 시간을 넘지 않게): 남은 시간이 너무 짧으면 그대로 알린다
    const left = budget - (Date.now() - started);
    const again = req.think && off && left > 15_000 && e instanceof AiCallError && (e.kind === 'fatal' || (e.kind === 'bad_output' && !e.truncated));
    if (!again) throw e;
    const prior = usageOf(e);
    console.warn('[kok] ai: thinking call failed, retrying without thinking', req.model, e.message);
    try {
      const res = await callOnce(anthropic, req, off, left);
      return prior ? { ...res, usage: addUsage(res.usage, prior) } : res;
    } catch (e2) {
      if (!prior) throw e2;
      const u = usageOf(e2);
      throw withUsage(e2, u ? addUsage(u, prior) : prior);
    }
  }
}

async function callOnce(
  anthropic: Anthropic,
  req: JsonCall,
  thinking: Anthropic.Messages.ThinkingConfigParam | undefined,
  timeoutMs: number,
): Promise<JsonResult> {
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
      { timeout: timeoutMs, maxRetries: req.maxRetries ?? 1 },
    );
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    if (e instanceof Anthropic.APIError) {
      const status = e.status ?? 0;
      const msg = String(e.message ?? '');
      // 까닭을 서버 기록에 남긴다 (화면에는 짧은 안내만 간다)
      console.error('[kok] ai api error', req.model, status, msg.slice(0, 300));
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
    console.error('[kok] ai call failed', req.model, e);
    throw new AiCallError('retryable', 'AI 서버에 연결하지 못했어요.');
  }

  const usage: Usage = {
    input_tokens: res.usage?.input_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: res.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: res.usage?.cache_read_input_tokens ?? 0,
  };
  const shape = () => `stop ${res.stop_reason}, blocks ${res.content.map((b) => b.type).join('+') || '없음'}, out ${usage.output_tokens}`;

  if (res.stop_reason === 'refusal') {
    throw withUsage(new AiCallError('refusal', '이 자료는 KOK에서 다룰 수 없는 내용이 있어서 정리하지 못했어요.'), usage);
  }
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') {
    console.error('[kok] ai bad output: no text', req.model, shape());
    throw withUsage(new AiCallError('bad_output', `AI 답이 비어 있어요 (${shape()}).`), usage);
  }
  if (res.stop_reason === 'max_tokens') {
    console.error('[kok] ai bad output: truncated', req.model, shape());
    const err = new AiCallError('bad_output', `AI 답이 너무 길어서 잘렸어요 (${shape()}).`);
    err.truncated = true;
    throw withUsage(err, usage);
  }
  try {
    return { json: JSON.parse(text.text), usage, model: res.model ?? req.model };
  } catch {
    console.error('[kok] ai bad output: not json', req.model, shape(), text.text.slice(0, 200));
    throw withUsage(new AiCallError('bad_output', `AI 답을 읽지 못했어요 (${shape()}).`), usage);
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
