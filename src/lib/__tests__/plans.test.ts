import { describe, expect, it } from 'vitest';
import {
  ALL_PERKS,
  DEFAULT_PLANS,
  NO_PERKS,
  countFrom,
  customPlanActive,
  energyWindow,
  perkNeed,
  perkTiers,
  planEndedAt,
  planLabel,
  planLimits,
  readPlans,
  refillText,
  resolvePlan,
  specFor,
  tierEnergy,
  toCustomPlan,
  won,
  type CustomPlan,
} from '@/lib/plans';
import { DEFAULT_LIMITS, MAX_FILE_MB } from '@/lib/settings';
import { EXTRA_WARNING, FIGURES_WARNING, FLAGS_WARNING, PlanBody, perksOf, planRow, savePlan, schemaMissing } from '@/app/api/admin/plans/shared';

const P = DEFAULT_PLANS;

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
    const c = planLimits('custom', custom, P);
    // 테스트 플랜 원본은 예전 행이면 계속 두지 않는다 (플랜이 끝나고 무료 보관 일수 뒤에 지움)
    expect(c).toMatchObject({ pdfPages: 80, images: 12, textChars: 50000, fileMb: MAX_FILE_MB, canCareful: false, keepFiles: false });
    expect(planLimits('pro', null, P)).toMatchObject({ pdfPages: P.pro.pdfPages, fileMb: P.pro.fileMb, canCareful: true, keepFiles: true });
    expect(planLimits('max', null, P)).toMatchObject({ pdfPages: P.max.pdfPages, fileMb: P.max.fileMb, canCareful: true, keepFiles: true });
    expect(planLimits('free', null, P)).toMatchObject({ pdfPages: P.free.pdfPages, fileMb: P.free.fileMb, canCareful: false, keepFiles: false });
    // 관리자: Max 숫자 + 모든 혜택, 자료 받기·갤러리는 제한 없음
    expect(planLimits('admin', null, P)).toMatchObject({ canCareful: true, canSkins: true, downloadsDaily: null, galleries: null, pdfPages: P.max.pdfPages });
    // 'custom' 인데 플랜 행이 없으면 무료 한도
    expect(planLimits('custom', null, P).pdfPages).toBe(P.free.pdfPages);
    expect(planLimits('custom', { ...custom, perks: { ...custom.perks, careful: true } }, P).canCareful).toBe(true);
  });

  it('처음 혜택: Pro 는 공부 핵심, Max 는 모두, 무료는 없음', () => {
    expect(planLimits('free', null, P)).toMatchObject({ canAppend: false, canTheme: false, canFigures: false, canCourse: false, canSkins: false });
    expect(planLimits('pro', null, P)).toMatchObject({
      canCareful: true,
      keepFiles: true,
      canAppend: true,
      canFigures: true,
      canTheme: true,
      canCourse: false,
      canReorganize: false,
      canCover: false,
      canRedraw: false,
      canSkins: false,
      canAiTheme: false,
    });
    expect(planLimits('max', null, P)).toMatchObject({
      canCourse: true,
      canReorganize: true,
      canCover: true,
      canRedraw: true,
      canSkins: true,
      canAiTheme: true,
    });
    // 값과 에너지·자료 받기 (요금제 화면의 처음 값)
    expect([P.free.price, P.pro.price, P.max.price]).toEqual([0, 6900, 14900]);
    expect([P.free.downloadsDaily, P.pro.downloadsDaily, P.max.downloadsDaily]).toEqual([2, 10, 30]);
    expect(P.pro).toMatchObject({ energyMonthly: 1500, energyDaily: 200 });
    expect(P.max).toMatchObject({ energyMonthly: 4000, energyDaily: 600 });
    expect(won(14900)).toBe('14,900원');
  });

  it('시그니처 테마·AI 테마는 테마가 켜져 있어야 쓴다', () => {
    const plans = readPlans({ max: { ...P.max, perks: { ...ALL_PERKS, theme: false } } });
    expect(planLimits('max', null, plans)).toMatchObject({ canTheme: false, canSkins: false, canAiTheme: false });
  });

  it('예전 테스트 플랜 행: 예전 스위치가 그때 Pro 처럼 새 혜택까지 켠다', () => {
    const on = toCustomPlan({ id: 'x', name: 'a', energy_total: 10, can_append: true, can_theme: true, can_figures: true });
    expect(planLimits('custom', on, P)).toMatchObject({
      canAppend: true,
      canCourse: true,
      canReorganize: true,
      canTheme: true,
      canSkins: true,
      canAiTheme: true,
      canFigures: true,
      canCover: true,
      canRedraw: true,
      keepFiles: false,
    });
    const off = toCustomPlan({ id: 'x', name: 'a', energy_total: 10 });
    expect(planLimits('custom', off, P)).toMatchObject({
      canAppend: false,
      canCourse: false,
      canTheme: false,
      canSkins: false,
      canFigures: false,
      canCover: false,
    });
    // 자료 공유 숫자가 없는 예전 행은 Pro 처음 값
    expect(off).toMatchObject({ downloadsDaily: P.pro.downloadsDaily, galleries: P.pro.galleries, shareFiles: P.pro.shareFiles });
  });

  it('새 테스트 플랜 행: extra 의 혜택 스위치와 자료 공유 숫자', () => {
    const c = toCustomPlan({
      id: 'x',
      name: 'a',
      energy_total: 10,
      can_append: true,
      extra: { perks: { ...NO_PERKS, keepFiles: true, cover: true }, downloadsDaily: 7, galleries: 0, shareFileMb: 20, shareFiles: 3 },
    });
    // extra 가 있으면 예전 칸(can_append)보다 extra 를 믿는다
    expect(c.perks).toMatchObject({ append: false, keepFiles: true, cover: true });
    expect(planLimits('custom', c, P)).toMatchObject({ downloadsDaily: 7, galleries: 0, shareFileMb: 20, shareFiles: 3, keepFiles: true, canCover: true });
    // extra 의 혜택 칸이 빠졌으면 그 칸만 예전 칸으로
    const partial = toCustomPlan({ id: 'x', name: 'a', energy_total: 10, can_theme: true, extra: { perks: { cover: true } } });
    expect(partial.perks).toMatchObject({ cover: true, theme: true, skins: true });
    expect(specFor('custom', c, P)).toMatchObject({ energyDaily: null, energyMonthly: null, price: 0 });
  });

  it('저장된 요금제 읽기: 이상한 칸은 처음 값, 무료는 예전 한도 값을 처음 값으로', () => {
    const L = { ...DEFAULT_LIMITS, freeDaily: 30, pdfPagesFree: 25 };
    expect(readPlans(undefined, L).free).toMatchObject({ energyDaily: 30, pdfPages: 25, downloadsDaily: 2 });
    expect(readPlans(null).pro).toEqual(P.pro);
    const r = readPlans({ pro: { price: -5, images: 999, energyDaily: 'x', downloadsDaily: 12, perks: { cover: true, careful: 'yes' } } });
    expect(r.pro).toMatchObject({ price: P.pro.price, images: P.pro.images, energyDaily: P.pro.energyDaily, downloadsDaily: 12 });
    expect(r.pro.perks).toMatchObject({ cover: true, careful: true });
    // 에너지가 둘 다 비면(제한 없음) 처음 값
    expect(readPlans({ max: { ...P.max, energyDaily: null, energyMonthly: null } }).max).toMatchObject({ energyDaily: 600, energyMonthly: 4000 });
  });

  it('혜택이 생기는 요금제와 안내 글', () => {
    const t = perkTiers(P);
    expect(t).toMatchObject({ careful: 'pro', append: 'pro', theme: 'pro', course: 'max', cover: 'max', skins: 'max', aiTheme: 'max' });
    expect(perkNeed(t, 'cover')).toBe('표지 그림은 Max에서 쓸 수 있어요.');
    expect(perkNeed(t, 'course', '단계별 학습')).toBe('단계별 학습은 Max에서 쓸 수 있어요.');
    expect(perkNeed(t, 'theme')).toBe('테마는 Pro에서 쓸 수 있어요.');
    // 무료에도 있으면 null, 아무 데도 없으면 null
    const plans = readPlans({ free: { ...P.free, perks: { ...NO_PERKS, cover: true } }, max: { ...P.max, perks: { ...ALL_PERKS, skins: false } } });
    expect(perkTiers(plans)).toMatchObject({ cover: null, skins: null });
    expect(perkNeed(perkTiers(plans), 'skins', '시그니처 테마')).toBe('시그니처 테마는 지금은 쓸 수 없어요.');
  });

  it('요금제 에너지: 한 달을 세면 이번 달과 하루 최대 중 적은 쪽, 아니면 하루만', () => {
    expect(tierEnergy(P.free, 5, 100)).toEqual({ remaining: 15, limit: 20, period: 'day', dailyMax: null });
    expect(tierEnergy(P.pro, 50, 1400)).toEqual({ remaining: 100, limit: 1500, period: 'month', dailyMax: 200 });
    expect(tierEnergy(P.pro, 190, 100)).toMatchObject({ remaining: 10 });
    expect(tierEnergy({ energyDaily: null, energyMonthly: 100 }, 500, 40)).toMatchObject({ remaining: 60, dailyMax: null });
    expect(tierEnergy(P.max, 700, 0).remaining).toBe(0);
  });

  it('Max 는 Pro 보다 먼저, 테스트 플랜보다 나중', () => {
    const both = { plan: 'pro', pro_until: later, max_until: later };
    expect(resolvePlan(both, null, false, NOW).info).toEqual({ kind: 'max', name: 'Max', start: null, until: later });
    // Max 가 끝났으면 Pro (Max 동안 미뤄 둔 Pro)
    expect(resolvePlan({ ...both, max_until: earlier }, null, false, NOW).info.kind).toBe('pro');
    expect(resolvePlan({ plan: 'free', max_until: later }, null, false, NOW).info.kind).toBe('max');
    const withCustom = { ...both, custom_plan_id: custom.id, custom_plan_start: earlier, custom_plan_until: later };
    expect(resolvePlan(withCustom, custom, false, NOW).info.kind).toBe('custom');
    expect(planLabel({ kind: 'max', name: 'Max', until: null })).toBe('Max');
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
    // Pro·Max: 하루 최대 300 을 거의 썼으면 내일
    expect(energyWindow({ period: 'month', limit: 2000, usedMonth: 600, usedToday: 299, dailyMax: 300 })).toBe('day');
    expect(energyWindow({ period: 'month', limit: 2000, usedMonth: 1999, usedToday: 10, dailyMax: 300 })).toBe('period');
  });

  it('다시 채워지는 때 안내', () => {
    const plan = { kind: 'custom' as const, name: '베타', until: '2026-10-25T05:00:00Z' };
    expect(refillText(plan, 'day')).toBe('내일 다시 채워져요.');
    expect(refillText(plan, 'period')).toBe("'베타' 플랜 에너지는 기간 동안 다시 채워지지 않아요. 플랜은 10월 25일까지예요.");
    expect(refillText({ kind: 'pro', name: 'Pro', until: null }, 'period')).toBe('다음 달 다시 채워져요.');
  });
});

