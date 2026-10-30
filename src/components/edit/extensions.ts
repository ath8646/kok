// 보이는 그대로 고치는 칸의 문서 모양(Tiptap). 저장 형식(src/lib/rich-doc.ts)이 적을 수 있는 것만 둔다:
// 문단·줄바꿈·목록·번호 목록, 굵게·형광펜·빨간 글씨, 수식(고칠 때는 창으로). 기호를 직접 쳐도 바뀐다(**굵게** · ==형광펜== · !!빨강!! · $수식$ · '- ' · '1. ').
// 꾸미기 규칙은 읽을 때(parseRich)와 같다: 여는 기호 뒤·닫는 기호 앞은 빈칸이 아니고, 영어·숫자 바로 뒤에서는 안에 한글 같은 글자가 있을 때만.
import { Extension, InputRule, Mark, Node, mergeAttributes, type Editor, type Extensions } from '@tiptap/core';
import type { MarkType, NodeType } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { HardBreak } from '@tiptap/extension-hard-break';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { renderTex } from '@/components/RichText';
import { texToText } from '@/lib/tex-text';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\!=]/g, '\\$&');

/** **·==·!! 를 치면 그 안을 꾸민다 (읽을 때와 같은 규칙만: 아니면 글자 그대로 둔다) */
function richMarkRule(type: MarkType, symbol: string): InputRule {
  const s = esc(symbol);
  const c = esc(symbol[0]);
  const find = new RegExp(`(?<!${c})${s}([^\\s${c}](?:[^${c}]*[^\\s${c}])?)${s}$`);
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const inner = match[1];
      const before = state.doc.textBetween(Math.max(range.from - 1, 0), range.from, '\n', '￼');
      if (/[A-Za-z0-9]/.test(before) && !/[^\x00-\x7f]/.test(inner)) return null;
      const { tr } = state;
      const textStart = range.from + symbol.length;
      const textEnd = textStart + inner.length;
      if (textEnd < range.to) tr.delete(textEnd, range.to);
      tr.delete(range.from, textStart);
      tr.addMark(range.from, range.from + inner.length, type.create());
      tr.removeStoredMark(type);
    },
  });
}

function richMark(name: string, symbol: string, tag: string, cls: string, shortcut?: string) {
  return Mark.create({
    name,
    parseHTML() {
      return name === 'bold'
        ? [{ tag: 'strong' }, { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null }]
        : [{ tag: `${tag}.${cls}` }, ...(name === 'highlight' ? [{ tag: 'mark' }] : [])];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { class: cls }), 0];
    },
    addKeyboardShortcuts() {
      return shortcut ? { [shortcut]: () => this.editor.commands.toggleMark(this.name) } : {};
    },
    addInputRules() {
      return [richMarkRule(this.type, symbol)];
    },
  });
}

export const RichBold = richMark('bold', '**', 'strong', 'font-bold', 'Mod-b');
export const RichHighlight = richMark('highlight', '==', 'mark', 'kok-mark', 'Mod-Shift-h');
export const RichRed = richMark('red', '!!', 'span', 'kok-red');

export type MathEdit = (editor: Editor, pos: number) => void;

export type KeyHooks = {
  /** 엔터 (한 줄 칸) · ⌘/Ctrl+엔터 (여러 줄 칸): 다음 칸으로 */
  onEnter: () => boolean;
  /** Esc: 칸을 닫는다 */
  onEscape: () => boolean;
  /** Alt+F10: 꾸미기 줄로 */
  onToolbar: () => boolean;
};

// 편집기마다 그 칸의 일(다음 칸으로, 수식 창 열기)을 담아 두는 곳 (편집기를 만든 뒤 attachEditorHooks 로 넣는다)
declare module '@tiptap/core' {
  interface Storage {
    kokKeys: { hooks: KeyHooks | null };
    math: { onEdit: MathEdit | null };
  }
}

/** 편집기가 만들어진 뒤 그 칸의 일을 넣는다 (그리는 동안에는 넣지 않는다) */
export function attachEditorHooks(editor: Editor, hooks: KeyHooks, onEditMath: MathEdit) {
  editor.storage.kokKeys.hooks = hooks;
  editor.storage.math.onEdit = onEditMath;
}

