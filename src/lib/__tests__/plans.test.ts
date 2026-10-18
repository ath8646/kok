import { describe, expect, it } from 'vitest';
import {
  countFrom,
  customPlanActive,
  energyWindow,
  planEndedAt,
  planFlags,
  planLabel,
  planLimits,
  refillText,
  resolvePlan,
  toCustomPlan,
  type CustomPlan,
} from '@/lib/plans';
import { DEFAULT_LIMITS, MAX_FILE_MB } from '@/lib/settings';
import { schemaMissing } from '@/app/api/admin/plans/shared';

const NOW = Date.parse('2026-10-18T03:00:00Z');
const later = new Date(NOW + 7 * 86_400_000).toISOString();
const earlier = new Date(NOW - 86_400_000).toISOString();

const custom: CustomPlan = toCustomPlan({
  id: '11111111-1111-4111-8111-111111111111',
  name: '베타 테스터',
  energy_total: '500.0', // PostgREST·pg 는 numeric 을 글자로 줄 때가 있다
  energy_daily: null,
  pdf_pages: 80,
  images: 12,
  text_chars: 50000,
  file_mb: 9999,
  careful: false,
  note: null,
});

describe('테스트 플랜 판단', () => {
  it('numeric 글자도 숫자로 읽는다', () => {
    expect(custom.energyTotal).toBe(500);
    expect(custom.energyDaily).toBeNull();
    expect(toCustomPlan({ id: 'x', name: 'a', energy_total: 10, energy_daily: '3.5' }).energyDaily).toBe(3.5);
  });

  it('관리자 > 테스트 플랜 > Pro > 무료', () => {
    const pro = { plan: 'pro', pro_until: later };
    const withCustom = { ...pro, custom_plan_id: custom.id, custom_plan_start: earlier, custom_plan_until: later };
    expect(resolvePlan(withCustom, custom, true, NOW).info.kind).toBe('admin');
    const r = resolvePlan(withCustom, custom, false, NOW);
    expect(r.info).toEqual({ kind: 'custom', name: '베타 테스터', start: earlier, until: later });
    expect(r.custom).toBe(custom);
    expect(resolvePlan(pro, null, false, NOW).info.kind).toBe('pro');
    expect(resolvePlan({ plan: 'free' }, null, false, NOW).info).toEqual({ kind: 'free', name: '무료', start: null, until: null });
  });

  it('기간이 끝나면 원래 플랜으로 돌아간다', () => {
    const ended = { plan: 'pro', pro_until: later, custom_plan_id: custom.id, custom_plan_start: earlier, custom_plan_until: earlier };
    expect(customPlanActive(ended, NOW)).toBe(false);
    expect(resolvePlan(ended, custom, false, NOW).info.kind).toBe('pro');
    expect(resolvePlan({ ...ended, plan: 'free' }, custom, false, NOW).info.kind).toBe('free');
    // 플랜이 지워져 행을 못 읽었으면 (custom = null) 원래 플랜
    expect(resolvePlan({ plan: 'free', custom_plan_id: custom.id, custom_plan_until: later }, null, false, NOW).info.kind).toBe('free');
    // 기간이 끝난 Pro 는 무료
    expect(resolvePlan({ plan: 'pro', pro_until: earlier }, null, false, NOW).info.kind).toBe('free');
  });

  it('켜져 있을 수 있는지: id 와 끝나는 시각이 모두 있고 아직 안 끝났을 때만', () => {
    expect(customPlanActive({ custom_plan_id: custom.id, custom_plan_until: later }, NOW)).toBe(true);
    expect(customPlanActive({ custom_plan_id: null, custom_plan_until: later }, NOW)).toBe(false);
    expect(customPlanActive({ custom_plan_id: custom.id, custom_plan_until: null }, NOW)).toBe(false);
    expect(customPlanActive({ custom_plan_id: custom.id, custom_plan_until: 'nope' }, NOW)).toBe(false);
    expect(customPlanActive({}, NOW)).toBe(false);
  });

  it('한도: 테스트 플랜은 플랜 값, 파일 크기는 저장소 한도까지만', () => {
    const L = DEFAULT_LIMITS;
    const c = planLimits('custom', custom, L);
    // 테스트 플랜 원본은 계속 두지 않는다 (플랜이 끝나고 무료 보관 일수 뒤에 지움)
    expect(c).toMatchObject({ pdfPages: 80, images: 12, textChars: 50000, fileMb: MAX_FILE_MB, canCareful: false, keepFiles: false });
    expect(planLimits('pro', null, L)).toMatchObject({ pdfPages: L.pdfPagesPro, fileMb: L.fileMbPro, canCareful: true, keepFiles: true });
    expect(planLimits('free', null, L)).toMatchObject({ pdfPages: L.pdfPagesFree, fileMb: L.fileMbFree, canCareful: false, keepFiles: false });
    expect(planLimits('admin', null, L).canCareful).toBe(true);
    // 'custom' 인데 플랜 행이 없으면 무료 한도
    expect(planLimits('custom', null, L).pdfPages).toBe(L.pdfPagesFree);
    expect(planFlags('custom', { ...custom, careful: true }).canCareful).toBe(true);
  });

  it('끝난 테스트 플랜 뒤부터 무료·Pro 에너지를 센다', () => {
    expect(planEndedAt({ custom_plan_until: earlier }, NOW)).toBe(earlier);
    expect(planEndedAt({ custom_plan_until: later }, NOW)).toBeNull(); // 아직 켜져 있음
    expect(planEndedAt({ custom_plan_until: null }, NOW)).toBeNull();
    const dayStart = new Date(NOW - 3 * 3600_000);
    // 오늘 안에 끝났으면 끝난 때부터
    const endedToday = new Date(NOW - 3600_000).toISOString();
    expect(countFrom(dayStart, endedToday).toISOString()).toBe(endedToday);
    // 어제 끝났으면 오늘 시작부터
    expect(countFrom(dayStart, earlier)).toBe(dayStart);
    expect(countFrom(dayStart, null)).toBe(dayStart);
  });

  it('이름과 끝나는 날', () => {
    expect(planLabel({ kind: 'admin', name: '관리자', until: null })).toBe('관리자');
    expect(planLabel({ kind: 'free', name: '무료', until: null })).toBe('무료');
    expect(planLabel({ kind: 'custom', name: '베타', until: '2026-10-25T05:00:00Z' })).toMatch(/^베타 · 2026\. 10\. 25\.까지$/);
    expect(planLabel({ kind: 'custom', name: '베타', until: '2026-10-25T05:00:00Z' }, false)).toBe('베타');
    expect(planLabel({ kind: 'pro', name: 'Pro', until: null })).toBe('Pro');
  });

  it('에너지가 다시 생기는 때: 하루 최대에 먼저 걸리면 내일', () => {
    const base = { usedToday: 0, usedMonth: 0 };
    expect(energyWindow({ ...base, period: 'day', limit: 20 })).toBe('day');
    // 테스트 플랜: 총량 500 중 100 사용, 하루 최대 50 중 45 사용 → 하루가 먼저
    expect(energyWindow({ ...base, period: 'plan', limit: 500, usedPlan: 100, usedToday: 45, planDaily: 50 })).toBe('day');
    // 총량이 거의 다 남지 않았으면 기간
    expect(energyWindow({ ...base, period: 'plan', limit: 500, usedPlan: 495, usedToday: 10, planDaily: 50 })).toBe('period');
    expect(energyWindow({ ...base, period: 'plan', limit: 500, usedPlan: 495, planDaily: null })).toBe('period');
    // Pro: 하루 최대 300 을 거의 썼으면 내일
    expect(energyWindow({ period: 'month', limit: 2000, usedMonth: 600, usedToday: 299, proDaily: 300 })).toBe('day');
    expect(energyWindow({ period: 'month', limit: 2000, usedMonth: 1999, usedToday: 10, proDaily: 300 })).toBe('period');
  });

  it('다시 채워지는 때 안내', () => {
    const plan = { kind: 'custom' as const, name: '베타', until: '2026-10-25T05:00:00Z' };
    expect(refillText(plan, 'day')).toBe('내일 다시 채워져요.');
    expect(refillText(plan, 'period')).toBe("'베타' 플랜 에너지는 기간 동안 다시 채워지지 않아요. 플랜은 10월 25일까지예요.");
    expect(refillText({ kind: 'pro', name: 'Pro', until: null }, 'period')).toBe('다음 달 다시 채워져요.');
  });
});

describe('테스트 플랜 표가 없을 때만 "schema.sql 다시 실행" 안내', () => {
  it('표·칸이 없다는 오류', () => {
    expect(schemaMissing({ code: '42P01', message: 'relation "public.custom_plans" does not exist' })?.code).toBe('schema_outdated');
    expect(schemaMissing({ code: 'PGRST205', message: "Could not find the table 'public.custom_plans' in the schema cache" })?.code).toBe('schema_outdated');
    expect(schemaMissing({ code: 'PGRST204', message: "Could not find the 'plan_id' column of 'coupons' in the schema cache" })?.code).toBe('schema_outdated');
    expect(schemaMissing({ code: '42703', message: 'column coupons.plan_id does not exist' })?.code).toBe('schema_outdated');
  });
  it('다른 오류는 그대로', () => {
    expect(schemaMissing({ code: '23514', message: 'new row for relation "custom_plans" violates check constraint "custom_plans_name_check"' })).toBeNull();
    expect(schemaMissing({ code: '42P01', message: 'relation "public.other" does not exist' })).toBeNull();
    expect(schemaMissing({ code: '08006', message: 'connection failure' })).toBeNull();
  });
});
