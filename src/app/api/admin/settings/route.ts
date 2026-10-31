// 관리자: 한도·요금제 혜택·모델·공지·비상 스위치·운영자 정보 바꾸기
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { clearSettingsCache } from '@/lib/server/account';
import { MAX_FILE_MB } from '@/lib/settings';
import { ENERGY_MAX, PERKS, PLAN_NUMBERS, PRICE_MAX, TIER_NAME, TIERS, type Perk, type PlanNumberKey } from '@/lib/plans';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
// 파일 크기는 저장소 한도(MAX_FILE_MB)를 넘길 수 없다
const fileMb = z
  .number()
  .finite()
  .min(1, '파일 MB는 1 이상이어야 해요.')
  .max(MAX_FILE_MB, `파일 MB는 ${MAX_FILE_MB}까지 정할 수 있어요 (저장소 한도). 더 크게 하려면 저장소 한도부터 올려야 해요.`);
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
  fileMbFree: fileMb,
  fileMbPro: fileMb,
  ratePerMinute: num(1, 1000),
  freeFileDays: num(1, 3650),
});
const modelId = z.string().regex(/^claude-[a-z0-9.-]{2,60}$/, '모델 이름은 claude- 로 시작해야 해요.');
const effort = z.enum(['low', 'medium', 'high']);
const Models = z.object({
  fast: modelId,
  careful: modelId,
  adminTest: modelId,
  effort: z.object({
    organize: effort,
    merge: effort,
    visual: effort,
    quiz: effort,
    check: effort,
    grade: effort,
    chat: effort.catch('low'),
    theme: effort.catch('low'),
    solve: effort.catch('medium'),
    redraw: effort.catch('medium'),
    locate: effort.catch('low'),
    cover: effort.catch('low'),
    problems: effort.catch('medium'),
  }),
});

/** 요금제 한 칸 (오류 글에 요금제와 칸 이름) */
function planSpec(tier: (typeof TIERS)[number]) {
  const who = TIER_NAME[tier];
  const n = (label: string, min: number, max: number) =>
    z
      .number({ error: `${who} '${label}' 칸에는 숫자를 적어 주세요.` })
      .finite()
      .min(min, `${who} '${label}' 칸은 ${min.toLocaleString('ko-KR')} 이상이어야 해요.`)
      .max(max, `${who} '${label}' 칸은 ${max.toLocaleString('ko-KR')}까지 정할 수 있어요.`);
  const nums = Object.fromEntries(PLAN_NUMBERS.map((f) => [f.key, n(f.label, f.min, f.max).int(`${who} '${f.label}' 칸은 정수로 적어 주세요.`)])) as Record<
    PlanNumberKey,
    z.ZodNumber
  >;
  return z
    .object({
      price: n('값', 0, PRICE_MAX).int(`${who} '값' 칸은 정수로 적어 주세요.`),
      energyDaily: n('하루 에너지', 0, ENERGY_MAX).nullable(),
      energyMonthly: n('한 달 에너지', 0, ENERGY_MAX).nullable(),
      ...nums,
      perks: z.object(Object.fromEntries(PERKS.map((p) => [p, z.boolean()])) as Record<Perk, z.ZodBoolean>),
    })
    .refine((v) => v.energyDaily !== null || v.energyMonthly !== null, `${who}는 하루나 한 달 에너지 중 하나는 정해 주세요.`)
    .refine((v) => v.energyMonthly === null || v.energyDaily === null || v.energyDaily <= v.energyMonthly, `${who}의 하루 에너지가 한 달 에너지보다 많아요.`);
}
const Plans = z.object({ free: planSpec('free'), pro: planSpec('pro'), max: planSpec('max') });
const Notice = z.object({ active: z.boolean(), text: z.string().max(300) });
const Site = z.object({ contactEmail: z.string().max(120), operatorName: z.string().max(60) });

const Body = z.discriminatedUnion('key', [
  z.object({ key: z.literal('limits'), value: Limits }),
  z.object({ key: z.literal('plans'), value: Plans }),
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
