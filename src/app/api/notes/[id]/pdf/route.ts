// PDF 요약 정리: 노트의 정리·마인드맵·자료 그림을 KOK 스타일 PDF 로 만들어 저장소에 두고(내id/pdf/자료id/<id>.pdf) note_pdfs 에 한 줄 남긴다.
// AI 없이 서버가 그린다 (번개 0). 만들 때마다 한 개씩 쌓이고(버전마다 따로), 이름 바꾸기는 화면이 note_pdfs.name 을 직접 고친다.
// POST { name?, theme? } 만들기 · DELETE { ids } 지우기 (파일도)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getFeatures } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { loadOwnedNote } from '@/lib/server/notes';
import { downloadOwn, pdfPath, removePaths } from '@/lib/server/files';
import { buildNotePdf, type PdfFigure } from '@/lib/server/note-pdf';
import { SOURCES_BUCKET } from '@/lib/supabase/admin';
import { zMindmap } from '@/lib/ai/schemas';
import { readFigures } from '@/lib/source-figures';
import { PDF_LIMITS } from '@/lib/note-pdf';

export const maxDuration = 60;

const Create = z.object({ name: z.string().max(PDF_LIMITS.name).optional(), theme: z.enum(['dark', 'light']).optional() });
const Remove = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/pdf'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const features = await getFeatures(admin);
    if (!features.pdfs) throw new UserFacingError('not_ready', '아직 준비 중이에요. 잠시 뒤에 다시 해 주세요.', 503);
    const parsed = Create.safeParse(await readJson(req, 4_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const note = await loadOwnedNote(admin, id, acc.userId);
    const empty = !note.note.key_points.length && !note.note.summary.trim() && !note.note.terms.length;
    if (empty) throw new UserFacingError('empty_note', '노트가 비어 있어요. 정리 탭에서 내용을 먼저 채워 주세요.', 400);

    const [{ count, error: cErr }, { data: subj }, { data: mm }] = await Promise.all([
      admin.from('note_pdfs').select('id', { count: 'exact', head: true }).eq('note_id', note.id).eq('user_id', acc.userId),
      admin.from('subjects').select('name').eq('id', note.subject_id).maybeSingle(),
      admin.from('visuals').select('spec').eq('note_id', note.id).eq('type', 'mindmap').maybeSingle(),
    ]);
    if (cErr) throw cErr;
    if ((count ?? 0) >= PDF_LIMITS.perNote) throw new UserFacingError('too_many', `PDF 요약은 노트마다 ${PDF_LIMITS.perNote}개까지 둘 수 있어요. 안 쓰는 것을 지워 주세요.`, 400);
    const mindmap = mm ? (zMindmap.safeParse(mm.spec).data ?? null) : null;

    // 자료 그림: 원본에서 자른 그림 몇 장 (못 읽은 그림은 뺀다)
    const figures: PdfFigure[] = [];
    if (features.sourceFigures) {
      for (const f of readFigures(note.raw).slice(0, PDF_LIMITS.figures)) {
        try {
          const bytes = await downloadOwn(admin, f.crop);
          figures.push({ title: f.title, caption: f.caption, bytes, w: f.w, h: f.h });
        } catch {
          /* 그림이 없으면 빼고 만든다 */
        }
      }
    }

    const title = note.title || note.note.title || '정리 노트';
    const theme = parsed.data.theme ?? 'dark';
    const name = (parsed.data.name ?? '').trim() || `${title}${count ? ` (${count + 1})` : ''}`.slice(0, PDF_LIMITS.name);
    const { bytes, pages } = await buildNotePdf({
      title,
      subject: String(subj?.name ?? ''),
      unit: note.note.unit,
      note: note.note,
      mindmap,
      figures,
      theme,
      date: new Date(),
    });

    const rowId = crypto.randomUUID();
    const path = pdfPath(acc.userId, note.source_id, rowId);
    const { error: upErr } = await admin.storage.from(SOURCES_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (upErr) throw new UserFacingError('upload_failed', 'PDF 파일을 저장하지 못했어요. 다시 해 주세요.', 502);
    const { data: row, error } = await admin
      .from('note_pdfs')
      .insert({ id: rowId, user_id: acc.userId, note_id: note.id, name, path, bytes: bytes.byteLength, pages, version: note.version })
      .select('id, name, path, bytes, pages, version, created_at, updated_at')
      .single();
    if (error) {
      await removePaths(admin, [path]);
      throw error;
    }
    return Response.json({ ok: true, pdf: row });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/pdf'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const parsed = Remove.safeParse(await readJson(req, 10_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const note = await loadOwnedNote(admin, id, acc.userId);
    const { data: rows, error } = await admin.from('note_pdfs').select('id, path').in('id', parsed.data.ids).eq('note_id', note.id).eq('user_id', acc.userId);
    if (error) throw error;
    const ids = (rows ?? []).map((r) => String(r.id));
    if (ids.length) {
      const { error: dErr } = await admin.from('note_pdfs').delete().in('id', ids).eq('user_id', acc.userId);
      if (dErr) throw dErr;
      await removePaths(
        admin,
        (rows ?? []).map((r) => String(r.path)),
      );
    }
    return Response.json({ ok: true, deleted: ids.length });
  } catch (e) {
    return errorResponse(e);
  }
}
