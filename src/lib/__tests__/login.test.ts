import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountLabel, flagOn, loginNames } from '@/lib/login';

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

describe('카카오 로그인 켜기 (NEXT_PUBLIC_KAKAO_LOGIN)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('환경변수가 없으면 카카오 버튼이 꺼져 있다', async () => {
    vi.stubEnv('NEXT_PUBLIC_KAKAO_LOGIN', '');
    vi.resetModules();
    expect((await import('@/lib/login')).KAKAO_LOGIN).toBe(false);
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_KAKAO_LOGIN', '1');
    expect((await import('@/lib/login')).KAKAO_LOGIN).toBe(true);
  });

  it('약관에 쓰는 로그인 방법 이름', () => {
    expect(loginNames(false, false)).toEqual(['구글']);
    expect(loginNames(true, false)).toEqual(['구글', '카카오']);
    expect(loginNames(true, true)).toEqual(['구글', '카카오', 'Apple']);
  });
});

describe('설정의 로그인 계정 이름', () => {
  it('이메일이 있으면 이메일과 로그인 회사', () => {
    expect(accountLabel('a@b.com', 'google')).toBe('a@b.com (구글)');
    expect(accountLabel('a@b.com', 'kakao')).toBe('a@b.com (카카오)');
    expect(accountLabel('a@b.com', null)).toBe('a@b.com');
  });

  it('이메일 없는 카카오 계정도 이름이 있다', () => {
    expect(accountLabel('', 'kakao')).toBe('카카오 계정');
    expect(accountLabel(null, 'kakao')).toBe('카카오 계정');
    expect(accountLabel('', null)).toBe('이메일 없는 계정');
  });
});
