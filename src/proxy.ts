import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // API, 정적 파일, 서비스 워커, 앱 정보 파일, 그림 파일, 다시 그린 지도의 바탕 지도(maps/)는 건너뛴다
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|robots.txt|icons/|maps/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
