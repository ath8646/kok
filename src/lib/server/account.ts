// 계정 정보, 운영 설정, 에너지 계산 (서버 전용)
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { costUsd, usdToEnergy, type Usage } from '@/lib/ai/models';
import { readLimits, readModels, readUserSettings, zNotice, type Limits, type ModelsConfig, type Notice, type UserSettings } from '@/lib/settings';
import { kstDayStart, kstMonthStart } from '@/lib/time';
import {
  countFrom,
  customPlanActive,
  energyWindow,
  planFlags,
  planEndedAt,
  planLimits,
  refillText,
  resolvePlan,
  toCustomPlan,
  type CustomPlan,
  type PlanInfo,
  type PlanLimits,
} from '@/lib/plans';

import { UserFacingError } from './errors';
import { accountKeys, deletedSince } from './tombstone';

export type { PlanInfo, PlanLimits };
export { refillText };

/** 이 사람에게 지금 적용되는 한도 (파일·쪽수·사진·글자) */
export function limitsFor(acc: Pick<Account, 'plan' | 'custom'>, L: Limits): PlanLimits {
  return planLimits(acc.plan.kind, acc.custom, L);
}

export type Account = {
  userId: string;
  email: string;
  /** 처음 가입한 로그인 회사 (google·kakao·apple) */
  provider: string | null;
  nickname: string | null;
  isAdmin: boolean;
  /** 지금 적용되는 플랜이 Pro 인지 (테스트 플랜이 켜져 있으면 false) */
  isPro: boolean;
  proUntil: string | null;
  /** 지금 적용되는 플랜 (관리자 > 테스트 플랜 > Pro > 무료) */
  plan: PlanInfo;
  /** 켜져 있는 테스트 플랜 (없으면 null) */
  custom: CustomPlan | null;
  /** 꼼꼼 모델을 쓸 수 있는지 */
  canCareful: boolean;
  /** 원본 파일을 기한 없이 보관하는지 */
  keepFiles: boolean;
  /** 노트에 자료 더하기(버전)를 쓸 수 있는지 (Pro·관리자, 켠 테스트 플랜) */
  canAppend: boolean;
  /** 테마를 쓸 수 있는지 (Pro·관리자, 켠 테스트 플랜) */
  canTheme: boolean;
  /** 그림 풀이를 쓸 수 있는지: 노트를 만들 때 문제 그림·단계 풀이, 채팅의 그림 풀이 (Pro·관리자, 켠 테스트 플랜) */
  canFigures: boolean;
  /** 마지막 테스트 플랜이 끝난 시각 (무료·Pro 에너지는 이 뒤부터 센다, 켜져 있으면 null) */
  planEndedAt: string | null;
  banned: boolean;
  consented: boolean;
  settings: UserSettings;
  /** 가입한 시각 (profiles.created_at) */
  createdAt: string | null;
};

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function getAccount(admin: SupabaseClient, userId: string, email?: string | null, provider?: string | null): Promise<Account> {
  const { data, error } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  let row = data;
  if (!row) {
    // 트리거가 늦거나 빠졌을 때를 대비
    const ins = await admin
      .from('profiles')
      .upsert({ id: userId, email: email ?? null, provider: provider ?? null })
      .select('*')
      .single();
    if (ins.error) throw ins.error;
    row = ins.data;
  }
  const mail = (row.email ?? email ?? '').toLowerCase();
  // 관리자: 구글로 로그인했고 ADMIN_EMAILS 에 있는 이메일(빼면 바로 관리자가 아니게 된다),
  // 또는 DB 에서 직접 role 을 admin 으로 바꾼 사람.
  // (다른 로그인 방법이 켜져 있어도 남이 관리자 이메일로 가입해 관리자가 되지 못하게 구글만 믿는다)
  const isAdmin = row.role === 'admin' || (row.provider === 'google' && !!mail && adminEmails().includes(mail));
  const proUntil: string | null = row.pro_until ?? null;
  // 테스트 플랜이 켜져 있으면 그 플랜 내용을 읽는다 (플랜이 지워졌으면 원래 플랜으로)
  let customRow: CustomPlan | null = null;
  if (!isAdmin && customPlanActive(row)) {
    const { data: cp, error: cpErr } = await admin.from('custom_plans').select('*').eq('id', row.custom_plan_id).maybeSingle();
    if (cpErr) console.error('[kok] custom plan read failed', cpErr);
    if (cp) customRow = toCustomPlan(cp);
  }
  const { info: plan, custom } = resolvePlan(row, customRow, isAdmin);
  const caps = planFlags(plan.kind, custom);
  return {
    userId,
    email: mail,
    provider: (row.provider as string | null) ?? provider ?? null,
    nickname: row.nickname ?? null,
    isAdmin,
    isPro: plan.kind === 'pro',
    proUntil,
    plan,
    custom,
    canCareful: caps.canCareful,
    keepFiles: caps.keepFiles,
    canAppend: caps.canAppend,
    canTheme: caps.canTheme,
    canFigures: caps.canFigures,
    planEndedAt: plan.kind === 'custom' ? null : planEndedAt(row),
    banned: !!row.banned,
    consented: !!row.consented_at,
    settings: readUserSettings(row.settings),
    createdAt: row.created_at ?? null,
  };
}

