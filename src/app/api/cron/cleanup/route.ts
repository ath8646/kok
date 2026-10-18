// 매일 한 번 청소 (Vercel Cron): 기간이 지난 원본 파일 지우기, 정리를 시작하지 않은 올리기 지우기,
// 멈춘 처리 정리, 오래된 요청·탈퇴 기록 지우기
import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { refundSource } from '@/lib/server/account';
import { removeFolder, sweepOrphanUploads } from '@/lib/server/files';
import { errorResponse } from '@/lib/server/errors';
import { TOMBSTONE_KEEP_MS } from '@/lib/server/tombstone';

export const maxDuration = 300;

/** Vercel Cron 은 CRON_SECRET 이 있으면 "Authorization: Bearer <값>" 을 붙여 부른다. 값이 없으면 아무도 못 부른다 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  try {
    if (!authorized(req)) {
      if (!process.env.CRON_SECRET) console.warn('[kok] CRON_SECRET 이 없어서 청소를 하지 않았어요.');
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const admin = adminClient();
    const now = new Date();
    let filesRemoved = 0;
    let stuck = 0;

    // 1) 무료 사용자의 원본 파일: 처리 7일 뒤 지운다 (노트·문제·그림은 남는다)
    const { data: expired } = await admin.from('sources').select('id, user_id').lt('files_expire_at', now.toISOString()).limit(300);
    for (const s of expired ?? []) {
      filesRemoved += await removeFolder(admin, `${s.user_id}/${s.id}`);
      await admin.from('sources').update({ file_paths: [], files_expire_at: null }).eq('id', s.id);
    }

    // 2) 올리기 자리를 받고 1시간 넘게 정리를 시작하지 않은 파일
    let orphans = 0;
    for (let i = 0; i < 10; i++) {
      const n = await sweepOrphanUploads(admin, { olderThanMs: 60 * 60_000, limit: 200 });
      orphans += n;
      if (n === 0) break;
    }

    // 3) 하루 넘게 멈춘 처리: 실패로 바꾸고 에너지를 돌려준다
    const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
    const { data: stale } = await admin.from('sources').select('id, user_id').in('status', ['queued', 'processing']).lt('updated_at', dayAgo).limit(300);
    for (const s of stale ?? []) {
      await admin
        .from('sources')
        .update({ status: 'error', error: '처리가 너무 오래 멈춰 있었어요. "다시 하기"를 눌러 주세요.', locked_until: null })
        .eq('id', s.id);
      try {
        await refundSource(admin, s.user_id, s.id);
      } catch {
        /* 무시 */
      }
      stuck++;
    }

    // 4) 오래된 기록 지우기: 분당 제한(하루), 올리기 자리(3일, 하루 올리기 수 세기에 쓴 뒤), 탈퇴 기록(2일)
    await admin.from('rate_hits').delete().lt('at', dayAgo);
    await admin
      .from('upload_tickets')
      .delete()
      .eq('swept', true)
      .lt('created_at', new Date(now.getTime() - 3 * 86400_000).toISOString());
    await admin
      .from('account_tombstones')
      .delete()
      .lt('deleted_at', new Date(now.getTime() - TOMBSTONE_KEEP_MS).toISOString());

    return Response.json({ ok: true, filesRemoved, orphans, stuck });
  } catch (e) {
    return errorResponse(e);
  }
}
