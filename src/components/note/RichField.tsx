'use client';
// 노트 고치기 칸: 꾸미기 버튼(굵게·형광펜·빨간 글씨·목록·번호·수식) + 미리보기 + 꾸미는 법.
// 버튼은 고른 글을 쉬운 기호로 감싼다(**굵게**). 기호를 직접 적어도 똑같다 (src/lib/richtext.ts 의 parseRich).
// 바꾸기는 브라우저 입력으로 넣어서 되돌리기(Ctrl+Z)가 된다.
import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { RichText } from '@/components/RichText';
import { cx } from '@/components/ui';
import { hasRichMarks } from '@/lib/richtext';
import { continueList, toggleList, toggleWrap, type RichEdit } from '@/lib/rich-edit';

type Make = (value: string, start: number, end: number) => RichEdit | null;

/**
 * 글 칸(textarea) 도우미: 글 길이에 맞춰 높이를 늘리고, 마지막으로 고른 곳을 기억하고,
 * 바꾸기(RichEdit)를 되돌리기가 되는 브라우저 입력으로 넣는다 (안 되는 브라우저는 값을 바로 바꾼다)
 */
export function useTextEdit(value: string, onChange: (v: string) => void, opts: { maxLength?: number; maxHeight?: number } = {}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const sel = useRef({ s: value.length, e: value.length });
  const pending = useRef<[number, number] | null>(null);
  const { maxLength, maxHeight = 440 } = opts;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`;
    if (pending.current) {
      const [a, b] = pending.current;
      pending.current = null;
      el.setSelectionRange(a, b);
      sel.current = { s: a, e: b };
    }
  }, [value, maxHeight]);

  const remember = useCallback(() => {
    const el = ref.current;
    if (el) sel.current = { s: el.selectionStart, e: el.selectionEnd };
  }, []);

  const apply = useCallback(
    (make: Make) => {
      const el = ref.current;
      if (!el) return;
      const focused = document.activeElement === el;
      const a = focused ? el.selectionStart : sel.current.s;
      const b = focused ? el.selectionEnd : sel.current.e;
      const r = make(el.value, Math.min(a, b, el.value.length), Math.min(Math.max(a, b), el.value.length));
      if (!r) return;
      const next = el.value.slice(0, r.start) + r.text + el.value.slice(r.end);
      // 한도를 넘기면 하지 않는다 (예전에 더 길게 저장된 글은 그보다 길어지지만 않으면 된다)
      if (maxLength && next.length > Math.max(maxLength, el.value.length)) return;
      el.focus({ preventScroll: true });
      let ok = el.value.slice(r.start, r.end) === r.text;
      if (!ok) {
        el.setSelectionRange(r.start, r.end);
        try {
          ok = r.text ? document.execCommand('insertText', false, r.text) : document.execCommand('delete');
        } catch {
          ok = false;
        }
      }
      if (!ok || el.value !== next) {
        pending.current = [r.selStart, r.selEnd];
        onChange(next);
        return;
      }
      el.setSelectionRange(r.selStart, r.selEnd);
      sel.current = { s: r.selStart, e: r.selEnd };
    },
    [maxLength, onChange],
  );

  return { ref, remember, apply };
}

function NumbersIcon() {
  return (
    <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
      {['1', '2', '3'].map((n, i) => (
        <text key={n} x="2.4" y={8.9 + i * 5.5} fontSize="7.2" fontWeight="800" fill="currentColor" stroke="none">
          {n}
        </text>
      ))}
    </svg>
  );
}

function BulletsIcon() {
  return (
    <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
      <path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" strokeWidth={3} />
    </svg>
  );
}

type Tool = { key: string; label: string; title: string; icon: ReactNode; run: Make; gap?: boolean };

export const RICH_TOOLS: Tool[] = [
  {
    key: 'b',
    label: '굵게',
    title: '굵게 (**글**)',
    icon: <span className="text-[16px] font-black leading-none">B</span>,
    run: (v, s, e) => toggleWrap(v, s, e, '**', '굵게'),
  },
  {
    key: 'mark',
    label: '형광펜',
    title: '형광펜 (==글==)',
    icon: <span className="kok-mark text-[13px] font-extrabold leading-none text-ink">가</span>,
    run: (v, s, e) => toggleWrap(v, s, e, '==', '형광펜'),
  },
  {
    key: 'red',
    label: '빨간 글씨',
    title: '빨간 글씨 (!!글!!)',
    icon: <span className="kok-red text-[15px] font-extrabold leading-none">가</span>,
    run: (v, s, e) => toggleWrap(v, s, e, '!!', '빨간 글씨'),
  },
  { key: 'ul', label: '목록', title: '목록 (줄 앞에 - )', icon: <BulletsIcon />, run: (v, s, e) => toggleList(v, s, e, 'bullet'), gap: true },
  { key: 'ol', label: '번호 목록', title: '번호 목록 (줄 앞에 1. )', icon: <NumbersIcon />, run: (v, s, e) => toggleList(v, s, e, 'number') },
  {
    key: 'math',
    label: '수식',
    title: '수식 ($x^2$)',
    icon: <span className="font-serif text-[16px] italic leading-none">x²</span>,
    run: (v, s, e) => toggleWrap(v, s, e, '$', 'x^2'),
    gap: true,
  },
];

const HELP: Array<[string, string]> = [
  ['**굵게**', '**굵게**'],
  ['==형광펜==', '==형광펜=='],
  ['!!빨간 글씨!!', '!!빨간 글씨!!'],
  ['- 목록', '- 목록'],
  ['1. 번호', '1. 번호'],
  ['$x^2$', '수식 $x^2$'],
];

function RichHelp({ id }: { id: string }) {
  return (
    <div id={id} className="kok-appear grid gap-2 rounded-2xl bg-surface-2 p-3.5 text-sm">
      <p className="font-bold">쉽게 꾸미는 법</p>
      <p className="text-xs text-muted">글을 고르고 위 버튼을 누르면 돼요. 기호를 직접 적어도 똑같이 보여요.</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        {HELP.map(([code, shown]) => (
          <Fragment key={code}>
            <dt>
              <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12.5px]">{code}</code>
            </dt>
            <dd>
              <RichText text={shown} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/** 버튼 줄의 키보드: ←→ 옮기기, Home·End (한 칸만 Tab 으로 들어간다) */
export function moveInToolbar(e: KeyboardEvent<HTMLButtonElement>, index: number, count: number, set: (i: number) => void) {
  const k = e.key;
  const to = k === 'ArrowRight' ? index + 1 : k === 'ArrowLeft' ? index - 1 : k === 'Home' ? 0 : k === 'End' ? count - 1 : null;
  if (to === null) return;
  e.preventDefault();
  const n = (to + count) % count;
  set(n);
  e.currentTarget.closest('[role="toolbar"]')?.querySelectorAll<HTMLButtonElement>('button')[n]?.focus();
}

export function RichField({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 2000,
  rows = 3,
  autoFocus = false,
  onSubmit,
  action,
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  autoFocus?: boolean;
  /** Ctrl·⌘ + 엔터 */
  onSubmit?: () => void;
  /** 이름 줄 오른쪽에 둘 것 (예: 이 칸 빼기) */
  action?: ReactNode;
  /** 카드 머리에 이미 이름이 있으면 이름 줄을 숨긴다 (화면 읽기에는 그대로) */
  hideLabel?: boolean;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const { ref, remember, apply } = useTextEdit(value, onChange, { maxLength });
  const [help, setHelp] = useState(false);
  const [tool, setTool] = useState(0);
  const preview = useMemo(() => hasRichMarks(value), [value]);
  const count = RICH_TOOLS.length + 1;

  return (
    <div className="grid gap-1.5">
      {hideLabel && !action ? (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      ) : (
        <div className="flex min-h-6 items-center justify-between gap-2">
          <label htmlFor={id} className="px-1 text-xs font-bold text-muted">
            {label}
          </label>
          {action}
        </div>
      )}
      <div className="flex flex-col rounded-2xl border-2 border-transparent bg-surface-2 transition-colors focus-within:border-accent focus-within:bg-surface">
        <textarea
          id={id}
          ref={ref}
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="block w-full resize-none bg-transparent px-3.5 pb-2.5 pt-2 text-[15px] leading-relaxed text-ink placeholder:text-muted/80 focus:outline-none"
          onChange={(e) => onChange(e.target.value)}
          onSelect={remember}
          onBlur={remember}
          onKeyDown={(e) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
              e.preventDefault();
              apply(RICH_TOOLS[0].run);
              return;
            }
            if (mod && e.key === 'Enter' && onSubmit) {
              e.preventDefault();
              onSubmit();
              return;
            }
            // 목록 줄에서 엔터: 다음 줄도 목록 (한글을 조합하는 중의 엔터는 그대로)
            if (e.key !== 'Enter' || e.shiftKey || mod || e.altKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
            const el = e.currentTarget;
            if (el.selectionStart !== el.selectionEnd) return;
            const r = continueList(el.value, el.selectionStart);
            if (!r) return;
            e.preventDefault();
            apply(() => r);
          }}
        />
        {/* 꾸미기 버튼: 글 칸 위에 보이지만 Tab 은 글 칸 다음 (글을 먼저 쓰게) */}
        <div
          role="toolbar"
          aria-label={`${label} 꾸미기`}
          aria-controls={id}
          className="no-scrollbar order-first flex items-center gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1"
          // 버튼을 눌러도 글 칸의 초점과 고른 글이 그대로 있게
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) e.preventDefault();
          }}
        >
          {RICH_TOOLS.map((t, i) => (
            <Fragment key={t.key}>
              {t.gap ? <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" /> : null}
              <button
                type="button"
                tabIndex={tool === i ? 0 : -1}
                aria-label={t.label}
                title={t.title}
                className="press grid h-8 min-w-8 shrink-0 place-items-center rounded-lg px-1.5 text-muted hover:bg-surface-3 hover:text-ink"
                onFocus={() => setTool(i)}
                onKeyDown={(e) => moveInToolbar(e, i, count, setTool)}
                onClick={() => apply(t.run)}
              >
                {t.icon}
              </button>
            </Fragment>
          ))}
          <span className="min-w-2 flex-1" />
          {value.length >= maxLength * 0.85 ? (
            <span className="shrink-0 px-1 text-[11px] font-semibold tabular-nums text-muted">
              {value.length}/{maxLength}
            </span>
          ) : null}
          <button
            type="button"
            tabIndex={tool === RICH_TOOLS.length ? 0 : -1}
            aria-label="꾸미는 법"
            aria-expanded={help}
            aria-controls={helpId}
            title="꾸미는 법"
            className={cx(
              'press grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-surface-3 hover:text-ink',
              help ? 'bg-surface-3 text-ink' : 'text-muted',
            )}
            onFocus={() => setTool(RICH_TOOLS.length)}
            onKeyDown={(e) => moveInToolbar(e, RICH_TOOLS.length, count, setTool)}
            onClick={() => setHelp((h) => !h)}
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded-full border-[1.7px] border-current text-[11px] font-black leading-none">?</span>
          </button>
        </div>
      </div>
      {help ? <RichHelp id={helpId} /> : null}
      {preview ? (
        <div className="kok-appear rounded-2xl border border-dashed border-line px-3.5 py-2">
          <p className="text-[11px] font-bold text-muted">미리보기</p>
          <div className="mt-0.5 text-[15px] leading-relaxed">
            <RichText text={value} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
