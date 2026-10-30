import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/lib/supabase/proxy';

describe('로그인 없이 열리는 주소 (lib/supabase/proxy.ts)', () => {
  it('첫 화면·법률 문서·계정 삭제 안내는 열리고, 앱 화면은 로그인으로 보낸다', () => {
    for (const p of ['/', '/terms', '/privacy', '/ai-guide', '/delete-account', '/offline', '/auth/callback']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/home', '/library', '/settings', '/admin', '/delete-account/x']) expect(isPublicPath(p)).toBe(false);
  });
});
