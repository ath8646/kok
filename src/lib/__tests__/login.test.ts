import { afterEach, describe, expect, it, vi } from 'vitest';
import { flagOn } from '@/lib/login';

describe('Apple 로그인 켜기 (NEXT_PUBLIC_APPLE_LOGIN)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('1 이나 true 일 때만 켜진다', () => {
    expect(flagOn(undefined)).toBe(false);
    expect(flagOn('')).toBe(false);
    expect(flagOn('0')).toBe(false);
    expect(flagOn('false')).toBe(false);
    expect(flagOn('yes')).toBe(false);
    expect(flagOn('1')).toBe(true);
    expect(flagOn(' true ')).toBe(true);
    expect(flagOn('TRUE')).toBe(true);
  });

  it('환경변수가 없으면 Apple 버튼이 꺼져 있다', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_LOGIN', '');
    vi.resetModules();
    expect((await import('@/lib/login')).APPLE_LOGIN).toBe(false);
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_APPLE_LOGIN', '1');
    expect((await import('@/lib/login')).APPLE_LOGIN).toBe(true);
  });
});
