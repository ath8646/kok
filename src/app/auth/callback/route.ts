// 구글·Apple 로그인에서 돌아오는 곳: 코드를 세션으로 바꾸고 앱으로 보낸다.
// Apple 은 먼저 Supabase 로 돌아가고(form_post), Supabase 가 구글과 똑같이 ?code= 를 붙여 여기로 보낸다.
// 로그인 방법에 따라 다르게 할 일은 없다: profiles 행은 DB 트리거가 만들고, 이름은 쓰지 않는다(닉네임은 가입 화면에서 정한다).
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/home';
  if (raw === '/' || raw.startsWith('/auth/')) return '/home';
  return raw;
}

/** 첫 화면으로 (가려던 곳은 그대로 들고 간다) */
function toLanding(origin: string, next: string, error: boolean) {
  const to = new URL('/', origin);
  if (next !== '/home') to.searchParams.set('next', next);
  if (error) to.searchParams.set('error', 'auth');
  return NextResponse.redirect(to);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const fwd = request.headers.get('x-forwarded-host');
      const base = process.env.NODE_ENV !== 'development' && fwd ? `https://${fwd}` : origin;
      return NextResponse.redirect(`${base}${next}`);
    }
    console.warn('[kok] exchangeCodeForSession failed', error.message);
  }
  const oauthError = searchParams.get('error');
  if (oauthError) {
    // 로그인 회사(구글·Apple)나 Supabase 가 붙여 보낸 오류. Apple 설정이 틀렸을 때 Vercel 로그에서 찾을 수 있게 남긴다
    console.warn(
      '[kok] oauth error',
      oauthError.slice(0, 80),
      (searchParams.get('error_code') ?? '').slice(0, 80),
      (searchParams.get('error_description') ?? '').slice(0, 200),
    );
    // Apple 화면에서 '취소'를 누른 것은 오류가 아니다
    if (oauthError === 'user_cancelled_authorize') return toLanding(origin, next, false);
  }
  return toLanding(origin, next, true);
}
