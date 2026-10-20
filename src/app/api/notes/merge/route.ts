// 노트 합치기 (AI 없이, 에너지 없음): 고른 노트들을 남길 노트(into) 하나에 이어 붙인다.
// 합친 정리·마인드맵은 여기서 만들고(src/lib/note-merge.ts), 저장·문제 옮기기는 DB 함수가 한 번에 한다 (kok_merge_notes).
// 합친 노트에서 Pro 는 'AI로 다시 정리'(/api/notes/[id]/reorganize)로 겹치는 개념을 하나로 다듬을 수 있다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { removeFigureFolders, removePaths } from '@/lib/server/files';
import { assertMergeReady, dbError } from '@/lib/server/organize';
import { zMindmap, zTable, zTimeline } from '@/lib/ai/schemas';
import { MERGE_MAX_NOTES, mergeNotes, type MergePart } from '@/lib/note-merge';

export const maxDuration = 60;

const Body = z.object({
  /** 남길 노트의 자료 번호 */
  into: z.string().uuid(),
  /** 합쳐질 노트의 자료 번호 (붙일 차례대로) */
  from: z.array(z.string().uuid()).min(1).max(MERGE_MAX_NOTES - 1),
});

const MESSAGES = {
  stale_note: ['그사이 노트가 바뀌었어요. 새로 고친 뒤 다시 합쳐 주세요.', 409],
  not_ready: ['정리가 끝난 노트만 합칠 수 있어요.', 409],
  append_running: ['자료를 더하는 중인 노트가 있어요. 끝난 뒤에 합쳐 주세요.', 409],
  note_not_found: ['합칠 노트를 찾을 수 없어요. 새로 고친 뒤 다시 골라 주세요.', 404],
  bad_notes: ['합칠 노트를 두 개 이상 골라 주세요.', 400],
} as const;

/** 합친 노트 정리의 글 길이 끝 (DB 칸 한도 512KB 보다 넉넉히 작게) */
const MAX_BODY_CHARS = 400_000;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 4_000));
    if (!parsed.success) throw new UserFacingError('bad_body', `노트는 한 번에 ${MERGE_MAX_NOTES}개까지 합칠 수 있어요.`, 400);
    const into = parsed.data.into;
    const from = [...new Set(parsed.data.from)].filter((x) => x !== into);
    if (!from.length) throw new UserFacingError('bad_notes', MESSAGES.bad_notes[0], 400);
    await assertMergeReady(admin);
    const ids = [into, ...from];

    const { data: srcs, error: sErr } = await admin.from('sources').select('id, status, parent_id').in('id', ids).eq('user_id', acc.userId);
    if (sErr) throw sErr;
    if ((srcs ?? []).length !== ids.length) throw new UserFacingError('note_not_found', MESSAGES.note_not_found[0], 404);
    if ((srcs ?? []).some((s) => s.status !== 'ready' || s.parent_id)) throw new UserFacingError('not_ready', MESSAGES.not_ready[0], 409);

    const { data: notes, error: nErr } = await admin.from('notes').select('id, source_id, body, updated_at').in('source_id', ids).eq('user_id', acc.userId);
    if (nErr) throw nErr;
    const bySource = new Map((notes ?? []).map((n) => [String(n.source_id), n]));
    if (ids.some((id) => !bySource.has(id))) throw new UserFacingError('note_not_found', MESSAGES.note_not_found[0], 404);
    const noteIds = ids.map((id) => String(bySource.get(id)?.id));

    const [{ data: vis, error: vErr }, { data: qs, error: qErr }] = await Promise.all([
      admin.from('visuals').select('note_id, type, spec').in('note_id', noteIds),
      // 남길 노트의 문제가 가리키는 개념 번호 (지난 버전 문제까지): 새 개념에는 쓰지 않는다
      admin.from('questions').select('key_point_id').eq('note_id', noteIds[0]).not('key_point_id', 'is', null).limit(5000),
    ]);
    if (vErr) throw vErr;
    if (qErr) throw qErr;
    const partOf = (sourceId: string): MergePart => {
      const n = bySource.get(sourceId) as { id: string; body: unknown };
      const spec = (type: string) => (vis ?? []).find((v) => v.note_id === n.id && v.type === type)?.spec;
      return {
        noteId: String(n.id),
        body: n.body && typeof n.body === 'object' ? (n.body as Record<string, unknown>) : {},
        mindmap: zMindmap.safeParse(spec('mindmap')).data ?? null,
        table: zTable.safeParse(spec('table')).data ?? null,
        timeline: zTimeline.safeParse(spec('timeline')).data ?? null,
      };
    };
    const merged = mergeNotes(partOf(into), from.map(partOf), { reserved: (qs ?? []).map((q) => String(q.key_point_id)) });
    if (JSON.stringify(merged.body).length > MAX_BODY_CHARS) {
      throw new UserFacingError('too_big', '합친 노트가 너무 길어요. 노트를 몇 개씩 나눠서 합쳐 주세요.', 400);
    }

    const updated = Object.fromEntries((notes ?? []).map((n) => [String(n.id), String(n.updated_at)]));
    const { data, error } = await admin.rpc('kok_merge_notes', {
      p_user: acc.userId,
      p_into: noteIds[0],
      p_from: noteIds.slice(1),
      p_body: merged.body,
      p_visuals: merged.visuals,
      p_maps: merged.maps,
      p_updated: updated,
    });
    if (error) throw dbError(error, MESSAGES);
    const r = (data ?? {}) as { paths?: unknown; sources?: unknown; merged?: unknown };
    // 지운 더한 자료(지난 버전에만 쓰였거나 실패한 것)의 파일과 잘라 둔 그림 (내 폴더 것만)
    const paths = (Array.isArray(r.paths) ? r.paths : []).filter((p): p is string => typeof p === 'string' && p.startsWith(`${acc.userId}/`));
    const gone = (Array.isArray(r.sources) ? r.sources : []).filter((s): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s));
    try {
      if (paths.length) await removePaths(admin, paths);
      if (gone.length) await removeFigureFolders(admin, acc.userId, gone);
    } catch (e) {
      console.warn('[kok] could not remove files of merged notes', e);
    }
    return Response.json({ ok: true, sourceId: into, merged: typeof r.merged === 'number' ? r.merged : from.length });
  } catch (e) {
    return errorResponse(e);
  }
}
