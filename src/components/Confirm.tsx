'use client';
// 앱 디자인의 확인 창: 브라우저의 confirm()·prompt() 대신 쓴다 (브라우저 창은 주소가 찍힌 회색 창이라 앱처럼 보이지 않는다).
// Providers 가 앱 전체에 깔고, 화면은 const ask = useConfirm(); if (!(await ask({...}))) return; 처럼 부른다.
// - 모양은 Sheet 와 같다: 폰은 아래에서 올라오는 시트, 넓은 화면은 가운데 카드 (kok-sheet·kok-scrim: 시그니처 테마도 그대로 입는다)
// - role alertdialog: 제목과 내용을 읽어 준다. 처음 초점은 글 칸 → 지우기처럼 되돌릴 수 없는 일이면 '그대로 두기' → 아니면 확인 단추
// - Esc·바깥 누르기 = 그대로 두기. Esc 는 창(window)의 capture 단계에서 먼저 받아 멈춰서 아래의 시트·테마 만들기·채팅 창은 같이 닫히지 않는다
// - Tab 은 이 창 안에서만 돈다. 닫으면 연 곳으로 초점을 돌려준다
// - 여러 개를 한꺼번에 부르면 하나씩 차례로 띄운다
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, cx, inputClass } from './ui';

export type ConfirmOpts = {
  /** 무엇을 하는지 짧게 ('자료 지우기') */
  title: string;
  /** 묻는 말 */
  body: ReactNode;
  /** 덧붙이는 말 (흐린 글자) */
  note?: ReactNode;
  /** 확인 단추 글 ('지우기') */
  ok: string;
  /** 그만두기 단추 글 (기본 '그대로 두기') */
  cancel?: string;
  /** 되돌릴 수 없는 일 (빨간 단추, 처음 초점은 '그대로 두기') */
  danger?: boolean;
};

export type AskTextOpts = {
  title: string;
  body?: ReactNode;
  /** 글 칸 이름 */
  label: string;
  /** 처음 글 */
  value?: string;
  ok: string;
  cancel?: string;
  inputMode?: 'numeric' | 'text';
  /** 틀린 값이면 보여 줄 말 (괜찮으면 null) */
  check?: (v: string) => string | null;
};

type Req =
  | { id: number; kind: 'confirm'; opts: ConfirmOpts; done: (v: boolean) => void }
  | { id: number; kind: 'text'; opts: AskTextOpts; done: (v: string | null) => void };

type Api = { confirm: (o: ConfirmOpts) => Promise<boolean>; askText: (o: AskTextOpts) => Promise<string | null> };
const Ctx = createContext<Api | null>(null);

// 확인 창 밖(테마 미리보기 iframe 등)에서 부르면 아무것도 하지 않은 것으로 (브라우저 창을 띄우지 않는다)
const NONE: Api = { confirm: async () => false, askText: async () => null };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Req[]>([]);
  const seq = useRef(0);
  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        const id = ++seq.current;
        setQueue((q) => [...q, { id, kind: 'confirm', opts, done: resolve }]);
      }),
    [],
  );
  const askText = useCallback(
    (opts: AskTextOpts) =>
      new Promise<string | null>((resolve) => {
        const id = ++seq.current;
        setQueue((q) => [...q, { id, kind: 'text', opts, done: resolve }]);
      }),
    [],
  );
  const api = useMemo(() => ({ confirm, askText }), [confirm, askText]);
  const top = queue[0];
  const finish = useCallback((req: Req, v: boolean | string | null) => {
    if (req.kind === 'confirm') req.done(v === true);
    else req.done(typeof v === 'string' ? v : null);
    setQueue((q) => q.filter((x) => x.id !== req.id));
  }, []);
  return (
    <Ctx.Provider value={api}>
      {children}
      {top ? <ConfirmView key={top.id} req={top} onDone={(v) => finish(top, v)} /> : null}
    </Ctx.Provider>
  );
}

/** 앱의 확인 창을 띄운다: 확인이면 true */
export function useConfirm() {
  return (useContext(Ctx) ?? NONE).confirm;
}

/** 앱의 글 입력 창을 띄운다: 확인이면 입력한 글, 그만두면 null */
export function useAskText() {
  return (useContext(Ctx) ?? NONE).askText;
}

/** 지금 확인 창이 떠 있는지 (Esc 를 먼저 받는 다른 창이 같이 닫히지 않게) */
export function confirmOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[data-kok-confirm]');
}

function ConfirmView({ req, onDone }: { req: Req; onDone: (v: boolean | string | null) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(req.kind === 'text' ? (req.opts.value ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const danger = req.kind === 'confirm' && !!req.opts.danger;
  const cancelLabel = req.opts.cancel ?? '그대로 두기';

  const cancel = () => onDone(req.kind === 'confirm' ? false : null);
  const ok = () => {
    if (req.kind === 'confirm') return onDone(true);
    const msg = req.opts.check?.(text) ?? null;
    if (msg) {
      setError(msg);
      panel.current?.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    onDone(text);
  };
  // 키 처리는 늘 지금 값으로 (effect 는 한 번만 단다)
  const keys = useRef({ cancel });
  useEffect(() => {
    keys.current = { cancel };
  });

  // 처음 초점, 닫으면 연 곳으로
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    const sel = req.kind === 'text' ? 'input' : danger ? '[data-confirm="cancel"]' : '[data-confirm="ok"]';
    const first = root?.querySelector<HTMLElement>(sel);
    first?.focus({ preventScroll: true });
    if (first instanceof HTMLInputElement) first.select();
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
    // 창마다 한 번 (key 로 새로 그린다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc = 그대로 두기, Tab 은 창 안에서만
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = panel.current;
      if (!root) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        keys.current.cancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const { title, body } = req.opts;
  const note = req.kind === 'confirm' ? req.opts.note : undefined;
  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      data-kok-confirm=""
      data-own-keys=""
    >
      <div className="kok-scrim absolute inset-0" aria-hidden="true" onClick={cancel} />
      <div
        ref={panel}
        className="kok-sheet relative w-full max-w-md rounded-t-[28px] bg-surface px-6 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:rounded-[28px] sm:pb-6 sm:pt-6"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-surface-3 sm:hidden" aria-hidden="true" />
        <h2 id={titleId} className="font-display text-xl">
          {title}
        </h2>
        {body ? (
          <div id={bodyId} className="mt-2 text-[15px] leading-relaxed">
            {body}
          </div>
        ) : null}
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        {req.kind === 'text' ? (
          <form
            className="mt-4 grid gap-1.5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              ok();
            }}
          >
            <label htmlFor={inputId} className="text-sm font-semibold">
              {req.opts.label}
            </label>
            <input
              id={inputId}
              className={cx(inputClass, error && 'ring-2 ring-bad')}
              value={text}
              inputMode={req.opts.inputMode}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-err` : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p id={`${inputId}-err`} className="text-sm font-semibold text-bad" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" data-confirm="cancel" onClick={cancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="lg" data-confirm="ok" onClick={ok}>
            {req.opts.ok}
          </Button>
        </div>
      </div>
    </div>
  );
}
