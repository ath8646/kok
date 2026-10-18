// 학생 설정과 운영 설정의 모양, 기본값
import { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high';
export type AiTask = 'organize' | 'merge' | 'visual' | 'quiz' | 'check' | 'grade' | 'chat';

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
    })
    .catch({ organize: 'medium', merge: 'low', visual: 'low', quiz: 'medium', check: 'low', grade: 'low', chat: 'low' }),
});
export type ModelsConfig = z.infer<typeof zModelsConfig>;
export const DEFAULT_MODELS: ModelsConfig = zModelsConfig.parse({});

export const zNotice = z.object({ active: z.boolean().catch(false), text: z.string().catch('') });
export type Notice = z.infer<typeof zNotice>;

// ------------------------------------------------------------- 학생 설정 (profiles.settings)
const zTier = z.enum(['fast', 'careful', 'admin']);
export type ModelTier = z.infer<typeof zTier>;

export const VISUAL_TYPES = ['mindmap', 'table', 'timeline'] as const;

/** 테마 (Pro): 색, 글꼴, 노트 종이 무늬. 무료는 기본만 쓴다 */
export const THEME_COLORS = ['default', 'ocean', 'forest', 'lavender', 'cherry', 'mint', 'mocha', 'night'] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];
export const THEME_FONTS = ['default', 'round', 'hand', 'serif'] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];
export const THEME_PAPERS = ['none', 'lined', 'grid', 'dots'] as const;
export type ThemePaper = (typeof THEME_PAPERS)[number];
export const DEFAULT_THEME = { color: 'default', font: 'default', paper: 'none' } as const satisfies { color: ThemeColor; font: ThemeFont; paper: ThemePaper };
export type VisualType = (typeof VISUAL_TYPES)[number];

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
      color: z.enum(THEME_COLORS).catch('default'),
      font: z.enum(THEME_FONTS).catch('default'),
      paper: z.enum(THEME_PAPERS).catch('none'),
    })
    .catch({ ...DEFAULT_THEME }),
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
    }),
  review: z
    .object({
      retention: z.number().min(0.8).max(0.95).catch(0.9),
      dailyMax: z.number().int().min(10).max(500).catch(50),
      session: z.union([z.literal(5), z.literal(10), z.literal(25)]).catch(5),
      interleave: z.boolean().catch(true),
      aiShortGrade: z.boolean().catch(true),
      reminder: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullable()
        .catch(null),
    })
    .catch({ retention: 0.9, dailyMax: 50, session: 5, interleave: true, aiShortGrade: true, reminder: null }),
  quiz: z
    .object({
      types: z
        .array(z.enum(['mcq', 'ox', 'cloze', 'short']))
        .min(1)
        .catch(['mcq', 'ox', 'cloze', 'short']),
      perKeyPoint: z.union([z.literal('auto'), z.literal(1), z.literal(2), z.literal(3)]).catch('auto'),
      mix: z.object({ easy: z.number().catch(30), medium: z.number().catch(50), hard: z.number().catch(20) }).catch({ easy: 30, medium: 50, hard: 20 }),
      language: z.enum(['ko', 'material']).catch('ko'),
    })
    .catch({ types: ['mcq', 'ox', 'cloze', 'short'], perKeyPoint: 'auto', mix: { easy: 30, medium: 50, hard: 20 }, language: 'ko' }),
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