// ------------------------------------------------------------- 새 표가 있는지
export type Features = {
  /** 노트 버전·자료 더하기 (note_versions, sources.parent_id) */
  versions: boolean;
  /** 숨긴 문제가 쉬던 문제였는지 기억하기 (questions.rested_hidden) */
  restedHidden: boolean;
  /** 노트 채팅 (chat_messages) */
  chat: boolean;
  /** 테스트 플랜마다 자료 더하기·테마 켜기 (custom_plans.can_append·can_theme) */
  planFlags: boolean;
  /** 내가 만든 테마·배경 그림 (user_themes, theme_images, app_counters) */
  themes: boolean;
  /** 문제 그림·단계 풀이 (questions.figure·steps, custom_plans.can_figures) */
  figures: boolean;
  /** 채팅에 붙인 사진·파일과 단계 풀이 (chat_messages.attachments·solution). 없어도 채팅은 예전처럼 된다 */
  chatFiles: boolean;
  /** 자료함 정리: 노트마다 복습에 넣기·별표·순서 (sources.in_review·starred·position, kok_reorder_sources) */
  organize: boolean;
  /** 자료 그림: PDF·사진 속 그림을 잘라 개념·그림 문제에 쓴다 (questions.source_figure, 단계 'figures') */
  sourceFigures: boolean;
  /** 과목 서랍: 과목 위에 고정·보관·최근 쓴 때 (subjects.pinned·archived·used_at) */
  subjectDrawer: boolean;
  /**
   * 자료함 정리 2: 고정한 과목 순서(kok_reorder_subjects), 자료 옮기기·과목 합치기·노트 합치기·AI로 다시 정리
   * (kok_move_sources·kok_merge_subjects·kok_merge_notes·kok_reorganize_note, note_versions.kind·qkeys). 같은 schema.sql 에 함께 있다.
   * qkeys 는 합치기 함수가 지금 모양(그림 행 확인·버전마다 개념 번호)이 된 때 생겼다: 그 전 함수로는 부르지 않는다
   */
  merge: boolean;
  /** 단계별 학습 (note_courses, Pro) */
  courses: boolean;
  /** PDF 요약 정리 (note_pdfs) */
  pdfs: boolean;
  /** 저장한 복습 세션 (review_sessions + kok_session_answer): 홈의 N분 KOK·복습 탭 이어서 하기 */
  sessions: boolean;
};

/** schema.sql 을 다시 실행하기 전의 DB 에는 함수가 없다 (PostgREST 가 함수를 못 찾음) */
export function missingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /Could not find the function|function .* does not exist/i.test(error.message ?? '');
}

let featuresCache: { at: number; value: Features } | null = null;

/**
 * schema.sql 을 다시 실행했는지(새 표·칸이 있는지) 확인한다. 배포가 먼저 되고 DB 는 나중에 바뀔 수 있어서,
 * 없으면 새 기능을 끄고 지금까지처럼 동작한다. 1분 동안 기억한다
 */
