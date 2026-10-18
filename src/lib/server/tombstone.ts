// 탈퇴 기록: 이메일을 알아볼 수 없는 값(HMAC)으로 바꿔 2일 동안만 둔다.
// 탈퇴하고 바로 다시 가입해서 무료 에너지를 또 받는 것을 막는다.
import 'server-only';
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** 탈퇴 기록을 남겨 두는 기간 */
export const TOMBSTONE_KEEP_MS = 2 * 86400_000;

function key(): Buffer {
  const s = process.env.SUPABASE_SECRET_KEY;
  if (!s) throw new Error('SUPABASE_SECRET_KEY 가 없어요.');
  return createHmac('sha256', s).update('kok-tombstone-v1').digest();
}

export function emailHash(email: string): string {
  return createHmac('sha256', key()).update(email.trim().toLowerCase()).digest('hex');
}

export async function recordDeletion(admin: SupabaseClient, email: string): Promise<void> {
  if (!email) return;
  const { error } = await admin.from('account_tombstones').upsert({ email_hash: emailHash(email), deleted_at: new Date().toISOString() });
  if (error) throw error;
}

/** 이 이메일로 since 뒤에 탈퇴한 적이 있는지 */
export async function deletedSince(admin: SupabaseClient, email: string, since: Date): Promise<boolean> {
  if (!email) return false;
  const { data, error } = await admin.from('account_tombstones').select('deleted_at').eq('email_hash', emailHash(email)).maybeSingle();
  if (error) throw error;
  return !!data && Date.parse(data.deleted_at) >= since.getTime();
}
