'use client';
// 글 칸(textarea) 도우미: 글 길이에 맞춰 높이를 늘리고, 마지막으로 고른 곳을 기억하고,
// 바꾸기를 되돌리기가 되는 브라우저 입력으로 넣는다 (안 되는 브라우저는 값을 바로 바꾼다). 수식 칸(TexInput)이 쓴다.
import { useCallback, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { RichEdit } from '@/lib/rich-edit';

type Make = (value: string, start: number, end: number) => RichEdit | null;

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