export async function getFeatures(admin: SupabaseClient): Promise<Features> {
  if (featuresCache && Date.now() - featuresCache.at < 60_000) return featuresCache.value;
  const [v, p, r, c, f, t, ti, ac, qf, pf, cf, og, sf, sd, vk, rs, nc, np, se] = await Promise.all([
    admin.from('note_versions').select('id').limit(1),
    admin.from('sources').select('parent_id').limit(1),
    admin.from('questions').select('rested_hidden').limit(1),
    admin.from('chat_messages').select('id').limit(1),
    admin.from('custom_plans').select('can_append, can_theme').limit(1),
    admin.from('user_themes').select('id').limit(1),
    admin.from('theme_images').select('id').limit(1),
    admin.from('app_counters').select('day').limit(1),
    admin.from('questions').select('figure, steps').limit(1),
    admin.from('custom_plans').select('can_figures').limit(1),
    admin.from('chat_messages').select('attachments, solution').limit(1),
    admin.from('sources').select('in_review, starred, position').limit(1),
    admin.from('questions').select('source_figure').limit(1),
    admin.from('subjects').select('pinned, archived, used_at').limit(1),
    admin.from('note_versions').select('kind, qkeys').limit(1),
    // 빈 목록이라 아무것도 바꾸지 않는다 (서버 키로는 auth.uid() 가 없어서 고칠 과목도 없다): 함수가 있는지만 본다
    admin.rpc('kok_reorder_subjects', { p_ids: [] }),
    admin.from('note_courses').select('id').limit(1),
    admin.from('note_pdfs').select('id').limit(1),
    admin.from('review_sessions').select('key').limit(1),
  ]);
  const value: Features = {
    versions: !v.error && !p.error,
    restedHidden: !r.error,
    chat: !c.error,
    planFlags: !f.error,
    themes: !t.error && !ti.error && !ac.error,
    figures: !qf.error && !pf.error,
    chatFiles: !c.error && !cf.error,
    organize: !og.error,
    sourceFigures: !sf.error,
    subjectDrawer: !sd.error,
    merge: !sd.error && !vk.error && !rs.error,
    courses: !nc.error,
    pdfs: !np.error,
    sessions: !se.error,
  };
  featuresCache = { at: Date.now(), value };
  return value;
}

// ------------------------------------------------------------- 운영 설정
export type AppSettings = {
  limits: Limits;
  models: ModelsConfig;
  notice: Notice;
  aiEnabled: boolean;
  site: { contactEmail: string; operatorName: string };
};

let settingsCache: { at: number; value: AppSettings } | null = null;

export async function getAppSettings(admin: SupabaseClient, fresh = false): Promise<AppSettings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < 15_000) return settingsCache.value;
  const { data, error } = await admin.from('app_settings').select('key, value');
  if (error) throw error;
  const map = new Map<string, unknown>((data ?? []).map((r) => [r.key as string, r.value]));
  const site = (map.get('site') ?? {}) as Record<string, unknown>;
  const value: AppSettings = {
    limits: readLimits(map.get('limits')),
    models: readModels(map.get('models')),
    notice: zNotice.catch({ active: false, text: '' }).parse(map.get('notice') ?? {}),
    aiEnabled: map.get('ai_enabled') !== false,
    site: {
      contactEmail: typeof site.contactEmail === 'string' ? site.contactEmail : '',
      operatorName: typeof site.operatorName === 'string' ? site.operatorName : 'KOK 운영자',
    },
  };
  settingsCache = { at: Date.now(), value };
  return value;
}

export function clearSettingsCache() {
  settingsCache = null;
}

// ------------------------------------------------------------- 에너지
export type EnergyStatus = {
  unlimited: boolean;
  remaining: number;
  /** 오늘(무료), 이번 달(Pro) 또는 플랜 기간 전체(테스트 플랜) 한도 */
  limit: number;
  period: 'day' | 'month' | 'plan';
  usedToday: number;
  usedMonth: number;
  /** 테스트 플랜: 플랜을 켠 뒤 쓴 번개, 하루 최대 */
  usedPlan?: number;
  planDaily?: number | null;
};

