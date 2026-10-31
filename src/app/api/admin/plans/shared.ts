// 테스트 플랜 값 검사 (만들기·고치기 같이 씀). 칸은 요금제 혜택(lib/plans.ts)과 같고, 에너지만 기간 총량 + 하루 최대
import { z } from 'zod';
import { ENERGY_MAX, PERKS, PLAN_NUMBERS, type Perk, type PlanNumberKey } from '@/lib/plans';
import { UserFacingError } from '@/lib/server/errors';

/** 숫자 칸 (오류 글: '칸 이름' 칸은 …) */
const num = (label: string, min: number, max: number, opts: { int?: boolean } = {}) => {
  let n = z.number({ error: `'${label}' 칸에는 숫자를 적어 주세요.` });
  if (opts.int) n = n.int(`'${label}' 칸은 정수로 적어 주세요.`);
  return n
    .min(min, `'${label}' 칸은 ${min.toLocaleString('ko-KR')} 이상이어야 해요.`)
    .max(max, `'${label}' 칸은 ${max.toLocaleString('ko-KR')}까지 정할 수 있어요.`);
};

/** 자료 공유 숫자 칸 (예전 화면은 보내지 않는다: 그때는 Pro 처음 값) */
const SHARE_KEYS = ['downloadsDaily', 'galleries', 'shareFileMb', 'shareFiles'] as const satisfies readonly PlanNumberKey[];
const field = (key: PlanNumberKey) => PLAN_NUMBERS.find((f) => f.key === key)!;
const planNum = (key: PlanNumberKey) => {
  const f = field(key);
  return num(f.label, f.min, f.max, { int: true });
};

export const PlanBody = z
  .object({
    name: z.string({ error: '플랜 이름을 적어 주세요.' }).trim().min(1, '플랜 이름을 적어 주세요.').max(30, '플랜 이름은 30자까지예요.'),
    energyTotal: num('번개 총량', 0, ENERGY_MAX),
    energyDaily: num('하루 최대', 0, ENERGY_MAX).nullable(),
    pdfPages: planNum('pdfPages'),
    images: planNum('images'),
    textChars: planNum('textChars'),
    fileMb: planNum('fileMb'),
    downloadsDaily: planNum('downloadsDaily').optional(),
    galleries: planNum('galleries').optional(),
    shareFileMb: planNum('shareFileMb').optional(),
    shareFiles: planNum('shareFiles').optional(),
    /** 혜택 스위치 전부 (예전 화면은 아래 네 칸만 보낸다) */
    perks: z.object(Object.fromEntries(PERKS.map((p) => [p, z.boolean()])) as Record<Perk, z.ZodBoolean>).optional(),
    careful: z.boolean({ error: '꼼꼼 모델 쓰기를 골라 주세요.' }).optional(),
    canAppend: z.boolean().optional(),
    canTheme: z.boolean().optional(),
    canFigures: z.boolean().optional(),
    note: z.string().trim().max(100, '메모는 100자까지예요.').default(''),
  })
  .refine((b) => b.perks || typeof b.careful === 'boolean', '꼼꼼 모델 쓰기를 골라 주세요.');
export type PlanInput = z.infer<typeof PlanBody>;

