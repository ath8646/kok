// 쿠폰(코드) 쓰기: Pro 또는 관리자가 만든 테스트 플랜을 켠다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

const Body = z.object({ code: z.string().trim().min(4).max(40) });

const MESSAGES: Record<string, string> = {
  coupon_not_found: '없는 쿠폰이에요. 글자를 다시 확인해 주세요.',
  coupon_expired: '기간이 지난 쿠폰이에요.',
  coupon_used_up: '이미 다 쓰인 쿠폰이에요.',
  coupon_already_used: '이미 쓴 쿠폰이에요.',
};

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
    const { data, error } = await admin.rpc('kok_redeem_coupon', { p_code: code, p_user: acc.userId });
    if (error) {
      const key = Object.keys(MESSAGES).find((k) => error.message?.includes(k));
      if (key) throw new UserFacingError(key, MESSAGES[key], 400);
      throw error;
    }
    // 어떤 플랜이 켜졌는지 알려 준다 (Pro 또는 관리자가 만든 테스트 플랜)
    const { data: c } = await admin.from('coupons').select('plan_id').eq('code', code).maybeSingle();
    let plan: { kind: 'pro' | 'custom'; name: string } = { kind: 'pro', name: 'Pro' };
    if (c?.plan_id) {
      const { data: p } = await admin.from('custom_plans').select('name').eq('id', c.plan_id).maybeSingle();
      plan = { kind: 'custom', name: (p?.name as string | undefined) ?? '테스트 플랜' };
    }
    return Response.json({ ok: true, until: data, proUntil: data, plan });
  } catch (e) {
    return errorResponse(e);
  }
}
