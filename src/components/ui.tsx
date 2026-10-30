'use client';
// KOK 공통 화면 조각 (버튼, 카드, 시트, 큰 제목, 메뉴, 알림 등)
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ICONS } from '@/lib/icons';
import { trackedFetch } from '@/lib/view-cache';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink' | 'kakao';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
};

const BTN_BASE =
  'press inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,background-color,opacity] disabled:cursor-not-allowed disabled:opacity-45 select-none whitespace-nowrap';
const BTN_SIZES = { sm: 'px-3.5 py-1.5 text-sm', md: 'px-5 py-2.5 text-[15px]', lg: 'px-6 py-3.5 text-base' };
// kok-btn-*: 시그니처 테마(skins.css)가 버튼 모양을 바꾸는 이름 (카카오 버튼은 안내대로 그대로 둔다)
const BTN_VARIANTS = {
  primary: 'kok-btn kok-btn-primary bg-accent text-accent-ink hover:brightness-110',
  ink: 'kok-btn kok-btn-ink bg-ink text-surface hover:opacity-90',
  secondary: 'kok-btn kok-btn-secondary bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'kok-btn kok-btn-ghost text-ink hover:bg-surface-2',
  danger: 'kok-btn kok-btn-danger bg-bad text-white hover:brightness-110',
  // 카카오 로그인 버튼: 카카오 안내대로 노란 바탕(#FEE500)에 검은 글자(85%). 어두운 화면에서도 같은 색
  kakao: 'bg-[#FEE500] text-black/85 hover:brightness-95',
};

export function Button({ variant = 'primary', size = 'md', busy, className, children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} className={cx(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant], className)} disabled={disabled || busy} {...rest}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function buttonClass(variant: NonNullable<BtnProps['variant']> = 'primary', size: NonNullable<BtnProps['size']> = 'md', extra?: string): string {
  return cx(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant], extra);
}

/** 버튼처럼 보이는 링크 */
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className,
  onClick,
  children,
}: {
  href: string;
  variant?: BtnProps['variant'];
  size?: BtnProps['size'];
  className?: string;
  /** 이동하기 전에 할 일 (이동은 링크가 한다) */
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Link href={href} onClick={onClick} className={cx(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant ?? 'primary'], className)}>
      {children}
    </Link>
  );
}