/** $수식$ 을 치면 수식 조각으로 */
function mathRule(type: NodeType): InputRule {
  return new InputRule({
    find: /(?<![\\$])\$([^\s$](?:[^$\n]*[^\s$\\])?)\$$/,
    handler: ({ state, range, match }) => {
      state.tr.replaceWith(range.from, range.to, type.create({ tex: match[1], display: false }));
    },
  });
}

/** 수식 조각: 글 칸 안에서는 그림으로 보이고, 누르거나 고른 채 엔터를 치면 수식 창이 열린다 */
export const MathNode = Node.create<object, { onEdit: MathEdit | null }>({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addStorage() {
    return { onEdit: null };
  },
  addAttributes() {
    return { tex: { default: '' }, display: { default: false } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-tex]',
        getAttrs: (el) => ({ tex: (el as HTMLElement).dataset.tex ?? '', display: (el as HTMLElement).dataset.display === 'true' }),
      },
    ];
  },
  renderHTML({ node }) {
    return ['span', { 'data-tex': node.attrs.tex, 'data-display': String(node.attrs.display) }, String(node.attrs.tex)];
  },
  renderText({ node }) {
    return node.attrs.display ? `$$${node.attrs.tex}$$` : `$${node.attrs.tex}$`;
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');
      dom.className = 'kok-math-node';
      dom.contentEditable = 'false';
      dom.setAttribute('role', 'img');
      let cur = node;
      const draw = () => {
        const tex = String(cur.attrs.tex);
        const html = renderTex(tex, cur.attrs.display === true);
        if (html) dom.innerHTML = html;
        else dom.textContent = tex;
        dom.dataset.display = String(cur.attrs.display === true);
        dom.setAttribute('aria-label', `수식 ${texToText(tex) || tex}`);
        dom.title = '눌러서 수식 고치기';
      };
      draw();
      dom.addEventListener('mousedown', (e) => e.preventDefault());
      dom.addEventListener('click', (e) => {
        e.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos === 'number') editor.storage.math.onEdit?.(editor, pos);
      });
      return {
        dom,
        update: (n) => {
          if (n.type !== cur.type) return false;
          cur = n;
          draw();
          return true;
        },
        selectNode: () => dom.classList.add('is-selected'),
        deselectNode: () => dom.classList.remove('is-selected'),
        ignoreMutation: () => true,
      };
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const sel = editor.state.selection;
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return false;
        editor.storage.math.onEdit?.(editor, sel.from);
        return true;
      },
    };
  },
  addInputRules() {
    return [mathRule(this.type)];
  },
});

/** 목록 안에 목록은 없다 (저장 형식이 한 단계): Tab 은 다음 칸으로 */
const FlatListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitListItem(this.name) };
  },
});

/** 한 줄 칸의 문서: 문단 하나 */
const SingleDocument = Document.extend({ content: 'paragraph' });

const KokKeys = Extension.create<{ single: boolean }, { hooks: KeyHooks | null }>({
  name: 'kokKeys',
  priority: 1000,
  addOptions() {
    return { single: false };
  },
  addStorage() {
    return { hooks: null };
  },
  addKeyboardShortcuts() {
    const h = () => this.storage.hooks;
    return {
      ...(this.options.single ? { Enter: () => h()?.onEnter() ?? false, 'Shift-Enter': () => true } : {}),
      'Mod-Enter': () => h()?.onEnter() ?? false,
      Escape: () => h()?.onEscape() ?? false,
      'Alt-F10': () => h()?.onToolbar() ?? false,
    };
  },
});

/** 칸 하나의 확장들 */
export function buildExtensions(o: { single: boolean; placeholder: string }): Extensions {
  return [
    o.single ? SingleDocument : Document,
    Paragraph,
    Text,
    ...(o.single ? [] : [HardBreak, BulletList, OrderedList, FlatListItem]),
    RichBold,
    RichHighlight,
    RichRed,
    MathNode,
    UndoRedo.configure({ depth: 200 }),
    Placeholder.configure({ placeholder: o.placeholder, showOnlyWhenEditable: false }),
    KokKeys.configure({ single: o.single }),
  ];
}
