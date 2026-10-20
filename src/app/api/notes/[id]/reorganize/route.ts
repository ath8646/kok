// 합친 노트를 AI 로 다시 정리 (Pro): 겹치는 개념을 하나로 묶고 차례를 다듬어 새 버전으로 저장한다 (kok_reorganize_note).
// 다시 정리하기 전의 노트는 버전 기록에 남는다. 문제·푼 기록은 그대로 두고 개념 번호만 따라간다.
// 마인드맵은 개념 번호만 바꿔 두고, 화면이 이어서 그림 다시 만들기(/api/notes/[id]/visual)로 새로 그린다
import type { NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoAppendRunning, assertNoteHasContent, loadOwnedNote } from '@/lib/server/notes';
import { assertMergeReady, dbError } from '@/lib/server/organize';
import { runTask } from '@/lib/server/tasks';
import { textBlock } from '@/lib/server/claude';
import { reorganizePrompt, wrap } from '@/lib/ai/prompts';
import { reorganizeJsonSchema, zMindmap, zNote, zReorganize } from '@/lib/ai/schemas';
import { MERGE_OUT_TOKENS, estimateTokens, mergeFits, noteForMerge } from '@/lib/append-merge';
import { readMergedMark } from '@/lib/note-merge';
import { remapFigures, remapMindmap, reorganizeMaxKeyPoints, settleReorganized } from '@/lib/note-reorganize';
import { readFigures } from '@/lib/source-figures';

export const maxDuration = 300;

const TOO_LONG = '노트가 너무 길어서 AI로 다시 정리하지 못했어요. 정리 탭에서 겹치는 개념을 직접 고쳐 주세요.';

const MESSAGES = {
  stale_note: ['AI가 정리하는 동안 노트가 바뀌어서 저장하지 못했어요. 새로 고친 뒤 다시 해 주세요.', 409],
  append_running: ['이 노트에 자료를 더하는 중이에요. 끝난 뒤에 해 주세요.', 409],
  note_not_found: ['노트를 찾을 수 없어요.', 404],
} as const;

/** 정리 글 길이 끝 (DB 칸 한도 512KB 보다 넉넉히 작게) */
const MAX_BODY_CHARS = 400_000;

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/reorganize'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    if (!acc.canAppend) throw new UserFacingError('pro_only', 'AI로 다시 정리하기는 Pro에서 쓸 수 있어요.', 403);
    await assertMergeReady(admin);
    const note = await loadOwnedNote(admin, id, acc.userId);
    if (!readMergedMark(note.raw)) throw new UserFacingError('not_merged', '여러 노트를 합친 노트만 AI로 다시 정리할 수 있어요.', 400);
    // 에너지를 쓰기 전에 안 되는 것을 먼저 알려 준다
    await assertNoAppendRunning(admin, note.source_id);
    assertNoteHasContent(note.note);
    const full = noteForMerge(note.note);
    if (!full || !mergeFits(full)) throw new UserFacingError('note_too_long', TOO_LONG, 400);

    // 새 개념에 쓰면 안 되는 번호: 이 노트의 개념, 문제(지난 버전 것까지)·마인드맵·자료 그림이 가리키는 번호
    const [{ data: qs, error: qErr }, { data: mm, error: mErr }] = await Promise.all([
      admin.from('questions').select('key_point_id').eq('note_id', note.id).not('key_point_id', 'is', null).limit(5000),
      admin.from('visuals').select('spec').eq('note_id', note.id).eq('type', 'mindmap').maybeSingle(),
    ]);
    if (qErr) throw qErr;
    if (mErr) throw mErr;
    const mindmap = mm ? (zMindmap.safeParse(mm.spec).data ?? null) : null;
    const figures = readFigures(note.raw);
    const reserved = new Set<string>(
      [
        ...note.note.key_points.map((k) => k.id),
        ...(qs ?? []).map((q) => String(q.key_point_id)),
        ...(mindmap?.nodes ?? []).map((n) => n.key_point_id),
        ...figures.map((f) => f.key_point_id),
      ].filter((x) => !!x && x.length <= 40),
    );
    const maxKeyPoints = reorganizeMaxKeyPoints(note.note.key_points.length);

    const app = await getAppSettings(admin);
    const json = await runTask(admin, acc, app, {
      task: 'reorganize',
      effortOf: 'merge',
      tier: acc.settings.models.organize,
      content: [
        textBlock(wrap('note', full)),
        textBlock(wrap('used_ids', JSON.stringify([...reserved].slice(0, 400)))),
        textBlock(reorganizePrompt(maxKeyPoints)),
      ],
      schema: reorganizeJsonSchema,
      maxTokens: MERGE_OUT_TOKENS,
      outTokens: Math.min(MERGE_OUT_TOKENS, estimateTokens(full) + 400),
      timeoutMs: 240_000,
      sourceId: note.source_id,
      tooLong: TOO_LONG,
    });
    const ai = zNote.parse(json);
    if (!ai.key_points.length) throw new UserFacingError('ai_bad_output', 'AI가 답을 제대로 만들지 못했어요. 다시 해 주세요.', 502);
    const { note: next, qmap, finalIds } = settleReorganized(note.note, ai, zReorganize.parse(json).id_map, { reserved });

    // 보기 설정·추천 그림 같은 다른 칸은 그대로, 합친 노트 표시는 뗀다 (다시 정리했으니)
    const body: Record<string, unknown> = { ...note.raw, ...next };
    delete body.merged;
    if (!next.summary_edited) delete body.summary_edited;
    if (!next.manual) delete body.manual;
    if (figures.length) body.figures = remapFigures(figures, qmap, finalIds);
    if (JSON.stringify(body).length > MAX_BODY_CHARS) throw new UserFacingError('note_too_long', TOO_LONG, 400);

    // 마인드맵은 AI 를 기다린 뒤에 다시 읽어서 개념 번호만 바꾼다 (그동안 다른 곳에서 고친 가지를 덮어쓰지 않게:
    // 저장하는 사이에 또 바뀌면 DB 함수가 updated_at 을 보고 멈춘다)
    const { data: mmNow, error: mmErr } = await admin
      .from('visuals')
      .select('spec, updated_at')
      .eq('note_id', note.id)
      .eq('type', 'mindmap')
      .maybeSingle();
    if (mmErr) throw mmErr;
    const mindmapNow = mmNow ? (zMindmap.safeParse(mmNow.spec).data ?? null) : null;
    const nextMap = remapMindmap(mindmapNow, qmap, finalIds);
    const { data: version, error } = await admin.rpc('kok_reorganize_note', {
      p_user: acc.userId,
      p_note: note.id,
      p_body: body,
      p_qmap: qmap,
      p_mindmap: nextMap,
      p_updated: note.updatedAt,
      p_mindmap_at: nextMap && mmNow ? String(mmNow.updated_at) : null,
    });
    if (error) throw dbError(error, MESSAGES);
    return Response.json({ ok: true, version: Number(version) });
  } catch (e) {
    return errorResponse(e);
  }
}
