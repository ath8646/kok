// 단계별 학습 (Pro): 노트 하나를 AI 가 단계 → 레슨(카드·확인 문제)으로 나눈 학습 길로 만든다.
// POST { level }: 만들기 (있으면 새로 만들어 바꾸고 진도는 처음부터). DELETE: 지우기.
// 참고 자료: 정리 노트(지문), 지금 문제(참고만), 자료 그림 설명, 원본 자료(글은 그대로, PDF·사진은 작을 때만 함께 보낸다).
// 큰 노트(레슨 9개 넘게: lib/course.ts courseStaged)는 두 번에 나눠 만든다: 길의 뼈대 한 번 → 단계마다 레슨을 동시에.
// 한 단계가 끝내 안 되면 그 단계만 노트의 설명·문제로 채워서(AI 없이) 길 전체가 실패하지 않게 한다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { assertPerk, getAppSettings, getFeatures, type Account, type AppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoteHasContent, loadOwnedNote, noteForPrompt } from '@/lib/server/notes';
import { runTaskFull } from '@/lib/server/tasks';
import { imageBlock, pdfBlock, textBlock, type ContentPart } from '@/lib/server/claude';
import { downloadOwn } from '@/lib/server/files';
import { courseOutlinePrompt, coursePrompt, courseUnitPrompt, wrap } from '@/lib/ai/prompts';
import {
  courseJsonSchema,
  courseOutlineJsonSchema,
  courseUnitJsonSchema,
  zCourseAi,
  zCourseOutline,
  zCourseUnit,
  type CourseOutline,
  type CourseUnitAi,
  type Note,
} from '@/lib/ai/schemas';
import { figuresForPrompt, readFigures, type SourceFigure } from '@/lib/source-figures';
import {
  COURSE_LEVELS,
  COURSE_MATERIAL,
  assembleCourse,
  courseCost,
  courseOut,
  courseOutlineOut,
  courseStaged,
  courseUnitOut,
  fallbackLessons,
  fallbackOutline,
  noteForStage,
  settleCourse,
  settleOutline,
  type CourseLevel,
  type NoteQuestionLite,
} from '@/lib/course';
import { aiWaitMs, coursePlanRange } from '@/lib/ai/scale';
import { estimateSmallTask } from '@/lib/ai/models';
import { modelForTier } from '@/lib/settings';
import { slicePdf } from '@/lib/pdf';
import { stripMarks } from '@/lib/richtext';
import { pictureNumbers, renumberPictures } from '@/lib/doc-pictures';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 300;

/** 이 시간 안에 끝낸다 (서버 함수 300초에서 저장할 여유를 뺀 값) */
const ROUTE_MS = 280_000;
/** AI 가 답을 못 만든 까닭 (이때만 AI 없이 채운다. 에너지 부족·신고 등은 그대로 알린다) */
const AI_FAILED = new Set(['ai_busy', 'ai_bad_output', 'ai_too_long']);

