// 자료 처리 파이프라인: 정리 → (합치기) → 그림 → 문제 → 검사·저장
// 한 번 부를 때 한 단계씩 진행하고, 상태는 sources 행에 저장한다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, SOURCES_BUCKET } from '@/lib/supabase/admin';
import {
  checkJsonSchema,
  noteJsonSchema,
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
import { checkPrompt, mergePrompt, organizePrompt, quizPrompt, visualPrompt, wrap, type MaterialMeta } from '@/lib/ai/prompts';
import { modelForTier, type AiTask, type UserSettings } from '@/lib/settings';
import { planChunks, slicePdf, splitText, PdfError } from '@/lib/pdf';
import { getAccount, getAppSettings, charge, refundSource, type Account, type AppSettings } from './account';
import { AiCallError, callJson, imageBlock, pdfBlock, textBlock, usageOf, type ContentPart } from './claude';
import { UserFacingError } from './errors';
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
  return modelForTier(ctx.app.models, tier, ctx.acc.isPro, ctx.acc.isAdmin);
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

/** 노트 번호(k1, k2 …)가 비었거나 겹치면 고친다 */
export function normalizeNote(note: Note): Note {
  const seen = new Set<string>();
  const remap = new Map<string, string>();
  const key_points = note.key_points.slice(0, 9).map((kp, i) => {
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
async function stepOrganize(ctx: Ctx): Promise<Partial<SourceRow>> {
  const { src, admin } = ctx;
  const i = src.chunk_index;
  const total = src.chunk_total;
  const meta: MaterialMeta = { title: src.title || '공부 자료', kind: src.kind, part: i + 1, parts: total };
  const content: ContentPart[] = [];

  if (src.kind === 'pdf') {
    const bytes = await download(admin, src.file_paths[0]);
    const chunks = planChunks(src.page_count ?? 1);
    const c = chunks[Math.min(i, chunks.length - 1)];
    const slice = await slicePdf(bytes, c.start, c.end);
    meta.pageStart = c.start;
    meta.pageEnd = c.end;
    content.push(pdfBlock(slice));
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
  if (total > 1) return { partials, chunk_index: next, step: 'merge', progress, draft: { ...src.draft, attempts: 0 } };
  return { partials: [], chunk_index: next, step: 'visual', progress: 62, draft: { ...src.draft, note, attempts: 0 } };
}

async function stepMerge(ctx: Ctx): Promise<Partial<SourceRow>> {
  const parts = (ctx.src.partials ?? []).map((p) => zNote.parse(p));
  const content = [textBlock(wrap('partials', JSON.stringify(parts))), textBlock(mergePrompt(parts.length))];
  const json = await ai(ctx, 'merge', content, noteJsonSchema, 8000);
  const note = normalizeNote(zNote.parse(json));
  return { partials: [], step: 'visual', progress: 66, draft: { ...ctx.src.draft, note, attempts: 0 } };
}

async function stepVisual(ctx: Ctx): Promise<Partial<SourceRow>> {
  const note = zNote.parse(ctx.src.draft.note);
  const v = ctx.settings.visual;
  const maxNodes = maxNodesFor(v.depth);
  const content = [textBlock(wrap('note', noteForPrompt(note))), textBlock(visualPrompt({ depth: v.depth, labelStyle: v.labels, maxNodes }))];
  const json = await ai(ctx, 'visual', content, visualJsonSchema, 4000);
  const visual = zVisualResult.parse(json);
  visual.mindmap = cleanMindmap(visual.mindmap, maxNodes);
  return { step: 'quiz', progress: 76, draft: { ...ctx.src.draft, visual, attempts: 0 } };
}

async function stepQuiz(ctx: Ctx): Promise<Partial<SourceRow>> {
  const note = zNote.parse(ctx.src.draft.note);
  const q = ctx.settings.quiz;
  const content = [
    textBlock(wrap('note', noteForPrompt(note))),
    textBlock(wrap('existing_questions', '[]')),
    textBlock(quizPrompt({ types: q.types, mix: q.mix, language: q.language, perKeyPoint: q.perKeyPoint })),
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

async function stepCheckAndFinish(ctx: Ctx): Promise<'done'> {
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
  const noteBody = { ...note, recommended: visual.recommended };
  const expire =
    ctx.acc.isPro || ctx.acc.isAdmin || ctx.src.kind === 'text' ? null : new Date(Date.now() + ctx.app.limits.freeFileDays * 86400_000).toISOString();

  const { error } = await ctx.admin.rpc('kok_finalize_source', {
    p_source: ctx.src.id,
    p_title: note.title || ctx.src.title,
    p_note: noteBody,
    p_visuals: visuals,
    p_questions: kept,
    p_expire: expire,
  });
  if (error) throw error;
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
      case 'check':
        await stepCheckAndFinish(ctx);
        return 'done';
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
