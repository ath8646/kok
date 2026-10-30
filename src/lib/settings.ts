// 학생 설정과 운영 설정의 모양, 기본값
import { z } from 'zod';
import { REVIEW_PERIODS } from './review-plan';

export type Effort = 'low' | 'medium' | 'high';
/**
 * solve: 문제 그림·단계 풀이, 사진·파일로 보낸 문제 풀기 (홈 채팅). redraw: 자료 그림을 KOK 스타일로 다시 그리기 (Pro).
 * locate: 자료 그림의 자리 찾기 (쪽을 그림으로 그려 보여 주고 픽셀 상자를 받는다, 정리 모델).
 * cover: 자료함 카드의 표지 그림 (Pro, 그림 모델)
 */
export type AiTask = 'organize' | 'merge' | 'visual' | 'quiz' | 'check' | 'grade' | 'chat' | 'theme' | 'solve' | 'redraw' | 'locate' | 'cover';

// ------------------------------------------------------------- 운영 설정 (app_settings)
/**
 * 파일 한 개의 최대 크기(MB). Supabase 저장소 'sources' 버킷 한도(schema.sql)와 Supabase 전체 업로드 한도보다 클 수 없다.
 * 올리려면 세 곳을 같이 바꾼다: 이 값, schema.sql 의 file_size_limit, Supabase Storage 설정의 전체 한도.
 */
export const MAX_FILE_MB = 200;

export const zLimits = z.object({
  freeDaily: z.number().catch(20),
  proMonthly: z.number().catch(2000),
  proDaily: z.number().catch(300),
  freeMonthlyBudgetUsd: z.number().catch(10),
  usdPerEnergy: z.number().positive().catch(0.001),
  pdfPagesFree: z.number().catch(20),
  pdfPagesPro: z.number().catch(150),
  imagesFree: z.number().catch(5),
  imagesPro: z.number().catch(30),
  textCharsFree: z.number().catch(20000),
  textCharsPro: z.number().catch(100000),
  fileMbFree: z.number().catch(10),
  fileMbPro: z.number().catch(200),
  ratePerMinute: z.number().catch(10),
  freeFileDays: z.number().catch(7),
});
export type Limits = z.infer<typeof zLimits>;
export const DEFAULT_LIMITS: Limits = zLimits.parse({});

const zEffort = z.enum(['low', 'medium', 'high']);
export const zModelsConfig = z.object({
  fast: z.string().catch('claude-haiku-5-5'),
  careful: z.string().catch('claude-sonnet-5-5'),
  adminTest: z.string().catch('claude-opus-5-5'),
  effort: z
    .object({
      organize: zEffort.catch('medium'),
      merge: zEffort.catch('low'),
      visual: zEffort.catch('low'),
      quiz: zEffort.catch('medium'),
      check: zEffort.catch('low'),
      grade: zEffort.catch('low'),
      chat: zEffort.catch('low'),
      theme: zEffort.catch('low'),
      solve: zEffort.catch('medium'),
      redraw: zEffort.catch('medium'),
      locate: zEffort.catch('low'),
      cover: zEffort.catch('low'),
    })
    .catch({
      organize: 'medium',
      merge: 'low',
      visual: 'low',
      quiz: 'medium',
      check: 'low',
      grade: 'low',
      chat: 'low',
      theme: 'low',
      solve: 'medium',
      redraw: 'medium',
      locate: 'low',
      cover: 'low',
    }),
});
export type ModelsConfig = z.infer<typeof zModelsConfig>;
export const DEFAULT_MODELS: ModelsConfig = zModelsConfig.parse({});

export const zNotice = z.object({ active: z.boolean().catch(false), text: z.string().catch('') });
export type Notice = z.infer<typeof zNotice>;

// ------------------------------------------------------------- 학생 설정 (profiles.settings)
const zTier = z.enum(['fast', 'careful', 'admin']);
export type ModelTier = z.infer<typeof zTier>;

/**
 * 테마 (Pro): 색, 글꼴, 노트 종이 무늬, 별표 빛. 무료는 기본만 쓴다.
 * 고르는 화면의 차례대로 (default = KOK 인디고, ocean = 블루, forest = 라임, night = 미드나잇 …: 번호는 예전 이름 그대로 둔다)
 */
export const THEME_COLORS = ['default', 'ocean', 'lavender', 'cherry', 'coral', 'forest', 'mint', 'mocha', 'night'] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];
/** 별표 빛: 별표한 카드에 번지는 두 가지 색 그라데이션 (accent = 테마 포인트 색) */
export const GLOW_TONES = ['gold', 'sunset', 'aurora', 'ocean', 'berry', 'accent'] as const;
export type GlowTone = (typeof GLOW_TONES)[number];
/** 별표 빛 세기 0 ~ 100 (0 이면 빛 없이 별만) */
export const DEFAULT_GLOW = { tone: 'gold', strength: 60 } as const satisfies { tone: GlowTone; strength: number };
export type Glow = { tone: GlowTone; strength: number };
export const THEME_FONTS = ['default', 'round', 'hand', 'serif'] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];
export const THEME_PAPERS = ['none', 'lined', 'grid', 'dots'] as const;
export type ThemePaper = (typeof THEME_PAPERS)[number];
/** 화면 밝기: 기기 설정 따르기·늘 밝게·늘 어둡게 */
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
/**
 * 시그니처 테마 (Pro): 색만이 아니라 모양(카드·버튼·칩·아래 메뉴·제목 글꼴·바탕 그림·움직임)까지 다른 테마.
 * 밝기가 정해져 있다 (src/lib/themes/skins.ts). 차례는 고르는 화면의 차례
 */
