// 로그인 방법. 구글은 늘 켜져 있다.
// 카카오·Apple 로그인은 주인이 그 회사와 Supabase 설정을 마친 뒤 Vercel 환경변수(NEXT_PUBLIC_KAKAO_LOGIN, NEXT_PUBLIC_APPLE_LOGIN)에
// 1 을 넣고 다시 배포해야 켜진다. NEXT_PUBLIC_ 값은 빌드할 때 코드에 박히므로, 바꾸면 꼭 다시 배포한다.

/** 환경변수 값이 '켜짐'인지 (1 또는 true, 앞뒤 빈칸·대소문자 무시) */
export function flagOn(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** Apple 로그인 버튼을 보일지. 꺼져 있으면 Apple 버튼이 아예 없다 (설정 전 깨진 버튼을 보이지 않게) */
export const APPLE_LOGIN = flagOn(process.env.NEXT_PUBLIC_APPLE_LOGIN);

/** 카카오 로그인 버튼을 보일지 */
export const KAKAO_LOGIN = flagOn(process.env.NEXT_PUBLIC_KAKAO_LOGIN);

/** 로그인 회사 이름 (설정·관리자 화면) */
export const PROVIDER_LABEL: Record<string, string> = { google: '구글', kakao: '카카오', apple: 'Apple' };

/** 켜져 있는 로그인 방법 이름 (약관 등): ['구글', '카카오'] */
export function loginNames(kakao = KAKAO_LOGIN, apple = APPLE_LOGIN): string[] {
  return ['구글', ...(kakao ? ['카카오'] : []), ...(apple ? ['Apple'] : [])];
}

/**
 * 설정에 보일 로그인 계정 이름. 이메일이 있으면 '이메일 (회사)', 없으면 '카카오 계정'.
 * 카카오는 이메일 제공에 동의하지 않을 수 있어서 이메일이 없는 계정도 있다.
 */
export function accountLabel(email: string | null | undefined, provider: string | null | undefined): string {
  const name = provider ? PROVIDER_LABEL[provider] : undefined;
  const mail = (email ?? '').trim();
  if (mail) return name ? `${mail} (${name})` : mail;
  return name ? `${name} 계정` : '이메일 없는 계정';
}
