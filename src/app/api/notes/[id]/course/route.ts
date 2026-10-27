// 단계별 학습 (Pro): 노트 하나를 AI 가 단계 → 레슨(카드·확인 문제)으로 나눈 학습 길로 만든다.
// POST { level }: 만들기 (있으면 새로 만들어 바꾸고 진도는 처음부터). DELETE: 지우기.
// 참고 자료: 정리 노트(지문), 지금 문제(참고만), 자료 그림 설명, 원본 자료(글은 그대로, PDF·사진은 작을 때만 함께 보낸다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings, getFeatures } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoteHasContent, loadOwnedNote, noteForPrompt } from '@/lib/server/notes';
import { runTaskFull } from '@/lib/server/tasks';
import { imageBlock, pdfBlock, textBlock, type ContentPart } from '@/lib/server/claude';
import { downloadOwn } from '@/lib/server/files';
import { coursePrompt, wrap } from '@/lib/ai/prompts';
import { courseJsonSchema, zCourseAi } from '@/lib/ai/schemas';
import { figuresForPrompt, readFigures } from '@/lib/source-figures';
import { COURSE_LEVELS, COURSE_MATERIAL, courseOut, settleCourse } from '@/lib/course';
import { coursePlanRange } from '@/lib/ai/scale';
import { slicePdf } from '@/lib/pdf';
import { stripMarks } from '@/lib/richtext';

export const maxDuration = 300;

const Body = z.object({ level: z.enum(COURSE_LEVELS) });

const PRO_ONLY = '단계별 학습은 Pro에서 쓸 수 있어요.';

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/course'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    if (!acc.canAppend) throw new UserFacingError('pro_only', PRO_ONLY, 403);
    const features = await getFeatures(admin);
    if (!features.courses) throw new UserFacingError('not_ready', '아직 준비 중이에요. 잠시 뒤에 다시 해 주세요.', 503);
    const parsed = Body.safeParse(await readJson(req, 2_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const { level } = parsed.data;
    const note = await loadOwnedNote(admin, id, acc.userId);
    assertNoteHasContent(note.note);

    // 참고: 지금 문제(글만), 자료 그림 설명, 원본 자료
    const [{ data: qs, error: qErr }, { data: src, error: sErr }] = await Promise.all([
      admin
        .from('questions')
        .select('type, prompt, choices, answer')
        .eq('note_id', note.id)
        .eq('user_id', acc.userId)
        .neq('status', 'hidden')
        .order('created_at')
        .limit(30),
      admin.from('sources').select('kind, file_paths, page_count, text_content').eq('id', note.source_id).maybeSingle(),
    ]);
    if (qErr) throw qErr;
    if (sErr) throw sErr;
    const figures = features.sourceFigures ? readFigures(note.raw) : [];
    const material = await materialBlocks(admin, src);

    const content: ContentPart[] = [
      textBlock(wrap('note', noteForPrompt(note.note))),
      ...(qs?.length
        ? [textBlock(wrap('questions', JSON.stringify(qs.map((q) => ({ type: q.type, prompt: String(q.prompt).slice(0, 300), answer: answerText(q) })))))]
        : []),
      ...(figures.length ? [textBlock(wrap('figures', JSON.stringify(figuresForPrompt(figures))))] : []),
      ...material.blocks,
      textBlock(coursePrompt(level, coursePlanRange(note.note.key_points.length))),
    ];
    const out = courseOut(note.note.key_points.length);
    const app = await getAppSettings(admin);
    const { json, energy, model } = await runTaskFull(admin, acc, app, {
      task: 'course',
      effortOf: 'organize',
      tier: acc.settings.models.organize,
      content,
      schema: courseJsonSchema,
      maxTokens: out.max,
      outTokens: out.estimate,
      extraInputTokens: material.tokens,
      timeoutMs: 240_000,
      sourceId: note.source_id,
      tooLong: '노트가 너무 커서 학습 길을 한 번에 만들지 못했어요. 노트를 나눠 보세요.',
    });
    const plan = settleCourse(
      zCourseAi.parse(json),
      note.note.key_points.map((k) => k.id),
    );
    if (!plan) throw new UserFacingError('ai_bad_output', 'AI가 학습 길을 제대로 만들지 못했어요. 다시 해 주세요.', 502);

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
    if (src.kind === 'text') {
      const text = stripMarks(src.text_content ?? '').slice(0, COURSE_MATERIAL.textChars);
      return text ? { blocks: [textBlock(wrap('material', text))], tokens: 0 } : { blocks: [], tokens: 0 };
    }
    const paths = (src.file_paths ?? []).filter((p) => typeof p === 'string');
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
