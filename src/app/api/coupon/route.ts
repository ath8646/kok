// 쿠폰(코드) 쓰기: Pro·Max 또는 관리자가 만든 테스트 플랜을 켠다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

/** replace: 다른 테스트 플랜이 켜져 있어도 새 플랜으로 바꾼다 (화면에서 한 번 물어본 뒤) */
const Body = z.object({ code: z.string().trim().min(4).max(40), replace: z.boolean().optional() });

const MESSAGES: Record<string, [string, number]> = {
  coupon_not_found: ['없는 쿠폰이에요. 글자를 다시 확인해 주세요.', 400],
  coupon_expired: ['기간이 지난 쿠폰이에요.', 400],
  coupon_used_up: ['이미 다 쓰인 쿠폰이에요.', 400],
  coupon_already_used: ['이미 쓴 쿠폰이에요.', 400],
  plan_active: ['이미 테스트 플랜을 쓰고 있어요. 새 플랜으로 바꿀지 골라 주세요.', 409],
};

type Redeemed = { kind: 'pro' | 'max' | 'custom'; until: string; starts?: string | null; pro_until?: string | null; max_until?: string | null };

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '쿠폰 번호를 적어 주세요.', 400);
    const { data: allowed, error: rErr } = await admin.rpc('kok_hit_rate', { p_user: acc.userId, p_max: 8, p_window_seconds: 60, p_kind: 'coupon' });
    if (rErr) throw rErr;
    if (allowed === false) throw new UserFacingError('rate_limited', '너무 많이 시도했어요. 1분 뒤에 다시 해 주세요.', 429);
    const code = parsed.data.code.trim().toUpperCase();
    // p_replace 는 바꾸겠다고 했을 때만 보낸다 (schema.sql 을 다시 실행하기 전의 함수에는 이 칸이 없다)
    const args: Record<string, unknown> = { p_code: code, p_user: acc.userId };
    if (parsed.data.replace) args.p_replace = true;
    const { data, error } = await admin.rpc('kok_redeem_coupon', args);
    if (error) {
      const key = Object.keys(MESSAGES).find((k) => error.message?.includes(k));
      if (key) throw new UserFacingError(key, MESSAGES[key][0], MESSAGES[key][1]);
      throw error;
    }
    // 예전 함수는 Pro 끝나는 때(글자)만 돌려준다
    const r: Redeemed = typeof data === 'string' ? { kind: 'pro', until: data } : (data as Redeemed);
    let plan: { kind: 'pro' | 'max' | 'custom'; name: string } = r.kind === 'max' ? { kind: 'max', name: 'Max' } : { kind: 'pro', name: 'Pro' };
    if (r.kind === 'custom') {
      const { data: c } = await admin.from('coupons').select('plan_id').eq('code', code).maybeSingle();
      const { data: p } = c?.plan_id ? await admin.from('custom_plans').select('name').eq('id', c.plan_id).maybeSingle() : { data: null };
      plan = { kind: 'custom', name: (p?.name as string | undefined) ?? '테스트 플랜' };
    }
    const startsLater = r.kind !== 'custom' && !!r.starts && Date.parse(r.starts) > Date.now() + 60_000;
    return Response.json({
      ok: true,
      until: r.until,
      plan,
      // Pro·Max 코드: 켜진 테스트 플랜(Pro 는 Max 도)이 끝난 뒤에 시작하면 그 시각
      proStarts: startsLater ? r.starts : null,
      // 테스트 플랜·Max 코드: 남은 Pro 가 그 뒤에 이어지면 그 끝나는 때
      proAfter: r.kind !== 'pro' ? (r.pro_until ?? null) : null,
      // 테스트 플랜 코드: 남은 Max 가 플랜 뒤에 이어지면 그 끝나는 때
      maxAfter: r.kind === 'custom' ? (r.max_until ?? null) : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
