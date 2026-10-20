'use client';
// 고르기 칸: 기본 <select> 대신 KOK 디자인의 펼침 목록 (ARIA listbox 패턴)
// - 칸은 입력칸과 같은 모양의 <button>, 누르거나 ↓↑·Enter·Space 로 열면 목록(role="listbox")에 초점이 가고 aria-activedescendant 로 줄을 가리킨다
// - 목록은 portal 로 띄워(position: fixed) 스크롤 상자에 잘리지 않고, 스크롤·화면 크기가 바뀌면 칸을 따라간다
// - 열려 있는 동안 목록 밖을 누르면 닫기만 한다 (밑에 있는 버튼·시트 바깥이 같이 눌리지 않게)
// 규칙(자리·글자로 찾기)은 src/lib/select.ts
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ICONS, Icon, cx, inputClass } from './ui';
import { findTyped, listWidthRange, placeList, stepEnabled } from '@/lib/select';

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  /** 목록에서 이름 아래에 보이는 작은 글 */
  hint?: string;
  disabled?: boolean;
};

const CHEVRON = 'M6 9l6 6 6-6';
/** 글자를 이어서 쳤다고 보는 간격 */
const TYPE_MS = 700;
/** 목록 위아래 여백 (py-1.5) */
const LIST_PAD = 6;

