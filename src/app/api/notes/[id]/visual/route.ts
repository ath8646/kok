// 그림 다시 만들기: preview(AI가 새로 그림, 저장 안 함) → apply(내가 고른 것을 저장)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoAppendRunning, assertSameVersion, loadOwnedNote, noteForPrompt, updateNoteBody } from '@/lib/server/notes';
import { runTask } from '@/lib/server/tasks';
import { cleanMindmap, maxNodesFor } from '@/lib/server/pipeline';
import { textBlock } from '@/lib/server/claude';
import { visualPrompt, wrap } from '@/lib/ai/prompts';
import { visualJsonSchema, zMindmap, zTable, zTimeline, zVisualResult, type Mindmap } from '@/lib/ai/schemas';

export const maxDuration = 150;

const Preview = z.object({ action: z.literal('preview'), want: z.enum(['table', 'timeline']).optional() });
const Apply = z.object({
  action: z.literal('apply'),
  /** 미리보기를 만든 노트 버전 (그사이 버전이 바뀌었으면 넣지 않는다) */
  version: z.number().int().min(1).optional(),
  recommended: z.enum(['mindmap', 'table', 'timeline']).optional(),
  mindmap: zMindmap.optional(),
  table: zTable.nullable().optional(),
  timeline: zTimeline.nullable().optional(),
});

function checkSizes(m?: Mindmap, t?: z.infer<typeof zTable> | null, tl?: z.infer<typeof zTimeline> | null) {
  if (m && (m.nodes.length > 150 || m.nodes.some((n) => n.label.length > 80 || n.id.length > 40))) {
    throw new UserFacingError('too_big', '마인드맵이 너무 커요.', 400);
  }
  if (t && (t.columns.length > 8 || t.rows.length > 60 || t.rows.some((r) => r.length > 8 || r.some((c) => c.length > 300)))) {
    throw new UserFacingError('too_big', '표가 너무 커요.', 400);
  }
  if (tl && (tl.events.length > 80 || tl.events.some((e) => e.label.length > 200 || e.detail.length > 400 || e.date.length > 40))) {
    throw new UserFacingError('too_big', '연표가 너무 커요.', 400);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/visual'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const body = await readJson(req, 400_000);
    const note = await loadOwnedNote(admin, id, acc.userId);

    const apply = Apply.safeParse(body);
    if (apply.success) {
      const a = apply.data;
      assertSameVersion(note, a.version);
      await assertNoAppendRunning(admin, note.source_id);
      checkSizes(a.mindmap, a.table, a.timeline);
      const rows: Array<{ user_id: string; note_id: string; type: string; spec: unknown }> = [];
      if (a.mindmap) rows.push({ user_id: acc.userId, note_id: note.id, type: 'mindmap', spec: a.mindmap });
      if (a.table) rows.push({ user_id: acc.userId, note_id: note.id, type: 'table', spec: a.table });
      if (a.timeline) rows.push({ user_id: acc.userId, note_id: note.id, type: 'timeline', spec: a.timeline });
      if (rows.length) {
        const { error } = await admin.from('visuals').upsert(rows, { onConflict: 'note_id,type' });
        if (error) throw error;
      }
      if (a.recommended) {
        const recommended = a.recommended;
        await updateNoteBody(admin, note.id, acc.userId, (cur) => ({ ...cur.raw, recommended }));
      }
      return Response.json({ ok: true });
    }

    const preview = Preview.safeParse(body);
    if (!preview.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    // 자료를 더하는 동안에는 적용할 수 없으니 에너지를 쓰기 전에 알려 준다
    await assertNoAppendRunning(admin, note.source_id);

    const app = await getAppSettings(admin);
    const v = acc.settings.visual;
    const maxNodes = maxNodesFor(v.depth);
    const { data: current } = await admin.from('visuals').select('spec').eq('note_id', note.id).eq('user_id', acc.userId).eq('type', 'mindmap').maybeSingle();
    const cur = current ? zMindmap.parse(current.spec) : null;
    // 내가 고친 노드는 그대로 둔다 (너무 많으면 앞의 것만)
    const locked = cur ? cur.nodes.filter((n) => n.edited).slice(0, 60) : [];

    const content = [textBlock(wrap('note', noteForPrompt(note.note)))];
    if (locked.length) {
      content.push(
        textBlock(
          wrap(
            'locked_nodes',
            JSON.stringify(
              locked.map(({ id: nid, parent_id, label }) => ({ id: nid.slice(0, 40), parent_id: parent_id.slice(0, 40), label: label.slice(0, 80) })),
            ),
          ),
        ),
      );
    }
    content.push(textBlock(visualPrompt({ depth: v.depth, labelStyle: v.labels, maxNodes, want: preview.data.want })));

    const json = await runTask(admin, acc, app, {
      task: 'visual',
      effortOf: 'visual',
      tier: acc.settings.models.visual,
      content,
      schema: visualJsonSchema,
      maxTokens: 4000,
      outTokens: 2500,
      timeoutMs: 120_000,
      sourceId: note.source_id,
    });
    const visual = zVisualResult.parse(json);
    const mindmap = cleanMindmap(visual.mindmap, maxNodes, locked);
    if (cur?.root_edited) {
      mindmap.root_label = cur.root_label;
      mindmap.root_edited = true;
    }
    return Response.json({
      ok: true,
      version: note.version,
      preview: {
        recommended: visual.recommended,
        mindmap,
        table:
          visual.table.include && visual.table.columns.length ? { title: visual.table.title, columns: visual.table.columns, rows: visual.table.rows } : null,
        timeline: visual.timeline.include && visual.timeline.events.length ? { title: visual.timeline.title, events: visual.timeline.events } : null,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