/** 동그란 아이콘 버튼 (머리 띠의 검색·메뉴 등) */
export function IconButton({ label, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // 손가락이 닿는 크기 (44px): 머리 띠의 검색·메뉴·닫기
      className={cx('press grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink hover:bg-surface-2', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 선 아이콘 (24 칸 기준 path) */
export function Icon({ d, size = 22, className, strokeWidth = 1.9 }: { d: string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

// 선 아이콘 모양은 src/lib/icons.ts (서버 화면에서도 쓰게 'use client' 밖에 둔다)
export { ICONS };

/** 에너지 수: 번개 아이콘 + 숫자 (⚡ 이모지 대신. 글자 크기를 따른다) */
export function Energy({
  n,
  className,
  sr = true,
}: {
  n: ReactNode;
  className?: string;
  /** 화면 읽기 프로그램에 '에너지'라고 읽어 줄지 (옆 글에 이미 '에너지'가 있으면 false) */ sr?: boolean;
}) {
  return (
    <span className={cx('inline-flex items-center gap-0.5 tabular-nums', className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[0.95em] w-[0.95em] shrink-0"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      >
        <path d={ICONS.bolt} />
      </svg>
      {sr ? <span className="sr-only">에너지 </span> : null}
      {n}
    </span>
  );
}

/** AI 를 부르기 전 한 줄: 예상 에너지(약 N)와 남은 에너지. est 가 없으면 남은 에너지만 */
export function EnergyEstimate({ est, left }: { est?: number | string | null; left?: number | null }) {
  const hasEst = est !== null && est !== undefined && est !== '';
  const hasLeft = left !== null && left !== undefined;
  return (
    <>
      {hasEst ? <Energy n={`약 ${est}`} /> : null}
      {hasEst && hasLeft ? ' · ' : null}
      {hasLeft ? `남음 ${left}` : null}
    </>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('kok-card p-4', className)} {...rest}>
      {children}
    </div>
  );
}

export function Chip({
  tone = 'plain',
  children,
  className,
}: {
  tone?: 'plain' | 'accent' | 'ok' | 'bad' | 'warn' | 'hl';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    plain: 'bg-surface-2 text-muted',
    accent: 'bg-accent-soft text-accent',
    ok: 'bg-ok-soft text-ok',
    bad: 'bg-bad-soft text-bad',
    warn: 'bg-warn-soft text-warn',
    hl: 'bg-hl text-hl-ink',
  };
  return (
    <span className={cx('kok-chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>
  );
}

/** 동그란 진행 고리 */
export function ProgressRing({
  value,
  size = 34,
  stroke = 4,
  label,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  /** 고리 가운데에 보일 것 */
  children?: ReactNode;
}) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke - 1) / 2;
  const c = 2 * Math.PI * r;
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <circle className="kok-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle
        className="kok-ring-progress"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--fab)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        opacity={v > 0 ? 1 : 0}
      />
    </svg>
  );
  if (!children) return svg;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {svg}
      <span className="absolute inset-0 grid place-items-center">{children}</span>
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1 mt-5 flex items-center justify-between gap-3 px-1">
      <h2 className="kok-section-title font-display text-lg">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="kok-card grid justify-items-center gap-1 px-5 py-10 text-center">
      {icon ? <div className="mb-2 text-muted">{icon}</div> : null}
      <p className="font-display text-lg">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------- 큰 제목 머리 (스크롤하면 위 띠로 작아진다)
/** 위 띠 높이: 폰 56px(+상태 표시줄), 컴퓨터 64px. 띠 아래에 붙는 탭은 STICKY_BELOW_TOPBAR 를 쓴다 */
const TOPBAR =
  'kok-topbar sticky top-0 z-30 -mx-4 flex h-[calc(56px+env(safe-area-inset-top))] items-center gap-1 px-2 pt-[env(safe-area-inset-top)] md:-mx-6 md:h-16 md:px-4 md:pt-0';
export const STICKY_BELOW_TOPBAR = 'sticky top-[calc(56px+env(safe-area-inset-top))] md:top-16';

function BackLink({ back }: { back: { href: string; label: string } }) {
  return (
    <Link
      href={back.href}
      aria-label={back.label}
      title={back.label}
      className="press grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-surface-2"
    >
      <Icon d={ICONS.back} />
    </Link>
  );
}

export function LargeHeader({
  title,
  subtitle,
  actions,
  back,
  compactTitle,
  size = 'large',
  flush = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** 왼쪽 위 뒤로 가기 링크 */
  back?: { href: string; label: string };
  /** 작아진 띠에 보일 제목 (없으면 title) */
  compactTitle?: ReactNode;
  /** large: 폰에서 화면 위쪽을 넉넉히 쓰는 큰 제목, compact: 긴 제목(노트 등) */
  size?: 'large' | 'compact';
  /** 바로 아래에 붙는 탭이 있으면 띠 아래 줄을 그리지 않는다 */
  flush?: boolean;
}) {
  const bigRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = bigRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), { rootMargin: '-64px 0px 0px 0px', threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div className={cx(TOPBAR, collapsed && 'is-collapsed', flush && 'is-flush')}>
        {back ? <BackLink back={back} /> : <span className="w-2" aria-hidden="true" />}
        <p className="kok-topbar-title min-w-0 flex-1 truncate text-[17px] font-bold" aria-hidden={!collapsed}>
          {compactTitle ?? title}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>
      <div
        ref={bigRef}
        className={cx('flex flex-col justify-end px-1', size === 'large' ? 'min-h-[18vh] pb-5 pt-2 md:min-h-0 md:pb-6 md:pt-1' : 'pb-4 pt-1 md:pb-5')}
      >
        <h1 className={cx('kok-title font-display leading-tight', size === 'large' ? 'text-[30px] md:text-[34px]' : 'line-clamp-3 text-[26px] md:text-[30px]')}>
          {/* 시그니처 테마가 제목을 꾸미는 칸 (형광펜 밑줄·커서·어긋난 색: skins.css). data-text 는 글자를 겹쳐 그릴 때 */}
          <span className="kok-title-text" data-text={typeof title === 'string' ? title : undefined}>
            {title}
          </span>
        </h1>
        {subtitle ? <div className="mt-1 text-[15px] text-muted">{subtitle}</div> : null}
      </div>
    </>
  );
}

/**
 * 바뀌는 글(제목·부제·숫자): key 를 글로 주면 바뀔 때 새 글이 살짝 번지며 나타난다 (.kok-swap).
 * still: 기억해 둔 화면으로 처음 그린 글은 번지지 않고 그대로 (다시 들어올 때 글이 깜빡이지 않게).
 * 처음 그릴 때 정한 대로 둔다: 같은 글에 나중에 번짐을 붙이면 그 자리에서 다시 번지기 때문이다
 */
export function Swap({ still = false, className, children }: { still?: boolean; className?: string; children: ReactNode }) {
  const [animate] = useState(!still);
  return <span className={cx(animate && 'kok-swap', className) || undefined}>{children}</span>;
}

// ------------------------------------------------------------- 메뉴 (⋮ 를 누르면 펼쳐지는 작은 목록)
export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; icon?: string };

/** 메뉴와 단추 사이, 메뉴와 화면 끝 사이 (px) */
const MENU_GAP = 4;
const MENU_EDGE = 8;

/**
 * 메뉴를 단추 옆 화면 안에 둔다: 아래 자리(화면 아래 메뉴·고르기 띠 위까지)가 모자라면 위로 열고,
 * 양쪽 모두 모자라면 넓은 쪽에 두고 안에서 스크롤한다. 왼쪽·오른쪽 끝도 넘지 않는다.
 * 단추가 화면 밖으로 나갔으면 false (메뉴를 닫는다)
 */
function placeMenu(trigger: HTMLElement, m: HTMLElement, align: 'left' | 'right'): boolean {
  const b = trigger.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  if ((!b.width && !b.height) || b.bottom < 0 || b.top > vh) {
    m.style.visibility = 'hidden';
    return false;
  }
  m.style.visibility = '';
  let bottom = vh - MENU_EDGE;
  // 창(시트 등) 안의 메뉴는 창이 화면 아래 메뉴를 덮고 있어서 화면 끝까지 쓴다
  if (!m.parentElement?.closest('[role="dialog"]')) {
    for (const el of document.querySelectorAll<HTMLElement>('.kok-tabbar, .kok-selbar')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < vh && r.top > vh / 2) bottom = Math.min(bottom, r.top - MENU_EDGE);
    }
  }
  const top = MENU_EDGE;
  const h = m.scrollHeight;
  const below = bottom - (b.bottom + MENU_GAP);
  const above = b.top - MENU_GAP - top;
  const up = h > below && above > below;
  const room = Math.max(96, up ? above : below);
  const height = Math.min(h, room);
  m.style.maxHeight = h > room ? `${room}px` : '';
  m.style.top = `${Math.round(up ? b.top - MENU_GAP - height : b.bottom + MENU_GAP)}px`;
  const w = m.offsetWidth;
  const left = Math.max(MENU_EDGE, Math.min(align === 'right' ? b.right - w : b.left, vw - MENU_EDGE - w));
  m.style.left = `${Math.round(left)}px`;
  m.style.transformOrigin = `${up ? 'bottom' : 'top'} ${align}`;
  return true;
}

/**
 * ⋮ 메뉴. 펼친 목록은 화면 맨 위 층에 그린다(창 안이면 그 창에): 카드가 잘라 내거나(overflow)
 * 화면 아래 메뉴·옆 카드 밑에 깔리지 않게. 열면 첫 칸에 초점, 위아래 화살표·Home·End 로 옮기고,
 * Esc·고르기는 ⋮ 로 초점을 돌려준다. Tab 은 메뉴를 닫고 다음 칸으로
 */
export function Menu({
  label,
  items,
  className,
  align = 'right',
  small = false,
}: {
  label: string;
  items: MenuItem[];
  className?: string;
  align?: 'left' | 'right';
  /** 카드 모서리에 들어가는 작은 ⋮ */
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** 펼친 목록을 그릴 곳: 메뉴가 든 창(role=dialog), 없으면 body */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const trigger = () => wrap.current?.querySelector<HTMLButtonElement>('button') ?? null;
  const close = (focusBack: boolean) => {
    setOpen(false);
    if (focusBack) trigger()?.focus({ preventScroll: true });
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrap.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    // Esc 는 열린 메뉴만 닫는다: 창의 capture 단계에서 먼저 받아 멈춰서, 시트(Sheet)·자료함 고르기 같은 다른 Esc 가 같이 닫히지 않게
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current(true);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  // 그리기 전에 자리를 잡고(번쩍이지 않게), 화면이 움직이면 ⋮ 를 따라간다. 열 때 첫 칸에 초점
  useLayoutEffect(() => {
    if (!open || !host) return;
    const m = pop.current;
    const t = wrap.current?.querySelector<HTMLButtonElement>('button');
    if (!m || !t) return;
    let raf = 0;
    const follow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (pop.current && !placeMenu(t, pop.current, align)) setOpen(false);
      });
    };
    if (placeMenu(t, m, align)) m.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    else follow();
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    window.visualViewport?.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      window.visualViewport?.removeEventListener('resize', follow);
    };
  }, [open, host, align]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!list.length) return;
    if (e.key === 'Tab') {
      // ⋮ 에 초점을 두고 닫으면, 브라우저가 거기서부터 다음(Shift 는 앞) 칸으로 옮긴다
      close(true);
      return;
    }
    const i = list.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'ArrowDown'
        ? (i + 1) % list.length
        : e.key === 'ArrowUp'
          ? (i - 1 + list.length) % list.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? list.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    list[to].focus({ preventScroll: true });
  };
  return (
    <div ref={wrap} className={cx('relative', className)}>
      <IconButton
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={small ? 'h-8 w-8 text-muted hover:text-ink' : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          setHost((e.currentTarget.closest('[role="dialog"]') as HTMLElement | null) ?? document.body);
          setOpen(true);
        }}
      >
        <Icon d={ICONS.more} size={small ? 18 : 22} strokeWidth={3} />
      </IconButton>
      {open && host
        ? createPortal(
            <div
              ref={pop}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKey}
              className="kok-pop fixed left-0 top-0 z-[60] min-w-44 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-2xl bg-surface py-1.5 shadow-[0_12px_32px_var(--shadow-strong)] ring-1 ring-line"
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={cx(
                    'flex w-full items-center gap-3 whitespace-nowrap px-4 py-2.5 text-left text-[15px] hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:[outline-offset:-3px]',
                    it.danger ? 'text-bad' : 'text-ink',
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // 고른 일이 창을 열면 창이 초점을 가져간다 (먼저 ⋮ 로 돌려 두어 초점이 사라지지 않게)
                    close(true);
                    it.onSelect();
                  }}
                >
                  {it.icon ? <Icon d={it.icon} size={18} className="shrink-0" /> : null}
                  {it.label}
                </button>
              ))}
            </div>,
            host,
          )
        : null}
    </div>
  );
}