async function sumEnergy(admin: SupabaseClient, userId: string, since: Date): Promise<number> {
  const { data, error } = await admin.rpc('kok_energy_since', { p_user: userId, p_since: since.toISOString() });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function energyStatus(admin: SupabaseClient, acc: Account, limits: Limits): Promise<EnergyStatus> {
  // 테스트 플랜이 오늘·이번 달 안에 끝났으면, 무료·Pro 에너지는 플랜이 끝난 뒤부터 센다 (energyWindows 와 같게)
  const [usedToday, usedMonth] = await Promise.all([
    sumEnergy(admin, acc.userId, countFrom(kstDayStart(), acc.planEndedAt)),
    sumEnergy(admin, acc.userId, countFrom(kstMonthStart(), acc.planEndedAt)),
  ]);
  if (acc.isAdmin) {
    return { unlimited: true, remaining: Infinity, limit: Infinity, period: 'day', usedToday, usedMonth };
  }
  if (acc.plan.kind === 'custom' && acc.custom && acc.plan.start) {
    // 테스트 플랜: 켠 뒤부터 쓴 번개를 총량에서 빼고, 하루 최대가 있으면 그것도 본다.
    // '오늘'도 플랜을 켠 뒤부터 센다 (켜기 전에 쓴 것은 플랜의 하루 최대에 넣지 않는다)
    const start = new Date(acc.plan.start);
    const usedPlan = await sumEnergy(admin, acc.userId, start);
    const planToday = start.getTime() > kstDayStart().getTime() ? usedPlan : usedToday;
    const daily = acc.custom.energyDaily;
    const remaining = Math.max(0, Math.min(acc.custom.energyTotal - usedPlan, daily === null ? Infinity : daily - planToday));
    return { unlimited: false, remaining, limit: acc.custom.energyTotal, period: 'plan', usedToday: planToday, usedMonth, usedPlan, planDaily: daily };
  }
  if (acc.isPro) {
    const remaining = Math.max(0, Math.min(limits.proMonthly - usedMonth, limits.proDaily - usedToday));
    return { unlimited: false, remaining, limit: limits.proMonthly, period: 'month', usedToday, usedMonth };
  }
  const remaining = Math.max(0, limits.freeDaily - usedToday);
  return { unlimited: false, remaining, limit: limits.freeDaily, period: 'day', usedToday, usedMonth };
}

/** AI를 써도 되는지 검사. 안 되면 한국어 메시지로 던진다 */
export async function assertAiAllowed(
  admin: SupabaseClient,
  acc: Account,
  app: AppSettings,
  opts: { estimate: number; rateLimit: boolean },
): Promise<EnergyStatus> {
  if (acc.banned) throw new UserFacingError('banned', '이 계정은 AI 기능을 쓸 수 없어요. 관리자에게 문의해 주세요.', 403);
  if (!app.aiEnabled && !acc.isAdmin) {
    throw new UserFacingError('ai_paused', '지금은 AI 기능을 잠깐 쉬고 있어요. 복습은 그대로 할 수 있어요.', 503);
  }
  if (acc.plan.kind === 'free') {
    const { data, error } = await admin.rpc('kok_free_usd_since', { p_since: kstMonthStart().toISOString() });
    if (error) throw error;
    if (Number(data ?? 0) >= app.limits.freeMonthlyBudgetUsd) {
      throw new UserFacingError('free_pool_empty', '이번 달 무료 AI가 모두 쓰였어요. 다음 달 1일에 다시 열려요. 복습은 그대로 할 수 있어요.', 429);
    }
    // 오늘 가입한 계정이 오늘 같은 이메일·같은 로그인 계정으로 탈퇴한 적이 있으면, 오늘은 AI를 쓸 수 없다 (에너지 다시 받기 막기)
    const dayStart = kstDayStart();
    if (
      acc.createdAt &&
      Date.parse(acc.createdAt) >= dayStart.getTime() &&
      (await deletedSince(admin, await accountKeys(admin, acc.userId, acc.email), dayStart))
    ) {
      throw new UserFacingError('rejoin_cooldown', '탈퇴한 날에는 다시 가입해도 AI를 쓸 수 없어요. 내일부터 쓸 수 있어요. 복습은 그대로 할 수 있어요.', 429);
    }
  }
  if (opts.rateLimit && !acc.isAdmin) {
    const { data, error } = await admin.rpc('kok_hit_rate', {
      p_user: acc.userId,
      p_max: app.limits.ratePerMinute,
      p_window_seconds: 60,
      p_kind: 'ai',
    });
    if (error) throw error;
    if (data === false) throw new UserFacingError('rate_limited', '요청이 너무 빨라요. 1분 뒤에 다시 해 주세요.', 429);
  }
  const status = await energyStatus(admin, acc, app.limits);
  if (!status.unlimited && status.remaining < opts.estimate) {
    throw new UserFacingError(
      'no_energy',
      `에너지가 부족해요. 필요: 약 ${Math.ceil(opts.estimate)}, 남음: ${Math.floor(status.remaining)}. ${refillText(acc.plan, energyWindow({ ...status, proDaily: acc.isPro ? app.limits.proDaily : null }))}`,
      402,
    );
  }
  return status;
}

/** 한 사람이 동시에 정리할 수 있는 자료 수 (관리자는 제한 없음) */
export const MAX_PARALLEL_SOURCES = 3;

/**
 * 자료 만들기·다시 하기에서 DB 가 검사할 에너지 한도 (null = 검사 안 함).
 * 두 번째 창(p_month_*)은 Pro 는 이번 달, 테스트 플랜은 플랜을 켠 때부터 끝날 때까지다.
 */
export function energyWindows(acc: Pick<Account, 'isAdmin' | 'isPro' | 'plan' | 'custom' | 'planEndedAt'>, limits: Limits) {
  const day = countFrom(kstDayStart(), acc.planEndedAt).toISOString();
  const month = countFrom(kstMonthStart(), acc.planEndedAt).toISOString();
  if (acc.isAdmin) return { p_day_start: day, p_day_limit: null, p_month_start: month, p_month_limit: null };
  if (acc.plan.kind === 'custom' && acc.custom && acc.plan.start) {
    // 하루 창도 플랜을 켠 뒤부터 (energyStatus 와 같게)
    const planDay = Date.parse(acc.plan.start) > Date.parse(day) ? acc.plan.start : day;
    return { p_day_start: planDay, p_day_limit: acc.custom.energyDaily, p_month_start: acc.plan.start, p_month_limit: acc.custom.energyTotal };
  }
  if (acc.isPro) return { p_day_start: day, p_day_limit: limits.proDaily, p_month_start: month, p_month_limit: limits.proMonthly };
  return { p_day_start: day, p_day_limit: limits.freeDaily, p_month_start: month, p_month_limit: null };
}

export type ReserveResult = {
  result: 'ok' | 'duplicate' | 'too_many' | 'no_energy' | 'not_found' | 'not_error' | 'append_busy';
  busy?: number;
  used?: number;
  inflight?: number;
  need?: number;
  limit?: number;
  period?: 'day' | 'month';
  status?: string;
};

/** kok_create_source·kok_retry_source 결과를 한국어 오류로 (ok 면 null) */
export function reserveError(r: ReserveResult, plan?: PlanInfo): UserFacingError | null {
  switch (r.result) {
    case 'ok':
    case 'not_error':
      return null;
    case 'duplicate':
      return new UserFacingError('duplicate', '이미 넣은 자료예요.', 409);
    case 'not_found':
      return new UserFacingError('not_found', '자료를 찾을 수 없어요.', 404);
    case 'too_many':
      return new UserFacingError('too_many_running', `지금 정리 중인 자료가 ${r.busy ?? '여러'}개 있어요. 하나가 끝나면 다시 해 주세요.`, 429);
    case 'append_busy':
      return new UserFacingError('append_busy', '이 노트에 더하는 자료가 아직 정리 중이에요. 끝나면 다음 자료를 더할게요.', 429);
    case 'no_energy': {
      const left = Math.max(0, Math.floor(Number(r.limit ?? 0) - Number(r.used ?? 0) - Number(r.inflight ?? 0)));
      const busy = Number(r.inflight ?? 0) > 0 ? ' 정리 중인 자료가 쓸 에너지는 미리 빼 두었어요.' : '';
      const when = refillText(plan ?? { kind: 'free', name: '무료', start: null, until: null }, r.period === 'month' ? 'period' : 'day');
      return new UserFacingError('no_energy', `에너지가 부족해요. 필요: 약 ${Math.ceil(Number(r.need ?? 0))}, 남음: ${left}.${busy} ${when}`, 402);
    }
    default:
      return new UserFacingError('reserve_failed', '자료를 시작하지 못했어요. 다시 해 주세요.', 500);
  }
}

/** AI 한 번 쓴 비용을 기록한다 */
export async function charge(
  admin: SupabaseClient,
  args: {
    acc: Pick<Account, 'userId' | 'plan'>;
    task: string;
    model: string;
    usage: Usage;
    usdPerEnergy: number;
    sourceId?: string | null;
  },
): Promise<{ usd: number; energy: number }> {
  const usd = costUsd(args.model, args.usage);
  const energy = usdToEnergy(usd, args.usdPerEnergy);
  const { error } = await admin.from('energy_ledger').insert({
    user_id: args.acc.userId,
    task: args.task,
    model: args.model,
    input_tokens: args.usage.input_tokens,
    output_tokens: args.usage.output_tokens,
    cache_write_tokens: args.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: args.usage.cache_read_input_tokens ?? 0,
    usd,
    energy,
    // free 만 '무료 전체 월 예산'에 들어간다 (테스트 플랜은 custom)
    plan: args.acc.plan.kind,
    source_id: args.sourceId ?? null,
  });
  if (error) console.error('[kok] charge insert failed', error);
  return { usd, energy };
}

/**
 * 처리에 실패한 자료에 쓴 에너지를 돌려준다 (달러 비용 기록은 남긴다).
 * 이미 돌려준 만큼은 빼고 남은 만큼만 돌려주므로, "다시 하기" 뒤에 또 실패해도 그만큼만 돌려준다.
 * 돌려준 기록의 시각은 마지막으로 쓴 시각에 맞춘다: 어제 쓴 것을 오늘 돌려받아 오늘 한도가 늘어나지 않게.
 */
export async function refundSource(admin: SupabaseClient, userId: string, sourceId: string): Promise<void> {
  const { data, error } = await admin.from('energy_ledger').select('energy, created_at').eq('user_id', userId).eq('source_id', sourceId);
  if (error) throw error;
  const rows = data ?? [];
  let left = Math.round(rows.reduce((a, r) => a + Number(r.energy ?? 0), 0) * 1000) / 1000;
  if (left <= 0) return;
  // 돌려줄 만큼을 가장 최근에 쓴 기록부터 나눠, 각 기록 바로 뒤 시각으로 적는다.
  // 그래야 오늘·이번 달·테스트 플랜 기간 어디에서 세도 그 기간에 쓴 만큼만 돌아간다
  const charges = rows
    .map((r) => ({ energy: Number(r.energy ?? 0), at: Date.parse(r.created_at as string) }))
    .filter((r) => r.energy > 0 && Number.isFinite(r.at))
    .sort((a, b) => b.at - a.at);
  const now = Date.now();
  const refunds: Array<{ user_id: string; task: string; usd: number; energy: number; plan: null; source_id: string; created_at: string }> = [];
  for (const c of charges) {
    if (left <= 0) break;
    const amount = Math.min(c.energy, left);
    left = Math.round((left - amount) * 1000) / 1000;
    refunds.push({
      user_id: userId,
      task: 'refund',
      usd: 0,
      energy: -amount,
      plan: null,
      source_id: sourceId,
      created_at: new Date(Math.min(c.at + 1, now)).toISOString(),
    });
  }
  if (left > 0) {
    refunds.push({ user_id: userId, task: 'refund', usd: 0, energy: -left, plan: null, source_id: sourceId, created_at: new Date(now).toISOString() });
  }
  const { error: insErr } = await admin.from('energy_ledger').insert(refunds);
  if (insErr) throw insErr;
}
