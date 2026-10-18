// 로그인 방법. 구글은 늘 켜져 있다.
// Apple 로그인은 주인이 Apple·Supabase 설정을 마친 뒤 Vercel 환경변수 NEXT_PUBLIC_APPLE_LOGIN=1 을 넣고
// 다시 배포해야 켜진다. NEXT_PUBLIC_ 값은 빌드할 때 코드에 박히므로, 바꾸면 꼭 다시 배포한다.

/** 환경변수 값이 '켜짐'인지 (1 또는 true, 앞뒤 빈칸·대소문자 무시) */
export function flagOn(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** Apple 로그인 버튼을 보일지. 꺼져 있으면 Apple 버튼이 아예 없다 (설정 전 깨진 버튼을 보이지 않게) */
export const APPLE_LOGIN = flagOn(process.env.NEXT_PUBLIC_APPLE_LOGIN);