const Body = z.object({ level: z.enum(COURSE_LEVELS) });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/course'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    assertPerk(acc, 'course', '단계별 학습');
    const features = await getFeatures(admin);
    if (!features.courses) throw new UserFacingError('not_ready', '아직 준비 중이에요. 잠시 뒤에 다시 해 주세요.', 503);
    const parsed = Body.safeParse(await readJson(req, 2_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const { level } = parsed.data;
    const note = await loadOwnedNote(admin, id, acc.userId);
    assertNoteHasContent(note.note);

    const started = Date.now();
    const left = () => started + ROUTE_MS - Date.now();
    // 참고: 지금 문제(글만), 자료 그림 설명, 원본 자료
    const [{ data: qs, error: qErr }, { data: src, error: sErr }] = await Promise.all([
      admin
        .from('questions')
        .select('type, prompt, choices, answer, accepted, explanation, key_point_id')
        .eq('note_id', note.id)
        .eq('user_id', acc.userId)
        .neq('status', 'hidden')
        .order('created_at')
        .limit(200),
      admin.from('sources').select('kind, file_paths, page_count, text_content').eq('id', note.source_id).maybeSingle(),
    ]);
    if (qErr) throw qErr;
    if (sErr) throw sErr;
    const questions = (qs ?? []) as NoteQuestionLite[];
    const figures = features.sourceFigures ? readFigures(note.raw) : [];
    const keyPointIds = note.note.key_points.map((k) => k.id);
    const n = note.note.key_points.length;
    const app = await getAppSettings(admin);

    const built = courseStaged(n)
      ? await buildStaged(admin, acc, app, { level, note: note.note, sourceId: note.source_id, questions, figures, left })
      : await buildOnce(admin, acc, app, { level, note: note.note, sourceId: note.source_id, questions, figures, src, left });
    const plan = settleCourse(built.course, keyPointIds);
    if (!plan) throw new UserFacingError('ai_bad_output', 'AI가 학습 길을 제대로 만들지 못했어요. 다시 해 주세요.', 502);
    const { energy, model } = built;

    // 노트 하나에 하나: 있으면 새것으로 바꾸고 진도는 처음부터
    const { data: row, error } = await admin
      .from('note_courses')
      .upsert({ user_id: acc.userId, note_id: note.id, level, plan, progress: {}, model, energy }, { onConflict: 'note_id' })
      .select('id, level, plan, progress, created_at, updated_at')
      .single();
    if (error) throw error;
    return Response.json({ ok: true, course: row, energy });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/course'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const note = await loadOwnedNote(admin, id, acc.userId);
    const { error } = await admin.from('note_courses').delete().eq('note_id', note.id).eq('user_id', acc.userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

type BuildArgs = {
  level: CourseLevel;
  note: Note;
  sourceId: string;
  questions: NoteQuestionLite[];
  figures: SourceFigure[];
  left: () => number;
};
type Built = { course: ReturnType<typeof zCourseAi.parse>; energy: number; model: string };

/** 지금 문제 (참고만: 같은 문제를 내지 않게) */
function questionsBlock(qs: NoteQuestionLite[]): ContentPart[] {
  return qs.length
    ? [textBlock(wrap('questions', JSON.stringify(qs.map((q) => ({ type: q.type, prompt: String(q.prompt).slice(0, 300), answer: answerText(q) })))))]
    : [];
}

/** 레슨이 적은 노트: 한 번에 (원본 자료도 함께) */
async function buildOnce(admin: SupabaseClient, acc: Account, app: AppSettings, a: BuildArgs & { src: SourceLite }): Promise<Built> {
  const material = await materialBlocks(admin, a.src);
  const content: ContentPart[] = [
    textBlock(wrap('note', noteForPrompt(a.note))),
    ...questionsBlock(a.questions.slice(0, 30)),
    ...(a.figures.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(a.figures))))] : []),
    ...material.blocks,
    textBlock(coursePrompt(a.level, coursePlanRange(a.note.key_points.length))),
  ];
  const out = courseOut(a.note.key_points.length);
  const { json, energy, model } = await runTaskFull(admin, acc, app, {
    task: 'course',
    effortOf: 'organize',
    tier: acc.settings.models.organize,
    content,
    schema: courseJsonSchema,
    maxTokens: out.max,
    outTokens: out.estimate,
    extraInputTokens: material.tokens,
    timeoutMs: Math.min(aiWaitMs(out.max), a.left()),
    sourceId: a.sourceId,
    tooLong: '노트가 너무 커서 학습 길을 한 번에 만들지 못했어요. 다시 해 주세요.',
  });
  return { course: zCourseAi.parse(json), energy, model };
}

/**
 * 레슨이 많은 노트: 길의 뼈대 → 단계마다 레슨(동시에). 에너지는 처음에 모두 합친 예상으로 한 번 검사하고, 부를 때마다 쓴 만큼 낸다.
 * 뼈대를 못 받으면 개념 차례대로 뼈대를 만들고, 한 단계를 두 번 못 받으면 그 단계만 노트로 채운다 (모든 단계가 안 되면 AI 가 바쁜 것: 알린다)
 */
