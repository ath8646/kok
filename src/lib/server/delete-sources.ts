// 자료 지우기: 노트·그림·문제·복습 기록은 자료 행과 함께 지워지고, 올린 파일·노트에 더한 자료의 파일·채팅에 보관한 파일·자료 그림·PDF 요약은 여기서 지운다
import type { SupabaseClient } from '@supabase/supabase-js';
import { removeFigureFolders, removeFolder, removePdfFolders } from './files';
import { chatFolderIdsOfNotes, removeChatFolders } from './chat-input';

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
  // 노트 채팅에 보관한 사진·파일 (Pro: 합친 노트면 합쳐 들어온 자료의 폴더도), 원본에서 잘라 둔 자료 그림 (더한 자료의 그림도)
  const kidIds = (kids ?? []).map((k) => String(k.id));
  const { data: notes } = await admin.from('notes').select('id').in('source_id', mine).eq('user_id', userId);
  const chatIds = await chatFolderIdsOfNotes(
    admin,
    userId,
    (notes ?? []).map((n) => String(n.id)),
  );
  await removeChatFolders(admin, userId, [...mine, ...kidIds, ...chatIds]);
  await removeFigureFolders(admin, userId, [...mine, ...kidIds]);
  await removePdfFolders(admin, userId, [...mine, ...kidIds]);
  const { error } = await admin.from('sources').delete().in('id', mine).eq('user_id', userId);
  if (error) throw error;
  return mine.length;
}
