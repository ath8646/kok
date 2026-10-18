// 올린 파일 검사 (경로, 실제 형식, 크기)
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SOURCES_BUCKET } from '@/lib/supabase/admin';
import { UserFacingError } from './errors';

const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;

/** `${userId}/${sourceId}/파일이름` 모양만 허용한다 */
export function assertOwnPath(path: string, userId: string, sourceId: string) {
  const parts = path.split('/');
  if (parts.length !== 3 || parts[0] !== userId || parts[1] !== sourceId || !NAME_RE.test(parts[2]) || parts[2].startsWith('.')) {
    throw new UserFacingError('bad_path', '파일 위치가 올바르지 않아요. 다시 올려 주세요.', 400);
  }
}

export type Sniffed = 'pdf' | 'jpeg' | 'png' | 'webp' | 'unknown';

export function sniff(bytes: Uint8Array): Sniffed {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)
    return 'png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'webp';
  // 일부 PDF 는 앞에 몇 바이트가 더 붙어 있다
  if (b.length > 8) {
    const head = Buffer.from(b.subarray(0, Math.min(1024, b.length))).toString('latin1');
    if (head.includes('%PDF-')) return 'pdf';
  }
  return 'unknown';
}

export function extOk(path: string, kind: 'pdf' | 'image'): boolean {
  const p = path.toLowerCase();
  if (kind === 'pdf') return p.endsWith('.pdf');
  return p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.png') || p.endsWith('.webp');
}

export async function downloadOwn(admin: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(SOURCES_BUCKET).download(path);
  if (error || !data) throw new UserFacingError('file_missing', '올린 파일을 찾을 수 없어요. 다시 올려 주세요.', 400);
  return new Uint8Array(await data.arrayBuffer());
}

/** 사용자 폴더 안의 파일을 모두 지운다 (prefix 예: `${userId}/${sourceId}` 또는 `${userId}`) */
export async function removeFolder(admin: SupabaseClient, prefix: string, bucketName: string = SOURCES_BUCKET): Promise<number> {
  const bucket = admin.storage.from(bucketName);
  let removed = 0;
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(dir, { limit: 100, offset });
      if (error || !data?.length) break;
      for (const item of data) {
        const full = `${dir}/${item.name}`;
        // 폴더는 id 가 없다
        if (item.id === null || item.id === undefined) out.push(...(await walk(full)));
        else out.push(full);
      }
      if (data.length < 100) break;
    }
    return out;
  };
  const files = await walk(prefix);
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    const { error } = await bucket.remove(batch);
    if (!error) removed += batch.length;
  }
  return removed;
}

export async function removePaths(admin: SupabaseClient, paths: string[]): Promise<void> {
  if (!paths.length) return;
  for (let i = 0; i < paths.length; i += 100) {
    await admin.storage.from(SOURCES_BUCKET).remove(paths.slice(i, i + 100));
  }
}

/**
 * 올리기 자리를 받고 정리를 시작하지 않은 파일(자료 행이 없는 것)을 지운다.
 * 검사한 자리는 swept 로 표시해 다시 보지 않는다 (하루 올리기 수를 세는 데는 계속 쓴다).
 */
export async function sweepOrphanUploads(admin: SupabaseClient, opts: { userId?: string; olderThanMs: number; limit?: number }): Promise<number> {
  const before = new Date(Date.now() - opts.olderThanMs).toISOString();
  let q = admin
    .from('upload_tickets')
    .select('id, user_id, source_id, path')
    .eq('swept', false)
    .lt('created_at', before)
    .order('id')
    .limit(opts.limit ?? 200);
  if (opts.userId) q = q.eq('user_id', opts.userId);
  const { data: tickets, error } = await q;
  if (error) throw error;
  if (!tickets?.length) return 0;
  const sourceIds = [...new Set(tickets.map((t) => t.source_id as string))];
  const { data: made, error: madeErr } = await admin.from('sources').select('id').in('id', sourceIds);
  if (madeErr) throw madeErr;
  const exists = new Set((made ?? []).map((m) => m.id as string));
  const paths = tickets
    .filter((t) => !exists.has(t.source_id as string) && String(t.path).startsWith(`${t.user_id}/${t.source_id}/`))
    .map((t) => t.path as string);
  if (paths.length) await removePaths(admin, paths);
  const { error: upErr } = await admin
    .from('upload_tickets')
    .update({ swept: true })
    .in(
      'id',
      tickets.map((t) => t.id),
    );
  if (upErr) throw upErr;
  return paths.length;
}
