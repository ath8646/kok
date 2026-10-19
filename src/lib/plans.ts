// 요금제 판단 (화면·서버 공통, 계산만): 관리자 > 테스트 플랜 > Pro > 무료
import { MAX_FILE_MB, type Limits } from './settings';

export type PlanKind = 'admin' | 'custom' | 'pro' | 'free';

/** 관리자가 만든 테스트 플랜 (custom_plans 행) */
export type CustomPlan = {
  id: string;
  name: string;
  /** 기간 전체 번개(에너지) 총량 */
  energyTotal: number;
  /** 하루 최대 (null = 하루 제한 없음) */
  energyDaily: number | null;
  pdfPages: number;
  images: number;
  textChars: number;
  fileMb: number;
  /** 꼼꼼 모델을 쓸 수 있는지 */
  careful: boolean;
  /** 노트에 자료 더하기(버전)를 쓸 수 있는지 */
  canAppend: boolean;
  /** 테마를 쓸 수 있는지 */
  canTheme: boolean;
  /** 그림 풀이(문제 그림·그림으로 보는 단계 풀이)를 쓸 수 있는지 */
  canFigures: boolean;
  note: string | null;
};

export type PlanInfo = {
  kind: PlanKind;
  /** 화면에 보일 이름 */
  name: string;
  /** 테스트 플랜을 켠 시각 (번개 총량을 이때부터 센다) */
  start: string | null;
  /** 끝나는 시각 (Pro·테스트 플랜) */
  until: string | null;
};

/** custom_plans 표의 한 행 → CustomPlan */
export function toCustomPlan(row: Record<string, unknown>): CustomPlan {
  const num = (v: unknown, d: number) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    id: String(row.id),
    name: String(row.name ?? '테스트 플랜'),
    energyTotal: num(row.energy_total, 0),
    energyDaily: row.energy_daily === null || row.energy_daily === undefined ? null : num(row.energy_daily, 0),
    pdfPages: num(row.pdf_pages, 20),
    images: num(row.images, 5),
    textChars: num(row.text_chars, 20000),
    fileMb: num(row.file_mb, 10),
    careful: row.careful !== false,
    canAppend: row.can_append === true,
    canTheme: row.can_theme === true,
    canFigures: row.can_figures === true,
    note: typeof row.note === 'string' ? row.note : null,
  };
}

/**
 * 지금 적용되는 플랜. 테스트 플랜이 켜져 있으면 Pro·무료 대신 그 플랜을 쓰고, 끝나면 원래 플랜으로 돌아간다.
 * profile: profiles 행 (plan, pro_until, custom_plan_start, custom_plan_until), custom: 켜진 테스트 플랜 행(없으면 null)
 */
export function resolvePlan(
  profile: {
    plan?: string | null;
    pro_until?: string | null;
    custom_plan_id?: string | null;
    custom_plan_start?: string | null;
    custom_plan_until?: string | null;
  },
  custom: CustomPlan | null,
  isAdmin: boolean,
  now: number = Date.now(),
): { info: PlanInfo; custom: CustomPlan | null } {
  if (isAdmin) return { info: { kind: 'admin', name: '관리자', start: null, until: null }, custom: null };
  const until = profile.custom_plan_until ? Date.parse(profile.custom_plan_until) : NaN;
  if (custom && Number.isFinite(until) && until > now) {
    return { info: { kind: 'custom', name: custom.name, start: profile.custom_plan_start ?? null, until: profile.custom_plan_until ?? null }, custom };
  }
  const proUntil = profile.pro_until ?? null;
  if (profile.plan === 'pro' && proUntil && Date.parse(proUntil) > now) {
    return { info: { kind: 'pro', name: 'Pro', start: null, until: proUntil }, custom: null };
  }
  return { info: { kind: 'free', name: '무료', start: null, until: null }, custom: null };
}

/** 테스트 플랜이 켜져 있을 수 있는지 (테스트 플랜 행을 읽어 볼 필요가 있는지) */
export function customPlanActive(profile: { custom_plan_id?: string | null; custom_plan_until?: string | null }, now: number = Date.now()): boolean {
  if (!profile.custom_plan_id || !profile.custom_plan_until) return false;
  const until = Date.parse(profile.custom_plan_until);
  return Number.isFinite(until) && until > now;
}

/**
 * 마지막 테스트 플랜이 끝난 시각 (지금 켜져 있으면 null).
 * 무료·Pro 에너지는 이 뒤에 쓴 것만 센다: 플랜에서 쓴 번개가 원래 요금제의 오늘·이번 달 몫을 먹지 않게.
 */
export function planEndedAt(profile: { custom_plan_until?: string | null }, now: number = Date.now()): string | null {
  const until = profile.custom_plan_until ? Date.parse(profile.custom_plan_until) : NaN;
  return Number.isFinite(until) && until <= now ? profile.custom_plan_until! : null;
}

