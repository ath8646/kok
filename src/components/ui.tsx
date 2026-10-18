'use client';
// 콕 공통 화면 조각 (버튼, 카드, 시트, 큰 제목, 메뉴, 알림 등)
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
};

const BTN_BASE =
  'press inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,background-color,opacity] disabled:cursor-not-allowed disabled:opacity-45 select-none whitespace-nowrap';
const BTN_SIZES = { sm: 'px-3.5 py-1.5 text-sm', md: 'px-5 py-2.5 text-[15px]', lg: 'px-6 py-3.5 text-base' };
const BTN_VARIANTS = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  ink: 'bg-ink text-surface hover:opacity-90',
  secondary: 'bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-bad text-white hover:brightness-110',
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
  children,
}: {
  href: string;
  variant?: BtnProps['variant'];
  size?: BtnProps['size'];
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant ?? 'primary'], className)}>
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
      className={cx('press grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink hover:bg-surface-2', className)}
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

export const ICONS = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  more: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  clip: 'M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4L15 6.9',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  send: 'M5 12h13M12 5l7 7-7 7',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  folder: 'M3 6h6l2 2h10v11H3z',
  check: 'M5 12.5l4.5 4.5L19 7',
  retry: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
};

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
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

export function ProgressBar({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'ok' | 'warn'; label?: string }) {
  const color = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-fab';
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cx('h-full origin-left rounded-full transition-[width] duration-500', color)} style={{ width: `${v}%` }} />
    </div>
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
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
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
      <h2 className="font-display text-lg">{children}</h2>
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
      className="press grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-surface-2"
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
        <h1 className={cx('font-display leading-tight', size === 'large' ? 'text-[30px] md:text-[34px]' : 'line-clamp-3 text-[26px] md:text-[30px]')}>
          {title}
        </h1>
        {subtitle ? <div className="mt-1 text-[15px] text-muted">{subtitle}</div> : null}
      </div>
    </>
  );
}

/** 작은 위 띠 (뒤로 가기 + 제목) */
export function TopBar({ back, title, actions }: { back?: { href: string; label: string }; title?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cx(TOPBAR, 'is-collapsed')}>
      {back ? <BackLink back={back} /> : <span className="w-2" aria-hidden="true" />}
      <p className="min-w-0 flex-1 truncate text-[17px] font-bold">{title}</p>
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  );
}

// ------------------------------------------------------------- 메뉴 (⋮ 를 누르면 펼쳐지는 작은 목록)
export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; icon?: string };

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
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={wrap} className={cx('relative', className)}>
      <IconButton
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={small ? 'h-8 w-8 text-muted hover:text-ink' : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Icon d={ICONS.more} size={small ? 18 : 22} strokeWidth={3} />
      </IconButton>
      {open ? (
        <div
          role="menu"
          className={cx(
            'kok-pop absolute z-40 min-w-44 overflow-hidden rounded-2xl bg-surface py-1.5 shadow-[0_12px_32px_var(--shadow-strong)] ring-1 ring-line',
            small ? 'top-9' : 'top-11',
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
          )}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-surface-2', it.danger ? 'text-bad' : 'text-ink')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon ? <Icon d={it.icon} size={18} /> : null}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
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
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'plain') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3400);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="kok-toasts pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-8"
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
  const res = await fetch(url, {
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
  'w-full min-w-0 rounded-2xl border-2 border-transparent bg-surface-2 px-4 py-2.5 text-[15px] text-ink placeholder:text-muted/80 transition-colors focus:border-accent focus:bg-surface focus:outline-none';

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-surface-2 p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'press rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors',
            o.value === value ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1" htmlFor={id}>
      <span className="text-[15px]">{label}</span>
      <span className="relative inline-flex">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-surface-3 transition-colors peer-checked:bg-fab peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent" />
        <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
