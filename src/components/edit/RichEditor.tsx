'use client';
// 켜진 글 칸 하나: Tiptap 편집기. 글이 바뀌면 0.9초 뒤에, 칸을 떠나면 바로 저장할 글(src/lib/rich-doc.ts)로 바꿔 알린다.
// 아무것도 바꾸지 않았으면(처음 문서와 같으면) 저장된 글을 그대로 둔다: 고치지 않은 글은 글자 하나 바뀌지 않는다.
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { docIsEmpty, docToRich, richToDoc, sameDoc, type DocNode } from '@/lib/rich-doc';
import { cx } from '@/components/ui';
import { attachEditorHooks, buildExtensions } from './extensions';
import { useEditSession } from './EditSession';

export type RichEditorProps = {
  fieldKey: string;
  initial: string;
  single: boolean;
  placeholder: string;
  label: string;
  className?: string;
  maxLength: number;
  onCommit: (text: string) => void;
  /** 비운 채로 칸을 떠나면 (새로 더한 함정·예시 등을 빼려고) */
  onEmptyLeave?: () => void;
};

export default function RichEditor({ fieldKey, initial, single, placeholder, label, className, maxLength, onCommit, onEmptyLeave }: RichEditorProps) {
  const session = useEditSession();
  const sessionRef = useRef(session);
  const commitRef = useRef(onCommit);
  const emptyRef = useRef(onEmptyLeave);
  useEffect(() => {
    sessionRef.current = session;
    commitRef.current = onCommit;
    emptyRef.current = onEmptyLeave;
  });
  // 처음 글과 문서는 한 번만 (켜져 있는 동안 밖에서 바뀐 글은 받지 않는다: 이 칸이 고치는 중이라)
  const [orig] = useState(initial);
  const [initialDoc] = useState(() => richToDoc(initial, { single }));
  const last = useRef(initial);
  const latest = useRef<DocNode>(initialDoc);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const textOf = useCallback(
    (doc: DocNode) => {
      if (sameDoc(doc, initialDoc)) return orig;
      const t = docToRich(doc, { single });
      return t.length > maxLength ? t.slice(0, maxLength) : t;
    },
    [initialDoc, orig, single, maxLength],
  );

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const ed = editorRef.current;
    const doc = ed && !ed.isDestroyed ? (ed.getJSON() as DocNode) : latest.current;
    const text = textOf(doc);
    if (text === last.current) return;
    last.current = text;
    commitRef.current(text);
  }, [textOf]);

  const leave = useCallback(() => {
    flush();
    const ed = editorRef.current;
    const empty = docIsEmpty(ed && !ed.isDestroyed ? (ed.getJSON() as DocNode) : latest.current);
    sessionRef.current.deactivate(fieldKey);
    if (empty) emptyRef.current?.();
  }, [flush, fieldKey]);

  const extensions = useMemo(() => buildExtensions({ single, placeholder }), [single, placeholder]);

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    injectCSS: false,
    extensions,
    content: initialDoc,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': String(!single),
        class: 'kok-pm',
      },
      // 글 커서가 위 띠(제목·탭)나 아래 꾸미기 줄에 가리지 않게 그만큼 띄워서 보여 준다
      scrollThreshold: { top: 130, bottom: 90, left: 0, right: 0 },
      scrollMargin: { top: 140, bottom: 100, left: 0, right: 0 },
      // 붙여 넣은 글의 꾸미기 기호(**굵게** 등)도 꾸미기로 (한 줄 칸은 줄을 빈칸으로)
      clipboardTextParser: (text, _ctx, _plain, view) => {
        const schema = view.state.schema;
        try {
          const node = schema.nodeFromJSON(richToDoc(single ? text.replace(/\s*\n\s*/g, ' ') : text, { single }));
          return Slice.maxOpen(node.content);
        } catch {
          return new Slice(Fragment.from(schema.text(text.replace(/\s*\n\s*/g, ' ') || ' ')), 0, 0);
        }
      },
      // 복사하면 글로도 꾸미기 기호가 같이 (다른 칸에 붙여도 그대로)
      clipboardTextSerializer: (slice) => docToRich({ type: 'doc', content: slice.content.toJSON() as DocNode[] }, { single }),
    },
    onUpdate: ({ editor: ed }) => {
      latest.current = ed.getJSON() as DocNode;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 900);
    },
    onBlur: ({ event }) => {
      const to = (event as FocusEvent).relatedTarget as Element | null;
      if (sessionRef.current.keepsFocus(to)) return;
      // 초점이 어디로 가는지 정해진 뒤에 본다 (꾸미기 줄을 누르는 중이면 그대로)
      setTimeout(() => {
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed || ed.isFocused || sessionRef.current.held()) return;
        if (sessionRef.current.keepsFocus(document.activeElement)) return;
        leave();
      }, 0);
    },
  });

  // 켜지면 누른 자리에 글 커서를 두고 초점 (숨은 칸에서 옮겨 온다: 폰 키보드가 그대로 열려 있게)
  useLayoutEffect(() => {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    editorRef.current = ed;
    const s = sessionRef.current;
    attachEditorHooks(
      ed,
      {
        onEnter: () => {
          flush();
          sessionRef.current.next(fieldKey);
          return true;
        },
        onEscape: () => {
          ed.commands.blur();
          return true;
        },
        onToolbar: () => {
          const b = sessionRef.current.barRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]');
          if (!b) return false;
          b.focus();
          return true;
        },
      },
      (e, pos) => sessionRef.current.openMath(e, pos, fieldKey),
    );
    s.setEditor(fieldKey, ed);
    const at = s.takeStart(fieldKey);
    let pos: number | 'end' = 'end';
    if (at !== 'end') {
      const r = ed.view.posAtCoords({ left: at.x, top: at.y });
      if (r) pos = r.pos;
    }
    // 누른 칸은 이미 보이니 그대로, 새로 더한 칸·다음 칸은 보이게 내린다
    ed.commands.focus(pos, { scrollIntoView: at === 'end' });
    return () => {
      s.setEditor(fieldKey, null);
    };
  }, [editor, fieldKey, flush]);

  // 칸이 닫히면 (다른 칸을 켰거나 고치기를 끝냈거나) 남은 글을 바로 알린다
  useEffect(() => () => flush(), [flush]);

  return <EditorContent editor={editor} data-field-key={fieldKey} className={cx('kok-field kok-editor is-active', className)} />;
}
