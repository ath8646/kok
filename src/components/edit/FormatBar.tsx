'use client';
// 켜진 글 칸의 꾸미기 줄: 화면 아래(폰은 키보드 바로 위). 굵게·형광펜·빨간 글씨·목록·번호·수식·되돌리기.
// 버튼을 눌러도 글 칸의 초점과 고른 글이 그대로 있다. Alt+F10 으로 글 칸에서 이 줄로, Esc 로 글 칸으로 돌아간다.
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { Fragment, useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx, Icon, ICONS } from '@/components/ui';

/** 폰 키보드가 가린 높이 (없으면 0): 줄을 그만큼 올린다 */
function useKeyboardCover(): number {
  const [cover, setCover] = useState(0);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => {
      const c = Math.round(window.innerHeight - (v.height + v.offsetTop));
      setCover(c > 60 ? c : 0);
    };
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, []);
  return cover;
}

function BulletsIcon() {
  return (
    <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
      <path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" strokeWidth={3} />
    </svg>
  );
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

const KEYBOARD_DOWN = 'M3 4.5h18v10H3zM6.5 7.5h.01M9.5 7.5h.01M12.5 7.5h.01M15.5 7.5h.01M8 11.5h8M9 18.5l3 2.5 3-2.5';

type Tool = { key: string; label: string; icon: ReactNode; on?: boolean; disabled?: boolean; run: () => void; gap?: boolean };

export default function FormatBar({
  editor,
  barRef,
  onMath,
}: {
  editor: Editor;
  barRef: RefObject<HTMLDivElement | null>;
  onMath: (pos: number | null) => void;
}) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || e.isDestroyed) return null;
      const sel = e.state.selection;
      return {
        bold: e.isActive('bold'),
        highlight: e.isActive('highlight'),
        red: e.isActive('red'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        lists: !!e.schema.nodes.bulletList,
        undo: e.can().undo(),
        redo: e.can().redo(),
        mathAt: sel instanceof NodeSelection && sel.node.type.name === 'math' ? sel.from : null,
        text: sel.empty ? '' : e.state.doc.textBetween(sel.from, sel.to, ' ', ' '),
      };
    },
  });
  const cover = useKeyboardCover();
  const [focusAt, setFocusAt] = useState(0);
  if (!st) return null;
  const chain = () => editor.chain().focus();
  const math = () => {
    if (st.mathAt !== null) return onMath(st.mathAt);
    const t = st.text.trim();
    // 고른 글이 있으면 그 글을 수식으로 (x^2 를 고르고 누르면 수식), 없으면 수식 창
    if (t && !t.includes('\n')) {
      chain()
        .insertContent({ type: 'math', attrs: { tex: t, display: false } })
        .run();
      return;
    }
    onMath(null);
  };
  const tools: Tool[] = [
    { key: 'b', label: '굵게', on: st.bold, icon: <span className="text-[16px] font-black leading-none">B</span>, run: () => chain().toggleMark('bold').run() },
    {
      key: 'mark',
      label: '형광펜',
      on: st.highlight,
      icon: <span className="kok-mark text-[13px] font-extrabold leading-none text-ink">가</span>,
      run: () => chain().toggleMark('highlight').run(),
    },
    {
      key: 'red',
      label: '빨간 글씨',
      on: st.red,
      icon: <span className="kok-red text-[15px] font-extrabold leading-none">가</span>,
      run: () => chain().toggleMark('red').run(),
    },
    ...(st.lists
      ? [
          { key: 'ul', label: '목록', on: st.bullet, icon: <BulletsIcon />, run: () => chain().toggleBulletList().run(), gap: true },
          { key: 'ol', label: '번호 목록', on: st.ordered, icon: <NumbersIcon />, run: () => chain().toggleOrderedList().run() },
        ]
      : []),
    { key: 'math', label: '수식', icon: <span className="font-serif text-[16px] italic leading-none">x²</span>, run: math, gap: true },
    { key: 'undo', label: '되돌리기', disabled: !st.undo, icon: <Icon d={ICONS.undo} size={19} />, run: () => chain().undo().run(), gap: true },
    { key: 'redo', label: '다시 하기', disabled: !st.redo, icon: <Icon d={ICONS.redo} size={19} />, run: () => chain().redo().run() },
    { key: 'done', label: '글 칸 닫기', icon: <Icon d={KEYBOARD_DOWN} size={20} />, run: () => editor.commands.blur(), gap: true },
  ];
  const count = tools.length;
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editor.commands.focus();
      return;
    }
    const to = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? count - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const n = (to + count) % count;
    setFocusAt(n);
    e.currentTarget.closest('[role="toolbar"]')?.querySelectorAll<HTMLButtonElement>('button')[n]?.focus();
  };
  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="글 꾸미기"
      aria-keyshortcuts="Alt+F10"
      className="kok-formatbar"
      style={cover ? { transform: `translateY(${-cover}px)` } : undefined}
      // 버튼을 눌러도 글 칸의 초점과 고른 글이 그대로 있게
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault();
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="kok-formatbar-inner no-scrollbar">
        {tools.map((t, i) => (
          <Fragment key={t.key}>
            {t.gap ? <span className="mx-0.5 h-5 w-px shrink-0 bg-line" aria-hidden="true" /> : null}
            <button
              type="button"
              tabIndex={focusAt === i ? 0 : -1}
              aria-label={t.label}
              title={t.label}
              aria-pressed={t.on === undefined ? undefined : t.on}
              disabled={t.disabled}
              className={cx(
                'press grid h-10 min-w-[34px] shrink-0 place-items-center rounded-xl px-1.5 text-ink disabled:opacity-35',
                t.on ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2',
              )}
              onFocus={() => setFocusAt(i)}
              onKeyDown={(e) => move(e, i)}
              onClick={t.run}
            >
              {t.icon}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
