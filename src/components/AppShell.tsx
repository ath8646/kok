'use client';
// 로그인한 뒤의 화면 틀: 위쪽 띠(로고·에너지), 공지, 아래쪽 탭(폰) / 왼쪽 메뉴(컴퓨터)
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse } from '@/lib/types';
import { Button, Spinner, cx } from './ui';

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
  { href: '/library', label: '자료함', icon: 'M4 4h6l2 2h8v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9h16' },
  { href: '/review', label: '복습', icon: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2M21 3v6h-6' },
  { href: '/wrong', label: '오답', icon: 'M5 4h14v16H5zM9 9l6 6M15 9l-6 6' },
  {
    href: '/settings',
    label: '설정',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  },
];

function TabIcon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export function EnergyPill({ me }: { me: MeResponse }) {
  const e = me.energy;
  const label = e.unlimited ? '∞' : `${Math.floor(e.remaining ?? 0)}`;
  const low = !e.unlimited && (e.remaining ?? 0) < 3;
  return (
    <Link
      href="/settings#energy"
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-bold',
        low ? 'border-warn bg-warn-soft text-warn' : 'border-line bg-surface text-ink',
      )}
      aria-label={`남은 AI 에너지 ${label}`}
    >
      <span aria-hidden="true">⚡</span>
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
          <p className="font-display text-3xl text-accent">콕</p>
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
  // 집중 모드로 바뀌어도 화면(children)이 다시 만들어지지 않도록, children 의 자리는 늘 같게 둔다
  return (
    <Ctx.Provider value={{ me, refresh, focus, setFocus }}>
      <div className={bare ? '' : 'md:flex'}>
        {!bare ? (
          <nav
            className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface/80 p-4 backdrop-blur md:flex"
            aria-label="주 메뉴"
          >
            <Link href="/home" className="mb-4 px-2 font-display text-3xl text-accent">
              콕
            </Link>
            {TABS.map((t) => {
              const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={on ? 'page' : undefined}
                  className={cx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold',
                    on ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface-2',
                  )}
                >
                  <TabIcon d={t.icon} />
                  {t.label}
                </Link>
              );
            })}
            <div className="mt-auto grid gap-2 text-sm">
              <EnergyPill me={me} />
              {me.isAdmin ? (
                <Link href="/admin" className="rounded-xl px-3 py-2 font-semibold text-muted hover:bg-surface-2">
                  관리자
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}

        <div className="min-w-0 flex-1">
          {!bare ? (
            <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/85 px-4 pb-2 pt-[calc(8px+env(safe-area-inset-top))] backdrop-blur md:hidden">
              <Link href="/home" className="font-display text-2xl text-accent">
                콕
              </Link>
              <div className="flex items-center gap-2">
                {me.isPro ? <span className="rounded-full bg-hl px-2 py-0.5 text-xs font-bold text-hl-ink">Pro</span> : null}
                <EnergyPill me={me} />
              </div>
            </header>
          ) : null}
          {!bare && me.notice.active && me.notice.text ? (
            <div className="border-b border-warn/30 bg-warn-soft px-4 py-2 text-center text-sm font-semibold text-warn" role="status">
              {me.notice.text}
            </div>
          ) : null}
          {!bare && !me.aiEnabled ? (
            <div className="border-b border-line bg-surface-2 px-4 py-2 text-center text-sm text-muted" role="status">
              지금은 AI 기능을 잠깐 쉬고 있어요. 복습은 그대로 할 수 있어요.
            </div>
          ) : null}
          <main
            className={cx(
              'mx-auto w-full max-w-3xl px-4',
              bare ? 'pb-10 pt-[calc(16px+env(safe-area-inset-top))]' : 'pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 md:pb-12 md:pt-8',
            )}
          >
            {children}
          </main>
        </div>

        {!bare ? (
          <nav
            className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
            aria-label="주 메뉴"
          >
            {TABS.map((t) => {
              const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={on ? 'page' : undefined}
                  className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', on ? 'text-accent' : 'text-muted')}
                >
                  <TabIcon d={t.icon} />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}
