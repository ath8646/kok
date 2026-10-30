// proxy(옛 middleware)에서 로그인 세션을 새로 고치고, 로그인 안 한 사람을 첫 화면으로 보낸다
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// 계정 삭제 안내(/delete-account)는 로그인 없이 열려야 한다 (Google Play 의 '계정 삭제 웹 주소')
const PUBLIC_EXACT = new Set(['/', '/terms', '/privacy', '/ai-guide', '/delete-account', '/offline']);
const PUBLIC_PREFIX = ['/auth/'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response; // 환경변수를 넣기 전 (첫 배포)

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // createServerClient 와 getClaims 사이에는 아무 코드도 넣지 않는다
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string, next?: string) => {
    const to = request.nextUrl.clone();
    to.pathname = path;
    to.search = '';
    if (next) to.searchParams.set('next', next);
    const res = NextResponse.redirect(to);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  };

  if (!userId && !isPublicPath(pathname)) return redirectTo('/', pathname + search);
  if (userId && pathname === '/') return redirectTo('/home');
  return response;
}
