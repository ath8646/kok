// 탈퇴 기록: 이메일과 로그인 회사의 계정 번호를 알아볼 수 없는 값(HMAC)으로 바꿔 2일 동안만 둔다.
// 탈퇴하고 바로 다시 가입해서 무료 에너지를 또 받는 것을 막는다 (이메일이 없는 카카오 계정도).
import 'server-only';
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tombstoneKeys } from '@/lib/tombstone-keys';

/** 탈퇴 기록을 남겨 두는 기간 */
export const TOMBSTONE_KEEP_MS = 2 * 86400_000;

function key(): Buffer {
  const s = process.env.SUPABASE_SECRET_KEY;
  if (!s) throw new Error('SUPABASE_SECRET_KEY 가 없어요.');
  return createHmac('sha256', s).update('kok-tombstone-v1').digest();
}

/** 이메일이나 'id:회사:번호' → 알아볼 수 없는 값 (예전 기록과 같게 이메일은 소문자로) */
export function emailHash(value: string): string {
  return createHmac('sha256', key()).update(value.trim().toLowerCase()).digest('hex');
}

/** 이 계정의 탈퇴 기록 값들: 이메일 + 로그인 회사 계정 번호 (번호를 못 읽으면 이메일만) */
export async function accountKeys(admin: SupabaseClient, userId: string, email: string | null | undefined): Promise<string[]> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) throw error;
    return tombstoneKeys(email ?? data.user?.email, data.user?.identities ?? []);
  } catch (e) {
    console.warn('[kok] identities read failed', (e as Error).message);
    return tombstoneKeys(email);
  }
}

export async function recordDeletion(admin: SupabaseClient, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const at = new Date().toISOString();
  const { error } = await admin.from('account_tombstones').upsert(keys.map((k) => ({ email_hash: emailHash(k), deleted_at: at })));
  if (error) throw error;
}

/** 이 값들 가운데 하나로 since 뒤에 탈퇴한 적이 있는지 */
export async function deletedSince(admin: SupabaseClient, keys: string[], since: Date): Promise<boolean> {
  if (!keys.length) return false;
  const { data, error } = await admin
    .from('account_tombstones')
    .select('deleted_at')
    .in(
      'email_hash',
      keys.map((k) => emailHash(k)),
    );
  if (error) throw error;
  return (data ?? []).some((r) => Date.parse(String(r.deleted_at)) >= since.getTime());
}
