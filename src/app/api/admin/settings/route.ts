// 관리자: 한도·모델·공지·비상 스위치·운영자 정보 바꾸기
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { clearSettingsCache } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const Limits = z.object({
  freeDaily: num(0, 100000),
  proMonthly: num(0, 10000000),
  proDaily: num(0, 1000000),
  freeMonthlyBudgetUsd: num(0, 100000),
  usdPerEnergy: num(0.00001, 1),
  pdfPagesFree: num(1, 1000),
  pdfPagesPro: num(1, 2000),
  imagesFree: num(1, 60),
  imagesPro: num(1, 60),
  textCharsFree: num(100, 200000),
  textCharsPro: num(100, 200000),
  fileMbFree: num(1, 50),
  fileMbPro: num(1, 50),
  ratePerMinute: num(1, 1000),
  freeFileDays: num(1, 3650),
});
const modelId = z.string().regex(/^claude-[a-z0-9.-]{2,60}$/, '모델 이름은 claude- 로 시작해야 해요.');
const effort = z.enum(['low', 'medium', 'high']);
const Models = z.object({
  fast: modelId,
  careful: modelId,
  adminTest: modelId,
  effort: z.object({ organize: effort, merge: effort, visual: effort, quiz: effort, check: effort, grade: effort }),
});
const Notice = z.object({ active: z.boolean(), text: z.string().max(300) });
const Site = z.object({ contactEmail: z.string().max(120), operatorName: z.string().max(60) });

const Body = z.discriminatedUnion('key', [
  z.object({ key: z.literal('limits'), value: Limits }),
  z.object({ key: z.literal('models'), value: Models }),
  z.object({ key: z.literal('notice'), value: Notice }),
  z.object({ key: z.literal('ai_enabled'), value: z.boolean() }),
  z.object({ key: z.literal('site'), value: Site }),
]);

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin } = await requireAccount({ admin: true });
    const parsed = Body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) {
      throw new UserFacingError('bad_body', parsed.error.issues[0]?.message ?? '값이 올바르지 않아요.', 400);
    }
    const { key, value } = parsed.data;
    const { error } = await admin.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    clearSettingsCache();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