/** 아래에서 올라오는 시트 (폰), 가운데 창 (컴퓨터) */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose 는 화면이 새로 그려질 때마다 새 함수일 수 있다: 열 때 한 번만 창에 초점을 두고,
  // 글자를 칠 때마다 입력칸의 초점을 빼앗지 않게 최신 onClose 는 ref 로 부른다
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 안쪽에서 Esc 를 먼저 쓴 경우(끌던 칸 내려놓기 등: preventDefault)는 닫지 않는다
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="닫기" className="kok-scrim absolute inset-0" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className="kok-sheet relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl outline-none sm:rounded-[28px]"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-surface-3 sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-6 pb-3 pt-4">
          {title ? <h2 className="font-display text-xl">{title}</h2> : <span />}
          <button type="button" onClick={onClose} className="press rounded-full px-3 py-1 text-sm font-semibold text-muted hover:bg-surface-2">
            닫기
          </button>
        </div>
        <div className={cx('min-h-0 flex-1 overflow-y-auto px-6', footer ? 'pb-4' : 'pb-[calc(24px+env(safe-area-inset-bottom))]')}>{children}</div>
        {footer ? <div className="border-t border-line px-6 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- 알림(토스트)
type Toast = { id: number; text: string; tone: 'plain' | 'ok' | 'bad' };
/**
 * 알림의 종류. done: 내가 한 일이 끝났다는 알림('지웠어요', '보관을 풀었어요' …) — 설정 '완료 알림 보이기'를 끄면 안 뜬다.
 * 표시가 없는 알림(오류, 'Pro에서 쓸 수 있어요'처럼 꼭 알아야 할 안내, 졸업 축하 …)은 늘 뜬다
 */
export type ToastOpts = { done?: boolean };
export const DONE: ToastOpts = { done: true };
const ToastCtx = createContext<(text: string, tone?: Toast['tone'], opts?: ToastOpts) => void>(() => {});

/** 완료 알림을 보일지 (AppShell 이 내 설정 notify.done 으로 정한다) */
let showDone = true;
export function setShowDoneToasts(on: boolean) {
  showDone = on;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'plain', opts?: ToastOpts) => {
    if (opts?.done && !showDone && tone !== 'bad') return;
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3400);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* 레슨·테마 만들기·PDF 보기 같은 전체 화면 창(z 70) 위에도 보이게 (묻는 창 z 95 보다는 아래) */}
      <div
        className="kok-toasts pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-4 md:bottom-8"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'kok-toast max-w-md rounded-full px-5 py-3 text-sm font-semibold shadow-lg',
              t.tone === 'ok' ? 'bg-ok text-white' : t.tone === 'bad' ? 'bg-bad text-white' : 'bg-ink text-surface',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** 서버가 돌려준 오류 (한국어 메시지 + 상태 + 오류 이름) */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