/** 에너지를 세기 시작하는 때: 기간 시작과 마지막 테스트 플랜이 끝난 때 중 늦은 쪽 */
export function countFrom(start: Date, endedAt: string | null): Date {
  const ended = endedAt ? Date.parse(endedAt) : NaN;
  return Number.isFinite(ended) && ended > start.getTime() ? new Date(ended) : start;
}

export type PlanLimits = {
  pdfPages: number;
  images: number;
  textChars: number;
  fileMb: number;
} & PlanFlags;

export type PlanFlags = {
  /** 꼼꼼 모델 */
  canCareful: boolean;
  /** 원본 파일을 기한 없이 보관 (아니면 처리 뒤 freeFileDays 일, 테스트 플랜은 플랜이 끝나고 freeFileDays 일) */
  keepFiles: boolean;
  /** 노트에 자료 더하기(버전) */
  canAppend: boolean;
  /** 테마 */
  canTheme: boolean;
  /** 그림 풀이: 노트를 만들 때 문제 그림과 그림으로 보는 단계 풀이, 채팅의 그림 풀이 */
  canFigures: boolean;
};

/** 꼼꼼 모델·원본 보관·자료 더하기·테마·그림 풀이처럼 숫자가 아닌 혜택 */
export function planFlags(plan: PlanKind, custom: CustomPlan | null): PlanFlags {
  if (plan === 'admin' || plan === 'pro') return { canCareful: true, keepFiles: true, canAppend: true, canTheme: true, canFigures: true };
  if (plan === 'custom' && custom) {
    return { canCareful: custom.careful, keepFiles: false, canAppend: custom.canAppend, canTheme: custom.canTheme, canFigures: custom.canFigures };
  }
  return { canCareful: false, keepFiles: false, canAppend: false, canTheme: false, canFigures: false };
}

/** 플랜별 한도 */
export function planLimits(plan: PlanKind, custom: CustomPlan | null, L: Limits): PlanLimits {
  const flags = planFlags(plan, custom);
  if (plan === 'admin' || plan === 'pro') {
    return { pdfPages: L.pdfPagesPro, images: L.imagesPro, textChars: L.textCharsPro, fileMb: L.fileMbPro, ...flags };
  }
  if (plan === 'custom' && custom) {
    return { pdfPages: custom.pdfPages, images: custom.images, textChars: custom.textChars, fileMb: Math.min(custom.fileMb, MAX_FILE_MB), ...flags };
  }
  return { pdfPages: L.pdfPagesFree, images: L.imagesFree, textChars: L.textCharsFree, fileMb: L.fileMbFree, ...flags };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
const fullDate = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

/** 화면에 보일 플랜 이름. withDate 면 끝나는 날을 붙인다 (예: "베타 테스트 · 2026. 10. 25.까지") */
export function planLabel(info: Pick<PlanInfo, 'kind' | 'name' | 'until'>, withDate = true): string {
  if (info.kind === 'admin') return '관리자';
  if (info.kind === 'free') return '무료';
  return withDate && info.until ? `${info.name} · ${fullDate(info.until)}까지` : info.name;
}

/** 에너지 기간 이름 (오늘·이번 달·플랜) */
export function energyPeriodLabel(period: 'day' | 'month' | 'plan'): string {
  return period === 'plan' ? '플랜' : period === 'month' ? '이번 달' : '오늘';
}

/**
 * 남은 에너지가 하루 한도 때문에 정해지는지('day'), 기간 한도 때문인지('period').
 * 무료는 하루, Pro 는 이번 달과 하루 최대, 테스트 플랜은 기간 총량과 하루 최대(있으면) 중 먼저 걸리는 쪽.
 */
export function energyWindow(e: {
  period: 'day' | 'month' | 'plan';
  limit: number | null;
  usedToday: number;
  usedMonth: number;
  proDaily?: number | null;
  usedPlan?: number | null;
  planDaily?: number | null;
}): 'day' | 'period' {
  if (e.period === 'day') return 'day';
  const daily = e.period === 'month' ? e.proDaily : e.planDaily;
  if (daily === null || daily === undefined || e.limit === null) return 'period';
  const used = e.period === 'month' ? e.usedMonth : (e.usedPlan ?? 0);
  return daily - e.usedToday < e.limit - used ? 'day' : 'period';
}

/** 다 쓴 에너지가 언제 다시 생기는지 */
export function refillText(plan: Pick<PlanInfo, 'kind' | 'name' | 'until'>, window: 'day' | 'period'): string {
  if (window === 'day') return '내일 다시 채워져요.';
  if (plan.kind === 'custom') {
    return `'${plan.name}' 플랜 에너지는 기간 동안 다시 채워지지 않아요.${plan.until ? ` 플랜은 ${shortDate(plan.until)}까지예요.` : ''}`;
  }
  return '다음 달 다시 채워져요.';
}