async function buildStaged(admin: SupabaseClient, acc: Account, app: AppSettings, a: BuildArgs): Promise<Built> {
  const n = a.note.key_points.length;
  const keyPointIds = a.note.key_points.map((k) => k.id);
  const model = modelForTier(app.models, acc.settings.models.organize, acc.canCareful, acc.isAdmin);
  const noteText = noteForPrompt(a.note);
  const cost = courseCost(n, noteText.length);
  const estimate = estimateSmallTask(model, app.limits.usdPerEnergy, cost.inputTokens, cost.outTokens);
  let energy = 0;
  let used = model;
  const base = { task: 'course', effortOf: 'organize' as const, tier: acc.settings.models.organize, sourceId: a.sourceId };

  // 1. 길의 뼈대
  let outline: CourseOutline | null = null;
  const outlineMax = courseOutlineOut(n);
  try {
    const r = await runTaskFull(admin, acc, app, {
      ...base,
      content: [
        textBlock(wrap('note', noteText)),
        ...questionsBlock(a.questions.slice(0, 30)),
        ...(a.figures.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(a.figures))))] : []),
        textBlock(courseOutlinePrompt(a.level, coursePlanRange(n))),
      ],
      schema: courseOutlineJsonSchema,
      maxTokens: outlineMax,
      outTokens: Math.round(outlineMax * 0.6),
      minEstimate: estimate,
      // 단계를 만들 시간을 남긴다
      timeoutMs: Math.min(aiWaitMs(outlineMax), 110_000),
    });
    energy += r.energy;
    used = r.model;
    outline = settleOutline(zCourseOutline.parse(r.json), keyPointIds);
  } catch (e) {
    if (!(e instanceof UserFacingError && AI_FAILED.has(e.code))) throw e;
    console.warn('[kok] course outline failed, using the note order', a.sourceId, e.code);
  }
  if (!outline) outline = settleOutline(fallbackOutline(a.note), keyPointIds);
  if (!outline) throw new UserFacingError('ai_bad_output', 'AI가 학습 길을 제대로 만들지 못했어요. 다시 해 주세요.', 502);
  const path = outline;
  const pathJson = JSON.stringify({
    title: path.title,
    units: path.units.map((u, i) => ({
      stage: i + 1,
      title: u.title,
      lessons: u.lessons.map((l) => ({ title: l.title, goal: l.goal, key_point_ids: l.key_point_ids })),
    })),
  });

  // 2. 단계마다 레슨 (동시에). 실패하면 시간이 남았을 때 한 번 더
  const callUnit = async (ui: number): Promise<CourseUnitAi['lessons']> => {
    const u = path.units[ui];
    const ids = [...new Set(u.lessons.flatMap((l) => l.key_point_ids))];
    const idSet = new Set(ids);
    const max = courseUnitOut(u.lessons.length);
    const qsOf = a.questions.filter((q) => typeof q.key_point_id === 'string' && idSet.has(q.key_point_id)).slice(0, 12);
    const figsOf = a.figures.filter((f) => idSet.has(f.key_point_id));
    const r = await runTaskFull(admin, acc, app, {
      ...base,
      content: [
        textBlock(wrap('path', pathJson)),
        textBlock(wrap('note', noteForPrompt(noteForStage(a.note, ids)))),
        ...questionsBlock(qsOf),
        ...(figsOf.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(figsOf))))] : []),
        textBlock(courseUnitPrompt(a.level, { index: ui, title: u.title, lessons: u.lessons.length })),
      ],
      schema: courseUnitJsonSchema,
      maxTokens: max,
      outTokens: Math.round(max * 0.6),
      // 처음에 모두 합쳐 검사했다
      minEstimate: 0,
      rateLimit: false,
      timeoutMs: Math.max(20_000, Math.min(aiWaitMs(max), a.left() - 5_000)),
    });
    energy += r.energy;
    used = r.model;
    return zCourseUnit.parse(r.json).lessons;
  };
  let failed = 0;
  // AI 가 아닌 까닭(에너지·멈춤·저장 등)으로 못 받은 단계의 오류: 다른 단계는 다시 부르지 않고, 모든 단계가 안 됐을 때 이것을 알린다
  let stop: unknown = null;
  const units = await Promise.all(
    path.units.map(async (u, ui) => {
      for (let attempt = 0; attempt < 2 && !stop; attempt++) {
        try {
          const lessons = await callUnit(ui);
          if (lessons.some((l) => l.cards.length)) return lessons;
        } catch (e) {
          // 한 단계의 오류로 다른 단계(이미 에너지를 쓴 것)까지 버리지 않는다: 이 단계만 노트로 채운다
          if (e instanceof UserFacingError && AI_FAILED.has(e.code)) {
            console.warn('[kok] course unit failed', a.sourceId, ui, attempt, e.code);
          } else {
            console.error('[kok] course unit error', a.sourceId, ui, e);
            stop ??= e;
            break;
          }
        }
        // 다시 부를 시간이 없으면 그만 (노트로 채운다)
        if (a.left() < 75_000) break;
      }
      failed++;
      return fallbackLessons(u.lessons, a.note, a.questions);
    }),
  );
  // 모든 단계가 안 됐으면: AI 가 아닌 까닭이 있으면 그것을, 아니면 AI 가 지금 바쁜 것이다.
  // 노트만으로 채운 길을 주지 않고 알린다 (에너지는 쓴 만큼만)
  if (failed === path.units.length) {
    if (stop) throw stop;
    throw new UserFacingError('ai_busy', 'AI 서버가 바빠서 학습 길을 다 만들지 못했어요. 잠시 뒤에 다시 해 주세요.', 503);
  }
  return { course: assembleCourse(path, units), energy: Math.round(energy * 10) / 10, model: used };
}

