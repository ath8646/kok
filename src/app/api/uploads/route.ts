// 파일 올리기 자리 받기: 서버가 개수·크기·하루 한도를 검사하고, 정해진 자리에 한 번만 올릴 수 있는 주소를 준다.
// (학생이 저장소에 직접 올리지 못하게 해서, 끝없이 올려 저장 공간을 채우는 것을 막는다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings, limitsFor } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { sweepOrphanUploads } from '@/lib/server/files';
import { SOURCES_BUCKET } from '@/lib/supabase/admin';

export const maxDuration = 30;

const Body = z.object({
  sourceId: z.string().uuid(),
  kind: z.enum(['pdf', 'image']),
  files: z
    .array(z.object({ size: z.number().int().positive() }))
    .min(1)
    .max(60),
});

/** 하루(24시간)에 받을 수 있는 올리기 자리 수 */
const FILES_PER_DAY = { free: 60, pro: 400 };
/** 아직 자료로 만들지 않은 올리기 자리 수 (그 뒤 1시간이 지나면 지운다) */
const PENDING_FILES = { free: 12, pro: 70 };
const MB = 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const b = parsed.data;
    const app = await getAppSettings(admin);
    if (acc.banned) throw new UserFacingError('banned', '이 계정은 AI 기능을 쓸 수 없어요. 관리자에게 문의해 주세요.', 403);
    if (!app.aiEnabled && !acc.isAdmin) throw new UserFacingError('ai_paused', '지금은 AI 기능을 잠깐 쉬고 있어요. 복습은 그대로 할 수 있어요.', 503);

    const lim = limitsFor(acc);
    // 하루 올리기 수·대기 파일 수는 무료가 아니면(Pro·테스트 플랜) 넉넉하게
    const pro = acc.plan.kind !== 'free';
    const maxMb = lim.fileMb;
    if (b.kind === 'pdf') {
      if (b.files.length !== 1) throw new UserFacingError('one_pdf', 'PDF는 한 번에 하나씩 넣어 주세요.', 400);
      if (b.files[0].size > maxMb * MB) throw new UserFacingError('too_big', `파일이 너무 커요. ${maxMb}MB까지 넣을 수 있어요.`, 400);
    } else {
      const maxImages = lim.images;
      if (b.files.length > maxImages) throw new UserFacingError('too_many_images', `사진은 한 번에 ${maxImages}장까지 넣을 수 있어요.`, 400);
      if (b.files.some((f) => f.size > Math.min(maxMb, 10) * MB)) throw new UserFacingError('too_big', '사진 파일이 너무 커요.', 400);
    }

    if (!acc.isAdmin) {
      const { data: ok, error } = await admin.rpc('kok_hit_rate', { p_user: acc.userId, p_max: 10, p_window_seconds: 60, p_kind: 'upload' });
      if (error) throw error;
      if (ok === false) throw new UserFacingError('rate_limited', '요청이 너무 빨라요. 1분 뒤에 다시 해 주세요.', 429);
    }

    const { data: exists } = await admin.from('sources').select('id').eq('id', b.sourceId).maybeSingle();
    if (exists) throw new UserFacingError('duplicate', '이미 넣은 자료예요.', 409);
    const { count: already } = await admin
      .from('upload_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', acc.userId)
      .eq('source_id', b.sourceId);
    if (already) throw new UserFacingError('duplicate', '이미 올리고 있는 자료예요. 처음부터 다시 해 주세요.', 409);

    // 1시간 넘게 자료로 만들지 않은 내 올리기는 먼저 지운다
    await sweepOrphanUploads(admin, { userId: acc.userId, olderThanMs: 60 * 60_000 });

    if (!acc.isAdmin) {
      const dayAgo = new Date(Date.now() - 86400_000).toISOString();
      const { data: recent, error } = await admin
        .from('upload_tickets')
        .select('source_id, swept')
        .eq('user_id', acc.userId)
        .gte('created_at', dayAgo)
        .limit(1000);
      if (error) throw error;
      const perDay = pro ? FILES_PER_DAY.pro : FILES_PER_DAY.free;
      if ((recent?.length ?? 0) + b.files.length > perDay) {
        throw new UserFacingError('upload_limit', '오늘은 파일을 너무 많이 올렸어요. 내일 다시 올려 주세요.', 429);
      }
      const open = (recent ?? []).filter((r) => !r.swept);
      if (open.length) {
        const ids = [...new Set(open.map((r) => r.source_id as string))];
        const { data: made, error: madeErr } = await admin.from('sources').select('id').in('id', ids);
        if (madeErr) throw madeErr;
        const madeSet = new Set((made ?? []).map((m) => m.id as string));
        const pending = open.filter((r) => !madeSet.has(r.source_id as string)).length;
        const cap = pro ? PENDING_FILES.pro : PENDING_FILES.free;
        if (pending + b.files.length > cap) {
          throw new UserFacingError('upload_pending', '아직 정리를 시작하지 않은 파일이 많아요. 잠시 뒤에 다시 해 주세요.', 429);
        }
      }
    }

    const base = `${acc.userId}/${b.sourceId}`;
    const paths = b.kind === 'pdf' ? [`${base}/source.pdf`] : b.files.map((_, i) => `${base}/p${String(i + 1).padStart(2, '0')}.jpg`);
    const { error: tErr } = await admin.from('upload_tickets').insert(paths.map((path) => ({ user_id: acc.userId, source_id: b.sourceId, path })));
    if (tErr) throw tErr;

    const bucket = admin.storage.from(SOURCES_BUCKET);
    const uploads: Array<{ path: string; token: string }> = [];
    for (const path of paths) {
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error || !data?.token) throw new UserFacingError('upload_sign', '파일을 올릴 준비를 하지 못했어요. 다시 해 주세요.', 502);
      uploads.push({ path, token: data.token });
    }
    return Response.json({ ok: true, uploads });
  } catch (e) {
    return errorResponse(e);
  }
}
