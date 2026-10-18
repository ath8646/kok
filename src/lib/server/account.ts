// 계정 정보, 운영 설정, 에너지 계산 (서버 전용)
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { costUsd, usdToEnergy, type Usage } from '@/lib/ai/models';
import { readLimits, readModels, readUserSettings, zNotice, type Limits, type ModelsConfig, type Notice, type UserSettings } from '@/lib/settings';
import { kstDayStart, kstMonthStart } from '@/lib/time';
import { UserFacingError } from './errors';
import { deletedSince } from './tombstone';

export type Account = {
  userId: string;
  email: string;
  nickname: string | null;
  isAdmin: boolean;
  isPro: boolean;
  proUntil: string | null;
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
  const isPro = row.plan === 'pro' && !!proUntil && Date.parse(proUntil) > Date.now();
  return {
    userId,
    email: mail,
    nickname: row.nickname ?? null,
    isAdmin,
    isPro,
    proUntil,
    banned: !!row.banned,
    consented: !!row.consented_at,
    settings: readUserSettings(row.settings),
    createdAt: row.created_at ?? null,
  };
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
      operatorName: typeof site.operatorName === 'string' ? site.operatorName : '콕 운영자',
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
  /** 오늘(무료) 또는 이번 달(Pro) 한도 */
  limit: number;
  period: 'day' | 'month';
  usedToday: number;
  usedMonth: number;
};

async function sumEnergy(admin: SupabaseClient, userId: string, since: Date): Promise<number> {
  const { data, error } = await admin.rpc('kok_energy_since', { p_user: userId, p_since: since.toISOString() });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function energyStatus(admin: SupabaseClient, acc: Account, limits: Limits): Promise<EnergyStatus> {
  const [usedToday, usedMonth] = await Promise.all([sumEnergy(admin, acc.userId, kstDayStart()), sumEnergy(admin, acc.userId, kstMonthStart())]);
  if (acc.isAdmin) {
    return { unlimited: true, remaining: Infinity, limit: Infinity, period: 'day', usedToday, usedMonth };
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
  if (!acc.isAdmin && !acc.isPro) {
    const { data, error } = await admin.rpc('kok_free_usd_since', { p_since: kstMonthStart().toISOString() });
    if (error) throw error;
    if (Number(data ?? 0) >= app.limits.freeMonthlyBudgetUsd) {
      throw new UserFacingError('free_pool_empty', '이번 달 무료 AI가 모두 쓰였어요. 다음 달 1일에 다시 열려요. 복습은 그대로 할 수 있어요.', 429);
    }
    // 오늘 가입한 계정이 오늘 같은 이메일로 탈퇴한 적이 있으면, 오늘은 AI를 쓸 수 없다 (에너지 다시 받기 막기)
    const dayStart = kstDayStart();
    if (acc.createdAt && Date.parse(acc.createdAt) >= dayStart.getTime() && (await deletedSince(admin, acc.email, dayStart))) {
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
    const when = status.period === 'day' ? '내일' : '다음 달';
    throw new UserFacingError(
      'no_energy',
      `에너지가 부족해요. 필요: 약 ${Math.ceil(opts.estimate)}, 남음: ${Math.floor(status.remaining)}. ${when} 다시 채워져요.`,
      402,
    );
  }
  return status;
}

/** 한 사람이 동시에 정리할 수 있는 자료 수 (관리자는 제한 없음) */
export const MAX_PARALLEL_SOURCES = 3;

/** 자료 만들기·다시 하기에서 DB 가 검사할 에너지 한도 (null = 검사 안 함) */
export function energyWindows(acc: Pick<Account, 'isAdmin' | 'isPro'>, limits: Limits) {
  const day = kstDayStart().toISOString();
  const month = kstMonthStart().toISOString();
  if (acc.isAdmin) return { p_day_start: day, p_day_limit: null, p_month_start: month, p_month_limit: null };
  if (acc.isPro) return { p_day_start: day, p_day_limit: limits.proDaily, p_month_start: month, p_month_limit: limits.proMonthly };
  return { p_day_start: day, p_day_limit: limits.freeDaily, p_month_start: month, p_month_limit: null };
}

export type ReserveResult = {
  result: 'ok' | 'duplicate' | 'too_many' | 'no_energy' | 'not_found' | 'not_error';
  busy?: number;
  used?: number;
  inflight?: number;
  need?: number;
  limit?: number;
  period?: 'day' | 'month';
  status?: string;
};

/** kok_create_source·kok_retry_source 결과를 한국어 오류로 (ok 면 null) */
export function reserveError(r: ReserveResult): UserFacingError | null {
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
    case 'no_energy': {
      const left = Math.max(0, Math.floor(Number(r.limit ?? 0) - Number(r.used ?? 0) - Number(r.inflight ?? 0)));
      const busy = Number(r.inflight ?? 0) > 0 ? ' 정리 중인 자료가 쓸 에너지는 미리 빼 두었어요.' : '';
      const when = r.period === 'month' ? '다음 달' : '내일';
      return new UserFacingError(
        'no_energy',
        `에너지가 부족해요. 필요: 약 ${Math.ceil(Number(r.need ?? 0))}, 남음: ${left}.${busy} ${when} 다시 채워져요.`,
        402,
      );
    }
    default:
      return new UserFacingError('reserve_failed', '자료를 시작하지 못했어요. 다시 해 주세요.', 500);
  }
}

/** AI 한 번 쓴 비용을 기록한다 */
export async function charge(
  admin: SupabaseClient,
  args: {
    acc: Pick<Account, 'userId' | 'isPro' | 'isAdmin'>;
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
    plan: args.acc.isAdmin ? 'admin' : args.acc.isPro ? 'pro' : 'free',
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
  const net = Math.round(rows.reduce((a, r) => a + Number(r.energy ?? 0), 0) * 1000) / 1000;
  if (net <= 0) return;
  const lastCharge = rows
    .filter((r) => Number(r.energy) > 0)
    .map((r) => Date.parse(r.created_at as string))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  const { error: insErr } = await admin.from('energy_ledger').insert({
    user_id: userId,
    task: 'refund',
    usd: 0,
    energy: -net,
    plan: null,
    source_id: sourceId,
    ...(lastCharge ? { created_at: new Date(Math.min(lastCharge + 1, Date.now())).toISOString() } : {}),
  });
  if (insErr) throw insErr;
}
