// 구글 로그인에서 돌아오는 곳: 코드를 세션으로 바꾸고 앱으로 보낸다
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/home';
  if (raw === '/' || raw.startsWith('/auth/')) return '/home';
  return raw;
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
  return NextResponse.redirect(`${origin}/?error=auth`);
}
