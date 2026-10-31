// 관리자: 쿠폰(코드) 목록과 만들기. 코드는 Pro·Max 또는 테스트 플랜을 정해진 날수만큼 켠다
import type { NextRequest } from 'next/server';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { schemaMissing } from '../plans/shared';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0, O, 1, I) 뺌

function makeCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `KOK-${part()}-${part()}`;
}

export async function GET() {
  try {
    const { admin } = await requireAccount({ admin: true });
    const { data, error } = await admin.from('coupons').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    // 테스트 플랜 코드에는 플랜 이름을 붙인다
    const ids = [...new Set(rows.map((c) => c.plan_id).filter((v): v is string => typeof v === 'string'))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: plans } = await admin.from('custom_plans').select('id, name').in('id', ids);
      for (const p of plans ?? []) names.set(String(p.id), String(p.name));
    }
    const coupons = rows.map((c) => ({
      ...c,
      plan_id: typeof c.plan_id === 'string' ? c.plan_id : null,
      plan_name: typeof c.plan_id === 'string' ? (names.get(c.plan_id) ?? null) : null,
    }));
    return Response.json({ ok: true, coupons });
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({
  days: z.number().int().min(1).max(3650),
  maxUses: z.number().int().min(1).max(10000),
  count: z.number().int().min(1).max(50),
  note: z.string().max(100).catch(''),
  expiresAt: z.string().datetime().nullable().optional(),
  /** 테스트 플랜 id (없으면 Pro·Max 코드) */
  planId: z.string().uuid().nullable().optional(),
  /** 테스트 플랜이 아닐 때 켜는 요금제 (없으면 Pro) */
  tier: z.enum(['pro', 'max']).optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin } = await requireAccount({ admin: true });
    const parsed = Body.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '값이 올바르지 않아요.', 400);
    const b = parsed.data;
    const planId = b.planId ?? null;
    if (planId) {
      const { data: plan, error: planErr } = await admin.from('custom_plans').select('id').eq('id', planId).maybeSingle();
      if (planErr) throw schemaMissing(planErr) ?? planErr;
      if (!plan) throw new UserFacingError('plan_not_found', '고른 테스트 플랜이 없어요. 목록을 새로 고쳐 주세요.', 400);
    }
    const max = !planId && b.tier === 'max';
    const rows = Array.from({ length: b.count }, () => ({
      code: makeCode(),
      days: b.days,
      max_uses: b.maxUses,
      note: b.note || null,
      expires_at: b.expiresAt ?? null,
      // Pro 코드는 plan_id·tier 칸을 아예 보내지 않는다 (schema.sql 을 다시 실행하기 전에도 Pro 코드는 만들 수 있게)
      ...(planId ? { plan_id: planId } : {}),
      ...(max ? { tier: 'max' } : {}),
    }));
    const { error } = await admin.from('coupons').insert(rows);
    if (error) {
      if (max && /tier/.test(error.message ?? '')) {
        throw new UserFacingError('schema_outdated', 'Max 쿠폰 칸이 아직 없어요. Supabase SQL Editor 에서 supabase/schema.sql 을 다시 실행해 주세요.', 503);
      }
      throw (planId ? schemaMissing(error) : null) ?? error;
    }
    return Response.json({ ok: true, codes: rows.map((r) => r.code) });
  } catch (e) {
    return errorResponse(e);
  }
}