/** 받은 값의 혜택 스위치 전부 (예전 화면이면 예전 네 칸으로: 자료 더하기는 레슨·다시 정리까지, 그림 풀이는 표지·다시 그리기까지, 테마는 시그니처·AI 테마까지) */
export function perksOf(b: PlanInput): Record<Perk, boolean> {
  if (b.perks) return b.perks;
  const append = b.canAppend === true;
  const theme = b.canTheme === true;
  const figures = b.canFigures === true;
  return {
    careful: b.careful !== false,
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
}

/** DB 에 있는 칸 (schema.sql 을 다시 실행하기 전에는 없을 수 있다) */
export type PlanColumns = { flags: boolean; figures: boolean; extra: boolean };

/**
 * 화면에서 받은 값 → custom_plans 행.
 * 예전 칸(careful·can_append·can_theme·can_figures)도 같이 적어 예전 코드가 읽어도 맞게 하고, 나머지는 extra 에.
 * 없는 칸은 빼고 저장한다 (savePlan 이 '칸이 없다' 오류를 보고 정한다)
 */
export function planRow(b: PlanInput, cols: PlanColumns = { flags: true, figures: true, extra: true }) {
  const perks = perksOf(b);
  const share = Object.fromEntries(SHARE_KEYS.map((k) => [k, b[k]]).filter(([, v]) => typeof v === 'number'));
  return {
    name: b.name,
    energy_total: b.energyTotal,
    energy_daily: b.energyDaily,
    pdf_pages: b.pdfPages,
    images: b.images,
    text_chars: b.textChars,
    file_mb: b.fileMb,
    careful: perks.careful,
    ...(cols.flags ? { can_append: perks.append, can_theme: perks.theme } : {}),
    ...(cols.flags && cols.figures ? { can_figures: perks.figures } : {}),
    ...(cols.extra ? { extra: { perks, ...share } } : {}),
    note: b.note || null,
  };
}

/** 표·칸·함수가 없다는 오류 (Postgres 42P01·42703·42883, PostgREST PGRST202·PGRST204·PGRST205) */
const MISSING_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

export const FLAGS_WARNING = '자료 더하기·테마·그림 풀이 칸이 아직 없어서 그 셋은 저장하지 않았어요. Supabase 에서 schema.sql 을 다시 실행해 주세요.';
export const FIGURES_WARNING = '그림 풀이 칸이 아직 없어서 그것은 저장하지 않았어요. Supabase 에서 schema.sql 을 다시 실행해 주세요.';
export const EXTRA_WARNING =
  '혜택 스위치 전부와 자료 공유 칸이 아직 없어서 예전 칸(꼼꼼 모델·자료 더하기·테마·그림 풀이)만 저장했어요. Supabase 에서 schema.sql 을 다시 실행해 주세요.';

function columnMissing(error: { code?: string; message?: string }, cols: RegExp): boolean {
  const msg = error.message ?? '';
  return cols.test(msg) && (MISSING_CODES.has(error.code ?? '') || /does not exist|schema cache/i.test(msg));
}

/** 자료 더하기·테마 칸이 없다는 오류인지 (그 칸이 없는 DB 에는 그림 풀이 칸도 없다) */
export function flagsMissing(error: { code?: string; message?: string }): boolean {
  return columnMissing(error, /can_append|can_theme/);
}

/** 그림 풀이 칸만 없다는 오류인지 */
export function figuresMissing(error: { code?: string; message?: string }): boolean {
  return columnMissing(error, /can_figures/);
}

/** 혜택 전부·자료 공유 칸(extra)이 없다는 오류인지 */
export function extraMissing(error: { code?: string; message?: string }): boolean {
  return columnMissing(error, /extra/);
}

type Saved = { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null };

/**
 * 플랜 저장: 모든 칸을 넣어 보고, 없는 칸이 있는 DB 면 빼고 다시 저장한다.
 * (기능 확인 기억(1분)에 기대지 않는다: schema.sql 을 막 다시 실행했어도 바로 저장된다)
 */
export async function savePlan(
  b: PlanInput,
  write: (row: ReturnType<typeof planRow>) => PromiseLike<Saved>,
): Promise<{ plan: Record<string, unknown> | null; warning?: string }> {
  const cols: PlanColumns = { flags: true, figures: true, extra: true };
  let r = await write(planRow(b, cols));
  let warning: string | undefined;
  const perks = perksOf(b);
  if (r.error && extraMissing(r.error)) {
    cols.extra = false;
    r = await write(planRow(b, cols));
    if (!r.error) warning = EXTRA_WARNING;
  }
  if (r.error && figuresMissing(r.error)) {
    cols.figures = false;
    r = await write(planRow(b, cols));
    if (!r.error && perks.figures) warning = FIGURES_WARNING;
  }
  if (r.error && flagsMissing(r.error)) {
    cols.flags = false;
    r = await write(planRow(b, cols));
    if (!r.error && (perks.append || perks.theme || perks.figures)) warning = FLAGS_WARNING;
  }
  if (r.error) throw schemaMissing(r.error) ?? r.error;
  return { plan: r.data, warning };
}

/**
 * DB 에 테스트 플랜 표·칸이 아직 없으면 (schema.sql 을 다시 실행하지 않았으면) 알아듣기 쉽게.
 * 표·칸이 없다는 오류이면서 테스트 플랜 표·칸 이야기일 때만 그렇게 본다 (값 검사에 걸린 오류 등은 그대로 둔다).
 */
export function schemaMissing(error: { code?: string; message?: string }): UserFacingError | null {
  const msg = error.message ?? '';
  const missing = MISSING_CODES.has(error.code ?? '') || /does not exist|schema cache/i.test(msg);
  if (missing && /custom_plans|plan_id|custom_plan_|kok_end_custom_plan/.test(msg)) {
    return new UserFacingError('schema_outdated', '테스트 플랜 표가 아직 없어요. Supabase SQL Editor 에서 supabase/schema.sql 을 다시 실행해 주세요.', 503);
  }
  return null;
}
