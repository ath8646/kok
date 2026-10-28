// 브라우저용 Supabase 클라이언트 (공개 키 + 로그인한 사람의 권한, RLS 적용)
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { trackedFetch } from '../view-cache';

let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  // 쓰기 요청을 세어, 기억해 둔 화면(view-cache)이 바뀌기 전 모습을 보여 주지 않게 한다
  cached = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { fetch: trackedFetch },
  });
  return cached;
}
