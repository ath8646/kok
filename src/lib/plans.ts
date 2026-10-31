// 요금제 판단 (화면·서버 공통, 계산만): 관리자 > 테스트 플랜 > Max > Pro > 무료.
// 무료·Pro·Max 의 혜택(에너지·한도·자료 받기·혜택 스위치)은 관리자가 고친다 (app_settings 'plans', 없으면 DEFAULT_PLANS).
// 테스트 플랜(custom_plans)도 같은 칸을 모두 정한다 (에너지만 기간 총량 + 하루 최대).
import { z } from 'zod';
import { josa } from './josa';
import { MAX_FILE_MB, type Limits } from './settings';

export type PlanKind = 'admin' | 'custom' | 'max' | 'pro' | 'free';

/** 요금제 표의 세 칸 (관리자가 혜택을 고치는 요금제) */
export const TIERS = ['free', 'pro', 'max'] as const;
export type Tier = (typeof TIERS)[number];
/** 돈을 내는 요금제 (쿠폰·관리자가 기간을 정한다) */
export type PaidTier = Exclude<Tier, 'free'>;
export const TIER_NAME: Record<Tier, string> = { free: '무료', pro: 'Pro', max: 'Max' };

/** 숫자가 아닌 혜택 (요금제마다 켜고 끈다). 차례는 요금제 표의 차례 */
export const PERKS = ['careful', 'keepFiles', 'append', 'figures', 'theme', 'course', 'reorganize', 'cover', 'redraw', 'skins', 'aiTheme'] as const;
export type Perk = (typeof PERKS)[number];
export type Perks = Record<Perk, boolean>;

/** 혜택 이름과 한 줄 설명 (요금제 화면·관리자 화면) */
export const PERK_INFO: Record<Perk, { label: string; hint: string }> = {
  careful: { label: '꼼꼼 모델', hint: '더 정확한 AI 모델을 고를 수 있어요 (에너지를 더 써요)' },
  keepFiles: { label: '원본 파일 계속 보관', hint: '끄면 처리 뒤 무료 보관 일수가 지나면 원본 파일을 지워요 (노트·문제는 남아요)' },
  append: { label: '노트에 자료 더하기·버전', hint: '지금 노트에 자료를 더해 새 버전으로 (버전 기록)' },
  figures: { label: '그림 풀이', hint: '필요한 문제에 문제 그림과 단계 풀이, 채팅의 그림 풀이' },
  theme: { label: '테마', hint: '기본 테마 색·내 테마 만들기·별표 빛·글꼴·노트 종이·화면 밝기' },
  course: { label: '단계별 학습 (레슨)', hint: '노트 하나를 수준에 맞는 레슨 길로' },
  reorganize: { label: 'AI로 다시 정리', hint: '합친 노트의 겹치는 개념을 AI가 하나로 다듬어요' },
  cover: { label: '표지 그림', hint: '자료함 카드에 노트의 핵심을 담은 작은 도표' },
  redraw: { label: '자료 그림 다시 그리기', hint: '자료 속 지도·그래프·표·연표·도식을 KOK 스타일로' },
  skins: { label: '시그니처 테마·터미널', hint: '네온·글리치 같은 모양까지 바뀌는 테마 (테마가 켜져 있어야 써요)' },
  aiTheme: { label: 'AI 테마 그림', hint: 'AI가 테마와 배경 그림을 만들어요 (테마가 켜져 있어야 써요)' },
};

/** 공유 파일 한 개의 가장 큰 크기 (MB): schema.sql 의 'community' 버킷 file_size_limit 과 같게 */
export const SHARE_MAX_FILE_MB = 50;
/** 공유 글 하나에 붙이는 파일 수의 끝 */
export const SHARE_MAX_FILES = 30;

/** 요금제 하나의 혜택 */
export type PlanSpec = {
  /** 한 달 값 (원, 결제가 열리기 전에는 화면에 '예정'으로) */
  price: number;
  /** 하루 에너지 (null = 하루 제한 없음) */
  energyDaily: number | null;
  /** 한 달 에너지 (null = 하루만 센다) */
  energyMonthly: number | null;
  pdfPages: number;
  images: number;
  textChars: number;
  fileMb: number;
  /** 자료 공유: 하루에 받을 수 있는 자료(공유 글) 수 */
  downloadsDaily: number;
  /** 자료 공유: 만들 수 있는 갤러리 수 */
  galleries: number;
  /** 자료 공유: 올리는 파일 한 개 크기 (MB) */
  shareFileMb: number;
  /** 자료 공유: 글 하나에 붙이는 파일 수 */
  shareFiles: number;
  perks: Perks;
};
export type PlansConfig = Record<Tier, PlanSpec>;

