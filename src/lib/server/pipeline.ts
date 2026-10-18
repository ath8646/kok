// 자료 처리 파이프라인: 정리 → (합치기) → 그림 → 문제 → 검사·저장
// 한 번 부를 때 한 단계씩 진행하고, 상태는 sources 행에 저장한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, SOURCES_BUCKET } from '@/lib/supabase/admin';
import {
  checkJsonSchema,
  noteJsonSchema,
  zMindmap,
  quizJsonSchema,
  toQuestionRow,
  visualJsonSchema,
  zCheck,
  zNote,
  zQuiz,
  zQuizItem,
  zVisualResult,
  type Mindmap,
  type Note,
  type VisualResult,
} from '@/lib/ai/schemas';
import { appendMergePrompt, checkPrompt, mergePrompt, organizePrompt, quizPrompt, visualPrompt, wrap, type MaterialMeta } from '@/lib/ai/prompts';
import { growthOfParts, keepFromCurrent, mergeFits, noteForMerge, remergeState, MERGE_OUT_TOKENS, NOTE_TOO_LONG } from '@/lib/append-merge';
import { modelForTier, type AiTask, type UserSettings } from '@/lib/settings';
import { planChunks, slicePdf, splitPdfBySize, splitText, PdfError } from '@/lib/pdf';
import { getAccount, getAppSettings, charge, refundSource, type Account, type AppSettings } from './account';
import { AiCallError, callJson, imageBlock, pdfBlock, textBlock, usageOf, type ContentPart } from './claude';
import { UserFacingError } from './errors';
import { removePaths } from './files';
import { noteForPrompt } from './notes';

export const IMAGES_PER_CHUNK = 6;
export const TEXT_CHARS_PER_CHUNK = 40000;
const LOCK_SECONDS = 240;
const MAX_ATTEMPTS = 3;

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
  step: 'organize' | 'merge' | 'visual' | 'quiz' | 'check' | 'done';
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
  const tier = task === 'visual' ? ctx.settings.models.visual : task === 'quiz' || task === 'check' ? ctx.settings.models.quiz : ctx.settings.models.organize;
  return modelForTier(ctx.app.models, tier, ctx.acc.canCareful, ctx.acc.isAdmin);
}

async function ai(ctx: Ctx, task: AiTask, content: ContentPart[], schema: Record<string, unknown>, maxTokens: number) {
  const model = modelFor(ctx, task);
  try {
    const res = await callJson({ model, effort: ctx.app.models.effort[task], content, schema, maxTokens, maxRetries: 0, timeoutMs: 150_000 });
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

export function maxNodesFor(depth: number): number {
  return depth <= 2 ? 24 : depth === 3 ? 42 : 60;
}

/** 마인드맵 정리: id 겹침 제거, 개수 제한, 잠긴(편집된) 노드 유지 */
export function cleanMindmap(raw: Mindmap, maxNodes: number, locked: Mindmap['nodes'] = []): Mindmap {
  const seen = new Set<string>();
  const nodes: Mindmap['nodes'] = [];
  for (const n of locked) {
    if (!n.id || seen.has(n.id)) continue;
    seen.add(n.id);
    nodes.push({ ...n, edited: true });
  }
  for (const n of raw.nodes) {
    const id = (n.id || '').trim();
    if (!id || seen.has(id) || id === '__root__') continue;
    if (nodes.length >= maxNodes + locked.length) break;
    seen.add(id);
    nodes.push({ ...n, id, label: (n.label || '').trim().slice(0, 60) || '…', edited: false });
  }
  return { root_label: (raw.root_label || '주제').trim().slice(0, 30), nodes };
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
    }
  } else if (src.kind === 'image') {
    const paths = src.file_paths.slice(i * IMAGES_PER_CHUNK, (i + 1) * IMAGES_PER_CHUNK);
    meta.imageStart = i * IMAGES_PER_CHUNK + 1;
    meta.imageEnd = i * IMAGES_PER_CHUNK + paths.length;
    for (let k = 0; k < paths.length; k++) {
      const bytes = await download(admin, paths[k]);
      content.push(textBlock(`Photo ${meta.imageStart + k}:`));
      content.push(imageBlock(bytes, mediaTypeOf(paths[k])));
    }
  } else {
    const parts = splitText(src.text_content ?? '', TEXT_CHARS_PER_CHUNK);
    meta.ownWriting = true;
    content.push(textBlock(wrap('material', parts[Math.min(i, parts.length - 1)] ?? '')));
  }
  content.push(textBlock(organizePrompt(meta)));

  const json = await ai(ctx, 'organize', content, noteJsonSchema, 8000);
  const note = normalizeNote(zNote.parse(json));
  const partials = [...(src.partials ?? []), note];
  const next = i + 1;
  const progress = Math.round(5 + (55 * next) / total);
  if (next < total) {
    return { partials, chunk_index: next, progress, draft: { ...src.draft, attempts: 0 } };
  }
  // 여러 조각이거나 노트에 더하는 자료면 합치기 단계로
  if (total > 1 || src.parent_id) return { partials, chunk_index: next, step: 'merge', progress, draft: { ...src.draft, attempts: 0 } };
  return { partials: [], chunk_index: next, step: 'visual', progress: 62, draft: { ...src.draft, note, attempts: 0 } };
}

