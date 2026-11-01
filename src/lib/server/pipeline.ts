// 자료 처리 파이프라인: 정리 → (합치기) → 그림 → 문제 → 검사·저장
// 한 번 부를 때 한 단계씩 진행하고, 상태는 sources 행에 저장한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, SOURCES_BUCKET } from '@/lib/supabase/admin';
import {
  checkJsonSchema,
  mergePlanJsonSchema,
  organizeJsonSchema,
  problemsJsonSchema,
  zMindmap,
  quizFiguresJsonSchema,
  quizJsonSchema,
  solveJsonSchema,
  toQuestionRow,
  visualJsonSchema,
  zCheck,
  zNote,
  zQuiz,
  zQuizItem,
  zSolve,
  zVisualResult,
  type Mindmap,
  type Note,
  type VisualResult,
} from '@/lib/ai/schemas';
import {
  appendMergePlanPrompt,
  checkPrompt,
  mergePlanPrompt,
  organizePrompt,
  problemsPrompt,
  quizPrompt,
  redrawPrompt,
  solvePrompt,
  visualPrompt,
  wrap,
  type MaterialMeta,
} from '@/lib/ai/prompts';
import { artJsonSchema, normalizeArt } from '@/lib/art/spec';
import { COVER_OUT_TOKENS, coverJsonSchema, coverNoteExcerpt } from '@/lib/cover';
import { coverWanted } from '@/lib/ai/models';
import {
  canRedraw,
  figurePath,
  figuresForPrompt,
  matchKeyPoint,
  questionFigure,
  readFigures,
  readFoundFigures,
  toSourceFigures,
  MAX_FIGURES,
  MAX_FIGURES_PER_PART,
  MAX_NOTE_FIGURES,
  type CutFigure,
  type FoundFigure,
  type SourceFigure,
} from '@/lib/source-figures';
import { keepFromCurrent, remergeState } from '@/lib/append-merge';
import { applyMergePlan, fallbackMergePlan, noteForPlan, partsForPlan, planOutTokens, zMergePlan, type MergePlan } from '@/lib/merge-plan';
import { modelForTier, type AiTask, type UserSettings } from '@/lib/settings';
import { examStyle } from '@/lib/exam-layout';
import { planChunks, slicePdf, splitPdfBySize, splitText, PdfError } from '@/lib/pdf';
import { isOfficeText } from '@/lib/office/names';
import { DOC_PICTURES_PER_CHUNK, pictureNumbers, splitDocText } from '@/lib/doc-pictures';
import { imageInfo } from '@/lib/image-size';
import { questionsForSolve, readSolution, stepsReachAnswer } from '@/lib/figure/solution';
import { getAccount, getAppSettings, getFeatures, charge, refundSource, type Account, type AppSettings } from './account';
import { AiCallError, callJson, imageBlock, pdfBlock, textBlock, usageOf, type ContentPart } from './claude';
import { UserFacingError } from './errors';
import { adminDetail } from './tasks';
import { removePaths } from './files';
import { normalizeAnswer } from '@/lib/grading';
import { noteMaterialType, readMaterialPick, readMaterialType, readPartTypes, type MaterialType, type NoteMaterial } from '@/lib/material-type';
import {
  forSaving,
  halveJob,
  problemJobs,
  readJobs,
  readOriginals,
  vocabCards,
  ORIGINALS_MAX,
  type MaterialQuestion,
  type ProblemsJob,
} from '@/lib/material-questions';
import { noteForPrompt } from './notes';
import { createHash } from 'node:crypto';
import { LOCK_POLL_MS, LOCK_WAIT_MS, RUN_MS, STAGGER_MS, aiParallel, lockSeconds, lockWait, sleep } from '@/lib/relay';
import { coverContent, settleCover } from './cover';
import { cutOnPage, openFigurePage, openPdfPages, pdfPrintedNumbers } from './figure-image';
import { locateOnPages, type FindPage } from './figure-find';
import { nextPages, SEARCH_BATCH, SEARCH_CALLS_MAX } from '@/lib/figure-locate';
import { buildPageLabels, offsetOf, printedPage, type PageAnchor, type PageEvidence, type PageLabels } from '@/lib/page-labels';
import { cleanMindmap, maxNodesFor, visualOutTokens } from '@/lib/mindmap-clean';
import {
  KEY_POINTS_MAX,
  NOTE_OUT_MAX,
  QUESTIONS_MAX,
  aiWaitMs,
  appendKeyPointMax,
  keyPointRange,
  mergedKeyPointRange,
  noteOutTokens,
  pageWeight,
  problemPieces,
  problemsOutTokens,
  quizOutTokens,
  vocabHeadroom,
  type PartSize,
  type Range,
} from '@/lib/ai/scale';

export const IMAGES_PER_CHUNK = 6;
export const TEXT_CHARS_PER_CHUNK = 40000;
const MAX_ATTEMPTS = 3;
/**
 * 같은 단계를 하던 서버 함수가 끝내지 못하고 멈춘(잠금을 풀지 못한) 수가 이만큼이면 실패로 (끝없이 다시 하지 않게).
 * 멈춘 수는 DB 의 kok_claim_source 가 센다 (draft.stalls, 단계를 마치면 0)
 */
const MAX_STALLS = 3;
/**
 * 그림 풀이(Pro): 한 번에 풀이를 만드는 문제 수와 최대 횟수.
 * 그림·단계가 든 답은 길어서, 한 번의 답이 너무 길어지지 않게(시간 제한 안에) 나눠 만든다
 */
export const SOLVE_PER_ROUND = 3;
export const SOLVE_ROUNDS = 2;

export type SourceRow = {
  id: string;
  user_id: string;
  subject_id: string;
  kind: 'text' | 'pdf' | 'image';
  title: string;
  text_content: string | null;
  file_paths: string[];
  page_count: number | null;
  status: 'queued' | 'processing' | 'ready' | 'error';
  step: 'organize' | 'merge' | 'figures' | 'visual' | 'quiz' | 'check' | 'done';
  progress: number;
  chunk_index: number;
  chunk_total: number;
  partials: unknown[];
  draft: Record<string, unknown>;
  model: string | null;
  error: string | null;
  updated_at: string;
  /** 노트에 더하는 자료면 그 노트의 자료 (끝나면 노트의 새 버전이 된다) */
  parent_id?: string | null;
  /** 자료함 카드의 표지 그림 (Pro, features.covers: 칸이 있을 때만 적는다) */
  cover?: Record<string, unknown> | null;
};

export function chunkCount(kind: SourceRow['kind'], pages: number, images: number, text: string): number {
  if (kind === 'pdf') return planChunks(Math.max(1, pages)).length;
  if (kind === 'image') return Math.max(1, Math.ceil(images / IMAGES_PER_CHUNK));
  return Math.max(1, textChunks(text, images > 0).length);
}

/** 글 자료의 조각: 글자 수로, 문서 속 그림이 있는 자료는 그림 수로도 나눈다 (그림 없는 글은 예전과 똑같이) */
function textChunks(text: string, pictures: boolean): string[] {
  return pictures ? splitDocText(text, TEXT_CHARS_PER_CHUNK, DOC_PICTURES_PER_CHUNK) : splitText(text, TEXT_CHARS_PER_CHUNK);
}

/** 글 자료에 딸린 문서(한글·워드·PPT) 속 그림 수 (글의 [[picture N]] 이 file_paths 의 N 번째) */
function docPictureCount(src: Pick<SourceRow, 'kind' | 'file_paths'>): number {
  return src.kind === 'text' ? (src.file_paths ?? []).length : 0;
}

