// 자료 처리 파이프라인: 정리 → (합치기) → 그림 → 문제 → 검사·저장
// 한 번 부를 때 한 단계씩 진행하고, 상태는 sources 행에 저장한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, SOURCES_BUCKET } from '@/lib/supabase/admin';
import {
  checkJsonSchema,
  noteJsonSchema,
  organizeFiguresJsonSchema,
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
  appendMergePrompt,
  checkPrompt,
  mergePrompt,
  organizePrompt,
  quizPrompt,
  redrawPrompt,
  solvePrompt,
  visualPrompt,
  wrap,
  type MaterialMeta,
} from '@/lib/ai/prompts';
import { artJsonSchema, normalizeArt } from '@/lib/art/spec';
import {
  canRedraw,
  figurePath,
  figuresForPrompt,
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
import { growthOfParts, keepFromCurrent, mergeFits, noteForMerge, remergeState, MERGE_OUT_TOKENS, NOTE_TOO_LONG } from '@/lib/append-merge';
import { modelForTier, type AiTask, type UserSettings } from '@/lib/settings';
import { planChunks, slicePdf, splitPdfBySize, splitText, PdfError } from '@/lib/pdf';
import { questionsForSolve, readSolution, stepsReachAnswer } from '@/lib/figure/solution';
import { getAccount, getAppSettings, getFeatures, charge, refundSource, type Account, type AppSettings } from './account';
import { AiCallError, callJson, imageBlock, pdfBlock, textBlock, usageOf, type ContentPart } from './claude';
import { UserFacingError } from './errors';
import { adminDetail } from './tasks';
import { removePaths } from './files';
import { noteForPrompt } from './notes';
import { cutFigures, type FigureSource } from './figure-image';
import { cleanMindmap, maxNodesFor } from '@/lib/mindmap-clean';

export const IMAGES_PER_CHUNK = 6;
export const TEXT_CHARS_PER_CHUNK = 40000;
const LOCK_SECONDS = 240;
const MAX_ATTEMPTS = 3;
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
};

export function chunkCount(kind: SourceRow['kind'], pages: number, images: number, text: string): number {
  if (kind === 'pdf') return planChunks(Math.max(1, pages)).length;
  if (kind === 'image') return Math.max(1, Math.ceil(images / IMAGES_PER_CHUNK));
  return Math.max(1, splitText(text, TEXT_CHARS_PER_CHUNK).length);
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
};

function modelFor(ctx: Ctx, task: AiTask): string {
  const tier =
    task === 'visual' || task === 'redraw'
      ? ctx.settings.models.visual
      : task === 'quiz' || task === 'check' || task === 'solve'
        ? ctx.settings.models.quiz
        : ctx.settings.models.organize;
  return modelForTier(ctx.app.models, tier, ctx.acc.canCareful, ctx.acc.isAdmin);
}

