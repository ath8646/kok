'use client';
// 로그인한 뒤의 화면 틀: 공지, 아래쪽 탭(폰) / 왼쪽 메뉴(컴퓨터), 빠른 추가(+ 버튼·끌어다 놓기)
// 화면마다 위쪽에 큰 제목(LargeHeader)이 있어서, 폰에서는 따로 위 띠를 두지 않는다.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse } from '@/lib/types';
import { QuickAddProvider } from './QuickAdd';
import { applyTheme, clearTheme, missingCustomIds, rememberCustomThemes, type CustomTheme, type Theme } from '@/lib/theme';
import { sb } from '@/lib/data';
import { Button, ICONS, Icon, Spinner, cx } from './ui';

type MeCtx = {
  me: MeResponse | null;
  refresh: () => Promise<void>;
  focus: boolean;
  setFocus: (on: boolean) => void;
};

const Ctx = createContext<MeCtx>({ me: null, refresh: async () => {}, focus: false, setFocus: () => {} });

export function useMe() {
  return useContext(Ctx);
}

const TABS = [
  { href: '/home', label: '홈', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { href: '/library', label: '자료함', icon: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z' },
  { href: '/review', label: '복습', icon: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2M21 3v6h-6' },
  { href: '/wrong', label: '오답', icon: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1zM9.5 8.5l5 5M14.5 8.5l-5 5' },
  {
    href: '/settings',
    label: '설정',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  },
];

/** + 버튼과 끌어다 놓기를 쓰는 화면 */
const QUICK_ADD_PAGES = ['/home', '/library', '/notes', '/wrong', '/questions'];
/** 넓게 쓰는 화면 (카드 격자) */
const WIDE_PAGES = ['/library'];

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function EnergyPill({ me }: { me: MeResponse }) {
  const e = me.energy;
  const label = e.unlimited ? '∞' : `${Math.floor(e.remaining ?? 0)}`;
  const low = !e.unlimited && (e.remaining ?? 0) < 3;
  return (
    <Link
      href="/settings#energy"
      className={cx(
        'press inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-bold',
        low ? 'bg-warn-soft text-warn' : 'bg-surface text-ink shadow-[0_1px_2px_var(--shadow)]',
      )}
      aria-label={`남은 AI 에너지 ${label}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      >
        <path d={ICONS.bolt} />
      </svg>
      {label}
    </Link>
  );
}

type MeResult = { kind: 'ok'; me: MeResponse } | { kind: 'unauth' } | { kind: 'error'; message: string };

async function fetchMe(): Promise<MeResult> {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' });
    if (res.status === 401) return { kind: 'unauth' };
    const body = await res.json().catch(() => null);
    if (!res.ok) return { kind: 'error', message: body?.message ?? '정보를 불러오지 못했어요.' };
    return { kind: 'ok', me: body as MeResponse };
  } catch {
    return { kind: 'error', message: '인터넷 연결을 확인해 주세요.' };
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);

  const apply = useCallback(
    (r: MeResult) => {
      if (r.kind === 'unauth') {
        // 로그인이 끝났으면 이 기기에 적어 둔 테마도 지운다 (다음에 로그인하는 사람에게 보이지 않게)
        clearTheme();
        router.replace(`/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (r.kind === 'error') {
        setError(r.message);
        return;
      }
      setError(null);
      setMe(r.me);
    },
    [router],
  );

  const refresh = useCallback(async () => apply(await fetchMe()), [apply]);

  useEffect(() => {
    let alive = true;
    fetchMe().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  useEffect(() => {
    if (me && !me.consented && pathname !== '/welcome') router.replace('/welcome');
  }, [me, pathname, router]);

  // 테마 (Pro·테스트 플랜에서 켠 경우): 쓸 수 없게 되면 기본으로 돌아간다 (고른 테마는 설정에 남는다)
  const theme = me ? (me.canTheme ? me.settings.theme : null) : undefined;
  const themeKey = theme === undefined ? '' : JSON.stringify(theme);
  const themesOn = !!me?.features.themes;
  useEffect(() => {
    if (!themeKey) return;
    const t = JSON.parse(themeKey) as Theme | null;
    if (!t) {
      applyTheme(null);
      return;
    }
    if (applyTheme(t)) return;
    // 내가 만든 테마를 아직 읽지 않았다: 읽은 뒤에 붙인다 (그동안은 THEME_BOOT 가 붙인 지난번 모습 그대로)
    if (!themesOn) {
      applyTheme(t, { allowMissing: true });
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (tries: number) => {
      sb()
        .from('user_themes')
        .select('id, name, spec')
        .in('id', missingCustomIds(t))
        .then(({ data, error }) => {
          if (!alive) return;
          if (error) {
            // 못 읽으면 한 번 더 (그래도 안 되면 지난번 색 그대로 두고, 밝기·글꼴·종이는 이미 붙였다)
            if (tries > 0) timer = setTimeout(() => load(tries - 1), 3000);
            return;
          }
          rememberCustomThemes((data ?? []) as CustomTheme[]);
          // 지워진 테마는 기본 색으로
          applyTheme(t, { allowMissing: true });
        });
    };
    load(1);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [themeKey, themesOn]);

  // 다른 화면으로 가면 집중 모드를 끈다
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setFocus(false);
  }

  if (error && !me) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
        <div className="grid gap-3">
          <p className="font-brand text-4xl text-accent">콕</p>
          <p>{error}</p>
          <Button onClick={() => refresh()}>다시 하기</Button>
        </div>
      </div>
    );
  }
  if (!me || (!me.consented && pathname !== '/welcome')) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted" aria-busy="true">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const bare = focus || pathname === '/welcome';
  const quickAdd = !bare && me.consented && QUICK_ADD_PAGES.some((p) => under(pathname, p));
  const wide = WIDE_PAGES.some((p) => under(pathname, p));
  // 탭(주소의 첫 칸)이 바뀔 때만 새 화면이 살짝 떠오른다 (/library ↔ /library/과목 은 같은 화면)
  const section = pathname.split('/')[1] ?? '';
  // 집중 모드로 바뀌어도 화면(children)이 다시 만들어지지 않도록, children 의 자리는 늘 같게 둔다
  return (
    <Ctx.Provider value={{ me, refresh, focus, setFocus }}>
      <QuickAddProvider me={me} refreshMe={refresh} enabled={quickAdd}>
        <div className={bare ? '' : 'md:flex'}>
          {!bare ? (
            <nav className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 px-4 pb-6 pt-7 md:flex" aria-label="주 메뉴">
              <Link href="/home" className="mb-6 px-3 font-brand text-4xl text-accent">
                콕
              </Link>
              {TABS.map((t) => {
                const on = under(pathname, t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={on ? 'page' : undefined}
                    className={cx(
                      'press flex items-center gap-3 rounded-full px-4 py-3 text-[15px] font-semibold transition-colors',
                      on ? 'bg-surface text-ink shadow-[0_1px_2px_var(--shadow)]' : 'text-muted hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    <Icon d={t.icon} size={21} className={on ? 'text-accent' : undefined} />
                    {t.label}
                  </Link>
                );
              })}
              <div className="mt-auto grid gap-2 px-1 text-sm">
                <EnergyPill me={me} />
                {me.isAdmin ? (
                  <Link href="/admin" className="rounded-full px-3 py-2 font-semibold text-muted hover:bg-surface-2">
                    관리자
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}

          <div className="min-w-0 flex-1">
            {!bare && me.notice.active && me.notice.text ? (
              <div className="bg-warn-soft px-4 pb-2 pt-[calc(8px+env(safe-area-inset-top))] text-center text-sm font-semibold text-warn md:pt-2" role="status">
                {me.notice.text}
              </div>
            ) : null}
            {!bare && !me.aiEnabled ? (
              <div className="bg-surface-2 px-4 pb-2 pt-[calc(8px+env(safe-area-inset-top))] text-center text-sm text-muted md:pt-2" role="status">
                지금은 AI 기능을 잠깐 쉬고 있어요. 복습은 그대로 할 수 있어요.
              </div>
            ) : null}
            <main
              className={cx(
                'mx-auto w-full px-4 md:px-6',
                wide ? 'max-w-6xl' : 'max-w-3xl',
                bare ? 'pb-10 pt-[calc(16px+env(safe-area-inset-top))]' : 'pb-[calc(170px+env(safe-area-inset-bottom))] md:pb-28',
              )}
            >
              <div key={section} className="kok-page">
                {children}
              </div>
            </main>
          </div>

          {!bare ? (
            <nav
              className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] px-1 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-1px_0_var(--line)] backdrop-blur-xl md:hidden"
              aria-label="주 메뉴"
            >
              {TABS.map((t) => {
                const on = under(pathname, t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={on ? 'page' : undefined}
                    className={cx('flex flex-col items-center gap-0.5 pb-1.5 pt-1 text-[11px] font-semibold', on ? 'text-ink' : 'text-muted')}
                  >
                    <span className={cx('kok-tab-pill grid h-8 w-14 place-items-center rounded-full', on ? 'bg-accent-soft text-accent' : '')}>
                      <Icon d={t.icon} size={21} />
                    </span>
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </QuickAddProvider>
    </Ctx.Provider>
  );
}