function mediaTypeOf(path: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const p = path.toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * AI 한 번에 보내는 PDF 조각의 최대 크기. Claude 요청은 32MB까지이고 PDF 는 base64 로 보내 4/3 배가 되므로 20MB 로 둔다.
 * 이보다 큰 PDF 는 처음 한 번 조각으로 나눠 저장하고, 단계마다 조각 하나만 받는다. (KOK_PDF_PART_MAX_BYTES 는 시험용)
 */
function pdfPartMaxBytes(): number {
  const v = Number(process.env.KOK_PDF_PART_MAX_BYTES);
  return Number.isFinite(v) && v > 0 ? v : 20 * 1024 * 1024;
}

type PdfPart = { start: number; end: number; path: string };

function pdfPartsOf(src: SourceRow): PdfPart[] | null {
  const v = src.draft.pdfParts;
  return Array.isArray(v) && v.length ? (v as PdfPart[]) : null;
}

async function download(admin: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(SOURCES_BUCKET).download(path);
  if (error || !data) {
    throw new UserFacingError('file_missing', '올린 파일을 찾을 수 없어요. 다시 올려 주세요.', 404);
  }
  return new Uint8Array(await data.arrayBuffer());
}

type Ctx = {
  admin: SupabaseClient;
  src: SourceRow;
  acc: Account;
  app: AppSettings;
  settings: UserSettings;
  /** 이때까지 끝내야 한다 (ms, 서버 함수 한 번의 끝) */
  deadline: number;
};

function modelFor(ctx: Ctx, task: AiTask): string {
  const tier =
    task === 'visual' || task === 'redraw' || task === 'cover'
      ? ctx.settings.models.visual
      : task === 'quiz' || task === 'check' || task === 'solve'
        ? ctx.settings.models.quiz
        : ctx.settings.models.organize;
  return modelForTier(ctx.app.models, tier, ctx.acc.canCareful, ctx.acc.isAdmin);
}

/** AI 를 기다릴 수 있는 가장 짧은 시간: 이보다 적게 남았으면 부르지 않고 새 요청으로 넘긴다 */
const MIN_AI_WAIT_MS = 20_000;

/**
 * 이번 요청(서버 함수 한 번)에 남은 시간이 AI 를 기다리기에 모자라다: 단계를 그대로 두고 새 요청에서 처음부터 한다.
 * (부르고 나서 함수가 끊기면 단계가 잠긴 채 5분 동안 멈춘다.) runOneStep 이 받아 시도로 세지 않고 'handoff'.
 * 단계 안에서 실패를 삼키는 곳(그림 자리 찾기·다시 그리기·원래 문제·검사·그림 풀이·표지)은 이것을 그대로 던진다 (passHandoff)
 */
class StepHandoff extends Error {
  constructor() {
    super('step_handoff');
    this.name = 'StepHandoff';
  }
}

/** 실패를 삼키는 catch 에서 먼저 부른다: 시간이 모자라 넘기는 것은 실패가 아니다 */
function passHandoff(e: unknown): void {
  if (e instanceof StepHandoff) throw e;
}

async function ai(ctx: Ctx, task: AiTask, content: ContentPart[], schema: Record<string, unknown>, maxTokens: number, think = false) {
  const model = modelFor(ctx, task);
  // 답이 길 수 있는 만큼 기다린다 (느린 모델로 긴 정리도 끝나게). 서버 함수가 끝나기 전까지만
  const left = ctx.deadline - Date.now() - 8_000;
  if (left < MIN_AI_WAIT_MS) throw new StepHandoff();
  try {
    const timeoutMs = Math.min(aiWaitMs(maxTokens), left);
    const res = await callJson({ model, effort: ctx.app.models.effort[task], content, schema, maxTokens, maxRetries: 0, timeoutMs, think });
    await charge(ctx.admin, {
      acc: ctx.acc,
      task,
      model: res.model,
      usage: res.usage,
      usdPerEnergy: ctx.app.limits.usdPerEnergy,
      sourceId: ctx.src.id,
    });
    return res.json;
  } catch (e) {
    const usage = usageOf(e);
    if (usage) {
      await charge(ctx.admin, { acc: ctx.acc, task, model, usage, usdPerEnergy: ctx.app.limits.usdPerEnergy, sourceId: ctx.src.id });
    }
    throw e;
  }
}

// ------------------------------------------------------------- AI 같이 부르기
// 서로 상관없는 AI 일(정리 조각들·원래 문제 꺼내기·그림 다시 그리기·마인드맵과 문제·검사와 그림 풀이와 표지)은 같이 불러
// 기다리는 시간을 줄인다. 같이 부른 일이 요청 한도·바쁨에 걸리면 이 자료는 남은 일을 하나씩 부른다 (draft.solo)

/** AI 서버가 바쁘거나 요청 한도에 걸렸다 (잠깐 뒤 다시 하면 된다) */
function busyError(e: unknown): boolean {
  return e instanceof AiCallError && e.kind === 'retryable';
}

/** 이 자료에서 한 번에 같이 부를 AI 수 (같이 부른 일이 한도에 걸렸던 자료는 1) */
function parallelOf(ctx: Ctx): number {
  return ctx.src.draft.solo === true ? 1 : aiParallel();
}

/** n 번째로 같이 부르는 일은 조금씩 늦게 시작한다 (먼저 부른 이 단계의 일이 먼저 들어가게) */
function staggered<T>(n: number, run: () => Promise<T>): Promise<T> {
  return n > 0 ? sleep(n * STAGGER_MS).then(run) : run();
}

/**
 * 단계가 실패하더라도 남길 것 (같이 정리해 둔 뒤 조각, 한도에 걸린 표시 등).
 * runOneStep 의 실패 처리가 ctx.src.draft 를 저장하므로 거기에 더한다 (다시 할 때 같은 AI 를 또 부르지 않게)
 */
function carry(ctx: Ctx, add: Record<string, unknown>): void {
  if (Object.keys(add).length) ctx.src.draft = { ...ctx.src.draft, ...add };
}

/** 같이 부른 일에서 시간이 모자라 넘긴 것 */
function isHandoff(e: unknown): boolean {
  return e instanceof StepHandoff;
}

/** 노트 번호(k1, k2 …)가 비었거나 겹치면 고친다. 개념은 maxKeyPoints 개까지 (기본은 노트 끝 KEY_POINTS_MAX) */
export function normalizeNote(note: Note, maxKeyPoints = KEY_POINTS_MAX): Note {
  const seen = new Set<string>();
  const remap = new Map<string, string>();
  const key_points = note.key_points.slice(0, maxKeyPoints).map((kp, i) => {
    let id = (kp.id || '').trim();
    if (!id || seen.has(id)) id = `k${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    if (kp.id && kp.id !== id) remap.set(kp.id, id);
    return { ...kp, id };
  });
  const fix = (kid: string) => remap.get(kid) ?? kid;
  return {
    ...note,
    key_points,
    pitfalls: note.pitfalls.map((p) => ({ ...p, key_point_id: fix(p.key_point_id) })),
    examples: note.examples.map((p) => ({ ...p, key_point_id: fix(p.key_point_id) })),
  };
}

export { cleanMindmap, maxNodesFor };

// ------------------------------------------------------------- 자료 그림
/** 다시 그린 그림 한 장의 답 길이 (지도는 영토·길 좌표가 많아 길다) */
const REDRAW_OUT_TOKENS = 8000;
/** 정리할 때 찾은 그림 하나가 늘리는 답 길이 (종류·이름·설명·시험 포인트·네 모서리) */

/** 자료 그림을 찾지 않는 까닭 (찾으면 null): 그림 없는 글 자료·설정에서 끔·DB 에 칸이 없음 (schema.sql 을 다시 실행하기 전에는 예전처럼) */
async function sourceFiguresOff(ctx: Ctx): Promise<FigureLog['skipped'] | null> {
  if (ctx.src.kind === 'text' && !docPictureCount(ctx.src)) return 'text';
  if (!ctx.settings.quiz.sourceFigures) return 'setting_off';
  return (await getFeatures(ctx.admin)).sourceFigures ? null : 'db_outdated';
}

/**
 * 자료 그림이 어디까지 됐는지 (노트의 body.figure_log 로 남겨 관리자가 노트 화면에서 본다: 그림이 없을 때 까닭을 알 수 있게).
 * looked: 그림을 찾으라고 한 조각 수, found: AI 가 찾은 그림, cut: 잘라 저장한 그림, missed: 쪽을 보여 줬는데 끝내 못 찾은 그림 (뺐다),
 * questions: 그림 문제, errors: 자르기·저장·자리 찾기 오류 (3개까지)
 */
export type FigureLog = {
  looked: number;
  skipped?: 'text' | 'setting_off' | 'db_outdated' | 'last_try' | 'full';
  found: number;
  cut: number;
  missed?: number;
  questions?: number;
  errors: string[];
};

function figLogOf(draft: Record<string, unknown>): FigureLog {
  const v = (draft.figLog ?? {}) as Partial<FigureLog>;
  return {
    looked: Number(v.looked ?? 0),
    skipped: v.skipped,
    found: Number(v.found ?? 0),
    cut: Number(v.cut ?? 0),
    ...(Number(v.missed ?? 0) ? { missed: Number(v.missed) } : {}),
    errors: Array.isArray(v.errors) ? v.errors.slice(0, 3) : [],
  };
}

function logError(log: FigureLog, e: unknown) {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (log.errors.length < 3) log.errors.push(m.slice(0, 200));
}

/** 정리하는 동안 자른 그림 (개념은 아직 이름으로: 조각마다 개념 번호가 달라서) */
function cutsOf(draft: Record<string, unknown>): CutFigure[] {
  return Array.isArray(draft.figCuts) ? (draft.figCuts as CutFigure[]) : [];
}

/** 노트가 정해진 뒤의 자료 그림 (개념 번호가 붙은 것, Pro 는 다시 그린 그림도) */
function draftFigures(draft: Record<string, unknown>): SourceFigure[] {
  return readFigures({ figures: draft.figures });
}

/** 노트가 정해진 다음 단계: Pro 이고 다시 그릴 그림(지도·그래프·표·연표·도식)이 있으면 그림 다시 그리기, 아니면 그림(마인드맵) */
function afterNote(ctx: Ctx, figures: SourceFigure[]): 'figures' | 'visual' {
  return ctx.acc.canRedraw && figures.some((f) => canRedraw(f.kind) && !f.art) ? 'figures' : 'visual';
}

/** 그림을 자를 원본: AI 에 보낸 PDF 조각(첫 쪽의 원래 쪽 번호와 함께) 또는 사진들(원래 사진 번호마다) */
type FigureHolder = { kind: 'pdf'; bytes: Uint8Array; firstPage: number } | { kind: 'image'; photos: Map<number, Uint8Array> };

/**
 * 정리 단계에서 찾고 아직 자리를 찾지 않은 그림 (그 조각 번호와 쪽 범위와 함께).
 * from·to: 그 조각의 쪽(사진) 범위 (그림을 찾아볼 범위, 예전 자료는 없다), fails: AI 가 바빠 찾지 못한 수
 */
type PendingCut = { chunk: number; from?: number; to?: number; found: FoundFigure[]; fails?: number };

function pendingOf(draft: Record<string, unknown>): PendingCut | null {
  const v = draft.figFound as Partial<PendingCut> | null | undefined;
  if (!v || !Number.isInteger(v.chunk) || !Array.isArray(v.found)) return null;
  return { chunk: Number(v.chunk), from: v.from, to: v.to, found: v.found, fails: Number(v.fails ?? 0) };
}

/** 자리 찾기를 해 보는 수 (그리다가 함수가 멈추면 다음 번에 한 번 더, 그래도 안 되면 그 묶음은 뺀다) */
const CUT_TRIES = 2;
/** AI 서버가 바빠 자리를 찾지 못했을 때 다시 해 보는 수 (넘으면 그 묶음은 뺀다: 그림 때문에 노트가 멈추지 않게) */
const LOCATE_FAILS_MAX = 2;

/** 그림을 자를 원본을 다시 받는다: PDF 는 나눠 둔 조각(있으면) 또는 원본 파일, 사진은 보여 줄 사진만 */
async function holderFor(ctx: Ctx, chunk: number, pages: number[]): Promise<FigureHolder | null> {
  const { src, admin } = ctx;
  if (src.kind === 'pdf') {
    const parts = pdfPartsOf(src);
    if (parts) {
      const part = parts[Math.min(chunk, parts.length - 1)];
      return { kind: 'pdf', bytes: await download(admin, part.path), firstPage: part.start };
    }
    // 나누지 않은 PDF: 원본의 같은 쪽을 그린다 (쪽 번호가 원래 번호 그대로)
    return { kind: 'pdf', bytes: await download(admin, src.file_paths[0]), firstPage: 1 };
  }
  if (src.kind === 'image') {
    const photos = new Map<number, Uint8Array>();
    for (const n of new Set(pages)) {
      const path = src.file_paths[n - 1];
      if (path) photos.set(n, await download(admin, path));
    }
    return { kind: 'image', photos };
  }
  return null;
}

/** 조각의 쪽(사진) 범위: 정리할 때 적어 둔 것, 예전 자료는 조각에서 다시 센다 */
function pendingRange(src: SourceRow, p: PendingCut): { from: number; to: number } {
  if (Number.isInteger(p.from) && Number.isInteger(p.to)) return { from: Number(p.from), to: Number(p.to) };
  if (src.kind === 'pdf') {
    const parts = pdfPartsOf(src);
    const c = parts ? parts[Math.min(p.chunk, parts.length - 1)] : planChunks(src.page_count ?? 1)[p.chunk];
    if (c) return { from: c.start, to: c.end };
  }
  const pages = p.found.map((f) => f.page);
  return { from: Math.min(...pages), to: Math.max(...pages) };
}

/** 그려 둔 쪽들 (PDF 는 한 번 열어 여러 쪽을). 그리지 못한 쪽은 뺀다 */
async function openPages(holder: FigureHolder, pages: number[], log: FigureLog): Promise<FindPage[]> {
  const out: FindPage[] = [];
  if (holder.kind === 'pdf') {
    try {
      const drawn = await openPdfPages(
        holder.bytes,
        pages.map((p) => p - holder.firstPage + 1),
      );
      drawn.forEach((fp, k) => {
        if (fp) out.push({ page: pages[k], fp });
      });
    } catch (e) {
      console.warn('[kok] figure pages could not be drawn', pages, e);
      logError(log, e);
    }
    return out;
  }
  for (const page of pages) {
    const bytes = holder.photos.get(page);
    if (!bytes) continue;
    try {
      out.push({ page, fp: await openFigurePage({ kind: 'image', bytes }) });
    } catch (e) {
      console.warn('[kok] figure photo could not be read', page, e);
      logError(log, e);
    }
  }
  return out;
}

/** 쪽 하나씩 읽은 인쇄된 쪽 번호 (그림을 찾을 때 AI 가 읽은 것: 노트의 쪽 표시에 쓴다) */
function anchorsOf(draft: Record<string, unknown>): PageAnchor[] {
  const v = draft.pageAnchors;
  if (!Array.isArray(v)) return [];
  return v.filter(
    (a): a is PageAnchor => !!a && typeof a === 'object' && Number.isInteger((a as PageAnchor).page) && Number.isInteger((a as PageAnchor).printed),
  );
}

function addAnchors(list: PageAnchor[], pages: FindPage[], printed: number[]): PageAnchor[] {
  const out = [...list];
  pages.forEach((p, k) => {
    if (printed[k] > 0 && !out.some((a) => a.page === p.page)) out.push({ page: p.page, printed: printed[k] });
  });
  return out.slice(-200);
}

/**
 * 자료 그림 자리 찾기와 자르기: 정리 단계에서 찾은 그림을, 그 쪽을 그림으로 그려 AI 에 보여 주고(픽셀 상자) 원본에서 잘라 저장한다.
 * 한 번 부를 때 묶음 하나(같은 쪽이라고 한 그림들)만: 처음에는 그 쪽만, 없으면 가까운 쪽부터 SEARCH_BATCH 쪽씩 (조각 안에서,
 * AI 한 번에 묻는 수는 SEARCH_CALLS_MAX 까지). 끝내 없으면 그 그림은 뺀다 (엉뚱한 곳을 자른 그림을 두지 않게).
 * 자르거나 찾다가 안 돼도 노트는 만든다. 한 조각짜리 자료면 다 찾은 뒤 그림을 개념에 붙이고 다음 단계를 정한다
 */
async function stepCutFigures(ctx: Ctx): Promise<Partial<SourceRow>> {
  const { src } = ctx;
  const pending = pendingOf(src.draft);
  const tries = Number(src.draft.figCutTries ?? 0);
  let cuts = cutsOf(src.draft);
  const log = figLogOf(src.draft);
  let anchors = anchorsOf(src.draft);
  let left: FoundFigure[] = pending ? [...pending.found] : [];
  let fails = pending?.fails ?? 0;

  if (pending && left.length) {
    const lead = left[0];
    const calls = Number(lead.calls ?? 0);
    // 같은 쪽이라고 한, 아직 같은 만큼 찾아본 그림들을 한 번에
    const group = left.filter((f) => f.page === lead.page && Number(f.calls ?? 0) === calls);
    const range = pendingRange(src, pending);
    const pages =
      src.kind === 'image'
        ? calls
          ? []
          : [lead.page]
        : calls >= SEARCH_CALLS_MAX
          ? []
          : nextPages({
              claimed: lead.page,
              hints: [...new Set(group.flatMap((f) => f.hints ?? []))],
              from: range.from,
              to: range.to,
              tried: lead.tried ?? [],
              batch: calls ? SEARCH_BATCH : 1,
            });
    const drop = (why: string | null) => {
      left = left.filter((f) => !group.includes(f));
      if (why) logError(log, why);
      else log.missed = (log.missed ?? 0) + group.length;
    };
    // 볼 쪽을 다 봤는데 없다: 그 그림은 뺀다 (오류가 아니라 AI 가 정리할 때 잘못 찾은 그림)
    if (!pages.length) drop(null);
    else if (tries >= CUT_TRIES) {
      // 두 번 해 봐도 끝나지 않았다 (그리다가 함수가 멈춤): 이 묶음은 뺀다
      console.warn('[kok] figure locate gave up after tries', src.id, lead.page);
      drop('locate stopped twice (time limit?)');
    } else {
      // 해 보는 수를 먼저 적어 둔다: 그리다가 함수가 멈춰도 다음에는 그만하게
      await ctx.admin
        .from('sources')
        .update({ draft: { ...src.draft, figCutTries: tries + 1 } })
        .eq('id', src.id);
      try {
        const holder = await holderFor(ctx, pending.chunk, pages);
        const shown = holder ? await openPages(holder, pages, log) : [];
        // 쪽을 하나도 그리지 못했다: 본 것으로 치고 다음 쪽들을 본다 (다 보면 뺀다)
        if (!shown.length) left = left.map((f) => (group.includes(f) ? { ...f, tried: [...new Set([...(f.tried ?? []), ...pages])], calls: calls + 1 } : f));
        else {
          const found = await locateOnPages({
            kind: src.kind === 'image' ? 'image' : 'pdf',
            pages: shown,
            asks: group.map((f) => ({ kind: f.kind, title: f.title, caption: f.caption })),
            call: (content, schema, maxTokens) => ai(ctx, 'locate', content, schema, maxTokens),
          });
          anchors = addAnchors(anchors, shown, found.printed);
          fails = 0;
          const done = new Set<FoundFigure>();
          for (let k = 0; k < group.length; k++) {
            const hit = found.hits[k];
            if (!hit) continue;
            const at = shown[hit.at];
            done.add(group[k]);
            const cut = await cutOnPage(at.fp, hit.quad).catch((e) => {
              console.warn('[kok] figure cut failed', src.id, at.page, e);
              return null;
            });
            if (!cut) {
              logError(log, 'bad box');
              continue;
            }
            const path = figurePath(src.user_id, src.id, cuts.length + 1);
            const { error } = await ctx.admin.storage.from(SOURCES_BUCKET).upload(path, cut.jpeg, { contentType: 'image/jpeg', upsert: true });
            if (error) {
              console.warn('[kok] figure upload failed', src.id, error.message);
              logError(log, `upload: ${error.message}`);
              continue;
            }
            const printed = found.printed[hit.at];
            const { tried: _t, calls: _c, hints: _h, corners: _o, ...fig } = group[k];
            void _t;
            void _c;
            void _h;
            void _o;
            cuts = [...cuts, { ...fig, page: at.page, ...(printed > 0 ? { printed } : {}), crop: path, w: cut.width, h: cut.height }];
            log.cut++;
          }
          // 찾지 못한 그림은 본 쪽을 적고 다음 번에 가까운 쪽을 더 본다
          const seen = shown.map((p) => p.page);
          left = left
            .filter((f) => !done.has(f))
            .map((f) => (group.includes(f) ? { ...f, tried: [...new Set([...(f.tried ?? []), ...pages, ...seen])], calls: calls + 1 } : f));
        }
      } catch (e) {
        passHandoff(e);
        if (e instanceof UserFacingError) throw e;
        if (e instanceof AiCallError && e.kind === 'retryable' && fails + 1 < LOCATE_FAILS_MAX) {
          // AI 서버가 잠깐 바쁘다: 다음 번에 같은 쪽을 다시 본다
          fails++;
          console.warn('[kok] figure locate busy, will retry', src.id, e.message);
        } else {
          console.warn('[kok] figure locate failed, dropping these figures', src.id, e);
          drop(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
          fails = 0;
        }
      }
    }
  }

  const draft: Record<string, unknown> = { ...src.draft, figCuts: cuts, figLog: log, pageAnchors: anchors };
  delete draft.figCutTries;
  if (pending && left.length) {
    draft.figFound = { ...pending, found: left, fails };
    return { draft };
  }
  delete draft.figFound;
  // 한 조각짜리 자료: 노트가 정해졌으니 그림을 개념에 붙이고 다음 단계를 정한다
  if (src.step === 'visual' && draft.note) {
    const figures = toSourceFigures(cuts, (draft.note as Note).key_points);
    draft.figures = figures;
    delete draft.figCuts;
    return { step: afterNote(ctx, figures), draft };
  }
  return { draft };
}

/** 자른 그림 한 장을 KOK 스타일 설계도로 (AI 한 번). 자른 그림 파일이 없으면 null (원본도 없으니 다시 그리지 않는다) */
async function redrawOne(ctx: Ctx, f: SourceFigure): Promise<ReturnType<typeof normalizeArt>> {
  const kind = f.kind;
  if (!canRedraw(kind)) return null;
  let bytes: Uint8Array;
  try {
    bytes = await download(ctx.admin, f.crop);
  } catch (e) {
    console.warn('[kok] redraw: crop missing', ctx.src.id, f.crop, e);
    return null;
  }
  const json = await ai(ctx, 'redraw', [imageBlock(bytes, 'image/jpeg'), textBlock(redrawPrompt({ kind }))], artJsonSchema(kind), REDRAW_OUT_TOKENS);
  return normalizeArt(kind, json);
}

/** 글 목록 칸 (예전 자료·이상한 값은 빈 목록) */
function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 이름마다 센 수 */
function countMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (Number.isFinite(Number(n))) out[k] = Number(n);
  return out;
}

/** 다시 그리기를 마친 그림 표시를 지운다 (그림 단계를 끝내거나 다시 합칠 때) */
function dropRedrawMarks(draft: Record<string, unknown>): Record<string, unknown> {
  delete draft.figRound;
  delete draft.figDone;
  delete draft.figFails;
  return draft;
}

/**
 * 그림 다시 그리기 (Pro): 아직 다시 그리지 않은 지도·그래프·표·연표·도식을 KOK 스타일로 다시 그린다 (한 번 부를 때 몇 장을 같이: 장마다 AI 한 번).
 * 못 그려도 원본 그림은 그대로 쓴다. 다시 그려 본 그림(못 그린 것도)은 draft.figDone(자른 그림 파일)에 적는다.
 * AI 서버가 바쁘면: 모두 바빴으면 조금 쉬었다가 다시(시도로 센다, 마지막 시도면 원본만), 몇 장만 바빴으면 그 그림을 다음 번에 한 번 더.
 * 다 그리면 그림(마인드맵) 단계로
 */
async function stepFigures(ctx: Ctx): Promise<Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const figures = draftFigures(ctx.src.draft);
  // 예전 자료(한 장씩 그리던 때)는 그린 차례(figRound) 앞의 그림을 건너뛴다
  const from = Number(ctx.src.draft.figRound ?? 0);
  const done = new Set(stringList(ctx.src.draft.figDone));
  const fails = countMap(ctx.src.draft.figFails);
  const open = (f: SourceFigure, i: number) => i >= from && canRedraw(f.kind) && !f.art && !done.has(f.crop);
  const todo = ctx.acc.canRedraw ? figures.map((f, i) => ({ f, i })).filter(({ f, i }) => open(f, i)) : [];
  if (!todo.length) return { step: 'visual', progress: 72, draft: dropRedrawMarks({ ...ctx.src.draft, attempts: 0 }) };

  const batch = todo.slice(0, parallelOf(ctx));
  const settled = await Promise.allSettled(batch.map(({ f }, n) => staggered(n, () => redrawOne(ctx, f))));
  const lastTry = Number(ctx.src.draft.attempts ?? 0) >= MAX_ATTEMPTS - 1;
  const next = [...figures];
  let drawn = 0;
  let gaveUp = 0;
  let handedOff = 0;
  let busy: unknown = null;
  let solo = false;
  settled.forEach((r, n) => {
    const { f, i } = batch[n];
    if (r.status === 'fulfilled') {
      next[i] = { ...f, art: r.value };
      done.add(f.crop);
      drawn++;
      return;
    }
    const e = r.reason;
    // 시간이 모자라 시작하지 않았다: 다음 번에 그대로
    if (isHandoff(e)) {
      handedOff++;
      return;
    }
    if (e instanceof UserFacingError) throw e;
    if (busyError(e)) {
      busy = e;
      if (n > 0) solo = true;
      fails[f.crop] = (fails[f.crop] ?? 0) + 1;
      return;
    }
    // 다시 그리지 못해도 원본 그림으로 노트를 만든다 (다시 그린 그림은 더해 주는 것일 뿐)
    console.warn('[kok] redraw failed, keeping the original only', ctx.src.id, f.id, e);
    done.add(f.crop);
    gaveUp++;
  });
  if (handedOff === batch.length) throw new StepHandoff();
  // 모두 AI 서버가 바빴다: 조금 쉬었다가 같은 그림들을 다시 (마지막 시도에서는 던지지 않아 자료가 실패하지 않는다)
  if (busy && !drawn && !gaveUp && !lastTry) {
    carry(ctx, solo ? { solo: true } : {});
    throw busy;
  }
  // 두 번 바빴던 그림·마지막 시도에서 바빴던 그림은 원본만
  for (const { f } of batch) if (!done.has(f.crop) && (fails[f.crop] ?? 0) > 0 && ((fails[f.crop] ?? 0) >= 2 || lastTry)) done.add(f.crop);
  const left = figures.filter((f, i) => open(f, i) && !next[i].art);
  const progress = Math.min(72, Math.max(ctx.src.progress, 66) + 2 * Math.max(1, batch.length - handedOff));
  if (!left.length)
    return { step: 'visual', progress, draft: dropRedrawMarks({ ...ctx.src.draft, figures: next, attempts: 0, ...(solo ? { solo: true } : {}) }) };
  const draft: Record<string, unknown> = { ...ctx.src.draft, figures: next, figDone: [...done], figFails: fails, attempts: 0 };
  if (solo) draft.solo = true;
  return { step: 'figures', progress, draft };
}

// ------------------------------------------------------------- 자료 종류 (lib/material-type.ts)
/** 학생이 자료 넣기 창에서 고른 종류 ('auto' 면 AI 가 조각마다 고른다) */
function pickOf(draft: Record<string, unknown>) {
  return readMaterialPick(draft.materialPick);
}

/** 이 자료(노트에 더하는 자료면 더한 자료)의 종류: 학생이 고른 것, 아니면 조각들 가운데 양이 반을 넘는 종류 (섞였으면 general) */
function materialOf(draft: Record<string, unknown>): MaterialType {
  return noteMaterialType(readPartTypes(draft.partTypes), pickOf(draft));
}

/** 조각(partials)마다 단어장인지: 합칠 때 단어장 조각의 용어·예문은 앱이 옮긴다. 조각 수가 맞지 않으면 자료 전체의 종류로 */
function wordListParts(draft: Record<string, unknown>, n: number): boolean[] {
  const pick = pickOf(draft);
  const types = readPartTypes(draft.partTypes);
  if (pick === 'auto' && types.length === n) return types.map((t) => t.type === 'vocab');
  const all = materialOf(draft) === 'vocab';
  return Array.from({ length: n }, () => all);
}

/** 원래 문제를 꺼낼 곳 (정리할 때 기출·문제집으로 고른 조각을 몇 쪽씩: lib/material-questions.ts ProblemsJob) */
function problemsTodo(draft: Record<string, unknown>): ProblemsJob[] {
  return readJobs(draft.problemsTodo);
}

/** 조각 글 (글 자료의 원래 문제 꺼내기: 일의 범위가 이 글의 글자 자리) */
function chunkText(src: SourceRow, i: number): string {
  return src.kind === 'text' ? (textChunks(src.text_content ?? '', docPictureCount(src) > 0)[i] ?? '') : '';
}

/** 꺼낸 원래 문제 */
function originalsOf(draft: Record<string, unknown>): MaterialQuestion[] {
  const v = draft.originals;
  return Array.isArray(v) ? (v as MaterialQuestion[]).filter((x) => !!x && typeof x === 'object' && typeof x.prompt === 'string') : [];
}

/**
 * 원래 문제를 꺼낼 차례인지: 노트가 정해졌고(합치기·자료 그림 자르기 뒤) 꺼낼 조각이 남았을 때.
 * 마인드맵·문제보다 먼저 (문제 단계가 원래 문제와 겹치지 않게 만든다)
 */
function problemsDue(src: SourceRow): boolean {
  return !!src.draft.note && !src.draft.figFound && problemsTodo(src.draft).length > 0 && (src.step === 'figures' || src.step === 'visual');
}

/** 원래 문제 꺼내기: 정리 때와 같은 조각 안의 한 부분 (PDF 쪽들·사진들·글과 그 글의 문서 속 그림) */
async function chunkMaterial(ctx: Ctx, job: ProblemsJob): Promise<{ content: ContentPart[]; meta: Parameters<typeof problemsPrompt>[0]; size: PartSize }> {
  const { src, admin } = ctx;
  const i = job.chunk;
  const content: ContentPart[] = [];
  /** 조각 안의 n 개 가운데 이 일의 범위 [from, to) */
  const span = (n: number) => {
    const from = Math.min(Math.max(0, job.from), Math.max(0, n - 1));
    return { from, to: Math.min(Math.max(job.to, from + 1), n) };
  };
  if (src.kind === 'pdf') {
    const parts = pdfPartsOf(src);
    // 큰 PDF 는 나눠 둔 조각(쪽 1부터), 아니면 원본에서 조각의 쪽을 자른다
    const part = parts ? parts[Math.min(i, parts.length - 1)] : null;
    const chunks = part ? [] : planChunks(src.page_count ?? 1);
    const c = part ?? chunks[Math.min(i, chunks.length - 1)];
    const { from, to } = span(c.end - c.start + 1);
    const bytes = await download(admin, part ? part.path : src.file_paths[0]);
    content.push(pdfBlock(await slicePdf(bytes, part ? from + 1 : c.start + from, part ? to : c.start + to - 1)));
    return {
      content,
      meta: { kind: 'pdf', pageStart: c.start + from, pageEnd: c.start + to - 1, figures: false },
      size: { kind: 'pdf', pages: to - from },
    };
  }
  if (src.kind === 'image') {
    const all = src.file_paths.slice(i * IMAGES_PER_CHUNK, (i + 1) * IMAGES_PER_CHUNK);
    const { from, to } = span(all.length);
    const paths = all.slice(from, to);
    const start = i * IMAGES_PER_CHUNK + from + 1;
    for (let k = 0; k < paths.length; k++) {
      content.push(textBlock(`Photo ${start + k}:`));
      content.push(imageBlock(await download(admin, paths[k]), mediaTypeOf(paths[k])));
    }
    return {
      content,
      meta: { kind: 'image', imageStart: start, imageEnd: start + paths.length - 1, figures: false },
      size: { kind: 'image', images: paths.length },
    };
  }
  const parts = textChunks(src.text_content ?? '', docPictureCount(src) > 0);
  const text = (parts[Math.min(i, parts.length - 1)] ?? '').slice(job.from, job.to);
  content.push(textBlock(wrap('material', text)));
  const nums = pictureNumbers(text).filter((n) => n <= docPictureCount(src));
  for (const n of nums) {
    content.push(textBlock(`Picture ${n}:`));
    content.push(imageBlock(await download(admin, src.file_paths[n - 1]), mediaTypeOf(src.file_paths[n - 1])));
  }
  return {
    content,
    meta: { kind: 'text', ...(nums.length ? { pictures: nums } : {}), figures: false },
    size: { kind: 'text', chars: text.length, images: nums.length },
  };
}

/** 그림이 이 조각의 쪽(사진·문서 속 그림 번호)에 있는지 */
function figureInChunk(f: SourceFigure, meta: Parameters<typeof problemsPrompt>[0]): boolean {
  if (meta.kind === 'pdf') return f.page >= (meta.pageStart ?? 0) && f.page <= (meta.pageEnd ?? 0);
  if (meta.kind === 'image') return f.page >= (meta.imageStart ?? 0) && f.page <= (meta.imageEnd ?? 0);
  return !!meta.pictures?.includes(f.page);
}

/**
 * 원래 문제 꺼내기 (기출·문제집 조각 하나, AI 한 번): 자료의 문제를 그대로 문제로. 이 조각에 자료 그림이 있으면 그 그림이 필요한 문제도.
 * 못 꺼내도 노트는 그대로 만든다 (UserFacingError 만 던지고, AI 가 잠깐 바쁘면 다시 한다). 꺼낸 문제는 검사 단계가 한 번 더 본다
 */
async function stepProblems(ctx: Ctx): Promise<Partial<SourceRow>> {
  const todo = problemsTodo(ctx.src.draft);
  const note = zNote.parse(ctx.src.draft.note);
  const prev = originalsOf(ctx.src.draft);
  const room = ORIGINALS_MAX - prev.length;
  const progress = (n: number) => Math.min(72, Math.max(ctx.src.progress, 64) + n);
  // 노트의 문제 수 끝만큼 꺼냈다
  if (room <= 0) return { progress: progress(1), draft: { ...ctx.src.draft, problemsTodo: [], attempts: 0 } };

  // 몇 부분을 같이 꺼낸다 (부분마다 AI 한 번). 꺼낸 문제는 차례대로 더한다: 앞 부분과 겹치는 문제는 빼고, 노트의 끝까지만
  const batch = todo.slice(0, parallelOf(ctx));
  const settled = await Promise.allSettled(batch.map((job, n) => staggered(n, () => askProblems(ctx, job, note))));
  const lastTry = Number(ctx.src.draft.attempts ?? 0) >= MAX_ATTEMPTS - 1;
  let found: MaterialQuestion[] = [];
  const again: ProblemsJob[] = [];
  let took = 0;
  let busy: unknown = null;
  let solo = false;
  let handedOff = 0;
  settled.forEach((r, n) => {
    const job = batch[n];
    if (r.status === 'fulfilled') {
      took++;
      const { json, crops } = r.value;
      // 그림 문제는 그림 파일도 적어 둔다 (노트에 더할 때 다시 합치면 그림 번호가 바뀔 수 있어서 문제 단계가 파일로 다시 찾는다)
      const more = readOriginals(json, { kps: note.key_points, figureIds: new Set(crops.keys()), max: room - found.length, before: [...prev, ...found] });
      found = [...found, ...more.map((o) => (o.figure_id ? { ...o, figure_crop: crops.get(o.figure_id) } : o))];
      return;
    }
    const e = r.reason;
    if (isHandoff(e)) {
      handedOff++;
      again.push(job);
      return;
    }
    if (e instanceof UserFacingError && e.code !== 'file_missing') throw e;
    if (busyError(e)) {
      // AI 서버가 바빴다: 다음 번에 다시 (마지막 시도에서는 그 부분만 빼고 넘어간다: 노트는 그대로)
      busy = e;
      if (n > 0) solo = true;
      if (!lastTry) again.push(job);
      else console.warn('[kok] original questions skipped (AI busy)', ctx.src.id, job);
      return;
    }
    // 답이 잘렸다 (문제가 많은 쪽): 반으로 나눠 다시 꺼낸다. 쪽 하나·사진 한 장·짧은 글이면 그 부분만 빼고 넘어간다
    const halves = e instanceof AiCallError && e.truncated ? halveJob(job, ctx.src.kind === 'text' ? chunkText(ctx.src, job.chunk) : undefined) : null;
    if (halves) again.push(...halves);
    else console.warn('[kok] could not take out the original questions, keeping the note', ctx.src.id, job, e);
  });
  if (handedOff === batch.length) throw new StepHandoff();
  // 모두 AI 서버가 바빠 꺼내지 못했다: 조금 쉬었다가 같은 부분들을 다시 (시도로 센다)
  if (busy && !took && !lastTry && again.length === batch.length) {
    carry(ctx, solo ? { solo: true } : {});
    throw busy;
  }
  const draft: Record<string, unknown> = {
    ...ctx.src.draft,
    originals: [...prev, ...found],
    problemsTodo: [...again, ...todo.slice(batch.length)],
    attempts: 0,
  };
  if (solo) draft.solo = true;
  return { progress: progress(Math.max(1, took)), draft };
}

/** 원래 문제 꺼내기 한 부분 (AI 한 번): 이 부분의 자료 + 노트의 개념 이름 + 이 조각의 자료 그림 설명 */
async function askProblems(ctx: Ctx, job: ProblemsJob, note: Note): Promise<{ json: unknown; crops: Map<string, string> }> {
  const { content, meta, size } = await chunkMaterial(ctx, job);
  const figs = draftFigures(ctx.src.draft).filter((f) => figureInChunk(f, meta));
  content.push(textBlock(wrap('note', JSON.stringify(note.key_points.map((k) => ({ id: k.id, title: k.title }))))));
  if (figs.length) content.push(textBlock(wrap('figures', JSON.stringify(figuresForPrompt(figs)))));
  content.push(textBlock(problemsPrompt({ ...meta, figures: figs.length > 0 })));
  const json = await ai(ctx, 'problems', content, problemsJsonSchema({ figures: figs.length > 0 }), problemsOutTokens(size));
  return { json, crops: new Map(figs.map((f) => [f.id, f.crop])) };
}

// ------------------------------------------------------------- 단계별 작업
/** 큰 PDF 를 조각으로 나눠 `내id/자료id/parts/001.pdf …` 에 저장한다 (정리가 끝나면 지운다) */
async function storePdfParts(ctx: Ctx, original: Uint8Array): Promise<PdfPart[]> {
  const bucket = ctx.admin.storage.from(SOURCES_BUCKET);
  const parts: PdfPart[] = [];
  await splitPdfBySize(original, pdfPartMaxBytes(), async (p) => {
    const path = `${ctx.src.user_id}/${ctx.src.id}/parts/${String(parts.length + 1).padStart(3, '0')}.pdf`;
    const { error } = await bucket.upload(path, p.bytes, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`PDF part upload failed: ${error.message}`);
    parts.push({ start: p.start, end: p.end, path });
  });
  return parts;
}

/** 지난 답이 잘린 조각이면 짧게 다시 정리하는 단계 (1: 개념 70%, 2: 개념 반·그림 없이). 다른 조각이면 0 */
function compactLevel(draft: Record<string, unknown>, chunk: number): number {
  const c = draft.compact as { part?: unknown; level?: unknown } | null | undefined;
  return c && Number(c.part) === chunk ? Math.min(2, Math.max(0, Number(c.level) || 0)) : 0;
}

/**
 * 같이 정리해 둔 뒤 조각 (앞 조각과 같이 부른 AI 의 답): 그 조각의 차례가 오면 AI 없이 쓴다.
 * sig: 어느 조각의 답인지 (조각의 자리·수·고른 종류가 지금과 다르면 버리고 다시 정리한다), figures: AI 에 찾으라고 한 그림 수,
 * keyPoints: 그때 정한 개념 수, textNums: PDF 글자에서 읽은 인쇄된 쪽 번호
 */
type AheadEntry = { sig: string; json: unknown; figures: number; keyPoints: Range; textNums: number[] | null };

function aheadOf(draft: Record<string, unknown>): Record<string, AheadEntry> {
  const v = draft.ahead;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, AheadEntry> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const e = raw as Partial<AheadEntry> | null;
    const kp = e?.keyPoints as Partial<Range> | undefined;
    if (!e || typeof e.sig !== 'string' || !('json' in e) || !kp || !(Number(kp.min) >= 1) || !(Number(kp.max) >= Number(kp.min))) continue;
    out[k] = {
      sig: e.sig,
      json: e.json,
      figures: Math.max(0, Math.round(Number(e.figures) || 0)),
      keyPoints: { min: Number(kp.min), max: Number(kp.max) },
      textNums: Array.isArray(e.textNums) ? e.textNums.map((n) => Number(n) || 0) : null,
    };
  }
  return out;
}

/** 조각 하나의 자리와 양 (파일을 받지 않고 정한다): 정리 지시(meta)·양(size)·같이 정리해 둔 답이 이 조각의 것인지 볼 표시(sig) */
type ChunkInfo = {
  meta: MaterialMeta & { keyPoints: Range };
  size: PartSize;
  sig: string;
  /** PDF: 나눠 둔 조각(큰 PDF)과 원래 쪽 범위 */
  pdf?: { part: PdfPart | null; start: number; end: number };
  /** 사진: 이 조각의 사진 파일 */
  photos?: string[];
  /** 글: 이 조각의 글과 그 글에 자리가 있는 문서 속 그림 번호 */
  text?: string;
  pictures?: number[];
};

function chunkInfo(src: SourceRow, i: number): ChunkInfo {
  const meta: MaterialMeta = { title: src.title || '공부 자료', kind: src.kind, part: i + 1, parts: src.chunk_total };
  let info: Omit<ChunkInfo, 'meta' | 'sig'>;
  let where: string;
  if (src.kind === 'pdf') {
    // 큰 PDF 는 나눠 둔 조각(쪽 1부터), 아니면 원본에서 조각의 쪽을 자른다
    const parts = pdfPartsOf(src);
    const part = parts ? parts[Math.min(i, parts.length - 1)] : null;
    const chunks = part ? [] : planChunks(src.page_count ?? 1);
    const c = part ?? chunks[Math.min(i, chunks.length - 1)];
    meta.pageStart = c.start;
    meta.pageEnd = c.end;
    // 쪽마다 인쇄된 쪽 번호도 받는다 (PDF 글자에서 읽었으면 그것을 쓰지만, 스캔 PDF 가 많아서 늘 받는다)
    meta.pageNumbers = true;
    info = { size: { kind: 'pdf', pages: c.end - c.start + 1 }, pdf: { part, start: c.start, end: c.end } };
    where = `${part ? 'part' : 'pages'}:${c.start}-${c.end}`;
  } else if (src.kind === 'image') {
    const photos = src.file_paths.slice(i * IMAGES_PER_CHUNK, (i + 1) * IMAGES_PER_CHUNK);
    meta.imageStart = i * IMAGES_PER_CHUNK + 1;
    meta.imageEnd = i * IMAGES_PER_CHUNK + photos.length;
    info = { size: { kind: 'image', images: photos.length }, photos };
    where = `photos:${meta.imageStart}-${meta.imageEnd}`;
  } else {
    // 학생이 적거나 붙여 넣은 글은 표현을 지키고, 한글·워드·PPT 에서 꺼낸 글(첫 줄 '(파일: …)')은 보통 자료처럼 정리한다
    meta.ownWriting = !isOfficeText(src.text_content);
    const parts = textChunks(src.text_content ?? '', docPictureCount(src) > 0);
    const text = parts[Math.min(i, parts.length - 1)] ?? '';
    const pictures = pictureNumbers(text).filter((n) => n <= docPictureCount(src));
    if (pictures.length) meta.pictures = pictures;
    info = { size: { kind: 'text', chars: text.length, images: pictures.length }, text, pictures };
    where = `text:${text.length}:${pictures.join(',')}`;
  }
  // 자료 종류: 학생이 고른 것이 있으면 그 지침으로, 없으면 AI 가 이 조각을 읽고 고른다 (답의 맨 앞 칸)
  const pick = pickOf(src.draft);
  if (pick !== 'auto') meta.materialPick = pick;
  // 자료 양에 따라 개념 수를 정한다 (조각마다 적어 두고 합칠 때 더한다)
  const keyPoints = keyPointRange(info.size);
  return { ...info, meta: { ...meta, keyPoints }, sig: `${src.kind}|${src.chunk_total}|${i}|${where}|${pick}` };
}

/** PDF 글자에서 읽은 인쇄된 쪽 번호 (노트의 쪽 표시: 글자가 없는 스캔 PDF 는 AI 가 읽은 번호를 쓴다) */
async function printedNumbers(id: string, bytes: Uint8Array): Promise<number[] | null> {
  try {
    return await pdfPrintedNumbers(bytes);
  } catch (e) {
    console.warn('[kok] page numbers skipped', id, e);
    return null;
  }
}

/** 문서 속 그림 (그림 번호 → JPEG) */
async function loadDocPictures(ctx: Ctx, nums: number[]): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  for (const n of nums) out.set(n, await download(ctx.admin, ctx.src.file_paths[n - 1]));
  return out;
}

/** 조각을 AI 에 보낼 모양으로 (파일을 받는다). original: 나누지 않은 PDF 원본 (여러 조각을 같이 정리할 때 한 번만 받는다) */
async function chunkContent(
  ctx: Ctx,
  info: ChunkInfo,
  original: Uint8Array | null,
): Promise<{ content: ContentPart[]; docPics: Map<number, Uint8Array> | null; textNums: number[] | null }> {
  const { src, admin } = ctx;
  const content: ContentPart[] = [];
  if (info.pdf) {
    const bytes = info.pdf.part
      ? await download(admin, info.pdf.part.path)
      : await slicePdf(original ?? (await download(admin, src.file_paths[0])), info.pdf.start, info.pdf.end);
    content.push(pdfBlock(bytes));
    return { content, docPics: null, textNums: await printedNumbers(src.id, bytes) };
  }
  if (info.photos) {
    const start = info.meta.imageStart ?? 1;
    for (let k = 0; k < info.photos.length; k++) {
      content.push(textBlock(`Photo ${start + k}:`));
      content.push(imageBlock(await download(admin, info.photos[k]), mediaTypeOf(info.photos[k])));
    }
    return { content, docPics: null, textNums: null };
  }
  content.push(textBlock(wrap('material', info.text ?? '')));
  // 문서 속 그림: 이 조각에 자리가 있는 그림을 글 뒤에 'Picture N:' 과 함께 보여 준다
  const docPics = info.pictures?.length ? await loadDocPictures(ctx, info.pictures) : null;
  for (const [n, bytes] of docPics ?? []) {
    content.push(textBlock(`Picture ${n}:`));
    content.push(imageBlock(bytes, mediaTypeOf(src.file_paths[n - 1])));
  }
  return { content, docPics, textNums: null };
}

/** 이 조각에서 찾을 그림 수: 그림을 찾을 곳이 있는 조각만 (문서 속 그림이 없는 글 조각은 빼고) */
function figuresFor(info: ChunkInfo, room: number): number {
  return room > 0 && (info.pdf || info.photos || info.pictures?.length) ? room : 0;
}

/** 정리 지시: 찾을 그림 수, 지난 답이 너무 길어 잘린 조각은 개념을 70%·50% 로 짧게 */
function organizeMeta(info: ChunkInfo, figures: number, compact: number): MaterialMeta & { keyPoints: Range } {
  const meta = { ...info.meta };
  if (figures > 0) meta.figures = figures;
  if (compact) {
    const f = compact === 1 ? 0.7 : 0.5;
    const max = Math.max(4, Math.round(meta.keyPoints.max * f));
    meta.keyPoints = { min: Math.min(max - 1, Math.max(3, Math.round(meta.keyPoints.min * f))), max };
    meta.compact = true;
  }
  return meta;
}

/** 조각 정리 AI. 답 길이는 개념 수에 따라, 그림을 찾으면 그만큼 더, 단어장일 수 있으면 낱말 수만큼 더 (쓴 만큼만 낸다). 짧게 다시 할 때는 끝까지 */
function organizeCall(ctx: Ctx, info: ChunkInfo, content: ContentPart[], meta: MaterialMeta & { keyPoints: Range }): Promise<unknown> {
  const figures = meta.figures ?? 0;
  const maxTokens = meta.compact
    ? NOTE_OUT_MAX
    : Math.min(NOTE_OUT_MAX, noteOutTokens(meta.keyPoints.max, figures) + (meta.pageNumbers ? 200 : 0) + vocabHeadroom(info.size, pickOf(ctx.src.draft)));
  return ai(
    ctx,
    'organize',
    [...content, textBlock(organizePrompt(meta))],
    organizeJsonSchema({ figures: figures > 0, pageNumbers: !!meta.pageNumbers }),
    maxTokens,
  );
}

/** 이 조각과 같이 정리할 뒤 조각 (바로 뒤 n 개 중 같이 정리해 둔 답이 없는 것) */
function laterChunks(src: SourceRow, i: number, have: Record<string, AheadEntry>, n: number): number[] {
  const out: number[] = [];
  for (let j = i + 1; j < Math.min(src.chunk_total, i + 1 + n); j++) {
    if (have[j]?.sig !== chunkInfo(src, j).sig) out.push(j);
  }
  return out;
}

/** 이 조각을 같이 정리해 둔 답이 있는지 (있으면 이번 단계는 AI 없이 빨리 끝난다) */
function aheadReady(src: SourceRow): boolean {
  if (src.step !== 'organize' || compactLevel(src.draft, src.chunk_index)) return false;
  const e = aheadOf(src.draft)[src.chunk_index];
  return !!e && e.sig === chunkInfo(src, src.chunk_index).sig;
}

/**
 * 정리: 조각 하나를 정리해 partials 에 더한다. 뒤 조각 몇 개(KOK_AI_PARALLEL)도 같이 정리해 draft.ahead 에 두었다가
 * 그 조각의 차례가 오면 AI 없이 쓴다 (조각이 많은 자료가 몇 배 빨리 끝난다. 같이 정리한 조각은 이 조각이 실패해도 남긴다)
 */
async function stepOrganize(ctx: Ctx): Promise<Partial<SourceRow>> {
  const { src, admin } = ctx;
  const i = src.chunk_index;
  const total = src.chunk_total;
  // 자료 그림: 이 조각에서 찾을 수 (첫 조각부터 다시 정리하면 예전에 찾은 그림은 버린다. 파일은 같은 이름으로 덮인다).
  // 이 조각의 마지막 시도면(두 번 실패) 그림은 찾지 않는다: 그림 때문에(답이 길어 잘리는 등) 노트가 실패하지 않게
  const prevCuts = i === 0 ? [] : cutsOf(src.draft);
  const attempts = Number(src.draft.attempts ?? 0);
  const lastTry = attempts >= MAX_ATTEMPTS - 1;
  // 지난 답이 너무 길어 잘린 조각: 개념을 줄이고 짧게 다시 (2번째는 그림도 찾지 않는다)
  const compact = compactLevel(src.draft, i);
  const off = await sourceFiguresOff(ctx);
  // 문서 속 그림은 그림 하나가 곧 자료 그림이라 자리를 찾지 않는다 (AI 를 더 부르지 않으니 한 조각에서 자료 하나의 끝까지)
  const perPart = src.kind === 'text' ? MAX_FIGURES : MAX_FIGURES_PER_PART;
  const budget = off ? 0 : Math.max(0, Math.min(perPart, MAX_FIGURES - prevCuts.length));
  const room = !lastTry && compact < 2 ? budget : 0;
  const figLog = i === 0 ? figLogOf({}) : figLogOf(src.draft);
  if (room <= 0) figLog.skipped = off ?? (lastTry || compact >= 2 ? 'last_try' : 'full');

  const info = chunkInfo(src, i);
  const ahead = aheadOf(src.draft);
  const hit = !compact && ahead[i]?.sig === info.sig ? ahead[i] : null;
  /** 아직 쓰지 않은 뒤 조각의 답 (이 조각과 앞 조각의 것은 뺀다) */
  const rest: Record<string, AheadEntry> = {};
  for (const [k, e] of Object.entries(ahead)) if (Number(k) > i) rest[k] = e;
  let json: unknown;
  let meta: MaterialMeta & { keyPoints: Range };
  let textNums: number[] | null;
  let docPics: Map<number, Uint8Array> | null = null;
  if (hit) {
    // 앞 단계에서 같이 정리해 둔 조각: AI 없이 (그림은 아래에서 지금 남은 자리만큼만 쓴다)
    json = hit.json;
    meta = { ...info.meta, keyPoints: hit.keyPoints, ...(hit.figures ? { figures: hit.figures } : {}) };
    textNums = hit.textNums;
  } else {
    let original: Uint8Array | null = null;
    if (info.pdf && !info.pdf.part) {
      original = await download(admin, src.file_paths[0]);
      if (original.byteLength > pdfPartMaxBytes()) {
        // 처음 한 번: AI 에 보낼 수 있는 크기로 나눠 저장만 하고, 정리는 다음 단계부터 조각마다 한다
        const stored = await storePdfParts(ctx, original);
        return { chunk_total: stored.length, progress: Math.max(src.progress, 4), draft: { ...src.draft, pdfParts: stored, attempts: 0 } };
      }
    }
    let load: Awaited<ReturnType<typeof chunkContent>>;
    try {
      load = await chunkContent(ctx, info, original);
    } catch (e) {
      // 큰 PDF 의 나눠 둔 조각이 없어졌다: 다음 단계에서 원본을 같은 방법으로 다시 나눈다 (조각 순서는 그대로라 이어서 정리한다)
      const resplits = Number(src.draft.pdfResplits ?? 0);
      if (info.pdf?.part && e instanceof UserFacingError && e.code === 'file_missing' && resplits < 2) {
        return { draft: { ...src.draft, pdfParts: null, pdfResplits: resplits + 1, ahead: {} } };
      }
      throw e;
    }
    meta = organizeMeta(info, figuresFor(info, room), compact);
    textNums = load.textNums;
    docPics = load.docPics;
    // 뒤 조각 몇 개도 같이 정리해 둔다: 처음 시도일 때만 (실패해 다시 하는 조각·짧게 다시 하는 조각은 혼자).
    // 뒤 조각도 지금 남은 그림 자리만큼 찾아 두고, 그 조각의 차례에 앞 조각이 쓰고 남은 만큼만 쓴다
    const later = !attempts && !compact ? laterChunks(src, i, rest, parallelOf(ctx) - 1) : [];
    const [own, ...more] = await Promise.allSettled([
      organizeCall(ctx, info, load.content, meta),
      ...later.map((j, n) =>
        staggered(n + 1, async (): Promise<AheadEntry> => {
          const inf = chunkInfo(src, j);
          const ld = await chunkContent(ctx, inf, original);
          const m = organizeMeta(inf, figuresFor(inf, budget), 0);
          const answer = await organizeCall(ctx, inf, ld.content, m);
          return { sig: inf.sig, json: answer, figures: m.figures ?? 0, keyPoints: m.keyPoints, textNums: ld.textNums };
        }),
      ),
    ]);
    let solo = false;
    more.forEach((r, n) => {
      if (r.status === 'fulfilled') rest[later[n]] = r.value;
      else {
        // 같이 정리하지 못한 조각은 그 조각의 차례에 혼자 정리한다 (요청 한도·바쁨이면 이 자료는 이제 하나씩)
        if (busyError(r.reason)) solo = true;
        if (!isHandoff(r.reason)) console.warn('[kok] organize ahead failed, that part goes alone later', src.id, later[n], r.reason);
      }
    });
    // 같이 정리한 뒤 조각은 이 조각이 실패해도 남긴다 (다시 할 때 이 조각만 다시)
    carry(ctx, { ...(more.length ? { ahead: rest } : {}), ...(solo ? { solo: true } : {}) });
    if (own.status === 'rejected') {
      const e = own.reason;
      // 답이 너무 길어 잘렸다: 같은 조각을 개념을 줄여 짧게 다시 정리한다 (실패로 세지 않는다: 다시 해도 같은 길이라)
      if (e instanceof AiCallError && e.truncated && compact < 2) {
        console.warn('[kok] organize answer too long, again shorter', src.id, i, compact + 1);
        return { draft: { ...ctx.src.draft, compact: { part: i, level: compact + 1 } } };
      }
      throw e;
    }
    json = own.value;
  }
  let note: Note;
  try {
    note = normalizeNote(zNote.parse(json), meta.keyPoints.max);
  } catch (e) {
    // 같이 정리해 둔 답을 읽지 못했다: 버리고 다시 할 때 이 조각을 새로 정리한다
    if (hit) carry(ctx, { ahead: rest });
    throw e;
  }
  const size = info.size;
  const pick = pickOf(src.draft);
  // 이 조각의 종류 (조각의 양과 함께: 노트의 종류는 양이 반을 넘는 종류). 기출 조각은 노트가 정해진 뒤 원래 문제를 몇 쪽씩 꺼낸다
  const ptype: MaterialType = pick !== 'auto' ? pick : readMaterialType((json as { material_type?: unknown } | null)?.material_type);
  const w = pageWeight(size);
  // 앞 조각의 종류를 모르면(이 기능이 생기기 전에 정리한 조각) 개념 정리로 본다 (뒤 조각만으로 노트의 종류가 정해지지 않게)
  const known = i === 0 ? [] : readPartTypes(src.draft.partTypes).slice(0, i);
  const partTypes = [...known, ...Array.from({ length: i - known.length }, () => ({ type: 'general' as const, w })), { type: ptype, w }];
  let jobs: ProblemsJob[] = [];
  if (ptype === 'exam') {
    const units =
      meta.kind === 'pdf' ? (meta.pageEnd ?? 1) - (meta.pageStart ?? 1) + 1 : meta.kind === 'image' ? (meta.imageEnd ?? 1) - (meta.imageStart ?? 1) + 1 : 0;
    const text = chunkText(src, i);
    jobs = units ? problemJobs(i, units, problemPieces(size, units)) : problemJobs(i, text.length, problemPieces(size), text);
  }
  const todo = [...(i === 0 ? [] : problemsTodo(src.draft)).filter((j) => j.chunk !== i), ...jobs];
  // 쪽 번호: 이 조각의 증거 (PDF 글자·AI 가 읽은 번호). 처음 조각부터 다시 정리하면 예전 것은 버린다
  const evidence = i === 0 ? [] : evidenceOf(src.draft).filter((e) => e.start !== meta.pageStart);
  let partAdd: number | null = null;
  if (src.kind === 'pdf' && meta.pageStart && meta.pageEnd) {
    const n = meta.pageEnd - meta.pageStart + 1;
    const aiNums = readNums((json as { page_numbers?: unknown } | null)?.page_numbers, n);
    const text = textNums?.length === n && textNums.some(Boolean) ? textNums : null;
    evidence.push({ start: meta.pageStart, end: meta.pageEnd, ...(text ? { text } : {}), ai: aiNums });
    partAdd = (text ? offsetOf({ start: meta.pageStart, nums: text }) : null) ?? offsetOf({ start: meta.pageStart, nums: aiNums });
  }
  // 찾은 그림: AI 에 찾으라고 한 수와 지금 남은 자리 중 작은 만큼 (같이 정리해 둔 조각은 앞 조각이 쓰고 남은 만큼만, 앞에 적은 그림부터)
  const asked = meta.figures ?? 0;
  const cap = Math.min(asked, room);
  if (asked > 0) figLog.looked++;
  // 찾은 그림은 다음 번에 그 쪽을 그림으로 그려 자리를 찾고 자른다 (stepCutFigures: AI 를 부른 이 단계와 나눠서, 오래 걸려도 정리를 다시 하지 않게).
  // 개념은 노트가 정해진 뒤 이름으로 붙인다
  let figFound: PendingCut | null = null;
  // 문서 속 그림: AI 가 고른 그림을 그대로 자료 그림으로 (자리 찾기·자르기 없이 그림 파일을 그림 폴더에 둔다)
  let docCuts: CutFigure[] = [];
  if (cap > 0 && info.pictures?.length) {
    docCuts = await keepDocFigures(ctx, json, docPics ?? (await loadDocPictures(ctx, info.pictures)), cap, prevCuts.length, figLog);
  }
  if (cap > 0 && (info.pdf || info.photos)) {
    const range = info.pdf ? { from: meta.pageStart ?? 1, to: meta.pageEnd ?? 1 } : { from: meta.imageStart ?? 1, to: meta.imageEnd ?? 1 };
    const found = readFoundFigures((json as { figures?: unknown } | null)?.figures, range, cap).map((f) => {
      // 그 쪽에 인쇄된 번호로 짐작한 쪽: AI 가 쪽을 잘못 셌으면 여기를 먼저 본다
      const guess = f.printed && partAdd !== null ? f.printed - partAdd : null;
      return guess && guess !== f.page && guess >= range.from && guess <= range.to ? { ...f, hints: [guess] } : f;
    });
    if (found.length) figFound = { chunk: i, from: range.from, to: range.to, found };
    figLog.found += found.length;
  }
  const partials = [...(src.partials ?? []), note];
  const next = i + 1;
  const progress = Math.round(5 + (55 * next) / total);
  const partRanges = [...(i === 0 ? [] : rangesOf(src.draft)), meta.keyPoints];
  const kept: Record<string, unknown> = {
    ...src.draft,
    compact: null,
    attempts: 0,
    figCuts: [...prevCuts, ...docCuts],
    figLog,
    partRanges,
    pageEvidence: evidence,
    partTypes,
    problemsTodo: todo,
  };
  // 같이 정리해 둔 뒤 조각 (다 쓰면 지운다)
  if (Object.keys(rest).length && next < total) kept.ahead = rest;
  else delete kept.ahead;
  if (i === 0) {
    delete kept.pageAnchors;
    // 처음 조각부터 다시 정리하면 예전에 꺼낸 원래 문제는 버린다 (조각마다 다시 꺼낸다)
    delete kept.originals;
  }
  if (figFound) kept.figFound = figFound;
  if (next < total) {
    return { partials, chunk_index: next, progress, draft: kept };
  }
  // 여러 조각이거나 노트에 더하는 자료면 합치기 단계로
  if (total > 1 || src.parent_id) return { partials, chunk_index: next, step: 'merge', progress, draft: kept };
  // 한 조각짜리: 그림이 있으면 자리를 찾아 자른 뒤 개념에 붙이고 다음 단계를 정한다 (stepCutFigures)
  const one: Record<string, unknown> = { ...src.draft, note, compact: null, attempts: 0, figLog, pageEvidence: evidence, partTypes, problemsTodo: todo };
  delete one.pageAnchors;
  delete one.originals;
  delete one.ahead;
  if (figFound) return { partials: [], chunk_index: next, step: 'visual', progress: 62, draft: { ...one, figCuts: [], figFound } };
  // 문서 속 그림은 이미 그림 폴더에 있다: 개념에 붙이고 다음 단계를 정한다 (Pro 는 다시 그리기부터)
  const figures = toSourceFigures(docCuts, note.key_points);
  const draft: Record<string, unknown> = { ...one, figures };
  delete draft.figCuts;
  return { partials: [], chunk_index: next, step: figures.length ? afterNote(ctx, figures) : 'visual', progress: 62, draft };
}

/**
 * 문서 속 그림 중 AI 가 자료 그림으로 고른 것(figures 의 page = 그림 번호)을 그림 폴더에 그대로 둔다 (f번호는 앞 조각에 이어서).
 * 이 조각에 없는 번호는 뺀다 (가까운 번호로 옮기지 않는다: 다른 그림을 붙이지 않게). 못 둔 그림은 기록만 남기고 넘어간다
 */
async function keepDocFigures(ctx: Ctx, json: unknown, pics: Map<number, Uint8Array>, max: number, before: number, log: FigureLog): Promise<CutFigure[]> {
  const raw = (json as { figures?: unknown } | null)?.figures;
  const listed = Array.isArray(raw) ? raw.filter((x) => pics.has(Math.round(Number((x as { page?: unknown } | null)?.page)))) : [];
  const nums = [...pics.keys()];
  const found = readFoundFigures(listed, { from: Math.min(...nums), to: Math.max(...nums) }, max);
  log.found += found.length;
  const out: CutFigure[] = [];
  const used = new Set<number>();
  for (const f of found) {
    const bytes = pics.get(f.page);
    if (!bytes || used.has(f.page)) continue;
    used.add(f.page);
    const info = imageInfo(bytes);
    if (!info || info.format !== 'jpeg') {
      logError(log, `picture ${f.page}: not a jpeg`);
      continue;
    }
    const path = figurePath(ctx.src.user_id, ctx.src.id, before + out.length + 1);
    const { error } = await ctx.admin.storage.from(SOURCES_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.warn('[kok] document picture upload failed', ctx.src.id, error.message);
      logError(log, `upload: ${error.message}`);
      continue;
    }
    out.push({ ...f, crop: path, w: info.width, h: info.height });
    log.cut++;
  }
  return out;
}

/** 조각마다의 쪽 번호 증거: PDF 쪽 start~end 에 인쇄된 번호 (PDF 글자 text, AI 가 읽은 ai) */
type PartEvidence = { start: number; end: number; text?: number[]; ai?: number[] };

function evidenceOf(draft: Record<string, unknown>): PartEvidence[] {
  const v = draft.pageEvidence;
  if (!Array.isArray(v)) return [];
  return v.filter(
    (e): e is PartEvidence => !!e && typeof e === 'object' && Number.isInteger((e as PartEvidence).start) && Number.isInteger((e as PartEvidence).end),
  );
}

/** AI 가 읽은 번호 n 개 (모자라면 0, 이상한 값은 0) */
function readNums(raw: unknown, n: number): number[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, k) => {
    const v = Math.round(Number(list[k]));
    return Number.isFinite(v) && v > 0 && v < 100000 ? v : 0;
  });
}

/** 정리를 마친 자료의 인쇄된 쪽 번호 구간 (PDF 만: 조각마다의 증거 + 그림을 찾을 때 쪽 하나씩 읽은 번호) */
function pageLabelsOf(src: SourceRow): PageLabels {
  if (src.kind !== 'pdf') return [];
  const parts = evidenceOf(src.draft).map((e) => ({
    from: e.start,
    to: e.end,
    text: e.text ? ({ start: e.start, nums: e.text } satisfies PageEvidence) : null,
    ai: e.ai ? ({ start: e.start, nums: e.ai } satisfies PageEvidence) : null,
  }));
  return buildPageLabels(parts, anchorsOf(src.draft));
}

/** 그림마다 그 쪽에 인쇄된 번호 (구간이 있으면 구간으로, 없으면 그 쪽에서 읽은 번호 그대로) */
function withPrinted<T extends { page: number; printed?: number }>(figs: T[], labels: PageLabels): T[] {
  return figs.map((f) => {
    const n = printedPage(labels, f.page);
    if (n) return { ...f, printed: n };
    return f;
  });
}

/** 조각마다 정한 개념 수 (예전 자료에는 없다: 조각의 개념 수로 어림) */
function rangesOf(draft: Record<string, unknown>): Range[] {
  const raw = draft.partRanges;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (r && typeof r === 'object' ? { min: Number((r as Range).min), max: Number((r as Range).max) } : null))
    .filter((r): r is Range => !!r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.min >= 1 && r.max >= r.min);
}

/**
 * 합치는 계획을 AI 에 받는다 (lib/merge-plan.ts). 답이 잘렸거나 읽을 수 없으면 AI 없이 만든 계획(같은 이름의 개념만 묶기)으로:
 * 합치기 때문에 노트가 멈추지 않게. AI 서버가 바쁜 것은 다시 해 본다 (단계 다시 하기)
 */
async function mergePlanOf(ctx: Ctx, content: ContentPart[], items: number, maxKeyPoints: number, fallback: () => MergePlan): Promise<MergePlan> {
  try {
    const plan = zMergePlan.parse(await ai(ctx, 'merge', content, mergePlanJsonSchema, planOutTokens(items, maxKeyPoints)));
    if (plan.key_points.length) return plan;
    console.warn('[kok] merge plan empty, merging by titles', ctx.src.id);
  } catch (e) {
    if (!(e instanceof AiCallError && e.kind === 'bad_output')) throw e;
    console.warn('[kok] merge plan unreadable, merging by titles', ctx.src.id, e.truncated ? 'truncated' : 'bad');
  }
  return fallback();
}

async function stepMerge(ctx: Ctx): Promise<Partial<SourceRow>> {
  const parts = (ctx.src.partials ?? []).map((p) => zNote.parse(p));
  if (ctx.src.parent_id) return stepAppendMerge(ctx, parts);
  // 합친 노트의 개념 수: 조각들의 개념 수를 더한다 (겹치는 것만 묶게)
  const ranges = rangesOf(ctx.src.draft);
  const range = mergedKeyPointRange(
    ranges.length === parts.length ? ranges : parts.map((p) => ({ min: Math.max(3, p.key_points.length), max: Math.max(5, p.key_points.length) })),
  );
  // AI 는 개념을 어떻게 합칠지(차례·같은 것 묶기)만 정하고, 개념·용어·공식·함정·예시는 앱이 옮긴다: 노트가 커도 답이 잘리지 않는다.
  // 단어장 조각의 용어는 낱말·뜻이 같을 때만 하나로 (같은 낱말의 다른 뜻은 둘 다)
  const lists = wordListParts(ctx.src.draft, parts.length);
  const items = parts.reduce((a, p) => a + p.key_points.length, 0);
  const content = [textBlock(wrap('parts', partsForPlan(parts))), textBlock(mergePlanPrompt(parts.length, range))];
  const plan = await mergePlanOf(ctx, content, items, range.max, () => fallbackMergePlan(parts));
  const note = normalizeNote(applyMergePlan(plan, parts, { maxKeyPoints: range.max, wordLists: lists.some(Boolean) }), range.max);
  // 조각마다 자른 그림을 합친 노트의 개념에 붙인다 (개념 이름으로)
  const figures = toSourceFigures(cutsOf(ctx.src.draft), note.key_points);
  const draft: Record<string, unknown> = { ...ctx.src.draft, note, figures, attempts: 0 };
  delete draft.figCuts;
  delete draft.partRanges;
  return { partials: [], step: afterNote(ctx, figures), progress: 66, draft };
}

const NOTE_GONE = '자료를 더할 노트를 찾을 수 없어요. 노트가 지워졌을 수 있어요.';

/** schema.sql 을 다시 실행하기 전의 DB 에는 함수(또는 함수의 새 인자)가 없다 */
function missingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /Could not find the function|function .* does not exist/i.test(error.message ?? '');
}

/** 합칠 노트와 그 지문(kok_note_base). 지문 함수가 없는 DB 면 지문은 null (예전처럼 확인하지 않는다) */
async function readMergeBase(ctx: Ctx): Promise<{ id: string; body: unknown; base: string | null }> {
  const { data, error } = await ctx.admin.rpc('kok_note_for_merge', { p_source: ctx.src.parent_id });
  if (!error) {
    const r = data as { id?: string; body?: unknown; base?: string } | null;
    if (!r?.id) throw new UserFacingError('not_found', NOTE_GONE, 404);
    return { id: r.id, body: r.body, base: typeof r.base === 'string' ? r.base : null };
  }
  if (!missingFunction(error)) throw error;
  const { data: n, error: nErr } = await ctx.admin.from('notes').select('id, body').eq('source_id', ctx.src.parent_id).maybeSingle();
  if (nErr) throw nErr;
  if (!n) throw new UserFacingError('not_found', NOTE_GONE, 404);
  return { id: n.id, body: n.body, base: null };
}

/**
 * 노트의 다른 곳이 가리키는 개념 번호: 문제(모든 버전·숨긴 문제까지)·지난 버전의 문제 개념(qkeys)·마인드맵·자료 그림·함정·예시.
 * 노트에 자료를 더할 때 새 개념에 이 번호를 다시 쓰지 않는다 (학생이 지운 개념의 문제·그림이 엉뚱한 새 개념에 붙지 않게).
 * 지난 버전·마인드맵은 읽지 못해도(칸이 없는 예전 DB) 건너뛴다
 */
async function usedKeyPointIds(ctx: Ctx, noteId: string, note: Note, body: unknown): Promise<Set<string>> {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.add(v.trim());
  };
  const [qs, vis, vers] = await Promise.all([
    ctx.admin.from('questions').select('key_point_id').eq('note_id', noteId),
    ctx.admin.from('visuals').select('spec').eq('note_id', noteId).eq('type', 'mindmap'),
    ctx.admin.from('note_versions').select('qkeys').eq('note_id', noteId),
  ]);
  if (qs.error) throw qs.error;
  for (const r of qs.data ?? []) add(r.key_point_id);
  for (const r of vis.error ? [] : (vis.data ?? [])) {
    const nodes = (r.spec as { nodes?: unknown } | null)?.nodes;
    if (Array.isArray(nodes)) for (const nd of nodes) add((nd as { key_point_id?: unknown } | null)?.key_point_id);
  }
  for (const r of vers.error ? [] : (vers.data ?? [])) {
    const q = (r as { qkeys?: unknown }).qkeys;
    if (q && typeof q === 'object') for (const v of Object.values(q as Record<string, unknown>)) add(v);
  }
  for (const f of readFigures(body)) add(f.key_point_id);
  for (const p of [...note.pitfalls, ...note.examples]) add(p.key_point_id);
  return ids;
}

/**
 * 노트에 더하는 자료: 지금 노트에 새 자료의 정리를 합친다 (기존 개념 번호는 그대로).
 * AI 는 합치는 계획만 쓰고(지금 노트의 개념은 그대로 옮기고, 새 내용을 넣는 개념만 다시 쓴다) 앱이 옮기니 노트가 커도 합친다.
 * 합칠 때 쓴 노트의 지문(base)을 남겨, 끝내기 전에 노트가 바뀌었으면 지금 노트에 다시 합친다
 */
async function stepAppendMerge(ctx: Ctx, parts: Note[]): Promise<Partial<SourceRow>> {
  const n = await readMergeBase(ctx);
  const current = zNote.parse(n.body ?? {});
  // 지금 개념은 모두 지키고 새 자료의 양만큼 늘어날 수 있다 (노트 끝까지)
  const ranges = rangesOf(ctx.src.draft);
  const maxKeyPoints = appendKeyPointMax(
    current.key_points.length,
    ranges.length === parts.length ? ranges : parts.map((p) => ({ min: 3, max: Math.max(5, p.key_points.length) })),
  );
  const items = current.key_points.length + parts.reduce((a, p) => a + p.key_points.length, 0);
  const content = [
    textBlock(wrap('note', noteForPlan(current))),
    textBlock(wrap('new_parts', partsForPlan(parts))),
    textBlock(appendMergePlanPrompt(parts.length, maxKeyPoints)),
  ];
  const plan = await mergePlanOf(ctx, content, items, maxKeyPoints, () => fallbackMergePlan(parts, current));
  // 새 개념 번호는 문제·마인드맵·그림이 가리키는 번호를 피한다 (지운 개념의 문제가 새 개념에 붙지 않게)
  const reserved = await usedKeyPointIds(ctx, n.id, current, n.body);
  // 지금 노트의 개념 수보다 줄이지 않는다 (내가 더한 개념이 잘리지 않게). 별표·고침·순서는 지금 노트대로
  const merged = normalizeNote(applyMergePlan(plan, parts, { current, maxKeyPoints, reserved }), Math.max(maxKeyPoints, current.key_points.length));
  const note = keepFromCurrent(current, merged, parts);
  // 자료 그림: 지금 노트의 그림은 그대로 두고, 새 자료의 그림을 번호를 이어 합친 노트의 개념에 붙인다.
  // 다시 합칠 때(노트가 바뀌었을 때)는 이미 다시 그린 그림을 그대로 쓴다 (같은 자른 그림이면)
  const baseFigures = readFigures(n.body);
  const firstNumber = baseFigures.reduce((m, f) => Math.max(m, Number(f.id.slice(1)) || 0), 0) + 1;
  const drawn = new Map(draftFigures(ctx.src.draft).map((f) => [f.crop, f.art]));
  const figures = toSourceFigures(cutsOf(ctx.src.draft), note.key_points, firstNumber)
    .slice(0, Math.max(0, MAX_NOTE_FIGURES - baseFigures.length))
    .map((f) => ({ ...f, art: drawn.get(f.crop) ?? null }));
  // base 는 늘 적는다 (지문 함수가 없는 DB 면 null: 확인하지 않는다)
  const draft: Record<string, unknown> = {
    ...ctx.src.draft,
    note,
    newParts: parts,
    parentNoteId: n.id,
    base: n.base,
    figures,
    baseFigures,
    attempts: 0,
  };
  delete draft.baseVersion;
  delete draft.partRanges;
  return { partials: [], step: afterNote(ctx, figures), progress: 66, draft: dropRedrawMarks(draft) };
}

/** 노트에 더하는 자료면 그 노트 번호 */
function parentNoteId(ctx: Ctx): string | null {
  return ctx.src.parent_id && typeof ctx.src.draft.parentNoteId === 'string' ? ctx.src.draft.parentNoteId : null;
}

/**
 * 노트에 더하는 자료: 합칠 때 쓴 노트가 지금 노트와 다른지 (지문을 비교한다).
 * 정리하는 동안에는 버전을 바꾸거나 노트를 고칠 수 없지만, 실패해 멈춘 사이에는 다른 자료를 더하거나 버전을 바꾸거나 고칠 수 있다.
 */
async function baseIsStale(ctx: Ctx): Promise<boolean> {
  const pid = parentNoteId(ctx);
  if (!pid) return false;
  const remerged = Number(ctx.src.draft.remerged ?? 0);
  // 지문을 적기 전(이 기능 전)에 합쳐 둔 자료: 한 번은 지금 노트에 다시 합친다
  if (!('base' in ctx.src.draft)) return remerged === 0;
  const base = ctx.src.draft.base;
  const { data, error } = await ctx.admin.rpc('kok_note_base', { p_note: pid });
  if (error) {
    // 지문 함수가 없는 DB (schema.sql 을 다시 실행하기 전): 예전처럼 확인하지 않는다
    if (missingFunction(error)) return false;
    throw error;
  }
  if (data === null || data === undefined) throw new UserFacingError('not_found', NOTE_GONE, 404);
  // 지문 함수가 생기기 전에 합쳐 둔 자료(base 가 null): 그사이 노트가 바뀌었는지 알 수 없으니 한 번은 지금 노트에 다시 합친다
  if (typeof base !== 'string') return remerged === 0;
  return data !== base;
}

/** 합치기 단계로 돌아가 지금 버전에 다시 합친다 (새 자료의 정리는 그대로 쓴다) */
function remergePatch(src: Pick<SourceRow, 'draft'>): Partial<SourceRow> {
  const patch = remergeState(src.draft);
  // 일어나지 않아야 한다 (정리하는 동안에는 버전이 바뀌지 않는다). 끝없이 다시 하지 않게 멈춘다
  if (!patch) throw new UserFacingError('append_conflict', '노트가 계속 바뀌어서 자료를 더하지 못했어요. "다시 하기"를 눌러 주세요.', 409);
  return patch;
}

/**
 * 마인드맵 (AI 한 번). 문제는 마인드맵과 상관없어서 같이 만들어 draft.quizAhead 에 두고, 문제 단계가 AI 없이 쓴다
 * (같이 만들지 못했으면 문제 단계가 만든다)
 */
async function stepVisual(ctx: Ctx): Promise<Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const note = zNote.parse(ctx.src.draft.note);
  const v = ctx.settings.visual;
  // 지난 답이 너무 길어 잘렸으면 가지를 줄여 다시 (마인드맵 때문에 노트가 멈추지 않게)
  const maxNodes = Math.max(12, Math.round(maxNodesFor(v.depth, note.key_points.length) * (ctx.src.draft.visualShort ? 0.6 : 1)));
  const content = [textBlock(wrap('note', noteForPrompt(note)))];
  // 노트에 더할 때는 지금 마인드맵에서 학생이 고친 노드와 가운데 이름을 그대로 둔다
  let locked: Mindmap['nodes'] = [];
  let rootLabel: string | null = null;
  const pid = parentNoteId(ctx);
  if (pid) {
    const { data: cur } = await ctx.admin.from('visuals').select('spec').eq('note_id', pid).eq('type', 'mindmap').maybeSingle();
    const parsed = cur ? zMindmap.safeParse(cur.spec) : null;
    locked = parsed?.success ? parsed.data.nodes.filter((x) => x.edited).slice(0, 60) : [];
    rootLabel = parsed?.success && parsed.data.root_edited ? parsed.data.root_label : null;
    if (locked.length) {
      content.push(
        textBlock(
          wrap(
            'locked_nodes',
            JSON.stringify(locked.map(({ id, parent_id, label }) => ({ id: id.slice(0, 40), parent_id: parent_id.slice(0, 40), label: label.slice(0, 80) }))),
          ),
        ),
      );
    }
  }
  content.push(textBlock(visualPrompt({ depth: v.depth, labelStyle: v.labels, maxNodes })));
  // 문제 같이 만들기 (아직 만들어 둔 것이 없을 때. 만들 문제가 없으면 부르지 않는다)
  let plan: QuizPlan | null = null;
  if (parallelOf(ctx) > 1) {
    plan = await quizPlan(ctx).catch((e) => {
      console.warn('[kok] quiz plan failed, the quiz step makes it', ctx.src.id, e);
      return null;
    });
    if (plan && (!plan.call || quizAheadOf(ctx.src.draft, plan.sig))) plan = null;
  }
  const quizCall = plan?.call;
  const [vis, qz] = await Promise.allSettled([
    ai(ctx, 'visual', content, visualJsonSchema, visualOutTokens(maxNodes)),
    quizCall ? staggered(1, () => ai(ctx, 'quiz', quizCall.content, quizCall.schema, quizCall.maxTokens)) : Promise.resolve(null),
  ]);
  const extra: Record<string, unknown> = {};
  if (plan && quizCall) {
    if (qz.status === 'fulfilled') {
      const parsed = zQuiz.safeParse(qz.value);
      if (parsed.success) extra.quizAhead = { sig: plan.sig, questions: parsed.data.questions };
    } else if (qz.reason instanceof AiCallError && qz.reason.truncated && !ctx.src.draft.quizShort) {
      // 문제 답이 너무 길어 잘렸다: 문제 단계가 개념마다 하나씩 다시 만든다
      extra.quizShort = true;
    } else {
      if (busyError(qz.reason)) extra.solo = true;
      if (!isHandoff(qz.reason)) console.warn('[kok] quiz alongside the mind map failed, the quiz step makes it', ctx.src.id, qz.reason);
    }
  }
  if (vis.status === 'rejected') {
    const e = vis.reason;
    if (e instanceof AiCallError && e.truncated && !ctx.src.draft.visualShort) {
      console.warn('[kok] mind map answer too long, again with fewer branches', ctx.src.id);
      return { draft: { ...ctx.src.draft, ...extra, visualShort: true } };
    }
    carry(ctx, extra);
    throw e;
  }
  const visual = zVisualResult.parse(vis.value);
  visual.mindmap = cleanMindmap(visual.mindmap, maxNodes, locked);
  if (rootLabel !== null) {
    visual.mindmap.root_label = rootLabel;
    visual.mindmap.root_edited = true;
  }
  return { step: 'quiz', progress: 76, draft: { ...ctx.src.draft, ...extra, visual, attempts: 0 } };
}

/** 문제 만들기에 쓰는 것: 노트·자료 그림·원래 문제·단어장 카드, AI 문제 자리(room)와 부를 AI (자리가 없으면 null), sig: AI 에 보내는 글의 표시 */
type QuizPlan = {
  note: Note;
  figures: SourceFigure[];
  originals: MaterialQuestion[];
  vocab: MaterialQuestion[];
  room: number;
  call: { content: ContentPart[]; schema: Record<string, unknown>; maxTokens: number } | null;
  sig: string;
};

async function quizPlan(ctx: Ctx): Promise<QuizPlan> {
  const note = zNote.parse(ctx.src.draft.note);
  const q = ctx.settings.quiz;
  const pid = parentNoteId(ctx);
  // 노트에 더할 때는 새 자료의 내용으로만, 지금 노트의 문제와 겹치지 않게 만든다
  let existing: string[] = [];
  if (pid) {
    const { data: rows } = await ctx.admin.from('questions').select('prompt').eq('note_id', pid).neq('status', 'hidden').limit(200);
    existing = (rows ?? []).map((r) => String(r.prompt).slice(0, 300));
  }
  // 자료 종류 (lib/material-type.ts): 기출 조각에서 꺼낸 원래 문제(개념은 이름으로 다시 붙인다: 다시 합쳐 번호가 바뀌었을 수 있다),
  // 단어장이면 낱말마다 AI 없이 만든 카드 (노트에 더할 때는 새 자료의 낱말만). AI 문제는 이것들과 겹치지 않게 덜 만든다
  const material = materialOf(ctx.src.draft);
  // 과목마다 시험지 꼴 (lib/exam-layout.ts): 과목 이름과 자료 종류로
  const { data: subj } = await ctx.admin.from('subjects').select('name').eq('id', ctx.src.subject_id).maybeSingle();
  const style = examStyle({ subject: typeof subj?.name === 'string' ? subj.name : '', material });
  // 자료 그림: 그림마다 그림 문제 하나 (AI 는 그림 대신 그림 설명을 본다. 노트에 더할 때는 새 자료의 그림만)
  const figures = draftFigures(ctx.src.draft);
  // 원래 문제의 그림은 그림 파일로 다시 찾는다 (다시 합쳐 그림 번호가 바뀌었을 수 있다). 그림이 없어졌으면 그 문제는 뺀다
  const byCrop = new Map(figures.map((f) => [f.crop, f.id]));
  const originals = originalsOf(ctx.src.draft)
    .map((o) => {
      const kp = { ...o, key_point_id: o.kp_title ? matchKeyPoint(o.kp_title, note.key_points) : '' };
      if (!o.figure_id) return kp;
      const fid = o.figure_crop ? byCrop.get(o.figure_crop) : figures.some((f) => f.id === o.figure_id) ? o.figure_id : undefined;
      return fid ? { ...kp, figure_id: fid } : null;
    })
    .filter((o): o is MaterialQuestion => !!o);
  const covered = [...new Set(originals.map((o) => o.key_point_id).filter(Boolean))];
  const newParts = pid && Array.isArray(ctx.src.draft.newParts) ? ctx.src.draft.newParts.map((p) => zNote.parse(p)) : [];
  const vocab =
    material === 'vocab'
      ? vocabCards(pid ? newParts.flatMap((p) => p.terms) : note.terms, {
          types: q.types,
          keyPoints: note.key_points,
          examples: note.examples,
          pitfalls: note.pitfalls,
          seed: ctx.src.id,
        }).filter((c) => !existing.includes(c.prompt.slice(0, 300)))
      : [];
  // AI 문제 자리: 노트의 문제 수 끝에서 원래 문제를 뺀 만큼 (단어장 카드는 AI 없이 만들어서 따로 센다). 자리가 없으면 AI 를 부르지 않는다
  const room = Math.max(0, QUESTIONS_MAX - originals.length);
  if (room <= 0) return { note, figures, originals, vocab, room, call: null, sig: '' };
  const content = [
    textBlock(wrap('note', noteForPrompt(note))),
    ...(pid ? [textBlock(wrap('new_parts', JSON.stringify(ctx.src.draft.newParts ?? [])))] : []),
    ...(figures.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(figures))))] : []),
    textBlock(wrap('existing_questions', JSON.stringify([...existing, ...[...originals, ...vocab].map((o) => o.prompt.slice(0, 300))]))),
    textBlock(
      quizPrompt(
        // 지난 답이 너무 길어 잘렸으면 개념마다 하나씩 (문제 수가 줄어 답이 짧다)
        { types: q.types, mix: q.mix, language: q.language, perKeyPoint: ctx.src.draft.quizShort ? 1 : q.perKeyPoint, figures: figures.length },
        { onlyNew: !!pid, material, originals: originals.length, covered, cards: vocab.length, style },
      ),
    ),
  ];
  const call = {
    content,
    schema: figures.length ? quizFiguresJsonSchema : quizJsonSchema,
    maxTokens: quizOutTokens(note.key_points.length, figures.length),
  };
  const sig = createHash('sha256')
    .update(JSON.stringify([content, figures.length > 0, call.maxTokens]))
    .digest('hex')
    .slice(0, 32);
  return { note, figures, originals, vocab, room, call, sig };
}

/** 같이 만들어 둔 문제 (마인드맵 단계): 지금 보낼 글과 같을 때만 */
function quizAheadOf(draft: Record<string, unknown>, sig: string): unknown[] | null {
  const v = draft.quizAhead as { sig?: unknown; questions?: unknown } | null | undefined;
  return v && v.sig === sig && Array.isArray(v.questions) ? v.questions : null;
}

async function stepQuiz(ctx: Ctx): Promise<Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const plan = await quizPlan(ctx);
  const q = ctx.settings.quiz;
  let raw: unknown[] = [];
  if (plan.call) {
    const ahead = quizAheadOf(ctx.src.draft, plan.sig);
    if (ahead) raw = ahead;
    else {
      let json: unknown;
      try {
        json = await ai(ctx, 'quiz', plan.call.content, plan.call.schema, plan.call.maxTokens);
      } catch (e) {
        if (e instanceof AiCallError && e.truncated && !ctx.src.draft.quizShort) {
          console.warn('[kok] quiz answer too long, again with fewer questions', ctx.src.id);
          return { draft: { ...ctx.src.draft, quizShort: true } };
        }
        throw e;
      }
      raw = zQuiz.parse(json).questions;
    }
  }
  const { originals, vocab, figures, room } = plan;
  const figIds = new Set(figures.map((f) => f.id));
  const rows: QuestionDraftRow[] = raw
    .map((r) => zQuizItem.safeParse(r))
    .filter((r) => r.success)
    .map((r) => {
      const row = toQuestionRow(r.data);
      const fid = (r.data.figure_id ?? '').trim();
      if (!row || !fid) return row;
      // 없는 그림을 가리키는 그림 문제는 뺀다 ('다음 지도' 같은 말만 남지 않게)
      return figIds.has(fid) ? { ...row, figure_id: fid } : null;
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .filter((r) => q.types.includes(r.type));
  // 원래 문제 → 단어장 카드 → AI 문제 차례로 (원래 문제 + AI 문제는 노트의 문제 수 끝까지). 원래 문제는 문제 종류 설정과 상관없이 넣는다
  // (학생의 시험 문제라서). 원래 문제·카드와 글이 같은 AI 문제는 뺀다 (같은 문제가 두 번 나오지 않게)
  const taken = new Set([...originals, ...vocab].map((x) => normalizeAnswer(x.prompt)));
  const fresh = rows.filter((r) => !taken.has(normalizeAnswer(r.prompt))).slice(0, room);
  const all: QuestionDraftRow[] = [...originals.slice(0, QUESTIONS_MAX), ...vocab, ...fresh];
  // 새로 만든 문제는 다시 검사하고 그림 풀이도 처음부터
  const draft: Record<string, unknown> = { ...ctx.src.draft, questions: all, attempts: 0 };
  delete draft.checked;
  delete draft.solveRound;
  delete draft.quizAhead;
  return { step: 'check', progress: 88, draft };
}

/** figure_id: 그림 문제의 자료 그림 번호 (저장할 때 그림을 그대로 남긴다: source_figure) */
type QuestionDraftRow = MaterialQuestion & { figure?: unknown; steps?: unknown };

/** 그림 풀이를 만드는지: Pro 혜택이 있고 설정에서 켜 두었고 DB 에 칸이 있을 때 (schema.sql 을 다시 실행하기 전에는 예전처럼) */
async function figuresOn(ctx: Ctx): Promise<boolean> {
  if (!ctx.acc.canFigures || !ctx.settings.quiz.figures) return false;
  return (await getFeatures(ctx.admin)).figures;
}

/**
 * 그림 풀이 한 번: 아직 풀이가 없는 문제 중 그림·단계가 도움이 되는 문제를 AI 가 골라(최대 SOLVE_PER_ROUND 개) 풀이를 붙인다.
 * more: 다음 번에 더 만들 만한지 (이번에 꽉 채워 골랐을 때만)
 */
async function solveRound(ctx: Ctx, note: Note, questions: QuestionDraftRow[]): Promise<{ questions: QuestionDraftRow[]; more: boolean }> {
  // 자료 그림이 붙은 문제는 그 그림을 보고 푸는 문제라 그림 풀이를 만들지 않는다
  // 단어장 카드(낱말 뜻)는 그림 풀이가 필요 없다
  const open = questions.map((q, i) => (q.steps || q.figure_id || q.origin === 'vocab' ? -1 : i)).filter((i) => i >= 0);
  if (!open.length) return { questions, more: false };
  const content = [
    textBlock(wrap('note', noteForPrompt(note))),
    textBlock(wrap('questions', JSON.stringify(questionsForSolve(questions, open)))),
    textBlock(solvePrompt({ max: SOLVE_PER_ROUND })),
  ];
  const json = await ai(ctx, 'solve', content, solveJsonSchema, 16_000, true);
  const out = [...questions];
  let added = 0;
  for (const sol of zSolve.parse(json).solutions.slice(0, SOLVE_PER_ROUND)) {
    if (!open.includes(sol.index) || out[sol.index].steps) continue;
    const solution = readSolution(sol);
    if (!solution) continue;
    // 마지막 단계가 표시된 정답과 분명히 다른 답을 말하면 붙이지 않는다 (다른 답으로 가는 풀이를 보여 주지 않게. 문제는 그대로)
    if (!stepsReachAnswer(sol.steps, out[sol.index])) {
      console.warn('[kok] solve: steps reach a different answer, solution dropped');
      continue;
    }
    out[sol.index] = { ...out[sol.index], figure: solution.figure, steps: solution.steps };
    added++;
  }
  return { questions: out, more: added >= SOLVE_PER_ROUND && open.length > added };
}

/**
 * 원래 문제·단어장 카드를 잠근다 (노트에서 같은 문제 글인 AI 문제). 잠근 문제는 '문제 다시 만들기'가 바꾸지 않는다.
 * 못 잠가도 노트는 그대로 (예전처럼 잠기지 않을 뿐)
 */
async function lockMaterialQuestions(ctx: Ctx, noteId: string, prompts: string[]): Promise<void> {
  if (!prompts.length) return;
  try {
    const want = new Set(prompts);
    const { data, error } = await ctx.admin
      .from('questions')
      .select('id, prompt')
      .eq('note_id', noteId)
      .eq('created_by', 'ai')
      .eq('locked', false)
      .neq('status', 'hidden')
      .limit(1000);
    if (error) throw error;
    const ids = (data ?? []).filter((r) => want.has(String(r.prompt))).map((r) => String(r.id));
    for (let i = 0; i < ids.length; i += 100) {
      const { error: uErr } = await ctx.admin
        .from('questions')
        .update({ locked: true })
        .in('id', ids.slice(i, i + 100));
      if (uErr) throw uErr;
    }
  } catch (e) {
    console.warn('[kok] could not lock the original questions', ctx.src.id, e);
  }
}

/** 더한 자료 마무리. 합칠 때 쓴 노트가 지금 노트가 아니면 'stale' (저장하지 않는다) */
async function finalizeAppend(ctx: Ctx, args: { p_note: unknown; p_visuals: unknown; p_questions: unknown; p_expire: string | null }): Promise<'ok' | 'stale'> {
  const base = typeof ctx.src.draft.base === 'string' ? ctx.src.draft.base : null;
  const params = { p_child: ctx.src.id, ...args };
  let { error } = await ctx.admin.rpc('kok_finalize_append', { ...params, p_base: base });
  // 예전 DB: 지문 인자가 없는 함수로 (그 DB 는 지문 함수도 없어서 base 가 늘 null 이다)
  if (error && missingFunction(error)) ({ error } = await ctx.admin.rpc('kok_finalize_append', params));
  if (error && /stale_base/.test(error.message ?? '')) return 'stale';
  if (error) throw error;
  return 'ok';
}

/** 표지 그림을 그릴 차례인지: 새 노트(더한 자료는 지금 노트의 표지를 그대로), Pro 혜택, 설정에서 켬, DB 칸이 있음, 아직 안 그림 */
async function coverPending(ctx: Ctx): Promise<boolean> {
  if (ctx.src.draft.coverDone === true) return false;
  if (!coverWanted({ canCover: ctx.acc.canCover, autoCover: ctx.settings.visual.autoCover, featureOn: true, append: !!parentNoteId(ctx) })) return false;
  return (await getFeatures(ctx.admin)).covers;
}

/** 표지 그림 (AI 한 번). 못 그리면 null: 표지는 꾸미는 것일 뿐이라 노트는 그대로 만든다 (오류는 남기고 넘어간다) */
async function drawCover(ctx: Ctx, note: Note): Promise<Record<string, unknown> | null> {
  try {
    const { data: subj } = await ctx.admin.from('subjects').select('name').eq('id', ctx.src.subject_id).maybeSingle();
    const excerpt = coverNoteExcerpt(note, typeof subj?.name === 'string' ? subj.name : '');
    const cover = settleCover(await ai(ctx, 'cover', coverContent(excerpt), coverJsonSchema, COVER_OUT_TOKENS));
    if (!cover) console.warn('[kok] cover: nothing drawable', ctx.src.id);
    return cover;
  } catch (e) {
    passHandoff(e);
    console.warn('[kok] cover failed, the note goes on without it', ctx.src.id, e);
    return null;
  }
}

/** 표지 그림 단계 (AI 한 번, 저장은 다음 번에) */
async function stepCover(ctx: Ctx, note: Note): Promise<Partial<SourceRow>> {
  const cover = await drawCover(ctx, note);
  return { progress: 98, ...(cover ? { cover } : {}), draft: { ...ctx.src.draft, coverDone: true, attempts: 0 } };
}

/**
 * 문제 검사 (AI 한 번): 뺄 문제의 차례(questions 안). 검사가 실패해도 문제는 살린다 (검사는 품질을 높이는 단계일 뿐)
 * 단어장 카드는 노트에 적힌 뜻 그대로라 검사하지 않는다 (AI 가 만든 문제와 자료의 원래 문제만)
 */
async function checkQuestions(ctx: Ctx, note: Note, questions: QuestionDraftRow[]): Promise<Set<number>> {
  const checkable = questions.map((x, i) => ({ x, i })).filter(({ x }) => x.origin !== 'vocab');
  if (!checkable.length) return new Set();
  const listed = checkable.map(({ x }, index) => {
    const row: Record<string, unknown> = { index, ...x };
    delete row.kp_title;
    delete row.figure_crop;
    // 그림 풀이는 검사하지 않는다 (같이 만드는 중이거나 앞에서 만든 것)
    delete row.figure;
    delete row.steps;
    if (x.origin !== 'material') delete row.origin;
    return row;
  });
  const used = new Set(questions.map((x) => x.figure_id).filter(Boolean));
  const figs = draftFigures(ctx.src.draft).filter((f) => used.has(f.id));
  const content = [
    textBlock(wrap('note', noteForPrompt(note))),
    ...(figs.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(figs))))] : []),
    textBlock(wrap('questions', JSON.stringify(listed))),
    textBlock(
      checkPrompt({
        figures: figs.length > 0,
        originals: checkable.some(({ x }) => x.origin === 'material'),
        math: materialOf(ctx.src.draft) === 'math',
      }),
    ),
  ];
  try {
    // 문제마다 판정 한 줄 (약 30토큰)
    const json = await ai(ctx, 'check', content, checkJsonSchema, Math.min(6000, 1500 + listed.length * 30));
    const verdicts = zCheck.parse(json).verdicts;
    return new Set(
      verdicts
        .filter((v) => !v.keep)
        .map((v) => checkable[v.index]?.i)
        .filter((i): i is number => Number.isInteger(i)),
    );
  } catch (e) {
    passHandoff(e);
    if (e instanceof UserFacingError) throw e;
    console.warn('[kok] check step failed, keeping questions', e);
    return new Set();
  }
}

/**
 * 검사·(Pro: 그림 풀이)·(Pro: 표지 그림) → 저장. 검사와 그림 풀이 첫 번과 표지 그림은 서로 상관없어서 같이 부른다
 * (그림 풀이는 검사 전 문제로 만들고, 검사가 뺀 문제의 풀이는 문제와 같이 빠진다).
 * 검사가 끝나면 draft.checked, 그림 풀이는 draft.solveRound 로 어디까지 했는지 남기고, 마지막 저장은 AI 없이 한다
 */
async function stepCheckAndFinish(ctx: Ctx): Promise<'done' | Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const note = zNote.parse(ctx.src.draft.note);
  const visual = zVisualResult.parse(ctx.src.draft.visual) as VisualResult;
  const questions = (ctx.src.draft.questions as QuestionDraftRow[] | undefined)?.filter(Boolean) ?? [];

  let kept = questions;
  if (ctx.src.draft.checked !== true) {
    const solve = questions.length > 0 && (await figuresOn(ctx));
    const cover = await coverPending(ctx);
    const [chk, sol, cov] = await Promise.allSettled([
      checkQuestions(ctx, note, questions),
      solve ? staggered(1, () => solveRound(ctx, note, questions)) : Promise.resolve(null),
      cover ? staggered(solve ? 2 : 1, () => drawCover(ctx, note)) : Promise.resolve(null),
    ]);
    // 검사를 시작하지 못했다(시간이 모자람)·검사가 학생에게 알릴 오류를 냈다: 이번 일은 버리고 다시 (또는 멈춤)
    if (chk.status === 'rejected') throw chk.reason;
    const drop = chk.value;
    // 그림 풀이: 시간이 모자라 시작하지 못했으면 다음 번에 첫 번부터, 실패하면(학생에게 알릴 오류가 아니면) 풀이 없이
    let solved = questions;
    let round = SOLVE_ROUNDS;
    if (solve) {
      if (sol.status === 'fulfilled' && sol.value) {
        solved = sol.value.questions;
        round = sol.value.more && SOLVE_ROUNDS > 1 ? 1 : SOLVE_ROUNDS;
      } else if (sol.status === 'rejected') {
        if (sol.reason instanceof UserFacingError) throw sol.reason;
        if (isHandoff(sol.reason)) round = 0;
        else console.warn('[kok] solve step failed, keeping questions without figures', sol.reason);
      }
    }
    kept = solved.filter((_, i) => !drop.has(i));
    const draft: Record<string, unknown> = { ...ctx.src.draft, questions: kept, checked: true, solveRound: kept.length ? round : SOLVE_ROUNDS, attempts: 0 };
    const patch: Partial<SourceRow> = { draft };
    // 표지 그림: 시간이 모자라 시작하지 못했으면 다음 번에
    if (cover && !(cov.status === 'rejected' && isHandoff(cov.reason))) {
      draft.coverDone = true;
      if (cov.status === 'fulfilled' && cov.value) patch.cover = cov.value;
    }
    // 그림 풀이가 남았거나 표지 그림이 남았으면 다음 번에, 표지를 그렸으면 저장은 다음 번에 (표지 칸을 먼저 적는다).
    // (진행 94: 그림 풀이 차례, 96: 표지 그림 차례, 97: 마무리 — 화면의 단계 이름이 이 값을 본다)
    const solveLeft = Number(draft.solveRound) < SOLVE_ROUNDS;
    const coverLeft = cover && draft.coverDone !== true;
    if (solveLeft || coverLeft || patch.cover) return { ...patch, progress: solveLeft ? 94 : coverLeft ? 96 : 97 };
  } else {
    const round = Number(ctx.src.draft.solveRound ?? SOLVE_ROUNDS);
    if (round < SOLVE_ROUNDS && kept.length && (await figuresOn(ctx))) {
      let next = { questions: kept, more: false };
      try {
        next = await solveRound(ctx, note, kept);
      } catch (e) {
        // 그림 풀이가 안 돼도 노트와 문제는 그대로 만든다 (그림은 더해 주는 것일 뿐)
        passHandoff(e);
        if (e instanceof UserFacingError) throw e;
        console.warn('[kok] solve step failed, keeping questions without figures', e);
      }
      const done = !next.more || round + 1 >= SOLVE_ROUNDS;
      return {
        progress: done ? ((await coverPending(ctx)) ? 96 : 97) : 94,
        draft: { ...ctx.src.draft, questions: next.questions, solveRound: done ? SOLVE_ROUNDS : round + 1, attempts: 0 },
      };
    }
    // 표지 그림 (저장은 다음 번에)
    if (await coverPending(ctx)) return await stepCover(ctx, note);
  }

  const visuals: Array<{ type: string; spec: unknown }> = [{ type: 'mindmap', spec: visual.mindmap }];
  if (visual.table.include && visual.table.columns.length && visual.table.rows.length) {
    visuals.push({ type: 'table', spec: { title: visual.table.title, columns: visual.table.columns, rows: visual.table.rows } });
  }
  if (visual.timeline.include && visual.timeline.events.length) {
    visuals.push({ type: 'timeline', spec: { title: visual.timeline.title, events: visual.timeline.events } });
  }
  // 자료 그림: 노트에 더할 때는 지금 노트의 그림 뒤에 새 그림 (노트 하나에 MAX_NOTE_FIGURES 장까지: 넘는 새 그림과 그 문제는 뺀다)
  // 인쇄된 쪽 번호(책의 쪽): 이 자료의 쪽 번호 구간. 새 그림은 그 쪽의 번호를 들고 다닌다 (노트를 합쳐도 제 자료의 번호로 보이게)
  const labels = pageLabelsOf(ctx.src);
  const baseFigures = readFigures({ figures: ctx.src.draft.baseFigures });
  const figures = withPrinted(draftFigures(ctx.src.draft).slice(0, Math.max(0, MAX_NOTE_FIGURES - baseFigures.length)), labels);
  const allFigures = [...baseFigures, ...figures];
  const figLog = figLogOf(ctx.src.draft);
  let noteBody: Record<string, unknown> = { ...note, recommended: visual.recommended, ...(allFigures.length ? { figures: allFigures } : {}) };
  // 노트의 쪽 표시는 처음 넣은 자료의 쪽이다 (더한 자료의 쪽 번호는 합칠 때 비운다): 새 노트에만 적는다
  if (!parentNoteId(ctx) && labels.length) noteBody.page_labels = labels;
  // 어떤 종류로 정리했는지 (노트 머리에 보인다). 노트에 더한 자료는 지금 노트의 것을 그대로 쓴다 (아래)
  if (!parentNoteId(ctx))
    noteBody.material = { type: materialOf(ctx.src.draft), by: pickOf(ctx.src.draft) === 'auto' ? 'ai' : 'student' } satisfies NoteMaterial;
  // 그림 문제는 그 그림을 문제에 그대로 남긴다 (그림이 없어졌으면 문제를 뺀다: '다음 지도' 같은 말이 남지 않게)
  const byId = new Map(figures.map((f) => [f.id, f]));
  const keptRows = kept.filter((x) => !x.figure_id || byId.has(x.figure_id));
  const saved = keptRows.map(forSaving).map(({ figure_id, ...row }) => (figure_id ? { ...row, source_figure: questionFigure(byId.get(figure_id)!) } : row));
  // 자료의 원래 문제와 단어장 카드는 저장한 뒤 잠근다: '문제 다시 만들기'가 AI 문제로 바꾸지 않게 (채팅에서 넣은 문제처럼)
  const lockPrompts = keptRows.filter((x) => x.origin === 'material' || x.origin === 'vocab').map((x) => x.prompt);
  // 자료 그림이 어디까지 됐는지 (관리자가 노트 화면에서 본다). 노트에 더한 자료는 지금 노트의 기록을 그대로 둔다
  if (!parentNoteId(ctx)) noteBody.figure_log = { ...figLog, questions: saved.filter((x) => 'source_figure' in x).length };
  const pid = parentNoteId(ctx);
  if (pid) {
    // 그림 보기 설정(노트마다)과 쪽 번호 구간은 지금 노트의 것을 그대로 쓴다
    const { data: cur } = await ctx.admin.from('notes').select('body').eq('id', pid).maybeSingle();
    const curBody = cur?.body as Record<string, unknown> | undefined;
    if (curBody?.view) noteBody = { ...noteBody, view: curBody.view };
    if (curBody?.page_labels) noteBody = { ...noteBody, page_labels: curBody.page_labels };
    if (curBody?.material) noteBody = { ...noteBody, material: curBody.material };
  }
  // 원본 파일(문서 속 그림 포함): Pro·관리자는 계속, 무료는 처리 뒤 freeFileDays 일, 테스트 플랜은 플랜이 끝나고 freeFileDays 일. 파일 없는 글은 없음
  const keepFrom = ctx.acc.plan.kind === 'custom' && ctx.acc.plan.until ? Math.max(Date.parse(ctx.acc.plan.until), Date.now()) : Date.now();
  const noFiles = ctx.src.kind === 'text' && !docPictureCount(ctx.src);
  const expire = ctx.acc.keepFiles || noFiles ? null : new Date(keepFrom + ctx.app.limits.freeFileDays * 86400_000).toISOString();

  if (pid && !ctx.src.title) {
    // 이름 없이 더한 자료(글 등)는 그 자료의 정리 제목을 이름으로 (버전 기록에 보인다)
    const parts = Array.isArray(ctx.src.draft.newParts) ? (ctx.src.draft.newParts as Array<{ title?: unknown }>) : [];
    const title = typeof parts[0]?.title === 'string' ? parts[0].title.trim().slice(0, 120) : '';
    if (title) await ctx.admin.from('sources').update({ title }).eq('id', ctx.src.id).eq('title', '');
  }
  if (pid) {
    // 검사하는 동안 버전이 바뀌었으면(일어나지 않아야 한다) 저장하지 않고 지금 버전에 다시 합친다
    if ((await finalizeAppend(ctx, { p_note: noteBody, p_visuals: visuals, p_questions: saved, p_expire: expire })) === 'stale') return remergePatch(ctx.src);
    await lockMaterialQuestions(ctx, pid, lockPrompts);
  } else {
    // 단원은 학생이 고른 것만 쓴다: 고르지 않았으면(빈 칸) DB 함수가 AI 단원으로 채운 것을 다시 비운다.
    // (AI 가 읽은 단원은 노트 정리(body.unit)에만 남아 노트 고치기의 단원 고르기에 'AI 추천'으로 보인다)
    const { data: before } = await ctx.admin.from('sources').select('unit').eq('id', ctx.src.id).maybeSingle();
    const { data: noteId, error } = await ctx.admin.rpc('kok_finalize_source', {
      p_source: ctx.src.id,
      p_title: note.title || ctx.src.title,
      p_note: noteBody,
      p_visuals: visuals,
      p_questions: saved,
      p_expire: expire,
    });
    if (error) throw error;
    if (typeof noteId === 'string') await lockMaterialQuestions(ctx, noteId, lockPrompts);
    const aiUnit = (typeof note.unit === 'string' ? note.unit : '').replace(/^ +| +$/g, '').slice(0, 40);
    if (before && !String(before.unit ?? '').trim() && aiUnit) {
      const { error: uErr } = await ctx.admin.from('sources').update({ unit: '' }).eq('id', ctx.src.id).eq('unit', aiUnit);
      if (uErr) console.warn('[kok] could not clear the AI unit', ctx.src.id, uErr.message);
    }
  }
  // 큰 PDF 를 나눈 조각은 정리가 끝나면 필요 없다 (원본은 '원본' 탭에서 보도록 남긴다)
  const parts = pdfPartsOf(ctx.src);
  if (parts) {
    try {
      await removePaths(
        ctx.admin,
        parts.map((x) => x.path),
      );
    } catch (e) {
      console.warn('[kok] could not remove pdf parts', ctx.src.id, e);
    }
  }
  return 'done';
}

// ------------------------------------------------------------- 실행기
export type StepOutcome = 'continue' | 'retry' | 'done' | 'error' | 'locked' | 'missing' | 'handoff';

async function release(admin: SupabaseClient, id: string, patch: Partial<SourceRow>) {
  const { error } = await admin
    .from('sources')
    .update({ ...patch, locked_until: null })
    .eq('id', id);
  if (error) throw error;
}

/** 학생에게 보일 까닭. 관리자에게는 AI 응답의 까닭도 같이 (adminDetail) */
function friendly(e: unknown, acc: Pick<Account, 'isAdmin'>): string {
  if (e instanceof UserFacingError) return e.message;
  if (e instanceof PdfError) return e.message;
  if (e instanceof AiCallError) {
    if (e.kind === 'refusal') return e.message;
    if (e.kind === 'retryable') return 'AI 서버가 바빠서 끝내지 못했어요. "다시 하기"를 눌러 주세요.';
    return `AI가 정리하다가 문제가 생겼어요. "다시 하기"를 눌러 주세요.${adminDetail(acc, e)}`;
  }
  return '정리하다가 문제가 생겼어요. "다시 하기"를 눌러 주세요.';
}

function isFinal(e: unknown): boolean {
  if (e instanceof UserFacingError || e instanceof PdfError) return true;
  if (e instanceof AiCallError) return e.kind === 'refusal' || e.kind === 'fatal';
  return false;
}

/**
 * 이 단계의 AI 를 가장 오래 기다릴 시간 (ms): 서버 함수 한 번에 남은 시간이 이것보다 적으면 새 요청으로 넘긴다.
 * 긴 답(정리·문제·그림 풀이)은 새 요청의 처음에만 시작해서 서버 함수가 중간에 끊기지 않게 한다.
 * 같이 부르는 AI 는 하나하나가 이 시간 안이라 같이 불러도 같다. 미리 만들어 둔 답을 쓰는 단계는 AI 를 부르지 않아 짧다
 */
function stepWaitMs(src: SourceRow): number {
  if (src.draft.figFound) return aiWaitMs(4000);
  if (problemsDue(src)) return aiWaitMs(12_000);
  switch (src.step) {
    case 'organize':
      return aheadReady(src) ? NO_AI_WAIT_MS : aiWaitMs(NOTE_OUT_MAX);
    case 'merge':
      return aiWaitMs(9000);
    case 'figures':
      return aiWaitMs(REDRAW_OUT_TOKENS);
    case 'visual':
      // 마인드맵 + 같이 만드는 문제
      return aiWaitMs(16_000);
    case 'quiz':
      return src.draft.quizAhead ? NO_AI_WAIT_MS : aiWaitMs(16_000);
    case 'check': {
      // 검사 + 그림 풀이(먼저 생각하고 답한다) + 표지 그림을 같이 → 그림 풀이 두 번째 → 표지 그림 → 저장(AI 없음)
      const d = src.draft;
      if (d.checked !== true || Number(d.solveRound ?? SOLVE_ROUNDS) < SOLVE_ROUNDS) return aiWaitMs(16_000);
      return d.coverDone === true ? NO_AI_WAIT_MS : aiWaitMs(COVER_OUT_TOKENS);
    }
    default:
      return 0;
  }
}

/** AI 를 부르지 않는 단계(미리 만든 답을 쓰기·저장)에 남겨 둘 시간 */
const NO_AI_WAIT_MS = 30_000;

/** 단계를 잡은 동안 놓아야 할 잠금 (잡은 뒤 실패해도 놓지 못하면 다음 요청이 그만큼 기다린다) */
type Hold = { id: string; held: boolean };

/** 잠금을 놓고 patch 를 적는다 (놓았으면 hold.held = false: 잡은 뒤의 실패 처리가 두 번 놓지 않게) */
async function letGo(admin: SupabaseClient, hold: Hold, patch: Partial<SourceRow>): Promise<void> {
  await release(admin, hold.id, patch);
  hold.held = false;
}

/**
 * 단계 하나를 한다. deadline: 서버 함수 한 번에서 단계를 끝내야 하는 때 (ms). first: 이번 요청의 첫 단계 (남은 시간이 가장 많으니 늘 한다).
 * 첫 단계가 아니고 남은 시간이 이 단계에 모자라면 손대지 않고 'handoff' (부른 쪽이 새 요청으로 이어 간다).
 * 잠금은 이 서버 함수가 끝나는 때까지만 잡는다: 함수가 멈추거나 다음 요청을 부르지 못해도 곧 풀려 다른 요청이 잇는다
 */
export async function runOneStep(sourceId: string, o: { deadline?: number; first?: boolean } = {}): Promise<StepOutcome> {
  const deadline = o.deadline ?? Date.now() + RUN_MS;
  const admin = adminClient();
  const { data, error } = await admin.rpc('kok_claim_source', { p_id: sourceId, p_seconds: lockSeconds(deadline, Date.now()) });
  if (error) throw error;
  const src = (Array.isArray(data) ? data[0] : data) as SourceRow | undefined;
  if (!src) {
    const { data: row } = await admin.from('sources').select('status').eq('id', sourceId).maybeSingle();
    if (!row) return 'missing';
    if (row.status === 'ready') return 'done';
    if (row.status === 'error') return 'error';
    return 'locked';
  }
  const hold: Hold = { id: src.id, held: true };
  try {
    return await runClaimed(admin, src, hold, deadline, !!o.first);
  } catch (e) {
    // 단계 밖에서 난 오류 (계정·설정 읽기, 잠금 놓기 등): 잠금을 놓고 알린다 (다음 요청이 바로 잇게)
    if (hold.held) {
      await admin
        .from('sources')
        .update({ locked_until: null })
        .eq('id', src.id)
        .then(
          () => {},
          () => {},
        );
    }
    throw e;
  }
}

async function runClaimed(admin: SupabaseClient, src: SourceRow, hold: Hold, deadline: number, first: boolean): Promise<StepOutcome> {
  if (!first && deadline - Date.now() < stepWaitMs(src) + 20_000) {
    await letGo(admin, hold, {});
    return 'handoff';
  }

  const acc = await getAccount(admin, src.user_id);
  const app = await getAppSettings(admin);
  const ctx: Ctx = { admin, src, acc, app, settings: acc.settings, deadline };
  const draft0 = src.draft;
  const stalls = Number(src.draft.stalls ?? 0);

  try {
    if (acc.banned) throw new UserFacingError('banned', '이 계정은 AI 기능을 쓸 수 없어요.', 403);
    if (!app.aiEnabled && !acc.isAdmin) {
      throw new UserFacingError('ai_paused', '지금은 AI 기능을 잠깐 쉬고 있어요. 나중에 "다시 하기"를 눌러 주세요.', 503);
    }
    // 같은 단계를 하던 서버 함수가 여러 번 끝내지 못하고 멈췄다 (자료가 너무 크거나 무거운 쪽): 끝없이 다시 하지 않는다
    if (stalls >= MAX_STALLS) {
      throw new UserFacingError('stalled', '정리하다가 여러 번 멈췄어요. "다시 하기"를 누르거나, 자료를 나눠서 넣어 주세요.', 500);
    }
    let patch: Partial<SourceRow>;
    // 정리 단계에서 찾은 그림이 있으면 이번에는 자르기만 한다 (자리를 찾는 AI 한 번)
    if (src.draft.figFound) patch = await stepCutFigures(ctx);
    // 기출·문제집 조각의 원래 문제 꺼내기 (노트가 정해진 뒤, 마인드맵·문제보다 먼저: 한 번에 몇 쪽씩)
    else if (problemsDue(src)) patch = await stepProblems(ctx);
    else {
      switch (src.step) {
        case 'organize':
          patch = await stepOrganize(ctx);
          break;
        case 'merge':
          patch = await stepMerge(ctx);
          break;
        case 'figures':
          patch = await stepFigures(ctx);
          break;
        case 'visual':
          patch = await stepVisual(ctx);
          break;
        case 'quiz':
          patch = await stepQuiz(ctx);
          break;
        case 'check': {
          const r = await stepCheckAndFinish(ctx);
          if (r === 'done') return 'done';
          patch = r;
          break;
        }
        default:
          await letGo(admin, hold, { status: 'ready', progress: 100 });
          return 'done';
      }
    }
    // 단계를 마쳤다: 멈춘 수는 처음부터 (다음 단계가 멈추면 다시 센다)
    if (stalls) {
      const d: Record<string, unknown> = { ...(patch.draft ?? ctx.src.draft) };
      delete d.stalls;
      patch = { ...patch, draft: d };
    }
    await letGo(admin, hold, { ...patch, status: 'processing', error: null });
    return 'continue';
  } catch (e) {
    // 단계가 실패하기 전에 남긴 것 (같이 정리해 둔 뒤 조각 등: carry)
    const kept = ctx.src.draft;
    if (e instanceof StepHandoff) {
      // 이번 요청에 시간이 모자랐다: 시도로 세지 않고 새 요청에서 같은 단계를 처음부터
      await letGo(admin, hold, kept !== draft0 ? { draft: kept } : {});
      return 'handoff';
    }
    // 마무리 저장은 끝났는데 응답만 못 받은 경우: 이미 완료됐으면 그대로 둔다
    const { data: cur } = await admin.from('sources').select('status').eq('id', src.id).maybeSingle();
    if (cur?.status === 'ready') return 'done';
    const attempts = Number(draft0.attempts ?? 0) + 1;
    console.error('[kok] step failed', src.id, src.step, e);
    if (isFinal(e) || attempts >= MAX_ATTEMPTS) {
      const d: Record<string, unknown> = { ...kept, attempts: 0 };
      delete d.stalls;
      await letGo(admin, hold, { status: 'error', error: friendly(e, acc), draft: d });
      try {
        await refundSource(admin, src.user_id, src.id);
      } catch (re) {
        console.error('[kok] refund failed', re);
      }
      return 'error';
    }
    await letGo(admin, hold, { draft: { ...kept, attempts } });
    return 'retry';
  }
}

/** 다른 요청이 잡은 단계를 기다릴 시간 (lib/relay.ts lockWait). 끝났거나 실패한 자료면 null */
async function waitForLock(sourceId: string, maxWait: number): Promise<number | null> {
  const { data } = await adminClient().from('sources').select('status, locked_until').eq('id', sourceId).maybeSingle();
  if (!data || (data.status !== 'queued' && data.status !== 'processing')) return null;
  return lockWait(data.locked_until as string | null, Date.now(), maxWait);
}

/**
 * 서버 함수 한 번(300초) 안에서 여러 단계를 진행한다. 끝나지 않았으면 'continue' (부른 쪽이 새 요청으로 이어 간다).
 * 단계마다 AI 를 가장 오래 기다릴 시간(stepWaitMs)이 남았을 때만 시작하고, AI 를 기다리는 시간도 이 함수가 끝나기 전까지로 자른다.
 * (Vercel 300초 제한: 단계 끝 RUN_MS 272초 + 다음 요청 부르기 10초 + 여유. startedAt: 요청이 시작된 때)
 * 다른 요청이 잡은 단계가 곧 풀리면(그 요청의 서버 함수가 끝나 가거나 멈췄다) 기다렸다가 잇는다.
 * wait: 앞 요청이 멈춘 것을 알고 부른 요청 (잠금이 풀릴 때까지 이 함수가 허락하는 만큼 기다린다)
 */
export async function runSteps(sourceId: string, startedAt = Date.now(), o: { wait?: boolean } = {}): Promise<StepOutcome> {
  // 요청이 시작된 때부터 센다 (after() 앞의 일도 서버 함수 시간에 든다)
  const deadline = Math.min(startedAt, Date.now()) + RUN_MS;
  let outcome: StepOutcome = 'continue';
  let first = true;
  while (outcome === 'continue' && deadline - Date.now() > 30_000) {
    outcome = await runOneStep(sourceId, { deadline, first });
    if (outcome === 'locked') {
      // 잡은 요청이 곧 놓을 때만 기다린다 (오래 잡혀 있으면 그 요청이 살아서 잇는다). 기다리는 동안 이따금 다시 본다
      const budget = o.wait ? deadline - Date.now() - 60_000 : LOCK_WAIT_MS;
      const ms = await waitForLock(sourceId, Math.max(0, budget));
      if (ms === null) return 'locked';
      await sleep(Math.min(ms, LOCK_POLL_MS));
      // 기다렸으니 남은 시간이 줄었다: 다음 단계는 남은 시간을 보고 한다
      first = false;
      outcome = 'continue';
      continue;
    }
    first = false;
    if (outcome === 'retry') {
      // AI 서버가 바쁠 때 바로 다시 부르지 않고 조금 쉰다
      await sleep(5000);
      outcome = 'continue';
    }
    if (outcome === 'handoff') return 'continue';
  }
  return outcome;
}

export { getAccount, getAppSettings };