/** 숫자 칸 (관리자 화면의 칸과 서버의 값 검사가 같이 쓴다) */
export type PlanNumberKey = 'pdfPages' | 'images' | 'textChars' | 'fileMb' | 'downloadsDaily' | 'galleries' | 'shareFileMb' | 'shareFiles';
export const PLAN_NUMBERS: ReadonlyArray<{ key: PlanNumberKey; label: string; unit: string; min: number; max: number }> = [
  { key: 'pdfPages', label: 'PDF 한 번에', unit: '쪽', min: 1, max: 2000 },
  { key: 'images', label: '사진 한 번에', unit: '장', min: 1, max: 60 },
  { key: 'textChars', label: '글 한 번에', unit: '자', min: 100, max: 200_000 },
  { key: 'fileMb', label: '파일 한 개', unit: 'MB', min: 1, max: MAX_FILE_MB },
  { key: 'downloadsDaily', label: '자료 받기 (하루)', unit: '개', min: 0, max: 10_000 },
  { key: 'galleries', label: '갤러리 만들기', unit: '개', min: 0, max: 1000 },
  { key: 'shareFileMb', label: '공유 파일 한 개', unit: 'MB', min: 1, max: SHARE_MAX_FILE_MB },
  { key: 'shareFiles', label: '공유 글 하나에 파일', unit: '개', min: 1, max: SHARE_MAX_FILES },
];
/** 에너지 칸의 끝 */
export const ENERGY_MAX = 10_000_000;
/** 값의 끝 (원) */
export const PRICE_MAX = 1_000_000;

const perksOf = (on: readonly Perk[]): Perks => Object.fromEntries(PERKS.map((p) => [p, on.includes(p)])) as Perks;
export const NO_PERKS: Perks = perksOf([]);
export const ALL_PERKS: Perks = perksOf(PERKS);

/**
 * 처음 값 (관리자가 고치기 전). Pro 는 공부 핵심(꼼꼼 모델·원본 보관·자료 더하기·그림 풀이·테마),
 * Max 는 Pro 전부 + 레슨·AI로 다시 정리·표지·자료 그림 다시 그리기·시그니처 테마·AI 테마와 큰 한도.
 * 값: 부가세 10%·앱 결제 수수료 15%·1달러 1,450원으로 에너지를 다 써도 Pro 약 59%·Max 약 50% 가 남게
 */
export const DEFAULT_PLANS: PlansConfig = {
  free: {
    price: 0,
    energyDaily: 20,
    energyMonthly: null,
    pdfPages: 20,
    images: 5,
    textChars: 20_000,
    fileMb: 10,
    downloadsDaily: 2,
    galleries: 2,
    shareFileMb: 10,
    shareFiles: 5,
    perks: NO_PERKS,
  },
  pro: {
    price: 6900,
    energyDaily: 200,
    energyMonthly: 1500,
    pdfPages: 100,
    images: 20,
    textChars: 60_000,
    fileMb: 100,
    downloadsDaily: 10,
    galleries: 5,
    shareFileMb: 30,
    shareFiles: 10,
    perks: perksOf(['careful', 'keepFiles', 'append', 'figures', 'theme']),
  },
  max: {
    price: 14_900,
    energyDaily: 600,
    energyMonthly: 4000,
    pdfPages: 300,
    images: 40,
    textChars: 150_000,
    fileMb: 200,
    downloadsDaily: 30,
    galleries: 10,
    shareFileMb: SHARE_MAX_FILE_MB,
    shareFiles: 20,
    perks: ALL_PERKS,
  },
};

/** 저장된 요금제 한 칸 읽기: 없거나 이상한 칸은 처음 값 (d) */
function readSpec(raw: unknown, d: PlanSpec): PlanSpec {
  const n = (min: number, max: number, def: number) => z.number().finite().min(min).max(max).catch(def);
  const nn = (def: number | null) => z.number().finite().min(0).max(ENERGY_MAX).nullable().catch(def);
  const perks = z.object(Object.fromEntries(PERKS.map((p) => [p, z.boolean().catch(d.perks[p])])) as Record<Perk, z.ZodCatch<z.ZodBoolean>>).catch(d.perks);
  const nums = Object.fromEntries(PLAN_NUMBERS.map((f) => [f.key, n(f.min, f.max, d[f.key])])) as Record<PlanNumberKey, z.ZodCatch<z.ZodNumber>>;
  const s = z
    .object({ price: n(0, PRICE_MAX, d.price), energyDaily: nn(d.energyDaily), energyMonthly: nn(d.energyMonthly), ...nums, perks })
    .catch(d)
    .parse(raw ?? {});
  // 에너지가 둘 다 없으면(제한 없음) 처음 값 (관리자 화면이 막지만, 손으로 고친 값도 무제한이 되지 않게)
  if (s.energyDaily === null && s.energyMonthly === null) return { ...s, energyDaily: d.energyDaily, energyMonthly: d.energyMonthly };
  return s as PlanSpec;
}

