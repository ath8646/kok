// 관리자: Pro 쿠폰 목록과 만들기
import type { NextRequest } from 'next/server';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

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
    return Response.json({ ok: true, coupons: data ?? [] });
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
});

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin } = await requireAccount({ admin: true });
    const parsed = Body.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '값이 올바르지 않아요.', 400);
    const b = parsed.data;
    const rows = Array.from({ length: b.count }, () => ({
      code: makeCode(),
      days: b.days,
      max_uses: b.maxUses,
      note: b.note || null,
      expires_at: b.expiresAt ?? null,
    }));
    const { error } = await admin.from('coupons').insert(rows);
    if (error) throw error;
    return Response.json({ ok: true, codes: rows.map((r) => r.code) });
  } catch (e) {
    return errorResponse(e);
  }
}
