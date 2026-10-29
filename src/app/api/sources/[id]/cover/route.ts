// 자료함 카드의 표지 그림 (Pro): 그리기·다시 그리기(POST)와 빼기(DELETE, 모든 플랜).
// 노트 내용(줄임)으로 AI 가 문제 그림체 설계도를 그리고(lib/cover.ts), sources.cover 에 저장한다 (학생은 읽기만)
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zNote } from '@/lib/ai/schemas';
import { COVER_OUT_TOKENS, coverJsonSchema, coverNoteExcerpt } from '@/lib/cover';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { getAppSettings, getFeatures } from '@/lib/server/account';
import { coverContent, settleCover } from '@/lib/server/cover';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoteHasContent } from '@/lib/server/notes';
import { runTask } from '@/lib/server/tasks';

// AI 한 번 (timeoutMs 는 이보다 짧게)
export const maxDuration = 60;

type Owned = { id: string; user_id: string; subject_id: string; status: string; parent_id: string | null };

/** 내 자료 (노트에 더한 자료는 표지가 없다: 노트의 처음 자료만) */
async function ownSource(admin: SupabaseClient, id: string, userId: string): Promise<Owned> {
  const { data, error } = await admin.from('sources').select('id, user_id, subject_id, status, parent_id').eq('id', id).maybeSingle();
  if (error) throw error;
  const src = data as Owned | null;
  if (!src || src.user_id !== userId || src.parent_id) throw new UserFacingError('not_found', '자료를 찾을 수 없어요.', 404);
  return src;
}

async function assertCoversOn(admin: SupabaseClient) {
  if (!(await getFeatures(admin)).covers) throw new UserFacingError('covers_off', '표지 그림을 아직 쓸 수 없어요.', 400);
}

export async function POST(req: NextRequest, ctx: RouteContext<'/api/sources/[id]/cover'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    await assertCoversOn(admin);
    if (!acc.canFigures) throw new UserFacingError('pro_only', '표지 그림은 Pro에서 쓸 수 있어요.', 403);
    const src = await ownSource(admin, id, acc.userId);
    if (src.status !== 'ready') throw new UserFacingError('not_ready', '노트가 다 만들어진 뒤에 그릴 수 있어요.', 409);
    const [{ data: noteRow, error: noteErr }, { data: subj }] = await Promise.all([
      admin.from('notes').select('body').eq('source_id', id).maybeSingle(),
      admin.from('subjects').select('name').eq('id', src.subject_id).maybeSingle(),
    ]);
    if (noteErr) throw noteErr;
    if (!noteRow) throw new UserFacingError('not_found', '노트를 찾을 수 없어요.', 404);
    const note = zNote.parse(noteRow.body ?? {});
    // 비어 있는 노트(직접 만들고 아직 안 채움)는 에너지를 쓰기 전에 알려 준다
    assertNoteHasContent(note);
    const app = await getAppSettings(admin);
    const json = await runTask(admin, acc, app, {
      task: 'cover',
      effortOf: 'cover',
      tier: acc.settings.models.visual,
      content: coverContent(coverNoteExcerpt(note, typeof subj?.name === 'string' ? subj.name : '')),
      schema: coverJsonSchema,
      maxTokens: COVER_OUT_TOKENS,
      outTokens: 2200,
      timeoutMs: 50_000,
      sourceId: id,
    });
    const cover = settleCover(json);
    if (!cover) throw new UserFacingError('cover_empty', 'AI가 그림을 제대로 그리지 못했어요. 다시 해 주세요.', 502);
    const { error } = await admin.from('sources').update({ cover }).eq('id', id).eq('user_id', acc.userId);
    if (error) throw error;
    return Response.json({ ok: true, cover });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 표지 빼기: 카드에 다시 한 줄 요약이 보인다 (Pro 가 끝나도 뺄 수 있다) */
export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/sources/[id]/cover'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    await assertCoversOn(admin);
    await ownSource(admin, id, acc.userId);
    const { error } = await admin.from('sources').update({ cover: null }).eq('id', id).eq('user_id', acc.userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