export const SKIN_IDS = ['neon', 'glitch', 'synthwave', 'terminal', 'brutal', 'sketch'] as const;
export type SkinId = (typeof SKIN_IDS)[number];
/**
 * 밝을 때·어두울 때 쓸 테마: 기본 테마('preset:ocean'), 시그니처 테마('skin:neon') 또는 내가 만든 테마('custom:<번호>').
 * 시그니처 테마는 두 모드에 같이 쓴다 (따로 고를 수 없다)
 */
export const THEME_REF = new RegExp(
  `^(preset:(${THEME_COLORS.join('|')})|skin:(${SKIN_IDS.join('|')})|custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
);
export type ThemeRef = string;
export const DEFAULT_THEME = {
  color: 'default',
  font: 'default',
  paper: 'none',
  mode: 'system',
  light: null,
  dark: null,
  glow: DEFAULT_GLOW,
  motion: true,
} as const satisfies {
  color: ThemeColor;
  font: ThemeFont;
  paper: ThemePaper;
  mode: ThemeMode;
  light: ThemeRef | null;
  dark: ThemeRef | null;
  glow: Glow;
  motion: boolean;
};

export const zUserSettings = z.object({
  models: z
    .object({
      organize: zTier.catch('fast'),
      visual: zTier.catch('fast'),
      quiz: zTier.catch('fast'),
      grade: zTier.catch('fast'),
      chat: zTier.catch('fast'),
    })
    .catch({ organize: 'fast', visual: 'fast', quiz: 'fast', grade: 'fast', chat: 'fast' }),
  /** 노트 채팅: AI 가 문제·노트에 넣자고 할 수 있는지 (넣기 전에는 늘 미리보기로 묻는다) */
  chat: z
    .object({
      allowQuestions: z.boolean().catch(true),
      allowNote: z.boolean().catch(true),
    })
    .catch({ allowQuestions: true, allowNote: true }),
  theme: z
    .object({
      // 예전 한 가지 테마 색 (밝을 때·어두울 때 테마를 따로 고르기 전에는 이것을 둘 다에 쓴다)
      color: z.enum(THEME_COLORS).catch('default'),
      font: z.enum(THEME_FONTS).catch('default'),
      paper: z.enum(THEME_PAPERS).catch('none'),
      mode: z.enum(THEME_MODES).catch('system'),
      light: z.string().regex(THEME_REF).nullable().catch(null),
      dark: z.string().regex(THEME_REF).nullable().catch(null),
      // 별표 빛 (예전 설정에는 없다: 기본 금빛)
      glow: z
        .object({
          tone: z.enum(GLOW_TONES).catch(DEFAULT_GLOW.tone),
          strength: z.number().int().min(0).max(100).catch(DEFAULT_GLOW.strength),
        })
        .catch({ ...DEFAULT_GLOW }),
      // 시그니처 테마의 움직임 (네온 빛 숨쉬기·글리치 지직거림·터미널 커서 …). 기기의 '동작 줄이기'를 켜면 늘 멈춘다
      motion: z.boolean().catch(true),
      // 내 글꼴·종이: 기본·시그니처 테마나 글꼴·종이를 정하지 않은 내 테마에서 쓰는 것 (font·paper 는 지금 쓰는 것).
      // 내 테마가 정한 글꼴·종이를 쓰는 동안 기억해 두었다가 다른 테마로 가면 이것으로 돌아온다 (lib/theme.ts baseLook). 예전 설정에는 없다
      base: z
        .object({ font: z.enum(THEME_FONTS).catch('default'), paper: z.enum(THEME_PAPERS).catch('none') })
        .optional()
        .catch(undefined),
    })
    .catch({ ...DEFAULT_THEME, glow: { ...DEFAULT_GLOW } }),
  visual: z
    .object({
      defaultType: z.enum(['auto', 'mindmap', 'table', 'timeline']).catch('auto'),
      bySubject: z.record(z.string(), z.enum(['mindmap', 'table', 'timeline'])).catch({}),
      layout: z.enum(['radial', 'right', 'down']).catch('radial'),
      depth: z.union([z.literal(2), z.literal(3), z.literal(4)]).catch(3),
      labels: z.enum(['keyword', 'phrase']).catch('keyword'),
      color: z.enum(['branch', 'subject', 'mono']).catch('branch'),
      icons: z.boolean().catch(true),
      reveal: z.enum(['all', 'step']).catch('all'),
      hideMode: z.enum(['off', 'on']).catch('off'),
      fontSize: z.enum(['sm', 'md', 'lg']).catch('md'),
      /** 자료 그림을 원본(자른 그림)으로 먼저 보기. 끄면 KOK 스타일로 다시 그린 그림이 있을 때 그것부터 (Pro) */
      originalFirst: z.boolean().catch(false),
      /** 자료를 넣으면 자료함 카드의 표지 그림을 AI 가 그린다 (Pro, 문제 그림체) */
      autoCover: z.boolean().catch(true),
    })
    .catch({
      defaultType: 'auto',
      bySubject: {},
      layout: 'radial',
      depth: 3,
      labels: 'keyword',
      color: 'branch',
      icons: true,
      reveal: 'all',
      hideMode: 'off',
      fontSize: 'md',
      originalFirst: false,
      autoCover: true,
    }),
  review: z
    .preprocess(
      // 예전 '세션 길이'(5·10·25분)를 고른 사람은 가까운 복습 시간(5·15·30분)으로
      (v) => {
        if (!v || typeof v !== 'object' || 'minutes' in v) return v;
        const old = (v as { session?: unknown }).session;
        return typeof old === 'number' ? { ...v, minutes: old >= 25 ? 30 : old >= 10 ? 15 : 5 } : v;
      },
      z.object({
        retention: z.number().min(0.8).max(0.95).catch(0.9),
        dailyMax: z.number().int().min(10).max(500).catch(50),
        /** 마지막으로 고른 복습 시간(분): 시간은 문제 수만 정한다 */
        minutes: z.union([z.literal(5), z.literal(15), z.literal(30)]).catch(5),
        /** 마지막으로 고른 복습 기간 (복습할 차례가 없을 때 먼저 고른다) */
        period: z.enum(REVIEW_PERIODS).catch('due'),
        interleave: z.boolean().catch(true),
        aiShortGrade: z.boolean().catch(true),
        reminder: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .catch(null),
      }),
    )
    .catch({ retention: 0.9, dailyMax: 50, minutes: 5, period: 'due', interleave: true, aiShortGrade: true, reminder: null }),
  quiz: z
    .object({
      types: z
        .array(z.enum(['mcq', 'ox', 'cloze', 'short']))
        .min(1)
        .catch(['mcq', 'ox', 'cloze', 'short']),
      perKeyPoint: z.union([z.literal('auto'), z.literal(1), z.literal(2), z.literal(3)]).catch('auto'),
      mix: z.object({ easy: z.number().catch(30), medium: z.number().catch(50), hard: z.number().catch(20) }).catch({ easy: 30, medium: 50, hard: 20 }),
      language: z.enum(['ko', 'material']).catch('ko'),
      /** Pro: 노트를 만들 때 필요한 문제에 그림과 단계 풀이를 붙인다 */
      figures: z.boolean().catch(true),
      /** PDF·사진 속 중요한 그림을 찾아 개념에 붙이고 그림 문제를 만든다 (자료 그림) */
      sourceFigures: z.boolean().catch(true),
    })
    .catch({
      types: ['mcq', 'ox', 'cloze', 'short'],
      perKeyPoint: 'auto',
      mix: { easy: 30, medium: 50, hard: 20 },
      language: 'ko',
      figures: true,
      sourceFigures: true,
    }),
  /** 알림: 내가 한 일이 끝났다는 알림('지웠어요' …)을 보일지. 오류·꼭 알아야 할 안내는 늘 보인다 */
  notify: z
    .object({
      done: z.boolean().catch(true),
    })
    .catch({ done: true }),
  /**
   * 노트: importance = 개념 카드에 AI 가 정한 중요도(꼭 외우기·중요·참고)를 보일지 (기본 끔, PDF 요약도 따른다).
   * 꺼도 복습은 AI 중요도로 중요한 문제를 먼저 낸다
   */
  note: z
    .object({
      importance: z.boolean().catch(false),
    })
    .catch({ importance: false }),
});
export type UserSettings = z.infer<typeof zUserSettings>;
export const DEFAULT_SETTINGS: UserSettings = zUserSettings.parse({});

export function readUserSettings(raw: unknown): UserSettings {
  const r = zUserSettings.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_SETTINGS;
}

export function readLimits(raw: unknown): Limits {
  const r = zLimits.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_LIMITS;
}

export function readModels(raw: unknown): ModelsConfig {
  const r = zModelsConfig.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_MODELS;
}

export function modelForTier(cfg: ModelsConfig, tier: ModelTier, canCareful: boolean, isAdmin: boolean): string {
  if (tier === 'admin' && isAdmin) return cfg.adminTest;
  if ((tier === 'careful' || tier === 'admin') && (canCareful || isAdmin)) return cfg.careful;
  return cfg.fast;
}

export const SUBJECT_COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'red', 'yellow'] as const;
export type SubjectColor = (typeof SUBJECT_COLORS)[number];