async function stepMerge(ctx: Ctx): Promise<Partial<SourceRow>> {
  const parts = (ctx.src.partials ?? []).map((p) => zNote.parse(p));
  if (ctx.src.parent_id) return stepAppendMerge(ctx, parts);
  const content = [textBlock(wrap('partials', JSON.stringify(parts))), textBlock(mergePrompt(parts.length))];
  const json = await ai(ctx, 'merge', content, noteJsonSchema, 8000);
  const note = normalizeNote(zNote.parse(json));
  return { partials: [], step: 'visual', progress: 66, draft: { ...ctx.src.draft, note, attempts: 0 } };
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
  // base 는 늘 적는다 (지문 함수가 없는 DB 면 null: 확인하지 않는다)
  const draft: Record<string, unknown> = { ...ctx.src.draft, note, newParts: parts, parentNoteId: n.id, base: n.base, attempts: 0 };
  delete draft.baseVersion;
  return { partials: [], step: 'visual', progress: 66, draft };
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
  const content = [
    textBlock(wrap('note', noteForPrompt(note))),
    ...(pid ? [textBlock(wrap('new_parts', JSON.stringify(ctx.src.draft.newParts ?? [])))] : []),
    textBlock(wrap('existing_questions', JSON.stringify(existing))),
    textBlock(quizPrompt({ types: q.types, mix: q.mix, language: q.language, perKeyPoint: q.perKeyPoint }, { onlyNew: !!pid })),
  ];
  const json = await ai(ctx, 'quiz', content, quizJsonSchema, 8000);
  const raw = zQuiz.parse(json).questions;
  const rows = raw
    .map((r) => zQuizItem.safeParse(r))
    .filter((r) => r.success)
    .map((r) => toQuestionRow(r.data))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .filter((r) => q.types.includes(r.type))
    .slice(0, 40);
  return { step: 'check', progress: 88, draft: { ...ctx.src.draft, questions: rows, attempts: 0 } };
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

async function stepCheckAndFinish(ctx: Ctx): Promise<'done' | Partial<SourceRow>> {
  if (await baseIsStale(ctx)) return remergePatch(ctx.src);
  const note = zNote.parse(ctx.src.draft.note);
  const visual = zVisualResult.parse(ctx.src.draft.visual) as VisualResult;
  const questions = (ctx.src.draft.questions as ReturnType<typeof toQuestionRow>[] | undefined)?.filter(Boolean) ?? [];

  let kept = questions;
  if (questions.length) {
    const listed = questions.map((x, index) => ({ index, ...x }));
    const content = [textBlock(wrap('note', noteForPrompt(note))), textBlock(wrap('questions', JSON.stringify(listed))), textBlock(checkPrompt())];
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

  const visuals: Array<{ type: string; spec: unknown }> = [{ type: 'mindmap', spec: visual.mindmap }];
  if (visual.table.include && visual.table.columns.length && visual.table.rows.length) {
    visuals.push({ type: 'table', spec: { title: visual.table.title, columns: visual.table.columns, rows: visual.table.rows } });
  }
  if (visual.timeline.include && visual.timeline.events.length) {
    visuals.push({ type: 'timeline', spec: { title: visual.timeline.title, events: visual.timeline.events } });
  }
  let noteBody: Record<string, unknown> = { ...note, recommended: visual.recommended };
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
    if ((await finalizeAppend(ctx, { p_note: noteBody, p_visuals: visuals, p_questions: kept, p_expire: expire })) === 'stale') return remergePatch(ctx.src);
  } else {
    const { error } = await ctx.admin.rpc('kok_finalize_source', {
      p_source: ctx.src.id,
      p_title: note.title || ctx.src.title,
      p_note: noteBody,
      p_visuals: visuals,
      p_questions: kept,
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

function friendly(e: unknown): string {
  if (e instanceof UserFacingError) return e.message;
  if (e instanceof PdfError) return e.message;
  if (e instanceof AiCallError) {
    if (e.kind === 'refusal') return e.message;
    if (e.kind === 'retryable') return 'AI 서버가 바빠서 끝내지 못했어요. "다시 하기"를 눌러 주세요.';
    return 'AI가 정리하다가 문제가 생겼어요. "다시 하기"를 눌러 주세요.';
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
    switch (src.step) {
      case 'organize':
        patch = await stepOrganize(ctx);
        break;
      case 'merge':
        patch = await stepMerge(ctx);
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
      await release(admin, src.id, { status: 'error', error: friendly(e), draft: { ...src.draft, attempts: 0 } });
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
