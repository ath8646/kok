// 테스트 플랜 값 검사 (만들기·고치기 같이 씀)
import { z } from 'zod';
import { MAX_FILE_MB } from '@/lib/settings';
import { UserFacingError } from '@/lib/server/errors';

/** 숫자 칸 (오류 글: '칸 이름' 칸은 …) */
const num = (label: string, min: number, max: number, opts: { int?: boolean } = {}) => {
  let n = z.number({ error: `'${label}' 칸에는 숫자를 적어 주세요.` });
  if (opts.int) n = n.int(`'${label}' 칸은 정수로 적어 주세요.`);
  return n
    .min(min, `'${label}' 칸은 ${min.toLocaleString('ko-KR')} 이상이어야 해요.`)
    .max(max, `'${label}' 칸은 ${max.toLocaleString('ko-KR')}까지 정할 수 있어요.`);
};

export const PlanBody = z.object({
  name: z.string({ error: '플랜 이름을 적어 주세요.' }).trim().min(1, '플랜 이름을 적어 주세요.').max(30, '플랜 이름은 30자까지예요.'),
  energyTotal: num('번개 총량', 0, 10_000_000),
  energyDaily: num('하루 최대', 0, 10_000_000).nullable(),
  pdfPages: num('PDF 쪽수', 1, 2000, { int: true }),
  images: num('사진 장수', 1, 60, { int: true }),
  textChars: num('글자 수', 100, 200_000, { int: true }),
  fileMb: num('파일 MB', 1, MAX_FILE_MB, { int: true }),
  careful: z.boolean({ error: '꼼꼼 모델 쓰기를 골라 주세요.' }),
  canAppend: z.boolean().default(false),
  canTheme: z.boolean().default(false),
  canFigures: z.boolean().default(false),
  note: z.string().trim().max(100, '메모는 100자까지예요.').default(''),
});
export type PlanInput = z.infer<typeof PlanBody>;

/**
 * 화면에서 받은 값 → custom_plans 행.
 * 자료 더하기·테마 칸(can_append·can_theme)과 그림 풀이 칸(can_figures)은 schema.sql 을 다시 실행한 DB 에만 있어서,
 * 없으면(planFlags·figures=false) 빼고 저장한다. 칸이 있는지는 먼저 넣어 보고 '칸이 없다' 오류가 나면 안다 (savePlan)
 */
export function planRow(b: PlanInput, planFlags: boolean, figures: boolean = planFlags) {
  return {
    name: b.name,
    energy_total: b.energyTotal,
    energy_daily: b.energyDaily,
    pdf_pages: b.pdfPages,
    images: b.images,
    text_chars: b.textChars,
    file_mb: b.fileMb,
    careful: b.careful,
    ...(planFlags ? { can_append: b.canAppend, can_theme: b.canTheme } : {}),
    ...(planFlags && figures ? { can_figures: b.canFigures } : {}),
    note: b.note || null,
  };
}

/** 표·칸·함수가 없다는 오류 (Postgres 42P01·42703·42883, PostgREST PGRST202·PGRST204·PGRST205) */
const MISSING_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

export const FLAGS_WARNING = '자료 더하기·테마·그림 풀이 칸이 아직 없어서 그 셋은 저장하지 않았어요. Supabase 에서 schema.sql 을 다시 실행해 주세요.';
export const FIGURES_WARNING = '그림 풀이 칸이 아직 없어서 그것은 저장하지 않았어요. Supabase 에서 schema.sql 을 다시 실행해 주세요.';

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

type Saved = { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null };

/**
 * 플랜 저장: 자료 더하기·테마·그림 풀이 칸까지 넣어 보고, 없는 칸이 있는 DB 면 빼고 다시 저장한다.
 * (기능 확인 기억(1분)에 기대지 않는다: schema.sql 을 막 다시 실행했어도 바로 저장된다)
 */
export async function savePlan(
  b: PlanInput,
  write: (row: ReturnType<typeof planRow>) => PromiseLike<Saved>,
): Promise<{ plan: Record<string, unknown> | null; warning?: string }> {
  let r = await write(planRow(b, true, true));
  let warning: string | undefined;
  if (r.error && figuresMissing(r.error)) {
    r = await write(planRow(b, true, false));
    if (!r.error && b.canFigures) warning = FIGURES_WARNING;
  }
  if (r.error && flagsMissing(r.error)) {
    r = await write(planRow(b, false));
    if (!r.error && (b.canAppend || b.canTheme || b.canFigures)) warning = FLAGS_WARNING;
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
