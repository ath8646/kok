// 서버 전용 Supabase 클라이언트 (비밀 키 사용, RLS를 건너뛴다).
// 사용자 확인을 끝낸 다음에만 쓴다. 브라우저 코드에서 import 하면 빌드가 실패한다.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('서버 환경변수 NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SECRET_KEY 가 없어요.');
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}

export const SOURCES_BUCKET = 'sources';
