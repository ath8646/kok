// 자료 넣기: 검사 → 예상 에너지 확인 → 자료 행 만들기 → 처리 시작
import { after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import {
  MAX_PARALLEL_SOURCES,
  assertAiAllowed,
  energyWindows,
  getAppSettings,
  getFeatures,
  limitsFor,
  reserveError,
  type ReserveResult,
} from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertOwnPath, downloadOwn, extOk, removePaths, sniff } from '@/lib/server/files';
import { chunkCount } from '@/lib/server/pipeline';
import { driveSource } from '@/lib/server/drive';
import { estimateEnergy, estimateSmallTask } from '@/lib/ai/models';
import { modelForTier } from '@/lib/settings';
import { pdfPageCount } from '@/lib/pdf';
import { adminClient } from '@/lib/supabase/admin';

export const maxDuration = 300;

const Body = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  kind: z.enum(['text', 'pdf', 'image']),
  title: z.string().max(120).catch(''),
  text: z.string().max(200_000).optional(),
  files: z.array(z.string().max(200)).max(60).catch([]),
  /** 이 자료를 더할 노트의 자료 (Pro). 정리가 끝나면 그 노트의 새 버전이 된다 */
  parentId: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  let uploaded: string[] = [];
  let cleanup = false;
  let ownerId = '';
  let sourceId = '';
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    ownerId = acc.userId;
    const parsed = Body.safeParse(await readJson(req, 600_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const b = parsed.data;
    sourceId = b.id;
    const app = await getAppSettings(admin);
    const L = app.limits;
    const lim = limitsFor(acc, L);

    // 노트에 자료 더하기: Pro 기능, 정리가 끝난 내 노트에만, 과목은 그 노트의 과목
    const parentId = b.parentId ?? null;
    if (parentId) {
      if (!(await getFeatures(admin)).versions) {
        throw new UserFacingError('schema_outdated', '노트에 자료를 더하려면 관리자가 Supabase 에서 schema.sql 을 다시 실행해야 해요.', 503);
      }
      if (!acc.canAppend) throw new UserFacingError('pro_only', '노트에 자료 더하기는 Pro 기능이에요.', 403);
      const { data: parent } = await admin.from('sources').select('id, user_id, subject_id, status, parent_id').eq('id', parentId).maybeSingle();
      if (!parent || parent.user_id !== acc.userId || parent.parent_id) throw new UserFacingError('not_found', '노트를 찾을 수 없어요.', 404);
      if (parent.status !== 'ready') throw new UserFacingError('parent_not_ready', '노트 정리가 끝난 뒤에 자료를 더할 수 있어요.', 409);
      const { data: pnote } = await admin.from('notes').select('id').eq('source_id', parentId).maybeSingle();
      if (!pnote) throw new UserFacingError('not_found', '노트를 찾을 수 없어요.', 404);
      b.subjectId = parent.subject_id as string;
    }

    const { data: subject } = await admin.from('subjects').select('id').eq('id', b.subjectId).eq('user_id', acc.userId).maybeSingle();
    if (!subject) throw new UserFacingError('no_subject', '과목을 찾을 수 없어요.', 404);

    const { data: exists } = await admin.from('sources').select('id').eq('id', b.id).maybeSingle();
    if (exists) throw new UserFacingError('duplicate', '이미 넣은 자료예요.', 409);

    uploaded = b.kind === 'text' ? [] : b.files.filter((p) => p.startsWith(`${acc.userId}/${b.id}/`));
    cleanup = true;
    let pages = 0;
    let images = 0;
    let text: string | null = null;

    if (b.kind === 'text') {
      text = (b.text ?? '').replace(/\r\n/g, '\n').trim();
      const max = lim.textChars;
      if (text.length < 20) throw new UserFacingError('too_short', '글이 너무 짧아요. 20자 이상 적어 주세요.', 400);
      if (text.length > max) throw new UserFacingError('too_long', `글이 너무 길어요. 한 번에 ${max.toLocaleString()}자까지 넣을 수 있어요.`, 400);
    } else {
      if (!b.files.length) throw new UserFacingError('no_files', '파일을 올려 주세요.', 400);
      const maxMb = lim.fileMb;
      for (const p of b.files) {
        assertOwnPath(p, acc.userId, b.id);
        if (!extOk(p, b.kind)) throw new UserFacingError('bad_type', '지원하지 않는 파일 형식이에요.', 400);
      }
      if (b.kind === 'pdf') {
        if (b.files.length !== 1) throw new UserFacingError('one_pdf', 'PDF는 한 번에 하나씩 넣어 주세요.', 400);
        const bytes = await downloadOwn(admin, b.files[0]);
        if (bytes.byteLength > maxMb * 1024 * 1024) throw new UserFacingError('too_big', `파일이 너무 커요. ${maxMb}MB까지 넣을 수 있어요.`, 400);
        if (sniff(bytes) !== 'pdf') throw new UserFacingError('bad_type', 'PDF 파일이 아니에요.', 400);
        pages = await pdfPageCount(bytes);
        const maxPages = lim.pdfPages;
        if (pages > maxPages) {
          throw new UserFacingError('too_many_pages', `PDF가 ${pages}쪽이에요. 한 번에 ${maxPages}쪽까지 넣을 수 있어요. 나눠서 올려 주세요.`, 400);
        }
      } else {
        images = b.files.length;
        const maxImages = lim.images;
        if (images > maxImages) throw new UserFacingError('too_many_images', `사진은 한 번에 ${maxImages}장까지 넣을 수 있어요.`, 400);
        for (const p of b.files) {
          const bytes = await downloadOwn(admin, p);
          if (bytes.byteLength > Math.min(maxMb, 10) * 1024 * 1024) throw new UserFacingError('too_big', '사진 파일이 너무 커요.', 400);
          const kind = sniff(bytes);
          if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') throw new UserFacingError('bad_type', '사진 파일이 아니에요 (JPG·PNG·WEBP).', 400);
        }
      }
    }

    const model = modelForTier(app.models, acc.settings.models.organize, acc.canCareful, acc.isAdmin);
    // 노트에 더할 때는 지금 노트와 합치는 단계가 하나 더 있다
    const estimate =
      estimateEnergy({ kind: b.kind, pages, images, chars: text?.length ?? 0 }, model, L.usdPerEnergy) +
      (parentId ? Math.ceil(estimateSmallTask(model, L.usdPerEnergy, 9000, 3000)) : 0);

    // 먼저 빠르게 검사하고(정지·무료 전체 한도·요청 속도·에너지), 마지막 검사와 행 만들기는 DB 가 한 번에 한다:
    // 정리 중인 자료가 쓸 에너지까지 미리 빼고, 같은 사람의 요청은 한 줄로 세운다 (동시에 여러 개 보내도 한도를 넘지 않게)
    await assertAiAllowed(admin, acc, app, { estimate, rateLimit: true });
    const chunkTotal = chunkCount(b.kind, pages, images, text ?? '');
    const { data: verdict, error } = await admin.rpc('kok_create_source', {
      p_row: {
        id: b.id,
        user_id: acc.userId,
        subject_id: b.subjectId,
        kind: b.kind,
        title: b.title.trim().slice(0, 120),
        text_content: text,
        file_paths: b.kind === 'text' ? [] : b.files,
        page_count: b.kind === 'pdf' ? pages : b.kind === 'image' ? images : null,
        chunk_total: chunkTotal,
        model,
        plan_at_start: acc.plan.kind,
        energy_estimate: estimate,
        ...(parentId ? { parent_id: parentId } : {}),
      },
      p_max_parallel: acc.isAdmin ? null : MAX_PARALLEL_SOURCES,
      ...energyWindows(acc, L),
    });
    if (error) throw error;
    const v = verdict as ReserveResult;
    // 같은 번호의 자료가 방금 만들어졌다면(두 번 누름) 그 자료의 파일이니 지우지 않는다
    if (v.result === 'duplicate') cleanup = false;
    const refusal = reserveError(v, acc.plan);
    if (refusal) throw refusal;
    cleanup = false;

    const origin = req.nextUrl.origin;
    after(() => driveSource(b.id, origin));
    return Response.json({ ok: true, id: b.id, estimate });
  } catch (e) {
    // 잠깐 기다리면 되는 거절(요청이 너무 빠름, 정리 중인 자료가 꽉 참)은 파일을 남겨 둔다:
    // 브라우저가 같은 파일로 다시 보낸다 (끝내 안 보내면 1시간 뒤 청소가 지운다)
    const retryLater = e instanceof UserFacingError && (e.code === 'rate_limited' || e.code === 'too_many_running' || e.code === 'append_busy');
    if (cleanup && !retryLater && ownerId && uploaded.length) {
      // 받지 못한 자료의 파일은 바로 지우고, '아직 정리하지 않은 파일' 수에서도 뺀다
      try {
        const admin = adminClient();
        await removePaths(
          admin,
          uploaded.filter((p) => p.startsWith(`${ownerId}/`)),
        );
        await admin.from('upload_tickets').update({ swept: true }).eq('user_id', ownerId).eq('source_id', sourceId);
      } catch {
        /* 무시 */
      }
    }
    return errorResponse(e);
  }
}