/**
 * 저장된 요금제 혜택 (app_settings 'plans'). 무료의 에너지·한도는 저장된 것이 없으면 예전 '한도' 값(관리자가 바꾸었을 수 있다)을 처음 값으로 쓴다
 */
export function readPlans(raw: unknown, L?: Limits): PlansConfig {
  const free: PlanSpec = L
    ? {
        ...DEFAULT_PLANS.free,
        energyDaily: L.freeDaily,
        pdfPages: L.pdfPagesFree,
        images: L.imagesFree,
        textChars: L.textCharsFree,
        fileMb: Math.min(L.fileMbFree, MAX_FILE_MB),
      }
    : DEFAULT_PLANS.free;
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { free: readSpec(r.free, free), pro: readSpec(r.pro, DEFAULT_PLANS.pro), max: readSpec(r.max, DEFAULT_PLANS.max) };
}

/** 이 혜택을 처음 주는 돈 내는 요금제 (Pro 에 있으면 Pro, Max 에만 있으면 Max, 아무 데도 없으면 null) */
export function perkTier(plans: PlansConfig, perk: Perk): PaidTier | null {
  if (plans.free.perks[perk]) return null;
  if (plans.pro.perks[perk]) return 'pro';
  return plans.max.perks[perk] ? 'max' : null;
}
export type PerkTiers = Record<Perk, PaidTier | null>;
export function perkTiers(plans: PlansConfig): PerkTiers {
  return Object.fromEntries(PERKS.map((p) => [p, perkTier(plans, p)])) as PerkTiers;
}

/** '표지 그림은 Max에서 쓸 수 있어요.' (어느 요금제에도 없으면 '…은 지금은 쓸 수 없어요.') */
export function perkNeed(tiers: PerkTiers, perk: Perk, what: string = PERK_INFO[perk].label): string {
  const t = tiers[perk];
  return t ? `${josa(what, '은')} ${TIER_NAME[t]}에서 쓸 수 있어요.` : `${josa(what, '은')} 지금은 쓸 수 없어요.`;
}

/** 혜택이 생기는 요금제 이름 ('Max', 없으면 '') : 칩·버튼 글 '(Max)' */
export function perkTierName(tiers: PerkTiers, perk: Perk): string {
  const t = tiers[perk];
  return t ? TIER_NAME[t] : '';
}

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
  downloadsDaily: number;
  galleries: number;
  shareFileMb: number;
  shareFiles: number;
  perks: Perks;
  note: string | null;
};

export type PlanInfo = {
  kind: PlanKind;
  /** 화면에 보일 이름 */
  name: string;
  /** 테스트 플랜을 켠 시각 (번개 총량을 이때부터 센다) */
  start: string | null;
  /** 끝나는 시각 (Pro·Max·테스트 플랜) */
  until: string | null;
};

/**
 * custom_plans 표의 한 행 → CustomPlan.
 * extra 칸(혜택 스위치 전부·자료 공유 숫자)이 없는 예전 행은 예전 스위치로 채운다: 예전 '자료 더하기'는 레슨·AI로 다시 정리까지,
 * '그림 풀이'는 표지·자료 그림 다시 그리기까지, '테마'는 시그니처 테마·AI 테마까지 켰다 (그때 Pro 가 그랬다)
 */