async function ai(ctx: Ctx, task: AiTask, content: ContentPart[], schema: Record<string, unknown>, maxTokens: number, think = false) {
  const model = modelFor(ctx, task);
  try {
    const res = await callJson({ model, effort: ctx.app.models.effort[task], content, schema, maxTokens, maxRetries: 0, timeoutMs: 150_000, think });
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

/** 노트 번호(k1, k2 …)가 비었거나 겹치면 고친다. 개념은 maxKeyPoints 개까지 */
export function normalizeNote(note: Note, maxKeyPoints = 9): Note {
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
const FIGURE_OUT_TOKENS = 400;

/** 자료 그림을 찾는지: PDF·사진이고, 설정에서 켜 두었고, DB 에 칸이 있을 때 (schema.sql 을 다시 실행하기 전에는 예전처럼) */
async function sourceFiguresOn(ctx: Ctx): Promise<boolean> {
  if (ctx.src.kind === 'text' || !ctx.settings.quiz.sourceFigures) return false;
  return (await getFeatures(ctx.admin)).sourceFigures;
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
  return ctx.acc.canFigures && figures.some((f) => canRedraw(f.kind) && !f.art) ? 'figures' : 'visual';
}

/** 그림을 자를 원본: AI 에 보낸 PDF 조각(첫 쪽의 원래 쪽 번호와 함께) 또는 사진들(원래 사진 번호마다) */
type FigureHolder = { kind: 'pdf'; bytes: Uint8Array; firstPage: number } | { kind: 'image'; photos: Map<number, Uint8Array> };

/**
 * AI 가 찾은 그림을 원본에서 잘라 `내id/figs/자료id/fN.jpg` 에 저장한다 (쪽마다 한 번만 그린다).
 * 자르거나 저장하지 못한 그림은 뺀다: 그림 때문에 노트 만들기가 멈추지 않게. already: 이미 자른 그림 수 (파일 번호)
 */
async function cutAndStore(ctx: Ctx, found: FoundFigure[], holder: FigureHolder, already: number, deadline: number): Promise<CutFigure[]> {
  const out: CutFigure[] = [];
  for (const page of [...new Set(found.map((f) => f.page))]) {
    // 시간이 넘으면 남은 쪽은 자르지 않는다 (그 그림은 뺀다)
    if (Date.now() > deadline) {
      console.warn('[kok] figure cut out of time', ctx.src.id, page);
      break;
    }
    const here = found.filter((f) => f.page === page);
    let source: FigureSource | null = null;
    if (holder.kind === 'pdf') source = { kind: 'pdf', bytes: holder.bytes, page: page - holder.firstPage + 1 };
    else {
      const bytes = holder.photos.get(page);
      if (bytes) source = { kind: 'image', bytes };
    }
    if (!source) continue;
    let cuts: Awaited<ReturnType<typeof cutFigures>>;
    try {
      cuts = await cutFigures(
        source,
        here.map((f) => f.corners),
      );
    } catch (e) {
      console.warn('[kok] figure cut failed', ctx.src.id, page, e);
      continue;
    }
    for (let k = 0; k < here.length; k++) {
      const cut = cuts[k];
      if (!cut) continue;
      const path = figurePath(ctx.src.user_id, ctx.src.id, already + out.length + 1);
      const { error } = await ctx.admin.storage.from(SOURCES_BUCKET).upload(path, cut.jpeg, { contentType: 'image/jpeg', upsert: true });
      if (error) {
        console.warn('[kok] figure upload failed', ctx.src.id, error.message);
        continue;
      }
      out.push({ ...here[k], crop: path, w: cut.width, h: cut.height });
    }
  }
  return out;
}

/** 정리 단계에서 찾고 아직 자르지 않은 그림 (그 조각 번호와 함께) */
type PendingCut = { chunk: number; found: FoundFigure[] };

function pendingOf(draft: Record<string, unknown>): PendingCut | null {
  const v = draft.figFound as Partial<PendingCut> | null | undefined;
  return v && Number.isInteger(v.chunk) && Array.isArray(v.found) ? { chunk: Number(v.chunk), found: v.found } : null;
}

/** 자르기를 해 보는 수 (자르다가 함수가 멈추면 다음 번에 한 번 더, 그래도 안 되면 그 그림은 뺀다) */
const CUT_TRIES = 2;
/** 한 번 자를 때 쓰는 시간 (넘으면 남은 쪽은 뺀다) */
const CUT_BUDGET_MS = 60_000;

/** 그림을 자를 원본을 다시 받는다: PDF 는 나눠 둔 조각(있으면) 또는 원본 파일, 사진은 그림이 있는 사진만 */
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

/**
 * 자료 그림 자르기 (AI 없음): 정리 단계에서 찾은 그림을 원본에서 잘라 저장한다. 정리 다음 번에 따로 돌아서,
 * 자르다 오래 걸리거나 멈춰도 정리(AI)를 다시 하지 않는다. 한 조각짜리 자료면 그림을 개념에 붙이고 다음 단계를 정한다
 */
async function stepCutFigures(ctx: Ctx): Promise<Partial<SourceRow>> {
  const { src } = ctx;
  const pending = pendingOf(src.draft);
  const tries = Number(src.draft.figCutTries ?? 0);
  let cuts = cutsOf(src.draft);
  if (pending && tries < CUT_TRIES) {
    // 해 보는 수를 먼저 적어 둔다: 자르다가 함수가 멈춰도 다음에는 그만 자르게
    await ctx.admin
      .from('sources')
      .update({ draft: { ...src.draft, figCutTries: tries + 1 } })
      .eq('id', src.id);
    try {
      const holder = await holderFor(
        ctx,
        pending.chunk,
        pending.found.map((f) => f.page),
      );
      if (holder) cuts = [...cuts, ...(await cutAndStore(ctx, pending.found, holder, cuts.length, Date.now() + CUT_BUDGET_MS))];
    } catch (e) {
      // 원본을 못 받았다: 그림 없이 노트를 만든다
      console.warn('[kok] figure cut skipped', src.id, e);
    }
  } else if (pending) {
    console.warn('[kok] figure cut gave up after tries', src.id);
  }
  const draft: Record<string, unknown> = { ...src.draft, figCuts: cuts };
  delete draft.figFound;
  delete draft.figCutTries;
  // 한 조각짜리 자료: 노트가 정해졌으니 그림을 개념에 붙이고 다음 단계를 정한다
  if (src.step === 'visual' && draft.note) {
    const figures = toSourceFigures(cuts, (draft.note as Note).key_points);
    draft.figures = figures;
    delete draft.figCuts;
    return { step: afterNote(ctx, figures), draft };
  }
  return { draft };
}

/**
 * 그림 다시 그리기 (Pro): 아직 다시 그리지 않은 지도·그래프·표·연표·도식 한 장을 KOK 스타일로 다시 그린다 (한 번 부를 때 AI 한 번).
 * 못 그려도 원본 그림은 그대로 쓴다. 다 그리면 그림(마인드맵) 단계로
 */
async function stepFigures(ctx: Ctx): Promise<Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const figures = draftFigures(ctx.src.draft);
  const from = Number(ctx.src.draft.figRound ?? 0);
  const todo = ctx.acc.canFigures ? figures.map((f, i) => ({ f, i })).filter(({ f, i }) => i >= from && canRedraw(f.kind) && !f.art) : [];
  if (!todo.length) {
    const draft: Record<string, unknown> = { ...ctx.src.draft, attempts: 0 };
    delete draft.figRound;
    return { step: 'visual', progress: 72, draft };
  }
  const { f, i } = todo[0];
  let art = null;
  if (canRedraw(f.kind)) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await download(ctx.admin, f.crop);
    } catch (e) {
      console.warn('[kok] redraw: crop missing', ctx.src.id, f.crop, e);
    }
    if (bytes) {
      try {
        const json = await ai(
          ctx,
          'redraw',
          [imageBlock(bytes, 'image/jpeg'), textBlock(redrawPrompt({ kind: f.kind }))],
          artJsonSchema(f.kind),
          REDRAW_OUT_TOKENS,
        );
        art = normalizeArt(f.kind, json);
      } catch (e) {
        // 다시 그리지 못해도 원본 그림으로 노트를 만든다 (다시 그린 그림은 더해 주는 것일 뿐).
        // AI 서버가 잠깐 바쁘면 조금 쉬었다가 두 번까지 다시 한다 (마지막 시도에서는 던지지 않아 자료가 실패하지 않는다)
        if (e instanceof UserFacingError) throw e;
        if (e instanceof AiCallError && e.kind === 'retryable' && Number(ctx.src.draft.attempts ?? 0) < MAX_ATTEMPTS - 1) throw e;
        console.warn('[kok] redraw failed, keeping the original only', ctx.src.id, f.id, e);
      }
    }
  }
  const next = figures.map((x, k) => (k === i ? { ...x, art } : x));
  const left = todo.length - 1;
  const progress = Math.min(72, Math.max(ctx.src.progress, 66) + 2);
  const draft: Record<string, unknown> = { ...ctx.src.draft, figures: next, figRound: i + 1, attempts: 0 };
  if (!left) delete draft.figRound;
  return { step: left ? 'figures' : 'visual', progress, draft };
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

async function stepOrganize(ctx: Ctx): Promise<Partial<SourceRow>> {
  const { src, admin } = ctx;
  const i = src.chunk_index;
  const total = src.chunk_total;
  const meta: MaterialMeta = { title: src.title || '공부 자료', kind: src.kind, part: i + 1, parts: total };
  const content: ContentPart[] = [];
  // 자료 그림: 이 조각에서 찾을 수 (첫 조각부터 다시 정리하면 예전에 찾은 그림은 버린다. 파일은 같은 이름으로 덮인다).
  // 이 조각의 마지막 시도면(두 번 실패) 그림은 찾지 않는다: 그림 때문에(답이 길어 잘리는 등) 노트가 실패하지 않게
  const prevCuts = i === 0 ? [] : cutsOf(src.draft);
  const lastTry = Number(src.draft.attempts ?? 0) >= MAX_ATTEMPTS - 1;
  const room = !lastTry && (await sourceFiguresOn(ctx)) ? Math.min(MAX_FIGURES_PER_PART, MAX_FIGURES - prevCuts.length) : 0;
  let holder: FigureHolder | null = null;

  if (src.kind === 'pdf') {
    const parts = pdfPartsOf(src);
    if (parts) {
      // 큰 PDF: 나눠 둔 조각 하나만 받는다
      const part = parts[Math.min(i, parts.length - 1)];
      let bytes: Uint8Array;
      try {
        bytes = await download(admin, part.path);
      } catch (e) {
        // 조각이 없어졌다: 다음 단계에서 원본을 같은 방법으로 다시 나눈다 (조각 순서는 그대로라 이어서 정리한다)
        const resplits = Number(src.draft.pdfResplits ?? 0);
        if (e instanceof UserFacingError && e.code === 'file_missing' && resplits < 2) {
          return { draft: { ...src.draft, pdfParts: null, pdfResplits: resplits + 1 } };
        }
        throw e;
      }
      meta.pageStart = part.start;
      meta.pageEnd = part.end;
      content.push(pdfBlock(bytes));
      holder = { kind: 'pdf', bytes, firstPage: part.start };
    } else {
      const bytes = await download(admin, src.file_paths[0]);
      if (bytes.byteLength > pdfPartMaxBytes()) {
        // 처음 한 번: AI 에 보낼 수 있는 크기로 나눠 저장만 하고, 정리는 다음 단계부터 조각마다 한다
        const stored = await storePdfParts(ctx, bytes);
        return { chunk_total: stored.length, progress: Math.max(src.progress, 4), draft: { ...src.draft, pdfParts: stored, attempts: 0 } };
      }
      const chunks = planChunks(src.page_count ?? 1);
      const c = chunks[Math.min(i, chunks.length - 1)];
      const slice = await slicePdf(bytes, c.start, c.end);
      meta.pageStart = c.start;
      meta.pageEnd = c.end;
      content.push(pdfBlock(slice));
      holder = { kind: 'pdf', bytes: slice, firstPage: c.start };
    }
  } else if (src.kind === 'image') {
    const paths = src.file_paths.slice(i * IMAGES_PER_CHUNK, (i + 1) * IMAGES_PER_CHUNK);
    meta.imageStart = i * IMAGES_PER_CHUNK + 1;
    meta.imageEnd = i * IMAGES_PER_CHUNK + paths.length;
    const photos = new Map<number, Uint8Array>();
    for (let k = 0; k < paths.length; k++) {
      const bytes = await download(admin, paths[k]);
      photos.set(meta.imageStart + k, bytes);
      content.push(textBlock(`Photo ${meta.imageStart + k}:`));
      content.push(imageBlock(bytes, mediaTypeOf(paths[k])));
    }
    holder = { kind: 'image', photos };
  } else {
    const parts = splitText(src.text_content ?? '', TEXT_CHARS_PER_CHUNK);
    meta.ownWriting = true;
    content.push(textBlock(wrap('material', parts[Math.min(i, parts.length - 1)] ?? '')));
  }
  if (room > 0 && holder) meta.figures = room;
  content.push(textBlock(organizePrompt(meta)));

  // 그림을 찾으면 답이 그만큼 길어진다 (그림 하나에 약 400토큰)
  const json = await ai(ctx, 'organize', content, meta.figures ? organizeFiguresJsonSchema : noteJsonSchema, 8000 + (meta.figures ?? 0) * FIGURE_OUT_TOKENS);
  const note = normalizeNote(zNote.parse(json));
  // 찾은 그림은 다음 번에 원본에서 자른다 (stepCutFigures: AI 를 부른 이 단계와 나눠서, 자르다 오래 걸려도 정리를 다시 하지 않게).
  // 개념은 노트가 정해진 뒤 이름으로 붙인다
  let figFound: PendingCut | null = null;
  if (meta.figures && holder) {
    const range = holder.kind === 'pdf' ? { from: meta.pageStart ?? 1, to: meta.pageEnd ?? 1 } : { from: meta.imageStart ?? 1, to: meta.imageEnd ?? 1 };
    const found = readFoundFigures((json as { figures?: unknown } | null)?.figures, range, meta.figures);
    if (found.length) figFound = { chunk: i, found };
  }
  const partials = [...(src.partials ?? []), note];
  const next = i + 1;
  const progress = Math.round(5 + (55 * next) / total);
  const kept: Record<string, unknown> = { ...src.draft, attempts: 0, figCuts: prevCuts };
  if (figFound) kept.figFound = figFound;
  if (next < total) {
    return { partials, chunk_index: next, progress, draft: kept };
  }
  // 여러 조각이거나 노트에 더하는 자료면 합치기 단계로
  if (total > 1 || src.parent_id) return { partials, chunk_index: next, step: 'merge', progress, draft: kept };
  // 한 조각짜리: 그림이 있으면 자른 뒤 개념에 붙이고 다음 단계를 정한다 (stepCutFigures)
  if (figFound) return { partials: [], chunk_index: next, step: 'visual', progress: 62, draft: { ...src.draft, note, attempts: 0, figCuts: [], figFound } };
  const draft: Record<string, unknown> = { ...src.draft, note, figures: [], attempts: 0 };
  delete draft.figCuts;
  return { partials: [], chunk_index: next, step: 'visual', progress: 62, draft };
}

async function stepMerge(ctx: Ctx): Promise<Partial<SourceRow>> {
  const parts = (ctx.src.partials ?? []).map((p) => zNote.parse(p));
  if (ctx.src.parent_id) return stepAppendMerge(ctx, parts);
  const content = [textBlock(wrap('partials', JSON.stringify(parts))), textBlock(mergePrompt(parts.length))];
  const json = await ai(ctx, 'merge', content, noteJsonSchema, 8000);
  const note = normalizeNote(zNote.parse(json));
  // 조각마다 자른 그림을 합친 노트의 개념에 붙인다 (개념 이름으로)
  const figures = toSourceFigures(cutsOf(ctx.src.draft), note.key_points);
  const draft: Record<string, unknown> = { ...ctx.src.draft, note, figures, attempts: 0 };
  delete draft.figCuts;
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
 * 노트에 더하는 자료: 지금 노트에 새 자료의 정리를 합친다 (기존 개념 번호는 그대로).
 * 합칠 때 쓴 노트의 지문(base)을 남겨, 끝내기 전에 노트가 바뀌었으면 지금 노트에 다시 합친다
 */
async function stepAppendMerge(ctx: Ctx, parts: Note[]): Promise<Partial<SourceRow>> {
  const n = await readMergeBase(ctx);
  const current = zNote.parse(n.body ?? {});
  // 지금 노트는 자르지 않고 모두 보낸다 (잘라 보내면 긴 설명이 잘린 채 새 버전에 남는다)
  const full = noteForMerge(current);
  const partsJson = JSON.stringify(parts);
  // 합친 노트가 답 길이에 들어가지 않을 노트는 AI 를 부르기 전에 막는다
  if (!full || !mergeFits(full, growthOfParts(partsJson))) throw new UserFacingError('note_too_long', NOTE_TOO_LONG, 400);
  const maxKeyPoints = Math.max(9, current.key_points.length);
  const content = [textBlock(wrap('note', full)), textBlock(wrap('new_parts', partsJson)), textBlock(appendMergePrompt(parts.length, maxKeyPoints))];
  let json: unknown;
  try {
    json = await ai(ctx, 'merge', content, noteJsonSchema, MERGE_OUT_TOKENS);
  } catch (e) {
    // 합친 노트가 답 길이 한도를 넘었다: 다시 해도 같으니 바로 알려 준다
    if (e instanceof AiCallError && e.truncated) throw new UserFacingError('note_too_long', NOTE_TOO_LONG, 400);
    throw e;
  }
  // 지금 노트의 개념 수보다 줄이지 않는다 (내가 더한 개념이 잘리지 않게)
  const merged = normalizeNote(zNote.parse(json), maxKeyPoints);
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
  delete draft.figRound;
  return { partials: [], step: afterNote(ctx, figures), progress: 66, draft };
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

async function stepVisual(ctx: Ctx): Promise<Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const note = zNote.parse(ctx.src.draft.note);
  const v = ctx.settings.visual;
  const maxNodes = maxNodesFor(v.depth);
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
  const json = await ai(ctx, 'visual', content, visualJsonSchema, 4000);
  const visual = zVisualResult.parse(json);
  visual.mindmap = cleanMindmap(visual.mindmap, maxNodes, locked);
  if (rootLabel !== null) {
    visual.mindmap.root_label = rootLabel;
    visual.mindmap.root_edited = true;
  }
  return { step: 'quiz', progress: 76, draft: { ...ctx.src.draft, visual, attempts: 0 } };
}

async function stepQuiz(ctx: Ctx): Promise<Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const note = zNote.parse(ctx.src.draft.note);
  const q = ctx.settings.quiz;
  const pid = parentNoteId(ctx);
  // 노트에 더할 때는 새 자료의 내용으로만, 지금 노트의 문제와 겹치지 않게 만든다
  let existing: string[] = [];
  if (pid) {
    const { data: rows } = await ctx.admin.from('questions').select('prompt').eq('note_id', pid).neq('status', 'hidden').limit(200);
    existing = (rows ?? []).map((r) => String(r.prompt).slice(0, 300));
  }
  // 자료 그림: 그림마다 그림 문제 하나 (AI 는 그림 대신 그림 설명을 본다. 노트에 더할 때는 새 자료의 그림만)
  const figures = draftFigures(ctx.src.draft);
  const content = [
    textBlock(wrap('note', noteForPrompt(note))),
    ...(pid ? [textBlock(wrap('new_parts', JSON.stringify(ctx.src.draft.newParts ?? [])))] : []),
    ...(figures.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(figures))))] : []),
    textBlock(wrap('existing_questions', JSON.stringify(existing))),
    textBlock(quizPrompt({ types: q.types, mix: q.mix, language: q.language, perKeyPoint: q.perKeyPoint, figures: figures.length }, { onlyNew: !!pid })),
  ];
  const json = await ai(ctx, 'quiz', content, figures.length ? quizFiguresJsonSchema : quizJsonSchema, 8000);
  const raw = zQuiz.parse(json).questions;
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
    .filter((r) => q.types.includes(r.type))
    .slice(0, 40);
  // 새로 만든 문제는 다시 검사하고 그림 풀이도 처음부터
  const draft: Record<string, unknown> = { ...ctx.src.draft, questions: rows, attempts: 0 };
  delete draft.checked;
  delete draft.solveRound;
  return { step: 'check', progress: 88, draft };
}

