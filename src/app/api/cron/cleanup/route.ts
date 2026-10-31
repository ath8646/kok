// 매일 한 번 청소 (Vercel Cron): 기간이 지난 원본 파일 지우기, 정리를 시작하지 않은 올리기 지우기,
// 멈춘 처리 정리, 오래된 요청·탈퇴 기록 지우기, 어느 테마도 쓰지 않는 배경 그림 지우기, 글이 되지 않은 자료 공유 파일 지우기
import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { getFeatures, refundSource } from '@/lib/server/account';
import { sweepUnusedImages } from '@/lib/server/themes';
import { removeFolder, sweepOrphanUploads } from '@/lib/server/files';
import { errorResponse } from '@/lib/server/errors';
import { TOMBSTONE_KEEP_MS } from '@/lib/server/tombstone';
import { COMMUNITY_BUCKET } from '@/lib/server/share';

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

    // 5) 테마: 하루 넘게 어느 테마도 쓰지 않은 배경 그림 (테마를 지웠거나 그림을 바꿈)
    let themeImages = 0;
    if ((await getFeatures(admin)).themes) {
      try {
        for (let i = 0; i < 10; i++) {
          const n = await sweepUnusedImages(admin, { olderThanMs: 86400_000, limit: 200 });
          themeImages += n;
          if (n < 200) break;
        }
      } catch (e) {
        // 그림 청소가 안 돼도 다른 청소는 끝났다 (내일 다시 한다)
        console.warn('[kok] theme image sweep failed', (e as Error).message);
      }
    }

    // 6) 자료 공유: 올리고 하루가 지나도 글이 되지 않은 파일 (글이 된 파일의 자리는 글을 만들 때 지운다)
    let shareOrphans = 0;
    if ((await getFeatures(admin)).community) {
      try {
        const { data: old, error: oErr } = await admin.from('community_uploads').select('id, path').lt('created_at', dayAgo).limit(1000);
        if (oErr) throw oErr;
        const rows = (old ?? []) as Array<{ id: number; path: string }>;
        if (rows.length) {
          // 그사이 글이 되어 파일 행이 생긴 것은 지우지 않는다 (자리만 지운다). 주소가 너무 길어지지 않게 100개씩 보고,
          // 하나라도 읽지 못하면 이번에는 아무것도 지우지 않는다 (글에 붙은 파일을 지우지 않게: 내일 다시 본다)
          const paths = rows.map((r) => r.path);
          const keep = new Set<string>();
          for (let i = 0; i < paths.length; i += 100) {
            const part = paths.slice(i, i + 100);
            const [used, previews] = await Promise.all([
              admin.from('community_files').select('path').in('path', part),
              admin.from('community_files').select('preview_path').in('preview_path', part),
            ]);
            if (used.error) throw used.error;
            if (previews.error) throw previews.error;
            for (const u of used.data ?? []) keep.add(String(u.path));
            for (const u of previews.data ?? []) keep.add(String(u.preview_path));
          }
          const drop = paths.filter((p) => !keep.has(p));
          for (let i = 0; i < drop.length; i += 100) await admin.storage.from(COMMUNITY_BUCKET).remove(drop.slice(i, i + 100));
          const ids = rows.map((r) => r.id);
          for (let i = 0; i < ids.length; i += 100) {
            await admin
              .from('community_uploads')
              .delete()
              .in('id', ids.slice(i, i + 100));
          }
          shareOrphans = drop.length;
        }
      } catch (e) {
        console.warn('[kok] share upload sweep failed', (e as Error).message);
      }
    }

    return Response.json({ ok: true, filesRemoved, orphans, stuck, themeImages, shareOrphans });
  } catch (e) {
    return errorResponse(e);
  }
}