export function toCustomPlan(row: Record<string, unknown>): CustomPlan {
  const num = (v: unknown, d: number) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const extra = row.extra && typeof row.extra === 'object' && !Array.isArray(row.extra) ? (row.extra as Record<string, unknown>) : null;
  const careful = row.careful !== false;
  const append = row.can_append === true;
  const theme = row.can_theme === true;
  const figures = row.can_figures === true;
  const legacy: Perks = {
    careful,
    keepFiles: false,
    append,
    figures,
    theme,
    course: append,
    reorganize: append,
    cover: figures,
    redraw: figures,
    skins: theme,
    aiTheme: theme,
  };
  const rawPerks = extra?.perks && typeof extra.perks === 'object' ? (extra.perks as Record<string, unknown>) : null;
  const perks = rawPerks
    ? (Object.fromEntries(PERKS.map((p) => [p, typeof rawPerks[p] === 'boolean' ? (rawPerks[p] as boolean) : legacy[p]])) as Perks)
    : legacy;
  const d = DEFAULT_PLANS.pro;
  const ex = (k: 'downloadsDaily' | 'galleries' | 'shareFileMb' | 'shareFiles') => num(extra?.[k], d[k]);
  return {
    id: String(row.id),
    name: String(row.name ?? '테스트 플랜'),
    energyTotal: num(row.energy_total, 0),
    energyDaily: row.energy_daily === null || row.energy_daily === undefined ? null : num(row.energy_daily, 0),
    pdfPages: num(row.pdf_pages, 20),
    images: num(row.images, 5),
    textChars: num(row.text_chars, 20000),
    fileMb: num(row.file_mb, 10),
    downloadsDaily: ex('downloadsDaily'),
    galleries: ex('galleries'),
    shareFileMb: ex('shareFileMb'),
    shareFiles: ex('shareFiles'),
    perks,
    note: typeof row.note === 'string' ? row.note : null,
  };
}

/**
 * 지금 적용되는 플랜. 테스트 플랜이 켜져 있으면 그 플랜을 쓰고, 끝나면 원래 플랜으로 돌아간다.
 * Max(max_until)가 켜져 있으면 Pro 보다 먼저 (Max 동안 남은 Pro 는 뒤로 미뤄져 있다: schema.sql kok_redeem_coupon).
 * profile: profiles 행 (plan, pro_until, max_until, custom_plan_start, custom_plan_until), custom: 켜진 테스트 플랜 행(없으면 null)
 */