/** fetch + JSON + 한국어 오류 메시지 */
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  // 쓰기 요청이면 기억해 둔 화면을 옛것으로 센다 (src/lib/view-cache.ts)
  const res = await trackedFetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = body as { message?: string; error?: string } | null;
    throw new ApiError(b?.message ?? '잠깐 문제가 생겼어요. 다시 해 주세요.', res.status, b?.error ?? 'unknown');
  }
  return body as T;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  'kok-input w-full min-w-0 rounded-2xl border-2 border-transparent bg-surface-2 px-4 py-2.5 text-[15px] text-ink placeholder:text-muted/80 transition-colors focus:border-accent focus:bg-surface focus:outline-none';

/**
 * 라디오 묶음의 키보드: ←↑ 앞, →↓ 다음, Home 처음, End 끝. 고르고 그 칸으로 초점을 옮긴다.
 * 쓰는 곳: role="radiogroup" 안의 role="radio" 버튼 (고른 것만 tabIndex 0)
 */
export function radioKeys(e: React.KeyboardEvent<HTMLElement>, index: number, count: number, select: (i: number) => void) {
  const k = e.key;
  const to =
    k === 'ArrowRight' || k === 'ArrowDown' ? index + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? index - 1 : k === 'Home' ? 0 : k === 'End' ? count - 1 : null;
  if (to === null || count < 1) return;
  e.preventDefault();
  const n = (to + count) % count;
  select(n);
  const radios = e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]');
  radios?.[n]?.focus();
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label?: string;
  disabled?: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      className={cx('kok-seg inline-flex flex-wrap gap-1 rounded-full bg-surface-2 p-1', disabled && 'opacity-50')}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          // 화살표로 고르기 (라디오처럼 한 번에 한 칸만 Tab 으로 들어간다)
          tabIndex={i === index ? 0 : -1}
          onKeyDown={(e) => radioKeys(e, i, options.length, (n) => onChange(options[n].value))}
          onClick={() => onChange(o.value)}
          className={cx(
            'press rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
            o.value === value ? 'kok-seg-on bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  id,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  /** 이름 아래 작은 설명 (스위치의 설명으로 읽힌다) */
  hint?: string;
  id?: string;
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <label className={cx('flex items-center justify-between gap-4 py-1', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')} htmlFor={id}>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[15px]">{label}</span>
        {hint ? (
          <span id={hintId} className="text-xs text-muted">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          // 설명이 있으면 이름은 짧게(이름만), 설명은 따로 읽힌다
          aria-label={hint ? label : undefined}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="kok-switch h-7 w-12 rounded-full bg-surface-3 transition-colors peer-checked:bg-fab peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent" />
        <span className="kok-switch-knob absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
