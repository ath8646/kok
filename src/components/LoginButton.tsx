'use client';
// 첫 화면의 로그인 버튼: 구글, 그리고 켜져 있으면 카카오·Apple (NEXT_PUBLIC_KAKAO_LOGIN·NEXT_PUBLIC_APPLE_LOGIN → src/lib/login.ts)
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { APPLE_LOGIN, KAKAO_LOGIN } from '@/lib/login';
import { Button } from './ui';

type Provider = 'google' | 'kakao' | 'apple';

export function LoginButton({
  size = 'lg',
  label = '구글로 시작하기',
  next = '/home',
  authError = false,
}: {
  size?: 'md' | 'lg';
  /** 구글 버튼 글자 */
  label?: string;
  next?: string;
  authError?: boolean;
}) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [err, setErr] = useState<string | null>(authError ? '로그인하지 못했어요. 다시 해 주세요.' : null);

  // 로그인 창에 갔다가 뒤로 가기로 돌아오면(화면이 그대로 되살아나면) 버튼을 다시 누를 수 있게 한다
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const signIn = async (provider: Provider) => {
    setBusy(provider);
    setErr(null);
    // 구글·카카오·Apple 모두 같은 곳(/auth/callback)으로 돌아온다
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setBusy(null);
      setErr('로그인 창을 열지 못했어요. 잠시 뒤에 다시 해 주세요.');
    }
  };

  // 버튼은 크기·모양이 같다 (Apple 안내: 다른 로그인 버튼보다 작지 않게). 모서리는 카카오 안내(12px)에 모두 맞춘다
  const cls = 'w-full min-w-64 rounded-xl! shadow-[0_8px_24px_var(--shadow-strong)]';
  return (
    <div className="grid justify-items-center gap-2">
      <div className="grid gap-2.5">
        <Button size={size} variant="ink" busy={busy === 'google'} disabled={busy !== null} className={cls} onClick={() => signIn('google')}>
          <GoogleLogo />
          {label}
        </Button>
        {KAKAO_LOGIN ? (
          // 카카오 로그인 디자인 안내: 노란 바탕(#FEE500), 공식 말풍선 심볼, 글자 '카카오 로그인'(검정 85%, 기기 기본 글꼴), 모서리 12px
          <Button size={size} variant="kakao" busy={busy === 'kakao'} disabled={busy !== null} className={cls} onClick={() => signIn('kakao')}>
            <KakaoSymbol />
            <span className="[font-family:system-ui,-apple-system,'Apple_SD_Gothic_Neo','Malgun_Gothic',sans-serif]">카카오 로그인</span>
          </Button>
        ) : null}
        {APPLE_LOGIN ? (
          <Button size={size} variant="ink" busy={busy === 'apple'} disabled={busy !== null} className={cls} onClick={() => signIn('apple')}>
            <AppleLogo />
            Apple로 계속하기
          </Button>
        ) : null}
      </div>
      {err ? <p className="text-sm font-semibold text-bad">{err}</p> : null}
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * 카카오 말풍선 심볼: 카카오 디벨로퍼스 [도구] > [리소스 다운로드] > [카카오 로그인] 의 공식 파일(kakao_login_light.svg)에 든 모양 그대로.
 * 카카오 안내에 따라 모양·비율·색을 바꾸지 않는다 (둘레만 잘라 썼다).
 */
function KakaoSymbol() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="13 13.5 22 22">
      <path
        fill="#191919"
        d="M24.0014 14C17.9241 14 13 18.0219 13 22.9825C13 26.1711 15.0368 28.9728 18.1057 30.5656L17.0681 34.5677C17.0295 34.6871 17.0598 34.8151 17.1424 34.9033C17.2029 34.9659 17.2855 35 17.3653 35C17.4341 35 17.5029 34.9772 17.5607 34.9289L22.0196 31.8171C22.661 31.911 23.3215 31.9622 23.9986 31.9622C30.0732 31.9622 35 27.9403 35 22.9797C35 18.0191 30.0759 14 24.0014 14Z"
      />
    </svg>
  );
}

/** Apple 로고. 글자와 같은 색(currentColor)이라 밝은 화면에서는 검정 버튼에 흰 로고, 어두운 화면에서는 흰 버튼에 검정 로고가 된다 */
function AppleLogo() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="currentColor" className="-mt-0.5">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}
