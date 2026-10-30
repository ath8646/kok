'use client';
// 노트 고치기 모드의 작은 조각들: 더하기 칩, 함정·예시 상자, 공식 고치기 칸, 지운 것 되돌리기, 빈 칸 정리.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { Note } from '@/lib/ai/schemas';
import { Button, Icon, ICONS, cx } from '@/components/ui';
import { TexInput, useTexProblem } from '@/components/edit/TexInput';

/** 카드 아래 '+ 함정' 같은 칩 */
export function AddChip({ children, onClick, label }: { children: ReactNode; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="press inline-flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1.5 text-[13px] font-semibold text-muted hover:border-accent hover:text-accent"
    >
      <Icon d={ICONS.plus} size={14} strokeWidth={2.6} />
      {children}
    </button>
  );
}

const TONES = {
  why: { box: 'bg-accent-soft', title: 'text-accent' },
  pit: { box: 'bg-bad-soft', title: 'text-bad' },
  ex: { box: 'bg-surface-2', title: 'text-ok' },
} as const;

/** 시험 포인트·함정·예시 상자 (고치기 모드): 위에 이름과 빼기(×), 그 아래 글 칸 */
export function LinkedBox({
  tone,
  title,
  removeLabel,
  onRemove,
  children,
}: {
  tone: keyof typeof TONES;
  title: string;
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className={cx('kok-linked mt-2 rounded-xl px-3 pb-2.5 pt-1.5 text-sm', t.box)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <b className={cx('text-[13px]', t.title)} aria-hidden="true">
          {title}
        </b>
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="press -mr-1.5 grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-bad"
        >
          <Icon d={ICONS.close} size={14} strokeWidth={2.4} />
        </button>
      </div>
      {children}
    </div>
  );
}

/** 공식 고치기: 기호 버튼 + 미리보기. 읽을 수 있는 공식이 되면 저절로 저장, '닫기'·Esc 로 닫는다 */
export function FormulaPanel({ initial, onCommit, onClose }: { initial: string; onCommit: (latex: string) => void; onClose: () => void }) {
  const [latex, setLatex] = useState(initial);
  const problem = useTexProblem(latex);
  const committed = useRef(initial);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(() => {
    const t = latex.trim();
    if (!t || problem || latex === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = latex;
      commitRef.current(t);
    }, 600);
    return () => clearTimeout(timer);
  }, [latex, problem]);
  const close = () => {
    const t = latex.trim();
    if (t && !problem && latex !== committed.current) {
      committed.current = latex;
      commitRef.current(t);
    }
    onClose();
  };
  return (
    <div
      className="kok-appear mt-2 grid gap-3 rounded-2xl border border-line bg-surface p-3"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          close();
        }
      }}
    >
      <TexInput value={latex} onChange={setLatex} autoFocus onSubmit={close} />
      <div className="flex items-center justify-between gap-2">
        <p className="px-1 text-xs text-muted">{problem ? '고칠 때까지 저장하지 않아요.' : '읽을 수 있는 공식이면 저절로 저장돼요.'}</p>
        <Button size="sm" onClick={close}>
          닫기
        </Button>
      </div>
    </div>
  );
}

/** 지운 카드 되돌리기 (화면 아래, 몇 초 동안) */
export function UndoBar({ text, onUndo, onClose }: { text: string; onUndo: () => void; onClose: () => void }) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const t = setTimeout(() => closeRef.current(), 7000);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className="kok-undobar" role="status">
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <button type="button" className="press shrink-0 rounded-full px-3 py-1.5 font-bold text-[var(--undo-action)]" onClick={onUndo}>
        되돌리기
      </button>
    </div>
  );
}

/**
 * 이름이 없는 목록(공식·용어)에 이 화면에서만 쓰는 이름을 붙인다: 끌어 옮기거나 지워도 같은 칸을 알아본다.
 * 밖에서 개수가 바뀌면(새로 읽음) 새로 붙인다
 */
export function useItemKeys(n: number) {
  const uid = useId();
  const [st, setSt] = useState(() => ({ keys: Array.from({ length: n }, (_, i) => `${uid}-0-${i}`), gen: 0 }));
  // 새 칸의 이름 (누를 때만 늘어난다)
  const added = useRef(0);
  let keys = st.keys;
  if (keys.length !== n) {
    const gen = st.gen + 1;
    keys = Array.from({ length: n }, (_, i) => `${uid}-${gen}-${i}`);
    setSt({ keys, gen });
  }
  return {
    keys,
    move: (from: number, to: number) => setSt((s) => ({ ...s, keys: arrayMove(s.keys, from, to) })),
    /** at 에 새 칸을 끼우고 그 이름을 돌려준다 */
    insertAt: (at: number): string => {
      const key = `${uid}-a${added.current++}`;
      setSt((s) => ({ ...s, keys: [...s.keys.slice(0, at), key, ...s.keys.slice(at)] }));
      return key;
    },
    remove: (at: number) => setSt((s) => ({ ...s, keys: s.keys.filter((_, j) => j !== at) })),
  };
}

/** 고치기를 마칠 때: 비운 채 둔 함정·예시·공식·용어와 아무것도 적지 않은 새 개념을 뺀다 */
export function cleanNote<T extends Note>(n: T): T {
  const pitfalls = n.pitfalls.filter((p) => p.text.trim());
  const examples = n.examples.filter((p) => p.text.trim());
  const key_points = n.key_points.filter(
    (k) =>
      k.title.trim() || k.explanation.trim() || k.why.trim() || pitfalls.some((p) => p.key_point_id === k.id) || examples.some((p) => p.key_point_id === k.id),
  );
  const formulas = n.formulas.filter((f) => f.latex.trim());
  const terms = n.terms.filter((t) => t.term.trim() || t.meaning.trim());
  if (
    pitfalls.length === n.pitfalls.length &&
    examples.length === n.examples.length &&
    key_points.length === n.key_points.length &&
    formulas.length === n.formulas.length &&
    terms.length === n.terms.length
  )
    return n;
  return { ...n, pitfalls, examples, key_points, formulas, terms };
}
