import { describe, expect, it } from 'vitest';
import { tombstoneKeys } from '@/lib/tombstone-keys';

describe('탈퇴 기록 값 (같은 날 다시 가입하면 알아보기)', () => {
  it('이메일은 소문자로, 로그인 회사 계정 번호도 함께', () => {
    expect(tombstoneKeys(' Student@Example.com ', [{ provider: 'google', id: '1234' }])).toEqual(['student@example.com', 'id:google:1234']);
  });

  it('이메일이 없는 카카오 계정은 카카오 회원번호로', () => {
    expect(tombstoneKeys('', [{ provider: 'kakao', id: '4242' }])).toEqual(['id:kakao:4242']);
    expect(tombstoneKeys(null, [{ provider: 'Kakao', id: ' 4242 ' }])).toEqual(['id:kakao:4242']);
  });

  it('빈 값은 넣지 않고, 같은 값은 한 번', () => {
    expect(tombstoneKeys(undefined, [{ provider: 'kakao', id: '' }, { provider: '', id: '1' }, null as never].filter(Boolean))).toEqual([]);
    expect(
      tombstoneKeys('a@b.c', [
        { provider: 'google', id: '1' },
        { provider: 'google', id: '1' },
      ]),
    ).toEqual(['a@b.c', 'id:google:1']);
  });
});
