// 로그인 확인 (모든 API 가 직접 부른다. proxy 는 /api 를 건너뛴다)
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { getAccount, type Account } from './account';
import { UserFacingError } from './errors';

export type SessionUser = { userId: string; email: string | null; provider: string | null };

export async function requireUser(): Promise<SessionUser> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) throw new UserFacingError('unauthorized', '로그인이 필요해요. 다시 로그인해 주세요.', 401);
  // 익명 로그인은 쓰지 않는다 (켜져 있어도 막는다)
  if (data.claims.is_anonymous === true) throw new UserFacingError('unauthorized', '구글로 로그인해 주세요.', 401);
  const email = typeof data.claims.email === 'string' ? data.claims.email : null;
  const meta = data.claims.app_metadata as { provider?: unknown } | undefined;
  const provider = typeof meta?.provider === 'string' ? meta.provider : null;
  return { userId: sub, email, provider };
}

export async function requireAccount(opts: { consent?: boolean; admin?: boolean } = {}): Promise<{
  user: SessionUser;
  admin: SupabaseClient;
  acc: Account;
}> {
  const user = await requireUser();
  const admin = adminClient();
  const acc = await getAccount(admin, user.userId, user.email, user.provider);
  if (opts.admin && !acc.isAdmin) throw new UserFacingError('forbidden', '관리자만 할 수 있어요.', 403);
  if (opts.consent !== false && !acc.consented && !acc.isAdmin) {
    throw new UserFacingError('no_consent', '먼저 약관에 동의해 주세요.', 403);
  }
  return { user, admin, acc };
}

/** 다른 사이트에서 보낸 요청(CSRF)을 막는다: Origin 이 이 사이트여야 한다 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return; // 같은 사이트의 fetch 는 보통 Origin 을 붙인다. 없으면 SameSite 쿠키에 맡긴다
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (host && new URL(origin).host === host) return;
  } catch {
    /* 아래에서 막는다 */
  }
  throw new UserFacingError('bad_origin', '허용되지 않은 요청이에요.', 403);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(id: string, what = '번호') {
  if (!UUID_RE.test(id)) throw new UserFacingError('bad_id', `${what}가 올바르지 않아요.`, 400);
}

/** JSON 본문 읽기 (너무 크면 거절) */
export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new UserFacingError('too_large', '보낸 내용이 너무 커요.', 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new UserFacingError('too_large', '보낸 내용이 너무 커요.', 413);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new UserFacingError('bad_json', '보낸 내용을 읽지 못했어요.', 400);
  }
}
