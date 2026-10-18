// Cloudflare Workers AI 로 배경 그림 만들기 (FLUX.1 schnell, 무료 몫 하루 10,000 뉴런 ≈ 그림 170장).
// 키는 Vercel 환경변수(CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)에만 있다. 없으면 그림 대신 무늬를 쓴다.
import 'server-only';
import { classifyCfError } from '@/lib/themes/cf-errors';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
/** 그림 한 장의 최대 크기 (FLUX 결과는 보통 100~300KB JPEG) */
export const AI_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export function cloudflareReady(): boolean {
  return !!process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && !!process.env.CLOUDFLARE_API_TOKEN?.trim();
}

/** 시험할 때 가짜 서버로 보낼 수 있게 (기본은 Cloudflare) */
function apiBase(): string {
  return (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
}

export class ImageGenError extends Error {
  constructor(
    public kind: 'not_configured' | 'quota' | 'refused' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

/** 그림 한 장 (JPEG 바이트). 실패하면 ImageGenError */
export async function generateImage(prompt: string, opts: { seed?: number; timeoutMs?: number } = {}): Promise<Uint8Array> {
  if (!cloudflareReady()) throw new ImageGenError('not_configured', 'Cloudflare 키가 없어요.');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID!.trim();
  if (!/^[0-9a-f]{32}$/i.test(account)) throw new ImageGenError('not_configured', 'Cloudflare 계정 ID 모양이 이상해요.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 40_000);
  try {
    const res = await fetch(`${apiBase()}/accounts/${account}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 4, seed: opts.seed ?? Math.floor(Math.random() * 1_000_000) }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let body: { success?: boolean; result?: { image?: unknown }; errors?: Array<{ code?: number; message?: string }> } | null = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!res.ok || !body?.success || typeof body.result?.image !== 'string') {
      const kind = classifyCfError(body);
      if (kind === 'quota') throw new ImageGenError('quota', '오늘 그림 몫을 다 썼어요.');
      if (kind === 'refused') throw new ImageGenError('refused', '이 그림은 만들 수 없어요.');
      const msg = (body?.errors ?? [])
        .map((e) => `${e.code ?? ''} ${e.message ?? ''}`)
        .join('; ')
        .slice(0, 300);
      console.warn('[kok] cloudflare image failed', res.status, msg);
      throw new ImageGenError('failed', '그림을 만들지 못했어요.');
    }
    const bytes = Uint8Array.from(Buffer.from(body.result.image, 'base64'));
    if (!bytes.length || bytes.length > AI_IMAGE_MAX_BYTES) throw new ImageGenError('failed', '그림을 만들지 못했어요.');
    return bytes;
  } catch (e) {
    if (e instanceof ImageGenError) throw e;
    console.warn('[kok] cloudflare image error', (e as Error).message);
    throw new ImageGenError('failed', '그림을 만들지 못했어요.');
  } finally {
    clearTimeout(timer);
  }
}
