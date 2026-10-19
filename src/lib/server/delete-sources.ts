// 자료 지우기: 노트·그림·문제·복습 기록은 자료 행과 함께 지워지고, 올린 파일·노트에 더한 자료의 파일·채팅에 보관한 파일은 여기서 지운다
import type { SupabaseClient } from '@supabase/supabase-js';
import { removeFolder } from './files';
import { removeChatFolders } from './chat-input';

/** 저장소 폴더를 한 번에 몇 개씩 지울지 (요청이 몰리지 않게) */
const FOLDERS_AT_ONCE = 5;

/** 내 자료들을 지운다 (다른 사람 자료 번호는 건너뛴다). 지운 자료 수 */
export async function deleteOwnSources(admin: SupabaseClient, userId: string, ids: string[]): Promise<number> {
  const want = [...new Set(ids)];
  if (!want.length) return 0;
  const { data: own, error: ownErr } = await admin.from('sources').select('id').in('id', want).eq('user_id', userId);
  if (ownErr) throw ownErr;
  const mine = (own ?? []).map((r) => String(r.id));
  if (!mine.length) return 0;
  // 이 노트들에 더한 자료의 파일 (자료 행은 지울 때 함께 지워진다). 칸(parent_id)이 없는 예전 DB 면 오류가 나고 더한 자료도 없다
  const { data: kids, error: kidsErr } = await admin.from('sources').select('id').in('parent_id', mine).eq('user_id', userId);
  if (kidsErr && !/parent_id/.test(kidsErr.message ?? '')) throw kidsErr;
  const folders = [...(kids ?? []).map((k) => `${userId}/${k.id}`), ...mine.map((id) => `${userId}/${id}`)];
  for (let i = 0; i < folders.length; i += FOLDERS_AT_ONCE) {
    await Promise.all(folders.slice(i, i + FOLDERS_AT_ONCE).map((f) => removeFolder(admin, f)));
  }
  // 노트 채팅에 보관한 사진·파일 (Pro)
  await removeChatFolders(admin, userId, mine);
  const { error } = await admin.from('sources').delete().in('id', mine).eq('user_id', userId);
  if (error) throw error;
  return mine.length;
}