export function resolvePlan(
  profile: {
    plan?: string | null;
    pro_until?: string | null;
    max_until?: string | null;
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
  const maxUntil = profile.max_until ?? null;
  if (maxUntil && Date.parse(maxUntil) > now) return { info: { kind: 'max', name: 'Max', start: null, until: maxUntil }, custom: null };
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
 * 무료·Pro·Max 에너지는 이 뒤에 쓴 것만 센다: 플랜에서 쓴 번개가 원래 요금제의 오늘·이번 달 몫을 먹지 않게.
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

/**
 * 이 플랜의 혜택 전부. 관리자는 Max 의 숫자 + 모든 혜택(에너지·자료 받기는 따로 무제한),
 * 테스트 플랜은 플랜 행의 값 (에너지는 기간 총량이라 여기 두 칸은 null), 'custom' 인데 행이 없으면 무료
 */
export function specFor(kind: PlanKind, custom: CustomPlan | null, plans: PlansConfig): PlanSpec {
  if (kind === 'admin') return { ...plans.max, perks: ALL_PERKS };
  if (kind === 'custom' && custom) {
    return {
      price: 0,
      energyDaily: null,
      energyMonthly: null,
      pdfPages: custom.pdfPages,
      images: custom.images,
      textChars: custom.textChars,
      fileMb: custom.fileMb,
      downloadsDaily: custom.downloadsDaily,
      galleries: custom.galleries,
      shareFileMb: custom.shareFileMb,
      shareFiles: custom.shareFiles,
      perks: custom.perks,
    };
  }
  if (kind === 'max' || kind === 'pro') return plans[kind];
  return plans.free;
}

export type PlanFlags = {
  /** 꼼꼼 모델 */
  canCareful: boolean;
  /** 원본 파일을 기한 없이 보관 (아니면 처리 뒤 freeFileDays 일, 테스트 플랜은 플랜이 끝나고 freeFileDays 일). 채팅에 붙인 파일 보관도 */
  keepFiles: boolean;
  /** 노트에 자료 더하기(버전) */
  canAppend: boolean;
  /** 테마 (기본 테마 색·내 테마·별표 빛·글꼴·종이) */
  canTheme: boolean;
  /** 그림 풀이: 노트를 만들 때 문제 그림과 그림으로 보는 단계 풀이, 채팅의 그림 풀이 */
  canFigures: boolean;
  /** 단계별 학습 (레슨 만들기: 이미 만든 레슨은 누구나 이어서 한다) */
  canCourse: boolean;
  /** AI로 다시 정리 */
  canReorganize: boolean;
  /** 표지 그림 */
  canCover: boolean;
  /** 자료 그림을 KOK 스타일로 다시 그리기 */
  canRedraw: boolean;
  /** 시그니처 테마·터미널 (테마도 켜져 있어야) */
  canSkins: boolean;
  /** AI 테마 그림 (테마도 켜져 있어야) */
  canAiTheme: boolean;
};

export function perksToFlags(p: Perks): PlanFlags {
  return {
    canCareful: p.careful,
    keepFiles: p.keepFiles,
    canAppend: p.append,
    canTheme: p.theme,
    canFigures: p.figures,
    canCourse: p.course,
    canReorganize: p.reorganize,
    canCover: p.cover,
    canRedraw: p.redraw,
    canSkins: p.theme && p.skins,
    canAiTheme: p.theme && p.aiTheme,
  };
}

export type PlanLimits = {
  pdfPages: number;
  images: number;
  textChars: number;
  fileMb: number;
  /** 하루 자료 받기 (null = 제한 없음: 관리자) */
  downloadsDaily: number | null;
  /** 만들 수 있는 갤러리 수 (null = 제한 없음: 관리자) */
  galleries: number | null;
  shareFileMb: number;
  shareFiles: number;
} & PlanFlags;

/** 플랜별 한도와 혜택 (파일 크기는 저장소 한도까지만) */
export function planLimits(kind: PlanKind, custom: CustomPlan | null, plans: PlansConfig): PlanLimits {
  const s = specFor(kind, custom, plans);
  const admin = kind === 'admin';
  return {
    pdfPages: s.pdfPages,
    images: s.images,
    textChars: s.textChars,
    fileMb: Math.min(s.fileMb, MAX_FILE_MB),
    downloadsDaily: admin ? null : s.downloadsDaily,
    galleries: admin ? null : s.galleries,
    shareFileMb: Math.min(s.shareFileMb, SHARE_MAX_FILE_MB),
    shareFiles: Math.min(s.shareFiles, SHARE_MAX_FILES),
    ...perksToFlags(s.perks),
  };
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

/** 1,234원 */
export function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/** 요금제 에너지 한 줄 ('하루 20', '한 달 1,500 (하루 최대 200)'): 요금제 화면·AI 사용 안내 */
export function energyText(s: Pick<PlanSpec, 'energyDaily' | 'energyMonthly'>): string {
  const n = (v: number) => v.toLocaleString('ko-KR');
  if (s.energyMonthly !== null) return `한 달 ${n(s.energyMonthly)}${s.energyDaily !== null ? ` (하루 최대 ${n(s.energyDaily)})` : ''}`;
  return `하루 ${n(s.energyDaily ?? 0)}`;
}

/**
 * 남은 에너지가 하루 한도 때문에 정해지는지('day'), 기간 한도 때문인지('period').
 * 하루만 세는 요금제는 하루, 한 달을 세는 요금제는 이번 달과 하루 최대, 테스트 플랜은 기간 총량과 하루 최대(있으면) 중 먼저 걸리는 쪽.
 */
export function energyWindow(e: {
  period: 'day' | 'month' | 'plan';
  limit: number | null;
  usedToday: number;
  usedMonth: number;
  /** 한 달을 세는 요금제의 하루 최대 */
  dailyMax?: number | null;
  usedPlan?: number | null;
  planDaily?: number | null;
}): 'day' | 'period' {
  if (e.period === 'day') return 'day';
  const daily = e.period === 'month' ? e.dailyMax : e.planDaily;
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

/**
 * 요금제의 남은 에너지 (테스트 플랜·관리자 말고). 한 달 칸이 있으면 이번 달과 하루 최대 중 적은 쪽, 없으면 하루만
 */
export function tierEnergy(
  spec: Pick<PlanSpec, 'energyDaily' | 'energyMonthly'>,
  usedToday: number,
  usedMonth: number,
): { remaining: number; limit: number; period: 'day' | 'month'; dailyMax: number | null } {
  if (spec.energyMonthly !== null) {
    const daily = spec.energyDaily;
    const remaining = Math.max(0, Math.min(spec.energyMonthly - usedMonth, daily === null ? Infinity : daily - usedToday));
    return { remaining, limit: spec.energyMonthly, period: 'month', dailyMax: daily };
  }
  const daily = spec.energyDaily ?? 0;
  return { remaining: Math.max(0, daily - usedToday), limit: daily, period: 'day', dailyMax: null };
}
