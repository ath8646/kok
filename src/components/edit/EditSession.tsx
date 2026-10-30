'use client';
// 고치기 모드의 글 칸들을 하나로 묶는다: 한 번에 한 칸만 편집기가 켜지고(나머지는 보이는 그대로의 글),
// 켜진 칸의 꾸미기 줄(화면 아래, 키보드 위)과 수식 창을 같이 쓴다.
// 폰(iOS)은 사용자가 누른 순간에 초점을 받아야 키보드가 열려서, 누르면 먼저 숨은 칸에 초점을 두고 편집기가 켜지면 옮긴다.
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { MathSheet, type MathTarget } from './MathSheet';

const FormatBar = lazy(() => import('./FormatBar'));

/** 편집기 조각을 미리 받아 둔다 (처음 누를 때 기다리지 않게) */
export function preloadEditor() {
  void import('./RichEditor');
  void import('./FormatBar');
}

type Start = { x: number; y: number } | 'end';

export type EditSession = {
  activeKey: string | null;
  /** 칸을 켠다. at: 누른 자리 (그 자리에 글 커서), 없으면 끝 */
  activate: (key: string, at?: Start) => void;
  deactivate: (key: string) => void;
  /** 켜진 칸이 처음 그릴 때 한 번 받는 커서 자리 */
  takeStart: (key: string) => Start;
  editor: Editor | null;
  setEditor: (key: string, editor: Editor | null) => void;
  /** 초점이 이리로 가도 칸을 닫지 않는다 (꾸미기 줄·수식 창) */
  keepsFocus: (el: Element | null) => boolean;
  /** 수식 창이 열려 있는 동안은 칸을 닫지 않는다 */
  held: () => boolean;
  openMath: (editor: Editor, pos: number | null, key: string) => void;
  /** 다음 칸으로 (한 줄 칸의 엔터) */
  next: (key: string) => void;
  /** 누른 순간에 숨은 칸으로 초점 (켜질 칸이 아직 없을 때: 고치기 모드를 막 켤 때) */
  holdKeyboard: () => void;
  barRef: RefObject<HTMLDivElement | null>;
};

const Ctx = createContext<EditSession | null>(null);

export function useEditSession(): EditSession {
  const s = useContext(Ctx);
  if (!s) throw new Error('useEditSession outside EditSessionProvider');
  return s;
}

export function EditSessionProvider({
  root,
  apiRef,
  active,
  children,
}: {
  root: RefObject<HTMLElement | null>;
  /** 밖(칸을 더하는 쪽)에서 칸을 켤 수 있게 */
  apiRef?: RefObject<EditSession | null>;
  /** 고치기 모드인지 (아니면 편집기 조각도 받지 않는다) */
  active: boolean;
  children: ReactNode;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [editor, setEditorState] = useState<Editor | null>(null);
  const editorKey = useRef<string | null>(null);
  const starts = useRef(new Map<string, Start>());
  const proxy = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [math, setMath] = useState<MathTarget | null>(null);
  const mathOpen = useRef(false);

  useEffect(() => {
    if (active) preloadEditor();
  }, [active]);

  /** 누른 순간에 숨은 칸으로 초점 (폰 키보드가 열리게): 누른 자리 가까이 두어 화면이 튀지 않게 */
  const holdAt = useCallback((y: number) => {
    const p = proxy.current;
    if (!p) return;
    p.style.top = `${Math.max(8, Math.min(window.innerHeight - 40, y))}px`;
    try {
      p.focus({ preventScroll: true });
    } catch {
      /* 무시 */
    }
  }, []);
  const holdKeyboard = useCallback(() => holdAt(window.innerHeight / 2), [holdAt]);

  const activate = useCallback(
    (key: string, at: Start = 'end') => {
      starts.current.set(key, at);
      // (다른 칸에서 옮겨 올 때도: 앞 칸이 사라지는 사이에 키보드가 닫히지 않게)
      holdAt(at === 'end' ? window.innerHeight / 2 : at.y);
      setActiveKey(key);
    },
    [holdAt],
  );

  const deactivate = useCallback((key: string) => {
    setActiveKey((k) => (k === key ? null : k));
  }, []);

  const takeStart = useCallback((key: string): Start => {
    const s = starts.current.get(key) ?? 'end';
    starts.current.delete(key);
    return s;
  }, []);

  const setEditor = useCallback((key: string, ed: Editor | null) => {
    if (ed) {
      editorKey.current = key;
      setEditorState(ed);
    } else if (editorKey.current === key) {
      editorKey.current = null;
      setEditorState(null);
    }
  }, []);

  const keepsFocus = useCallback((el: Element | null) => mathOpen.current || (!!el && !!barRef.current?.contains(el)), []);
  const held = useCallback(() => mathOpen.current, []);

  const openMath = useCallback((ed: Editor, pos: number | null, key: string) => {
    const node = pos === null ? null : ed.state.doc.nodeAt(pos);
    mathOpen.current = true;
    setMath({ editor: ed, key, pos: node?.type.name === 'math' ? pos : null, tex: node?.type.name === 'math' ? String(node.attrs.tex) : '' });
  }, []);

  const closeMath = useCallback(() => {
    mathOpen.current = false;
    setMath(null);
  }, []);

  const next = useCallback(
    (key: string) => {
      const el = root.current;
      if (!el) return;
      const all = Array.from(el.querySelectorAll<HTMLElement>('[data-field-key]'));
      const i = all.findIndex((x) => x.dataset.fieldKey === key);
      const to = i >= 0 ? all[i + 1] : undefined;
      if (to?.dataset.fieldKey) activate(to.dataset.fieldKey, 'end');
      else setActiveKey(null);
    },
    [root, activate],
  );

  // 고치기 모드가 끝나면 켜진 칸도 없다
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) {
      setActiveKey(null);
      setMath(null);
    }
  }
  useEffect(() => {
    if (!active) mathOpen.current = false;
  }, [active]);

  const value = useMemo<EditSession>(
    () => ({ activeKey, activate, deactivate, takeStart, editor, setEditor, keepsFocus, held, openMath, next, holdKeyboard, barRef }),
    [activeKey, activate, deactivate, takeStart, editor, setEditor, keepsFocus, held, openMath, next, holdKeyboard],
  );

  useLayoutEffect(() => {
    if (!apiRef) return;
    apiRef.current = value;
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, value]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* 폰 키보드를 여는 숨은 칸 (글자는 받지 않는다: 편집기가 켜지면 초점이 그리로 간다) */}
      <input ref={proxy} aria-hidden="true" tabIndex={-1} className="kok-proxy-input" defaultValue="" onFocus={(e) => (e.currentTarget.value = '')} />
      {active && editor && !math && typeof document !== 'undefined'
        ? createPortal(
            <Suspense fallback={null}>
              <FormatBar editor={editor} barRef={barRef} onMath={(pos) => openMath(editor, pos, editorKey.current ?? '')} />
            </Suspense>,
            document.body,
          )
        : null}
      <MathSheet target={math} onClose={closeMath} />
    </Ctx.Provider>
  );
}