/** figure_id: 그림 문제의 자료 그림 번호 (저장할 때 그림을 그대로 남긴다: source_figure) */
type QuestionDraftRow = NonNullable<ReturnType<typeof toQuestionRow>> & { figure?: unknown; steps?: unknown; figure_id?: string };

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
  const open = questions.map((q, i) => (q.steps || q.figure_id ? -1 : i)).filter((i) => i >= 0);
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

/**
 * 검사 → (Pro: 그림 풀이 몇 번) → 저장. 한 번 부를 때 AI 는 한 번만 부른다:
 * 검사가 끝나면 draft.checked, 그림 풀이는 draft.solveRound 로 어디까지 했는지 남기고, 마지막 저장은 AI 없이 한다
 */
async function stepCheckAndFinish(ctx: Ctx): Promise<'done' | Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const note = zNote.parse(ctx.src.draft.note);
  const visual = zVisualResult.parse(ctx.src.draft.visual) as VisualResult;
  const questions = (ctx.src.draft.questions as QuestionDraftRow[] | undefined)?.filter(Boolean) ?? [];

  let kept = questions;
  if (ctx.src.draft.checked !== true) {
    if (questions.length) {
      const listed = questions.map((x, index) => ({ index, ...x }));
      const used = new Set(questions.map((x) => x.figure_id).filter(Boolean));
      const figs = draftFigures(ctx.src.draft).filter((f) => used.has(f.id));
      const content = [
        textBlock(wrap('note', noteForPrompt(note))),
        ...(figs.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(figs))))] : []),
        textBlock(wrap('questions', JSON.stringify(listed))),
        textBlock(checkPrompt({ figures: figs.length > 0 })),
      ];
      try {
        const json = await ai(ctx, 'check', content, checkJsonSchema, 2500);
        const verdicts = zCheck.parse(json).verdicts;
        const drop = new Set(verdicts.filter((v) => !v.keep).map((v) => v.index));
        kept = questions.filter((_, i) => !drop.has(i));
      } catch (e) {
        // 검사가 실패해도 문제는 살린다 (검사는 품질을 높이는 단계일 뿐)
        if (e instanceof UserFacingError) throw e;
        console.warn('[kok] check step failed, keeping questions', e);
      }
    }
    // 그림 풀이를 만들면 검사 결과를 남기고 다음 번에 (한 번에 AI 한 번)
    if (kept.length && (await figuresOn(ctx))) {
      return { progress: 91, draft: { ...ctx.src.draft, questions: kept, checked: true, solveRound: 0, attempts: 0 } };
    }
  } else {
    const round = Number(ctx.src.draft.solveRound ?? SOLVE_ROUNDS);
    if (round < SOLVE_ROUNDS && kept.length && (await figuresOn(ctx))) {
      let next = { questions: kept, more: false };
      try {
        next = await solveRound(ctx, note, kept);
      } catch (e) {
        // 그림 풀이가 안 돼도 노트와 문제는 그대로 만든다 (그림은 더해 주는 것일 뿐)
        if (e instanceof UserFacingError) throw e;
        console.warn('[kok] solve step failed, keeping questions without figures', e);
      }
      const done = !next.more || round + 1 >= SOLVE_ROUNDS;
      return {
        progress: done ? 97 : 94,
        draft: { ...ctx.src.draft, questions: next.questions, solveRound: done ? SOLVE_ROUNDS : round + 1, attempts: 0 },
      };
    }
  }

  const visuals: Array<{ type: string; spec: unknown }> = [{ type: 'mindmap', spec: visual.mindmap }];
  if (visual.table.include && visual.table.columns.length && visual.table.rows.length) {
    visuals.push({ type: 'table', spec: { title: visual.table.title, columns: visual.table.columns, rows: visual.table.rows } });
  }
  if (visual.timeline.include && visual.timeline.events.length) {
    visuals.push({ type: 'timeline', spec: { title: visual.timeline.title, events: visual.timeline.events } });
  }
  // 자료 그림: 노트에 더할 때는 지금 노트의 그림 뒤에 새 그림 (노트 하나에 MAX_NOTE_FIGURES 장까지: 넘는 새 그림과 그 문제는 뺀다)
  const baseFigures = readFigures({ figures: ctx.src.draft.baseFigures });
  const figures = draftFigures(ctx.src.draft).slice(0, Math.max(0, MAX_NOTE_FIGURES - baseFigures.length));
  const allFigures = [...baseFigures, ...figures];
  let noteBody: Record<string, unknown> = { ...note, recommended: visual.recommended, ...(allFigures.length ? { figures: allFigures } : {}) };
  // 그림 문제는 그 그림을 문제에 그대로 남긴다 (그림이 없어졌으면 문제를 뺀다: '다음 지도' 같은 말이 남지 않게)
  const byId = new Map(figures.map((f) => [f.id, f]));
  const saved = kept
    .filter((x) => !x.figure_id || byId.has(x.figure_id))
    .map(({ figure_id, ...row }) => (figure_id ? { ...row, source_figure: questionFigure(byId.get(figure_id)!) } : row));
  const pid = parentNoteId(ctx);
  if (pid) {
    // 그림 보기 설정(노트마다)은 지금 노트의 것을 그대로 쓴다
    const { data: cur } = await ctx.admin.from('notes').select('body').eq('id', pid).maybeSingle();
    const view = (cur?.body as Record<string, unknown> | undefined)?.view;
    if (view) noteBody = { ...noteBody, view };
  }
  // 원본 파일: Pro·관리자는 계속, 무료는 처리 뒤 freeFileDays 일, 테스트 플랜은 플랜이 끝나고 freeFileDays 일
  const keepFrom = ctx.acc.plan.kind === 'custom' && ctx.acc.plan.until ? Math.max(Date.parse(ctx.acc.plan.until), Date.now()) : Date.now();
  const expire = ctx.acc.keepFiles || ctx.src.kind === 'text' ? null : new Date(keepFrom + ctx.app.limits.freeFileDays * 86400_000).toISOString();

  if (pid && !ctx.src.title) {
    // 이름 없이 더한 자료(글 등)는 그 자료의 정리 제목을 이름으로 (버전 기록에 보인다)
    const parts = Array.isArray(ctx.src.draft.newParts) ? (ctx.src.draft.newParts as Array<{ title?: unknown }>) : [];
    const title = typeof parts[0]?.title === 'string' ? parts[0].title.trim().slice(0, 120) : '';
    if (title) await ctx.admin.from('sources').update({ title }).eq('id', ctx.src.id).eq('title', '');
  }
  if (pid) {
    // 검사하는 동안 버전이 바뀌었으면(일어나지 않아야 한다) 저장하지 않고 지금 버전에 다시 합친다
    if ((await finalizeAppend(ctx, { p_note: noteBody, p_visuals: visuals, p_questions: saved, p_expire: expire })) === 'stale') return remergePatch(ctx.src);
  } else {
    const { error } = await ctx.admin.rpc('kok_finalize_source', {
      p_source: ctx.src.id,
      p_title: note.title || ctx.src.title,
      p_note: noteBody,
      p_visuals: visuals,
      p_questions: saved,
      p_expire: expire,
    });
    if (error) throw error;
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
export type StepOutcome = 'continue' | 'retry' | 'done' | 'error' | 'locked' | 'missing';

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

export async function runOneStep(sourceId: string): Promise<StepOutcome> {
  const admin = adminClient();
  const { data, error } = await admin.rpc('kok_claim_source', { p_id: sourceId, p_seconds: LOCK_SECONDS });
  if (error) throw error;
  const src = (Array.isArray(data) ? data[0] : data) as SourceRow | undefined;
  if (!src) {
    const { data: row } = await admin.from('sources').select('status').eq('id', sourceId).maybeSingle();
    if (!row) return 'missing';
    if (row.status === 'ready') return 'done';
    if (row.status === 'error') return 'error';
    return 'locked';
  }

  const acc = await getAccount(admin, src.user_id);
  const app = await getAppSettings(admin);
  const ctx: Ctx = { admin, src, acc, app, settings: acc.settings };

  try {
    if (acc.banned) throw new UserFacingError('banned', '이 계정은 AI 기능을 쓸 수 없어요.', 403);
    if (!app.aiEnabled && !acc.isAdmin) {
      throw new UserFacingError('ai_paused', '지금은 AI 기능을 잠깐 쉬고 있어요. 나중에 "다시 하기"를 눌러 주세요.', 503);
    }
    let patch: Partial<SourceRow>;
    // 정리 단계에서 찾은 그림이 있으면 이번에는 자르기만 한다 (AI 없음)
    if (src.draft.figFound) {
      patch = await stepCutFigures(ctx);
      await release(admin, src.id, { ...patch, status: 'processing', error: null });
      return 'continue';
    }
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
        await release(admin, src.id, { status: 'ready', progress: 100 });
        return 'done';
    }
    await release(admin, src.id, { ...patch, status: 'processing', error: null });
    return 'continue';
  } catch (e) {
    // 마무리 저장은 끝났는데 응답만 못 받은 경우: 이미 완료됐으면 그대로 둔다
    const { data: cur } = await admin.from('sources').select('status').eq('id', src.id).maybeSingle();
    if (cur?.status === 'ready') return 'done';
    const attempts = Number((src.draft as { attempts?: number }).attempts ?? 0) + 1;
    console.error('[kok] step failed', src.id, src.step, e);
    if (isFinal(e) || attempts >= MAX_ATTEMPTS) {
      await release(admin, src.id, { status: 'error', error: friendly(e, acc), draft: { ...src.draft, attempts: 0 } });
      try {
        await refundSource(admin, src.user_id, src.id);
      } catch (re) {
        console.error('[kok] refund failed', re);
      }
      return 'error';
    }
    await release(admin, src.id, { draft: { ...src.draft, attempts } });
    return 'retry';
  }
}

/**
 * 시간 예산 안에서 여러 단계를 진행한다. 끝나지 않았으면 'continue'.
 * 한 단계는 길면 2분 넘게 걸리므로, budgetMs 가 지나기 전에만 새 단계를 시작한다.
 * (Vercel 300초 제한: 새 단계 시작은 90초까지 + AI 대기 최대 150초 + 다음 요청 부르기 10초 + 요청 앞부분·여유)
 */
export async function runSteps(sourceId: string, budgetMs = 90_000): Promise<StepOutcome> {
  const started = Date.now();
  let outcome: StepOutcome = 'continue';
  while (outcome === 'continue' && Date.now() - started < budgetMs) {
    outcome = await runOneStep(sourceId);
    if (outcome === 'retry') {
      // AI 서버가 바쁠 때 바로 다시 부르지 않고 조금 쉰다
      await new Promise((r) => setTimeout(r, 5000));
      outcome = 'continue';
    }
  }
  return outcome;
}

export type { Ctx as PipelineCtx };
export { getAccount, getAppSettings };