/** 글자로 찾기에 쓰는 키 (한글 조합 중·단축키는 빼고) */
const isTypeKey = (e: ReactKeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing;

/**
 * 목록을 띄울 곳: 시트처럼 aria-modal 인 창 안이면 그 창 (화면 읽기 프로그램이 창 밖을 숨겨서), 아니면 <body>.
 * 그 창이나 위 상자에 transform 등이 있으면 fixed 가 화면 기준이 아니게 되어 <body> 로 띄운다.
 */
function portalHost(trigger: HTMLElement): HTMLElement {
  const modal = trigger.closest<HTMLElement>('[aria-modal="true"]');
  if (!modal) return document.body;
  for (let el: HTMLElement | null = modal; el && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (
      s.transform !== 'none' ||
      s.translate !== 'none' ||
      s.scale !== 'none' ||
      s.rotate !== 'none' ||
      s.perspective !== 'none' ||
      s.filter !== 'none' ||
      (s.backdropFilter || 'none') !== 'none' ||
      (s.containerType || 'normal') !== 'normal' ||
      /paint|layout|strict|content/.test(s.contain) ||
      /transform|perspective|filter/.test(s.willChange)
    )
      return document.body;
  }
  return modal;
}

/** 칸을 감싼 <label> 의 글. 칸(고른 값)과 숨은 글은 뺀다 */
function textWithout(root: Node, skip: Node): string {
  let s = '';
  for (const n of Array.from(root.childNodes)) {
    if (n === skip) continue;
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? '';
    else if (n instanceof HTMLElement && !n.hidden && n.getAttribute('aria-hidden') !== 'true') s += textWithout(n, skip);
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** 칸을 잘라 보이게 하는 위 상자들 (스크롤 상자 등). 칸이 이 상자 밖으로 다 나가면 목록을 닫는다 */
function clippingAncestors(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') out.push(p);
    if (s.position === 'fixed') break;
  }
  return out;
}

export function Select<T extends string = string>({
  value,
  options,
  onChange,
  id,
  placeholder,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  /** 칸(button)의 id: <label htmlFor> 가 이 칸의 이름이 된다 */
  id?: string;
  /** 고른 값이 목록에 없을 때 흐리게 보이는 글 (없으면 기본 <select> 처럼 첫 줄) */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const base = useId();
  const triggerId = id ?? `${base}t`;
  const listId = `${base}l`;
  const valueId = `${base}v`;
  const nameId = `${base}n`;
  const optionId = (i: number) => `${base}o${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const clipsRef = useRef<HTMLElement[]>([]);
  const typedRef = useRef({ text: '', at: 0 });
  const pointerRef = useRef({ x: NaN, y: NaN });
  const centerNext = useRef(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [host, setHost] = useState<HTMLElement | null>(null);
  // 목록 밖을 눌러 닫은 뒤, 그 누름이 끝날 때까지 밑에 있는 것이 눌리지 않게 막아 두는 판
  const [guard, setGuard] = useState(false);

  if (open && disabled) setOpen(false);

  const selected = options.findIndex((o) => o.value === value);
  // 값이 목록에 없으면: 안내 글이 있으면 흐리게, 없으면 기본 <select> 처럼 첫 줄을 보인다
  const shown = selected >= 0 ? options[selected] : placeholder === undefined ? options.find((o) => !o.disabled) : undefined;
  const act = active < options.length ? active : -1;

  /** 목록을 칸에 맞춰 놓는다. 칸이 보이지 않으면 false */
  const place = useCallback((): boolean => {
    const t = triggerRef.current;
    const list = listRef.current;
    if (!t || !list) return true;
    const vv = window.visualViewport;
    const view = vv
      ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
      : { left: 0, top: 0, width: document.documentElement.clientWidth, height: window.innerHeight };
    const r = t.getBoundingClientRect();
    let top = Math.max(r.top, view.top);
    let bottom = Math.min(r.bottom, view.top + view.height);
    let left = Math.max(r.left, view.left);
    let right = Math.min(r.right, view.left + view.width);
    for (const c of clipsRef.current) {
      const cr = c.getBoundingClientRect();
      top = Math.max(top, cr.top);
      bottom = Math.min(bottom, cr.bottom);
      left = Math.max(left, cr.left);
      right = Math.min(right, cr.right);
    }
    const w = listWidthRange(r.width, view);
    list.style.minWidth = `${w.min}px`;
    list.style.maxWidth = `${w.max}px`;
    const p = placeList(r, view, { width: list.offsetWidth, contentHeight: list.scrollHeight });
    list.style.maxHeight = `${p.maxHeight}px`;
    list.style.left = `${p.left}px`;
    list.style.top = `${p.top}px`;
    list.style.transformOrigin = `${p.originX}px ${p.up ? '100%' : '0'}`;
    return bottom - top >= 1 && right - left >= 1;
  }, []);

  const close = useCallback((refocus: boolean) => {
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);

  const openAt = (index: number) => {
    const t = triggerRef.current;
    if (!t || disabled || !options.length) return;
    clipsRef.current = clippingAncestors(t);
    centerNext.current = true;
    setHost(portalHost(t));
    setActive(index);
    setOpen(true);
  };

  /** 열 때 가리킬 줄: 고른 값, 없으면 첫 줄 */
  const startIndex = () => (selected >= 0 && !options[selected].disabled ? selected : stepEnabled(options, -1, 1));

  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    close(true);
    if (o.value !== value) onChange(o.value);
  };

  const typeahead = (key: string, from: number) => {
    const now = Date.now();
    const t = typedRef.current;
    t.text = now - t.at > TYPE_MS ? key : t.text + key;
    t.at = now;
    return findTyped(options, t.text, from);
  };
  const typing = () => typedRef.current.text !== '' && Date.now() - typedRef.current.at <= TYPE_MS;

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    // Enter·Space 는 버튼의 click 으로 연다
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(startIndex());
    } else if (isTypeKey(e) && e.key !== ' ') {
      const i = typeahead(e.key, selected);
      if (i >= 0) {
        e.preventDefault();
        openAt(i);
      }
    }
  };

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    // Tab: 닫고 칸으로 초점을 돌린다. 기본 동작(다음·앞 칸으로)은 칸에서 이어진다
    if (k === 'Tab') return close(true);
    let next = -2;
    if (k === 'ArrowDown') next = stepEnabled(options, act, 1);
    else if (k === 'ArrowUp') next = act < 0 ? stepEnabled(options, options.length, -1) : stepEnabled(options, act, -1);
    else if (k === 'Home') next = stepEnabled(options, -1, 1);
    else if (k === 'End') next = stepEnabled(options, options.length, -1);
    else if (k === 'PageDown' || k === 'PageUp') {
      next = act;
      for (let n = 0; n < 8; n++) next = stepEnabled(options, next, k === 'PageDown' ? 1 : -1);
    } else if (k === 'Escape') close(true);
    else if (k === 'Enter' || (k === ' ' && !typing())) {
      if (act >= 0) choose(act);
      else close(true);
    } else if (isTypeKey(e)) {
      next = typeahead(k, act);
    } else return;
    // 시트·노트 화면이 window 에서 듣는 키(Esc 로 닫기 등)까지 가지 않게
    e.preventDefault();
    e.stopPropagation();
    if (next >= 0) setActive(next);
  };

  // 열려 있는 동안: 스크롤·화면 크기에 맞춰 자리를 다시 잡고, 초점이 다른 곳으로 가면 닫는다
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const follow = () => {
      raf = 0;
      if (!place()) close(true);
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      if (!raf) raf = requestAnimationFrame(follow);
    };
    const onResize = () => {
      if (!raf) raf = requestAnimationFrame(follow);
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node | null;
      if (t && !listRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const vv = window.visualViewport;
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, place, close]);

  // 열려 있으면 그릴 때마다 자리를 다시 잡는다 (목록 내용이 바뀌어도 맞게). 그리기 전에 놓아서 엉뚱한 곳에 번쩍이지 않는다
  useLayoutEffect(() => {
    if (open) place();
  });

  // 열리면 목록에 초점 (화살표·Enter·Esc 를 목록이 받는다)
  useLayoutEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  // 가리킨 줄이 보이게 목록을 스크롤한다 (처음 열 때는 가운데로)
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = act >= 0 ? (list?.children[act] as HTMLElement | undefined) : undefined;
    const center = centerNext.current;
    centerNext.current = false;
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return;
    if (center) list.scrollTop = top - (list.clientHeight - el.offsetHeight) / 2;
    else list.scrollTop = top < list.scrollTop ? top - LIST_PAD : bottom - list.clientHeight + LIST_PAD;
  }, [open, act]);

  // 칸과 목록의 이름: 이름(aria-labelledby, aria-label, 칸에 붙은 <label>) + 고른 값.
  // 화면 읽기 프로그램이 기본 <select> 처럼 '연결할 개념, 없음' 으로 읽는다.
  // aria-label 과 칸을 감싼 <label> 의 글은 숨은 글(nameId)에 적어 쓴다 (감싼 <label> 을 그대로 가리키면 고른 값을 두 번 읽는다)
  useLayoutEffect(() => {
    const t = triggerRef.current;
    const nameEl = nameRef.current;
    if (!t || !nameEl) return;
    let ids = ariaLabelledBy ?? '';
    let text = '';
    if (!ids && ariaLabel) text = ariaLabel;
    else if (!ids && t.labels?.length) {
      const own: string[] = [];
      const wrapping: string[] = [];
      Array.from(t.labels).forEach((l, i) => {
        if (l.contains(t)) wrapping.push(textWithout(l, t));
        else {
          if (!l.id) l.id = `${base}lb${i}`;
          own.push(l.id);
        }
      });
      ids = own.join(' ');
      text = wrapping.join(' ').trim();
    }
    if (nameEl.textContent !== text) nameEl.textContent = text;
    const names = [ids, text ? nameId : ''].filter(Boolean).join(' ');
    if (names) t.setAttribute('aria-labelledby', `${names} ${valueId}`);
    else t.removeAttribute('aria-labelledby');
    const list = listRef.current;
    if (list && names) list.setAttribute('aria-labelledby', names);
  });

  // 화면이 숨겨지면 (Activity) 펼친 목록을 닫아 둔다
  useLayoutEffect(() => () => setOpen(false), []);

  useEffect(
    () => () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    },
    [],
  );

  const endGuard = () => {
    if (guardTimer.current) clearTimeout(guardTimer.current);
    guardTimer.current = null;
    setGuard(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={cx(
          inputClass,
          'flex cursor-pointer select-none items-center gap-2 text-left aria-expanded:border-accent aria-expanded:bg-surface disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onClick={() => (open ? close(false) : openAt(startIndex()))}
        onKeyDown={onTriggerKey}
      >
        <span id={valueId} className={cx('min-w-0 flex-1 truncate', !shown && 'text-muted')}>
          {shown ? shown.label : placeholder || '\u00a0'}
        </span>
        <Icon d={CHEVRON} size={18} strokeWidth={2} className={cx('-mr-1 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <span ref={nameRef} id={nameId} hidden />
      {(open || guard) && host
        ? createPortal(
            <>
              <div
                aria-hidden="true"
                className="fixed inset-0 z-[70]"
                onPointerDown={(e) => {
                  // 목록 밖을 누르면 닫기만 한다: 초점은 칸으로, 그 누름(click)은 이 판이 받는다
                  e.preventDefault();
                  if (open) close(true);
                  setGuard(true);
                  if (guardTimer.current) clearTimeout(guardTimer.current);
                  guardTimer.current = setTimeout(endGuard, 1000);
                }}
                onClick={endGuard}
                onPointerCancel={endGuard}
                onContextMenu={(e) => e.preventDefault()}
              />
              {open ? (
                <div
                  ref={listRef}
                  id={listId}
                  role="listbox"
                  tabIndex={-1}
                  aria-activedescendant={act >= 0 ? optionId(act) : undefined}
                  className="kok-pop group fixed left-0 top-0 z-[70] w-max overflow-y-auto overscroll-contain rounded-2xl bg-surface py-1.5 shadow-[0_12px_32px_var(--shadow-strong)] outline-none ring-1 ring-line"
                  onKeyDown={onListKey}
                >
                  {options.map((o, i) => {
                    const isChosen = i === selected;
                    const isActive = i === act;
                    return (
                      <div
                        key={`${i}:${o.value}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={isChosen}
                        aria-disabled={o.disabled || undefined}
                        className={cx(
                          'flex min-h-11 select-none items-center gap-3 px-4 py-2.5 text-[15px]',
                          o.disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
                          isChosen ? 'font-semibold text-accent' : 'text-ink',
                          // 가리킨 줄 (마우스를 올린 줄도 같다). 키보드로 옮길 때는 테두리도
                          isActive && 'bg-surface-2 group-focus-visible:outline-2 group-focus-visible:-outline-offset-2 group-focus-visible:outline-accent',
                        )}
                        onClick={() => choose(i)}
                        onPointerMove={(e) => {
                          // 마우스만: 스크롤한 뒤 같은 자리에서 오는 움직임은 무시한다 (키보드로 옮긴 줄을 빼앗지 않게)
                          if (e.pointerType !== 'mouse') return;
                          const p = pointerRef.current;
                          if (p.x === e.clientX && p.y === e.clientY) return;
                          pointerRef.current = { x: e.clientX, y: e.clientY };
                          if (!o.disabled && i !== act) setActive(i);
                        }}
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {o.label}
                          {o.hint ? <span className="mt-0.5 block text-[13px] font-normal leading-snug text-muted">{o.hint}</span> : null}
                        </span>
                        <span className="grid h-5 w-5 shrink-0 place-items-center">
                          {isChosen ? <Icon d={ICONS.check} size={18} strokeWidth={2.4} /> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>,
            host,
          )
        : null}
    </>
  );
}