describe('테스트 플랜 저장 값', () => {
  const body = PlanBody.parse({
    name: '베타',
    energyTotal: 500,
    energyDaily: null,
    pdfPages: 80,
    images: 12,
    textChars: 50000,
    fileMb: 50,
    careful: true,
    canAppend: true,
    canTheme: false,
  });
  it('자료 더하기·테마 칸이 있는 DB 에는 같이 저장한다', () => {
    expect(planRow(body)).toMatchObject({ can_append: true, can_theme: false, careful: true, energy_total: 500 });
    // 예전 화면이 보낸 네 칸은 그때 Pro 처럼 새 혜택까지 켠다
    expect(planRow(body).extra?.perks).toMatchObject({ append: true, course: true, reorganize: true, theme: false, skins: false });
  });
  it('새 화면: 혜택 스위치 전부와 자료 공유 숫자를 extra 에, 예전 칸도 맞춰 적는다', () => {
    const b = PlanBody.parse({
      name: '체험',
      energyTotal: 300,
      energyDaily: 50,
      pdfPages: 40,
      images: 10,
      textChars: 30000,
      fileMb: 20,
      downloadsDaily: 4,
      galleries: 1,
      shareFileMb: 15,
      shareFiles: 6,
      perks: { ...NO_PERKS, careful: true, figures: true, cover: true },
    });
    const row = planRow(b);
    expect(row).toMatchObject({ careful: true, can_append: false, can_theme: false, can_figures: true });
    expect(row.extra).toEqual({
      perks: { ...NO_PERKS, careful: true, figures: true, cover: true },
      downloadsDaily: 4,
      galleries: 1,
      shareFileMb: 15,
      shareFiles: 6,
    });
    expect(perksOf(b).cover).toBe(true);
    // 저장한 행을 다시 읽으면 같은 혜택
    expect(toCustomPlan({ id: 'p', ...row })).toMatchObject({ downloadsDaily: 4, galleries: 1, shareFileMb: 15, shareFiles: 6, perks: b.perks });
    // 꼼꼼 모델 칸도 혜택도 없으면 거절
    expect(PlanBody.safeParse({ name: 'a', energyTotal: 1, energyDaily: null, pdfPages: 1, images: 1, textChars: 100, fileMb: 1 }).success).toBe(false);
    // 숫자 칸 범위
    expect(PlanBody.safeParse({ ...b, shareFiles: 99 }).success).toBe(false);
  });
  it('extra 칸이 없는 DB 면 빼고 예전 칸만 저장하고 알려 준다', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const r = await savePlan(body, async (row) => {
      rows.push(row);
      return 'extra' in row
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'extra' column of 'custom_plans' in the schema cache" } }
        : { data: { id: 'p0', ...row }, error: null };
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).not.toHaveProperty('extra');
    expect(rows[1]).toMatchObject({ can_append: true });
    expect(r.warning).toBe(EXTRA_WARNING);
  });
  it('칸이 없다는 오류가 나면 그 칸을 빼고 다시 저장하고 알려 준다', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const r = await savePlan(body, async (row) => {
      rows.push(row);
      if ('extra' in row)
        return { data: null, error: { code: 'PGRST204', message: "Could not find the 'extra' column of 'custom_plans' in the schema cache" } };
      return 'can_append' in row
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'can_append' column of 'custom_plans' in the schema cache" } }
        : { data: { id: 'p1', ...row }, error: null };
    });
    expect(rows).toHaveLength(3);
    expect(rows[2]).not.toHaveProperty('can_append');
    expect(r.plan).toMatchObject({ id: 'p1', name: '베타' });
    expect(r.warning).toBe(FLAGS_WARNING);
    // 칸이 있으면 한 번에 저장하고 알림도 없다
    const once = await savePlan(body, async (row) => ({ data: { id: 'p2', ...row }, error: null }));
    expect(once.warning).toBeUndefined();
    expect(once.plan).toMatchObject({ can_append: true });
    // 다른 오류는 그대로 낸다
    await expect(savePlan(body, async () => ({ data: null, error: { code: '23514', message: 'check violation' } }))).rejects.toMatchObject({ code: '23514' });
  });
  it('그림 풀이 칸만 없으면 그 칸만 빼고 다시 저장한다', async () => {
    const withFig = PlanBody.parse({ ...body, canFigures: true });
    expect(planRow(withFig)).toMatchObject({ can_figures: true, can_append: true });
    const rows: Array<Record<string, unknown>> = [];
    const r = await savePlan(withFig, async (row) => {
      rows.push(row);
      if ('extra' in row)
        return { data: null, error: { code: 'PGRST204', message: "Could not find the 'extra' column of 'custom_plans' in the schema cache" } };
      return 'can_figures' in row
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'can_figures' column of 'custom_plans' in the schema cache" } }
        : { data: { id: 'p3', ...row }, error: null };
    });
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ can_append: true });
    expect(rows[2]).not.toHaveProperty('can_figures');
    expect(r.warning).toBe(FIGURES_WARNING);
  });
  it('schema.sql 을 다시 실행하기 전(칸이 없음)에는 그 칸을 빼고 저장한다', () => {
    const row = planRow(body, { flags: false, figures: false, extra: false });
    expect(row).not.toHaveProperty('can_append');
    expect(row).not.toHaveProperty('can_theme');
    expect(row).not.toHaveProperty('can_figures');
    expect(row).toMatchObject({ name: '베타', careful: true });
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