function answerText(q: { type: string; choices: unknown; answer: unknown }): string {
  if (q.type === 'mcq' && Array.isArray(q.choices) && typeof q.answer === 'number') return String(q.choices[q.answer] ?? '');
  if (q.type === 'ox') return q.answer ? 'O' : 'X';
  return String(q.answer ?? '').slice(0, 100);
}

type SourceLite = { kind: string; file_paths: string[] | null; page_count: number | null; text_content: string | null } | null;

/**
 * 원본 자료를 함께 보낸다: 글은 그대로(앞 2만 자), PDF 는 앞 몇 쪽만, 사진은 몇 장만.
 * 파일이 없거나(무료였던 때 지워짐) 너무 크면 노트만으로 만든다. tokens: 글로 세지 못하는 입력의 예상 토큰
 */
async function materialBlocks(admin: Awaited<ReturnType<typeof requireAccount>>['admin'], src: SourceLite): Promise<{ blocks: ContentPart[]; tokens: number }> {
  if (!src) return { blocks: [], tokens: 0 };
  try {
    const paths = (src.file_paths ?? []).filter((p) => typeof p === 'string');
    if (src.kind === 'text') {
      let text = stripMarks(src.text_content ?? '').slice(0, COURSE_MATERIAL.textChars);
      if (!text) return { blocks: [], tokens: 0 };
      // 그림 없는 글은 예전처럼 그대로
      if (!paths.length || !pictureNumbers(text).length) return { blocks: [textBlock(wrap('material', text))], tokens: 0 };
      // 한글·워드·PPT 속 그림: 앞의 몇 장만 같이 보낸다 (받지 못한 그림·나머지 그림 자리는 지우고, 번호는 'Picture N:' 차례로 다시)
      const got: Array<{ n: number; bytes: Uint8Array; path: string }> = [];
      for (const n of pictureNumbers(text).filter((x) => x <= paths.length)) {
        if (got.length >= COURSE_MATERIAL.images) break;
        try {
          got.push({ n, bytes: await downloadOwn(admin, paths[n - 1]), path: paths[n - 1] });
        } catch {
          // 그림이 없어졌다: 글만
        }
      }
      text = renumberPictures(
        text,
        got.map((g) => g.n),
      );
      const blocks: ContentPart[] = [textBlock(wrap('material', text))];
      if (got.length) {
        blocks.push(textBlock('Pictures from the document: a line "[[picture N]]" in <material> marks where "Picture N" appears.'));
        got.forEach((g, k) => blocks.push(textBlock(`Picture ${k + 1}:`), imageBlock(g.bytes, mediaTypeOf(g.path))));
      }
      return { blocks, tokens: got.length * 1600 };
    }
    if (!paths.length) return { blocks: [], tokens: 0 };
    if (src.kind === 'pdf') {
      const bytes = await downloadOwn(admin, paths[0]);
      if (bytes.byteLength > COURSE_MATERIAL.pdfBytes) return { blocks: [], tokens: 0 };
      const pages = Math.min(src.page_count ?? 1, COURSE_MATERIAL.pdfPages);
      const part = await slicePdf(bytes, 1, pages);
      return { blocks: [textBlock(`Original material (first ${pages} page(s)):`), pdfBlock(part)], tokens: pages * 3500 };
    }
    const blocks: ContentPart[] = [textBlock('Original material (photos):')];
    const take = paths.slice(0, COURSE_MATERIAL.images);
    for (const p of take) {
      const bytes = await downloadOwn(admin, p);
      blocks.push(imageBlock(bytes, mediaTypeOf(p)));
    }
    return { blocks, tokens: take.length * 2600 };
  } catch {
    // 파일을 못 읽어도 노트로 만든다
    return { blocks: [], tokens: 0 };
  }
}

function mediaTypeOf(path: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const p = path.toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
