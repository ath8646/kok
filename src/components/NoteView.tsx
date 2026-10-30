'use client';
// 정리 노트: 한 줄 요약, 핵심 개념(별표한 것이 맨 위), 공식, 용어, 확인할 것, AI가 바꾼 것.
// 읽기: 보이는 그대로. 별표는 읽을 때도 바로 된다 (별이 튄 뒤 카드가 맨 위로 미끄러진다).
// 고치기 모드(editMode: 노트 화면 위 '고치기'): 모든 글을 그 자리에서 보이는 그대로 고치고(src/components/edit) 저절로 저장한다.
//   카드 왼쪽 손잡이로 끌어 순서(note/EditSortable, 별표한 개념끼리·나머지끼리), ⋯ 메뉴로 옮기기·지우기(아래 띠에서 되돌리기),
//   카드 아래 칩으로 시험 포인트·함정·예시를 더한다. 마치면 비운 채 둔 칸은 뺀다(cleanNote).
// 개념 순서 = 저장된 배열 순서. 화면에는 별표한 개념을 먼저 (별표끼리·나머지끼리는 그 순서대로).
// 자료 그림: 개념에 붙은 그림은 개념 카드 안에, 개념이 없는 그림은 '자료 그림'에 (figure/SourceFigureView).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { KeyPoint, Note } from '@/lib/ai/schemas';
import { previewText } from '@/lib/richtext';
import { starredFirst } from '@/lib/note-order';
import { RichText, Tex } from './RichText';
import { Button, Chip, Icon, ICONS, Menu, cx, type MenuItem } from './ui';
import { useConfirm } from './Confirm';
import { StarButton, StarGlyph, useStarRefocus } from './note/StarButton';
import { EditSortable } from './note/EditSortable';
import { AddChip, FormulaPanel, LinkedBox, UndoBar, cleanNote, useItemKeys } from './note/NoteEditParts';
import { EditSessionProvider, type EditSession } from './edit/EditSession';
import { EditableRich } from './edit/EditableRich';
import { prefersReducedMotion } from './useReducedMotion';
import { SourceFigureView } from './figure/SourceFigureView';
import { figuresByKeyPoint, type SourceFigure } from '@/lib/source-figures';
import { pageName, type PageLabels } from '@/lib/page-labels';

export type NoteBody = Note & { recommended?: string };

type Linked = 'pitfalls' | 'examples';

const IMPORTANCE: Record<KeyPoint['importance'], { label: string; tone: 'bad' | 'accent' | 'plain' }> = {
  high: { label: '꼭 외우기', tone: 'bad' },
  medium: { label: '중요', tone: 'accent' },
  low: { label: '참고', tone: 'plain' },
};

/** 카드 이름을 화면 읽기·메뉴에 쓸 글로 (꾸미기 기호·수식 표시 없이) */
function plain(text: string): string {
  return previewText(text) || text;
}

/** 새 개념 번호: 개념은 물론 함정·예시가 가리키는 번호와도 겹치지 않게 (주인 없는 함정이 새 개념에 붙지 않게) */
function newKeyPointId(note: Note, reserved?: ReadonlySet<string>): string {
  const used = new Set([
    ...note.key_points.map((k) => k.id),
    ...note.pitfalls.map((p) => p.key_point_id),
    ...note.examples.map((p) => p.key_point_id),
    // 지운 개념의 번호를 문제·마인드맵·그림이 아직 가리키면 쓰지 않는다 (새 개념에 옛 문제가 붙지 않게)
    ...(reserved ?? []),
  ]);
  let n = note.key_points.length + 1;
  while (used.has(`k${n}`)) n++;
  return `k${n}`;
}

/**
 * 순서가 바뀌면 카드가 원래 자리에서 새 자리로 미끄러진다 (FLIP: 바뀌기 전 자리를 재고, 바뀐 뒤 거꾸로 옮겼다가 풀어 준다).
 * 움직이는 카드(lead)는 다른 카드 위로 살짝 떠서 지나간다. 움직임 줄이기면 바로 바뀐다
 */
function useFlip(root: RefObject<HTMLElement | null>, orderKey: string) {
  const before = useRef<Map<string, number> | null>(null);
  const lead = useRef<string | null>(null);
  const capture = (leadId: string | null) => {
    const el = root.current;
    if (!el) return;
    lead.current = leadId;
    before.current = new Map(Array.from(el.querySelectorAll<HTMLElement>('[data-flip]'), (n) => [n.dataset.flip ?? '', n.getBoundingClientRect().top]));
  };
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    const el = root.current;
    if (!prev || !el) return;
    const reduce = prefersReducedMotion();
    for (const n of Array.from(el.querySelectorAll<HTMLElement>('[data-flip]'))) {
      const id = n.dataset.flip ?? '';
      const top = prev.get(id);
      if (top === undefined) continue;
      const rect = n.getBoundingClientRect();
      const dy = top - rect.top;
      if (Math.abs(dy) < 1) continue;
      const isLead = id === lead.current;
      if (reduce) continue;
      if (isLead) n.style.zIndex = '2';
      const anim = n.animate(
        isLead
          ? [{ transform: `translateY(${dy}px)` }, { transform: `translateY(${dy * 0.42}px) scale(1.015)`, offset: 0.5 }, { transform: 'none' }]
          : [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: 300, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' },
      );
      if (isLead) {
        const done = () => {
          n.style.zIndex = '';
        };
        anim.onfinish = done;
        anim.oncancel = done;
      }
    }
  }, [orderKey, root]);
  return capture;
}

function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-2">
      <h3 className="font-display text-lg">
        {title}
        {typeof count === 'number' ? <span className="ml-1.5 text-[15px] font-bold tabular-nums text-muted">{count}</span> : null}
      </h3>
    </div>
  );
}

/** 점선 '더하기' 줄 (개념·공식·용어 추가) */
function AddRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex w-full items-center justify-center gap-1.5 rounded-[22px] border-2 border-dashed border-line px-4 py-3 text-sm font-semibold text-muted hover:border-accent hover:text-accent"
    >
      <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
      {children}
    </button>
  );
}

const ARROW_UP = 'M12 19V5M5.5 11.5 12 5l6.5 6.5';
const ARROW_DOWN = 'M12 5v14M5.5 12.5 12 19l6.5-6.5';

/** ⋯ 메뉴의 '위로·아래로 옮기기' (맨 끝이면 그 쪽은 없다) */
function moveItems(i: number, count: number, move: (to: number) => void): MenuItem[] {
  return [
    ...(i > 0 ? [{ label: '위로 옮기기', icon: ARROW_UP, onSelect: () => move(i - 1) }] : []),
    ...(i < count - 1 ? [{ label: '아래로 옮기기', icon: ARROW_DOWN, onSelect: () => move(i + 1) }] : []),
  ];
}

export function NoteView({
  note,
  kind,
  editable,
  editMode = false,
  onEditMode,
  onChange,
  showImportance = false,
  highlightKeyPoint,
  onSelectKeyPoint,
  onOpenPage,
  reservedIds,
  figures = [],
  originalFirst = false,
  onFiguresChange,
  pageLabels,
}: {
  note: NoteBody;
  kind: string;
  /** 고칠 수 있는지 (자료를 더하는 중 등에는 아니다) */
  editable?: boolean;
  /** 고치기 모드 (노트 화면 위 '고치기' / '완료') */
  editMode?: boolean;
  /** 고치기 모드를 켜 달라고 (빈 노트의 '첫 개념 적기') */
  onEditMode?: (on: boolean) => void;
  onChange?: (next: NoteBody) => void;
  /** 설정: AI 가 정한 중요도(꼭 외우기·중요·참고)를 카드에 보일지 */
  showImportance?: boolean;
  highlightKeyPoint?: string | null;
  onSelectKeyPoint?: (id: string | null) => void;
  onOpenPage?: (page: number) => void;
  /** 문제·마인드맵이 가리키는 개념 번호 (새 개념에 쓰지 않는다) */
  reservedIds?: ReadonlySet<string>;
  /** 자료 그림 (body.figures): 개념 카드 안과 '자료 그림'에 */
  figures?: SourceFigure[];
  /** 설정: 자료 그림을 원본으로 먼저 보기 */
  originalFirst?: boolean;
  /** 자료 그림을 빼면 (고칠 수 있을 때만) */
  onFiguresChange?: (next: SourceFigure[]) => void;
  /** 인쇄된 쪽 번호 (body.page_labels): 쪽 표시를 책의 쪽 번호로 */
  pageLabels?: PageLabels;
}) {
  const ask = useConfirm();
  const editing = editMode && !!editable;
  const rootRef = useRef<HTMLDivElement>(null);
  const session = useRef<EditSession | null>(null);

  // ---------------------------------------------------------- 고치기: 바뀐 노트를 차례로 쌓아 알린다 (한 번에 여러 칸이 바뀌어도 앞 것을 잃지 않게)
  const noteRef = useRef(note);
  const changeRef = useRef(onChange);
  useLayoutEffect(() => {
    noteRef.current = note;
    changeRef.current = onChange;
  });
  const update = useCallback((f: (n: NoteBody) => NoteBody) => {
    const cur = noteRef.current;
    const next = f(cur);
    if (next === cur) return;
    noteRef.current = next;
    changeRef.current?.(next);
  }, []);
  const activate = (key: string) => session.current?.activate(key, 'end');

  // ---------------------------------------------------------- 별표: 별이 튄 뒤 카드가 맨 위로 미끄러진다
  const [hold, setHold] = useState<string[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  const ordered = useMemo(() => {
    const all = note.key_points;
    if (!hold) return starredFirst(all);
    // 별이 튀는 동안에는 자리를 그대로 둔다
    const byId = new Map(all.map((k) => [k.id, k]));
    const seen = new Set<string>();
    const out: KeyPoint[] = [];
    for (const id of hold) {
      const k = byId.get(id);
      if (k && !seen.has(id)) {
        out.push(k);
        seen.add(id);
      }
    }
    for (const k of all) if (!seen.has(k.id)) out.push(k);
    return out;
  }, [note.key_points, hold]);
  const listRef = useRef<HTMLDivElement>(null);
  // 키보드로 별표를 빼면 카드가 제자리로 옮겨 간 뒤 그 카드의 별 버튼으로 초점을 되돌린다
  const rememberStar = useStarRefocus(listRef, hold !== null);
  const flip = useFlip(listRef, ordered.map((k) => k.id).join('|'));
  const toggleStar = (kp: KeyPoint) => {
    rememberStar(kp.id);
    const on = !kp.starred;
    const now = ordered.map((k) => k.id);
    const cur = noteRef.current;
    const key_points = cur.key_points.map((x) => (x.id === kp.id ? { ...x, starred: on || undefined } : x));
    // 자리가 바뀔 때만 움직임을 잰다 (맨 위 카드에 별표하면 그대로)
    const moves = starredFirst(key_points)
      .map((k) => k.id)
      .some((id, i) => id !== now[i]);
    setHold(now);
    update((n) => ({ ...n, key_points: n.key_points.map((x) => (x.id === kp.id ? { ...x, starred: on || undefined } : x)) }));
    if (on) {
      setFlash(kp.id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 420);
    }
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(
      () => {
        holdTimer.current = null;
        if (moves) flip(kp.id);
        setHold(null);
      },
      on ? 200 : 80,
    );
  };

  // ---------------------------------------------------------- 고치기 모드의 상태
  // 비어 있지만 열어 둔 '시험 포인트' 칸 (글을 적기 전에도 보이게)
  const [whyOpen, setWhyOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [openFormula, setOpenFormula] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ text: string; restore: () => void } | null>(null);
  // 지운 개념의 번호 (되돌릴 때까지 새 개념에 쓰지 않는다)
  const removedIds = useRef(new Set<string>());
  const fKeys = useItemKeys(note.formulas.length);
  const tKeys = useItemKeys(note.terms.length);
  // 빈 노트의 '첫 개념 적기'처럼 고치기 모드를 켠 뒤에 할 일
  const pending = useRef<'kp' | null>(null);

  // 고치는 동안 아래 메뉴·떠 있는 버튼은 감춘다 (꾸미기 줄이 그 자리를 쓴다)
  useEffect(() => {
    if (!editing) return;
    document.body.classList.add('kok-editing');
    return () => document.body.classList.remove('kok-editing');
  }, [editing]);

  // 고치기를 마치면(또는 화면을 떠나면) 비운 채 둔 칸을 뺀다. 열려 있던 글 칸이 마지막 글을 알린 뒤에 (다음 차례)
  const wasEditing = useRef(editing);
  useEffect(() => {
    const was = wasEditing.current;
    wasEditing.current = editing;
    if (was && !editing) {
      setTimeout(() => {
        update(cleanNote);
        setWhyOpen(new Set());
        setOpenFormula(null);
        setUndo(null);
      }, 0);
    }
  }, [editing, update]);
  useEffect(
    () => () => {
      if (wasEditing.current) setTimeout(() => update(cleanNote), 0);
    },
    [update],
  );

  const reservedAll = () => new Set([...(reservedIds ?? []), ...figures.map((f) => f.key_point_id).filter(Boolean), ...removedIds.current]);

  // ---------------------------------------------------------- 고치기: 개념
  const setKp = (id: string, patch: Partial<KeyPoint>) =>
    update((n) => {
      const k = n.key_points.find((x) => x.id === id);
      if (!k || Object.entries(patch).every(([f, v]) => k[f as keyof KeyPoint] === v)) return n;
      return { ...n, key_points: n.key_points.map((x) => (x.id === id ? { ...x, ...patch, edited: true } : x)) };
    });
  const addKp = () => {
    const id = newKeyPointId(noteRef.current, reservedAll());
    update((n) => ({ ...n, key_points: [...n.key_points, { id, title: '', explanation: '', why: '', importance: 'medium', pages: [], edited: true }] }));
    activate(`kp:${id}:title`);
  };
  const deleteKp = (id: string) => {
    const n0 = noteRef.current;
    const index = n0.key_points.findIndex((k) => k.id === id);
    if (index < 0) return;
    const kp = n0.key_points[index];
    const pits = n0.pitfalls.filter((p) => p.key_point_id === id);
    const exs = n0.examples.filter((p) => p.key_point_id === id);
    removedIds.current.add(id);
    update((n) => ({
      ...n,
      key_points: n.key_points.filter((k) => k.id !== id),
      pitfalls: n.pitfalls.filter((p) => p.key_point_id !== id),
      examples: n.examples.filter((p) => p.key_point_id !== id),
    }));
    const name = plain(kp.title);
    setUndo({
      text: name ? `'${name.length > 18 ? `${name.slice(0, 18)}…` : name}' 개념을 지웠어요` : '개념을 지웠어요',
      restore: () => {
        update((n) =>
          n.key_points.some((k) => k.id === id)
            ? n
            : {
                ...n,
                key_points: [...n.key_points.slice(0, index), kp, ...n.key_points.slice(index)],
                pitfalls: [...n.pitfalls, ...pits],
                examples: [...n.examples, ...exs],
              },
        );
        removedIds.current.delete(id);
      },
    });
  };
  /** 보이는 차례(별표 먼저)에서 from → to. 같은 묶음(별표·나머지) 안에서만 움직인다 */
  const moveKp = (from: number, to: number) => {
    const ids = ordered.map((k) => k.id);
    const starredCount = ordered.filter((k) => k.starred).length;
    const inStarred = from < starredCount;
    const lo = inStarred ? 0 : starredCount;
    const hi = inStarred ? starredCount - 1 : ids.length - 1;
    const target = Math.max(lo, Math.min(hi, to));
    if (target === from) return;
    const next = arrayMove(ids, from, target);
    update((n) => {
      const byId = new Map(n.key_points.map((k) => [k.id, k]));
      const starred = next.filter((id) => byId.get(id)?.starred).map((id) => byId.get(id)!);
      const others = next.filter((id) => byId.has(id) && !byId.get(id)!.starred).map((id) => byId.get(id)!);
      let si = 0;
      let oi = 0;
      return { ...n, key_points: n.key_points.map((k) => (k.starred ? (starred[si++] ?? k) : (others[oi++] ?? k))) };
    });
  };

  // ---------------------------------------------------------- 고치기: 함정·예시·시험 포인트
  const setLinked = (kindOf: Linked, kpId: string, j: number, text: string) =>
    update((n) => {
      let c = -1;
      const list = n[kindOf].map((p) => (p.key_point_id === kpId && ++c === j ? (p.text === text ? p : { ...p, text, edited: true }) : p));
      return list.every((p, i) => p === n[kindOf][i]) ? n : { ...n, [kindOf]: list };
    });
  const removeLinked = (kindOf: Linked, kpId: string, j: number) =>
    update((n) => {
      let c = -1;
      const list = n[kindOf].filter((p) => !(p.key_point_id === kpId && ++c === j));
      return list.length === n[kindOf].length ? n : { ...n, [kindOf]: list };
    });
  const addLinked = (kindOf: Linked, kpId: string) => {
    const j = noteRef.current[kindOf].filter((p) => p.key_point_id === kpId).length;
    update((n) => ({ ...n, [kindOf]: [...n[kindOf], { text: '', key_point_id: kpId, edited: true }] }));
    activate(`${kindOf === 'pitfalls' ? 'pit' : 'ex'}:${kpId}:${j}`);
  };
  const openWhy = (kpId: string) => {
    setWhyOpen((s) => new Set(s).add(kpId));
    activate(`kp:${kpId}:why`);
  };
  const closeWhy = (kpId: string) =>
    setWhyOpen((s) => {
      if (!s.has(kpId)) return s;
      const x = new Set(s);
      x.delete(kpId);
      return x;
    });

  // ---------------------------------------------------------- 고치기: 공식·용어
  const setFormula = (i: number, patch: Partial<Note['formulas'][number]>) =>
    update((n) => {
      const f = n.formulas[i];
      if (!f || Object.entries(patch).every(([k, v]) => f[k as keyof typeof f] === v)) return n;
      return { ...n, formulas: n.formulas.map((x, j) => (j === i ? { ...x, ...patch, edited: true } : x)) };
    });
  const addFormula = () => {
    const at = noteRef.current.formulas.length;
    update((n) => ({ ...n, formulas: [...n.formulas, { latex: '', label: '', edited: true }] }));
    setOpenFormula(fKeys.insertAt(at));
  };
  const deleteFormula = (i: number) => {
    const f = noteRef.current.formulas[i];
    if (!f) return;
    update((n) => ({ ...n, formulas: n.formulas.filter((_, j) => j !== i) }));
    fKeys.remove(i);
    if (!f.latex.trim()) return;
    setUndo({
      text: '공식을 지웠어요',
      restore: () => {
        const at = Math.min(i, noteRef.current.formulas.length);
        update((n) => ({ ...n, formulas: [...n.formulas.slice(0, at), f, ...n.formulas.slice(at)] }));
        fKeys.insertAt(at);
      },
    });
  };
  const moveFormula = (from: number, to: number) => {
    if (from === to) return;
    update((n) => ({ ...n, formulas: arrayMove(n.formulas, from, to) }));
    fKeys.move(from, to);
  };
  const setTerm = (i: number, patch: Partial<Note['terms'][number]>) =>
    update((n) => {
      const t = n.terms[i];
      if (!t || Object.entries(patch).every(([k, v]) => t[k as keyof typeof t] === v)) return n;
      return { ...n, terms: n.terms.map((x, j) => (j === i ? { ...x, ...patch, edited: true } : x)) };
    });
  const addTerm = () => {
    const at = noteRef.current.terms.length;
    update((n) => ({ ...n, terms: [...n.terms, { term: '', meaning: '', edited: true }] }));
    activate(`t:${tKeys.insertAt(at)}:term`);
  };
  const deleteTerm = (i: number) => {
    const t = noteRef.current.terms[i];
    if (!t) return;
    update((n) => ({ ...n, terms: n.terms.filter((_, j) => j !== i) }));
    tKeys.remove(i);
    if (!t.term.trim() && !t.meaning.trim()) return;
    setUndo({
      text: t.term.trim() ? `'${plain(t.term).slice(0, 18)}' 용어를 지웠어요` : '용어를 지웠어요',
      restore: () => {
        const at = Math.min(i, noteRef.current.terms.length);
        update((n) => ({ ...n, terms: [...n.terms.slice(0, at), t, ...n.terms.slice(at)] }));
        tKeys.insertAt(at);
      },
    });
  };
  const moveTerm = (from: number, to: number) => {
    if (from === to) return;
    update((n) => ({ ...n, terms: arrayMove(n.terms, from, to) }));
    tKeys.move(from, to);
  };

  // 고치기 모드를 켠 뒤에 할 일 (빈 노트의 '첫 개념 적기')
  useEffect(() => {
    if (!editing || !pending.current) return;
    pending.current = null;
    addKp();
  });

  // ---------------------------------------------------------- 자료 그림: 개념마다, 개념이 없는 그림은 따로
  const figs = useMemo(() => figuresByKeyPoint(figures, new Set(note.key_points.map((k) => k.id))), [figures, note.key_points]);
  const figure = (f: SourceFigure) => (
    <SourceFigureView
      key={f.id}
      fig={f}
      originalFirst={originalFirst}
      pageLabel={f.page && kind !== 'text' ? pageName(kind, f.page, pageLabels, f.printed) : undefined}
      onOpenPage={onOpenPage}
      menu={
        editable && onFiguresChange
          ? [
              {
                label: '이 그림 빼기',
                icon: ICONS.trash,
                danger: true,
                onSelect: async () => {
                  if (
                    !(await ask({
                      title: '그림 빼기',
                      body: '이 그림을 노트에서 뺄까요?',
                      note: '이 그림으로 만든 문제는 그대로 남아요.',
                      ok: '빼기',
                      danger: true,
                    }))
                  )
                    return;
                  onFiguresChange(figures.filter((x) => x.id !== f.id));
                },
              },
            ]
          : undefined
      }
    />
  );

  const pages = (ps: number[]) =>
    ps.length && kind !== 'text' ? (
      <span className="flex flex-wrap gap-1">
        {ps.slice(0, 6).map((p) => (
          <button
            key={p}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPage?.(p);
            }}
            className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
          >
            {pageName(kind, p, pageLabels)}
          </button>
        ))}
      </span>
    ) : null;

  const badge = (kp: KeyPoint, n: number, extra?: string) => (
    <span
      className={cx(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums transition-colors',
        kp.starred ? 'kok-star-badge' : 'bg-accent text-accent-ink',
        flash === kp.id && 'kok-badge-pop',
        extra,
      )}
    >
      {n}
    </span>
  );

  // ---------------------------------------------------------- 읽기: 개념 카드
  const readKpCard = (kp: KeyPoint, idx: number) => {
    const imp = IMPORTANCE[kp.importance] ?? IMPORTANCE.medium;
    const hl = highlightKeyPoint === kp.id;
    const pits = note.pitfalls.filter((p) => p.key_point_id === kp.id && p.text.trim());
    const exs = note.examples.filter((p) => p.key_point_id === kp.id && p.text.trim());
    const name = plain(kp.title);
    return (
      <article
        key={kp.id}
        id={`kp-${kp.id}`}
        data-flip={kp.id}
        className={cx('kok-card kok-paper kok-glow p-4 transition-shadow', hl && 'shadow-[0_0_0_3px_var(--hl)]', kp.starred && 'is-starred')}
        onClick={() => onSelectKeyPoint?.(hl ? null : kp.id)}
      >
        <div className="flex items-start gap-3">
          {badge(kp, idx + 1, 'mt-0.5')}
          <div className="min-w-0 flex-1">
            <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', (editable || kp.starred) && 'pr-9')}>
              <h4 className="text-[16px] font-bold">{kp.title.trim() ? <RichText text={kp.title} /> : <span className="text-muted">이름 없는 개념</span>}</h4>
              {showImportance ? <Chip tone={imp.tone}>{imp.label}</Chip> : null}
            </div>
            {kp.explanation ? (
              <p className="mt-1.5 text-[15px] leading-relaxed">
                <RichText text={kp.explanation} />
              </p>
            ) : null}
            {kp.why.trim() ? (
              <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink">
                <b className="text-accent">시험 포인트 </b>
                <RichText text={kp.why} />
              </p>
            ) : null}
            {pits.length ? (
              <ul className="mt-2 grid gap-1.5">
                {pits.map((p, i) => (
                  <li key={i} className="rounded-xl bg-bad-soft px-3 py-2 text-sm">
                    <b className="text-bad">함정 </b>
                    <RichText text={p.text} />
                  </li>
                ))}
              </ul>
            ) : null}
            {exs.length ? (
              <ul className="mt-2 grid gap-1.5">
                {exs.map((p, i) => (
                  <li key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                    <b className="text-ok">예시 </b>
                    <RichText text={p.text} />
                  </li>
                ))}
              </ul>
            ) : null}
            {figs.byKp.get(kp.id)?.length ? <div className="mt-3 grid gap-4">{figs.byKp.get(kp.id)!.map(figure)}</div> : null}
            {kp.pages.length && kind !== 'text' ? <div className="mt-2">{pages(kp.pages)}</div> : null}
          </div>
        </div>
        {editable ? (
          <StarButton
            className="absolute right-2 top-2"
            starFor={kp.id}
            on={!!kp.starred}
            label={`${name || `${idx + 1}번 개념`} 별표`}
            onToggle={() => toggleStar(kp)}
          />
        ) : kp.starred ? (
          <span className="absolute right-3.5 top-3.5" title="별표한 개념">
            <StarGlyph on size={20} />
          </span>
        ) : null}
      </article>
    );
  };

  // ---------------------------------------------------------- 고치기: 개념 카드
  const kpCalled = (kp: KeyPoint, idx: number) => {
    const name = plain(kp.title);
    return name ? `'${name.length > 24 ? `${name.slice(0, 24)}…` : name}'` : `${idx + 1}번 개념`;
  };
  const editKpCard = (kp: KeyPoint, idx: number, grip: ReactNode) => {
    const n = idx + 1;
    const name = plain(kp.title);
    const imp = IMPORTANCE[kp.importance] ?? IMPORTANCE.medium;
    const pits = note.pitfalls.filter((p) => p.key_point_id === kp.id);
    const exs = note.examples.filter((p) => p.key_point_id === kp.id);
    const whyShown = !!kp.why.trim() || whyOpen.has(kp.id);
    const group = ordered.filter((k) => !!k.starred === !!kp.starred).map((k) => k.id);
    const gi = group.indexOf(kp.id);
    const groupStart = kp.starred ? 0 : ordered.length - group.length;
    const menu: MenuItem[] = [
      ...moveItems(gi, group.length, (to) => moveKp(idx, groupStart + to)),
      ...(showImportance
        ? (['high', 'medium', 'low'] as const)
            .filter((v) => v !== kp.importance)
            .map((v) => ({ label: `중요도: ${IMPORTANCE[v].label}`, icon: ICONS.flag, onSelect: () => setKp(kp.id, { importance: v }) }))
        : []),
      { label: '개념 지우기', icon: ICONS.trash, danger: true, onSelect: () => deleteKp(kp.id) },
    ];
    return (
      <article id={`kp-${kp.id}`} data-flip={kp.id} className={cx('kok-card kok-paper kok-glow is-editing p-4 pl-2', kp.starred && 'is-starred')}>
        <div className="flex items-start gap-1.5">
          {grip}
          {badge(kp, n, 'mt-0.5')}
          <div className="min-w-0 flex-1 pl-1">
            <div className="pr-[76px]">
              <EditableRich
                single
                fieldKey={`kp:${kp.id}:title`}
                value={kp.title}
                placeholder="개념 이름"
                label={`${n}번 개념 이름`}
                className="text-[16px] font-bold"
                maxLength={120}
                onCommit={(t) => setKp(kp.id, { title: t })}
              />
              {showImportance ? (
                <div className="mt-1">
                  <Chip tone={imp.tone}>{imp.label}</Chip>
                </div>
              ) : null}
            </div>
            <EditableRich
              fieldKey={`kp:${kp.id}:explanation`}
              value={kp.explanation}
              placeholder="설명을 적어요"
              label={`${n}번 개념 설명`}
              className="mt-1.5 text-[15px] leading-relaxed"
              maxLength={3000}
              onCommit={(t) => setKp(kp.id, { explanation: t })}
            />
            {whyShown ? (
              <LinkedBox
                tone="why"
                title="시험 포인트"
                removeLabel={`${n}번 개념 시험 포인트 빼기`}
                onRemove={() => {
                  closeWhy(kp.id);
                  setKp(kp.id, { why: '' });
                }}
              >
                <EditableRich
                  fieldKey={`kp:${kp.id}:why`}
                  value={kp.why}
                  placeholder="시험에 어떻게 나오는지 적어요"
                  label={`${n}번 개념 시험 포인트`}
                  className="leading-relaxed text-ink"
                  maxLength={1000}
                  onCommit={(t) => setKp(kp.id, { why: t })}
                  onEmptyLeave={() => closeWhy(kp.id)}
                />
              </LinkedBox>
            ) : null}
            {pits.map((p, j) => (
              <LinkedBox
                key={`p${j}`}
                tone="pit"
                title="함정"
                removeLabel={`${n}번 개념 함정 ${j + 1} 빼기`}
                onRemove={() => removeLinked('pitfalls', kp.id, j)}
              >
                <EditableRich
                  fieldKey={`pit:${kp.id}:${j}`}
                  value={p.text}
                  placeholder="틀리기 쉬운 점을 적어요"
                  label={`${n}번 개념 함정 ${j + 1}`}
                  className="leading-relaxed"
                  maxLength={1000}
                  onCommit={(t) => setLinked('pitfalls', kp.id, j, t)}
                  onEmptyLeave={() => removeLinked('pitfalls', kp.id, j)}
                />
              </LinkedBox>
            ))}
            {exs.map((p, j) => (
              <LinkedBox
                key={`e${j}`}
                tone="ex"
                title="예시"
                removeLabel={`${n}번 개념 예시 ${j + 1} 빼기`}
                onRemove={() => removeLinked('examples', kp.id, j)}
              >
                <EditableRich
                  fieldKey={`ex:${kp.id}:${j}`}
                  value={p.text}
                  placeholder="예시를 적어요"
                  label={`${n}번 개념 예시 ${j + 1}`}
                  className="leading-relaxed"
                  maxLength={1000}
                  onCommit={(t) => setLinked('examples', kp.id, j, t)}
                  onEmptyLeave={() => removeLinked('examples', kp.id, j)}
                />
              </LinkedBox>
            ))}
            {figs.byKp.get(kp.id)?.length ? <div className="mt-3 grid gap-4">{figs.byKp.get(kp.id)!.map(figure)}</div> : null}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {!whyShown ? (
                <AddChip label={`${n}번 개념에 시험 포인트 더하기`} onClick={() => openWhy(kp.id)}>
                  시험 포인트
                </AddChip>
              ) : null}
              <AddChip label={`${n}번 개념에 함정 더하기`} onClick={() => addLinked('pitfalls', kp.id)}>
                함정
              </AddChip>
              <AddChip label={`${n}번 개념에 예시 더하기`} onClick={() => addLinked('examples', kp.id)}>
                예시
              </AddChip>
              {kp.pages.length && kind !== 'text' ? <span className="ml-auto">{pages(kp.pages)}</span> : null}
            </div>
          </div>
        </div>
        <div className="absolute right-1.5 top-1.5 flex items-center">
          <StarButton starFor={kp.id} on={!!kp.starred} label={`${name || `${n}번 개념`} 별표`} onToggle={() => toggleStar(kp)} />
          <Menu small label={`${name || `${n}번 개념`} 메뉴`} items={menu} />
        </div>
      </article>
    );
  };

  // ---------------------------------------------------------- 그리기
  const readFormulas = note.formulas.filter((f) => f.latex.trim());
  const readTerms = note.terms.filter((t) => t.term.trim() || t.meaning.trim());
  const showFormulas = editing ? note.formulas.length > 0 : readFormulas.length > 0;
  const showTerms = editing ? note.terms.length > 0 : readTerms.length > 0;

  const body = (
    <div ref={rootRef} className={cx('grid gap-5', editing && 'kok-note-editing')}>
      {editing ? (
        <p className="kok-appear flex items-center gap-2 px-1 text-sm text-muted" role="note">
          <Icon d={ICONS.edit} size={16} className="shrink-0 text-accent" />
          글을 누르면 그 자리에서 고쳐요. 고친 건 저절로 저장돼요.
        </p>
      ) : null}

      {/* 한 줄 요약 (kok-paper: 테마의 노트 종이 무늬) */}
      <section className="kok-card kok-paper p-4">
        <h3 className="mb-1 flex min-h-8 items-center text-sm font-bold text-muted">한 줄 요약</h3>
        {editing ? (
          <EditableRich
            fieldKey="summary"
            value={note.summary}
            placeholder="이 노트를 한 줄로 적어요"
            label="한 줄 요약"
            className="text-[17px] font-semibold leading-relaxed"
            maxLength={1000}
            onCommit={(v) => update((n) => (n.summary === v ? n : { ...n, summary: v, summary_edited: true }))}
          />
        ) : note.summary.trim() ? (
          <p className="text-[17px] font-semibold leading-relaxed">
            <span className="hl-mark">
              <RichText text={note.summary} />
            </span>
          </p>
        ) : (
          <p className="text-[15px] text-muted">{editable ? '고치기를 누르면 이 노트를 한 줄로 적을 수 있어요.' : '요약이 아직 없어요.'}</p>
        )}
      </section>

      {/* 핵심 개념 */}
      <section className="grid gap-3" aria-label="핵심 개념">
        <SectionHead title="핵심 개념" count={note.key_points.length || undefined} />
        {editing ? (
          <div ref={listRef}>
            {ordered.length ? (
              <EditSortable
                items={ordered}
                keys={ordered.map((k) => k.id)}
                label="개념 순서"
                nameOf={(k) => plain(k.title)}
                gripLabel={(k, i) => `${kpCalled(k, i)} 옮기기`}
                gripClass="-mt-1"
                onMove={moveKp}
                render={(kp, i, grip) => editKpCard(kp, i, grip)}
              />
            ) : null}
          </div>
        ) : (
          <div ref={listRef} className="grid gap-3">
            {ordered.map((kp, idx) => readKpCard(kp, idx))}
          </div>
        )}
        {editing ? (
          <AddRow onClick={addKp}>개념 추가</AddRow>
        ) : !note.key_points.length ? (
          <div className="kok-card kok-paper grid justify-items-center gap-1.5 px-5 py-8 text-center">
            <p className="font-display text-lg">아직 개념이 없어요</p>
            <p className="max-w-xs text-sm text-muted">
              {editable ? '외울 개념을 하나씩 적어 보세요. 굵게·형광펜으로 꾸밀 수도 있어요.' : '이 노트에는 개념이 없어요.'}
            </p>
            {editable && onEditMode ? (
              <Button
                className="mt-3"
                onClick={() => {
                  // 누른 순간에 키보드를 붙잡아 둔다 (폰: 고치기 모드가 켜진 뒤 첫 칸으로 옮겨 간다)
                  session.current?.holdKeyboard();
                  pending.current = 'kp';
                  onEditMode(true);
                }}
              >
                첫 개념 적기
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 자료 그림: 개념에 붙지 않은 그림 (개념을 지웠거나 개념 없이 중요한 그림) */}
      {figs.loose.length ? (
        <section className="grid gap-3" aria-label="자료 그림">
          <SectionHead title="자료 그림" count={figs.loose.length} />
          <div className="kok-card kok-paper grid gap-6 p-4">{figs.loose.map(figure)}</div>
        </section>
      ) : null}

      {/* 공식 */}
      {showFormulas ? (
        <section className="grid gap-2.5" aria-label="공식">
          <SectionHead title="공식" count={(editing ? note.formulas.length : readFormulas.length) || undefined} />
          {editing ? (
            <>
              <EditSortable
                items={note.formulas}
                keys={fKeys.keys}
                label="공식 순서"
                nameOf={(f) => plain(f.label) || f.latex}
                gripLabel={(f, i) => `${plain(f.label) || `공식 ${i + 1}`} 옮기기`}
                gripClass="-mt-1"
                onMove={moveFormula}
                className="grid gap-2.5"
                render={(f, i, grip) => {
                  const key = fKeys.keys[i];
                  const name = plain(f.label) || `공식 ${i + 1}`;
                  return (
                    <div className="kok-card is-editing relative p-4 pl-2">
                      <div className="flex items-start gap-1.5">
                        {grip}
                        <div className="min-w-0 flex-1 pl-1 pr-8">
                          <EditableRich
                            single
                            fieldKey={`f:${key}:label`}
                            value={f.label}
                            placeholder="공식 이름 (없어도 돼요)"
                            label={`공식 ${i + 1} 이름`}
                            className="mb-1 text-sm font-semibold text-muted"
                            maxLength={120}
                            onCommit={(t) => setFormula(i, { label: t })}
                          />
                          {openFormula === key ? (
                            <FormulaPanel
                              initial={f.latex}
                              onCommit={(latex) => setFormula(i, { latex })}
                              onClose={() => {
                                setOpenFormula(null);
                                if (!noteRef.current.formulas[i]?.latex.trim()) deleteFormula(i);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              aria-label={`${name} 고치기`}
                              className="kok-field block w-full overflow-x-auto py-1 text-left"
                              onClick={() => setOpenFormula(key)}
                            >
                              {f.latex.trim() ? <Tex tex={f.latex} display /> : <span className="kok-field-placeholder">공식을 적어요</span>}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="absolute right-1.5 top-1.5">
                        <Menu
                          small
                          label={`${name} 메뉴`}
                          items={[
                            ...moveItems(i, note.formulas.length, (to) => moveFormula(i, to)),
                            { label: '공식 지우기', icon: ICONS.trash, danger: true, onSelect: () => deleteFormula(i) },
                          ]}
                        />
                      </div>
                    </div>
                  );
                }}
              />
              <AddRow onClick={addFormula}>공식 추가</AddRow>
            </>
          ) : (
            readFormulas.map((f, i) => (
              <div key={i} className="kok-card p-4">
                {f.label ? (
                  <p className="mb-1 text-sm font-semibold text-muted">
                    <RichText text={f.label} />
                  </p>
                ) : null}
                <div className="overflow-x-auto">
                  <Tex tex={f.latex} display />
                </div>
              </div>
            ))
          )}
        </section>
      ) : null}

      {/* 용어 */}
      {showTerms ? (
        <section className="grid gap-2.5" aria-label="용어">
          <SectionHead title="용어" count={(editing ? note.terms.length : readTerms.length) || undefined} />
          {editing ? (
            <>
              <EditSortable
                items={note.terms}
                keys={tKeys.keys}
                label="용어 순서"
                nameOf={(t) => plain(t.term)}
                gripLabel={(t, i) => `'${plain(t.term) || `용어 ${i + 1}`}' 옮기기`}
                gripClass="-mt-1"
                onMove={moveTerm}
                className="grid gap-2"
                render={(t, i, grip) => {
                  const key = tKeys.keys[i];
                  const name = plain(t.term) || `용어 ${i + 1}`;
                  return (
                    <div className="kok-card is-editing relative flex items-start gap-1.5 py-3 pl-2 pr-10">
                      {grip}
                      <div className="min-w-0 flex-1 pl-1 sm:flex sm:items-start sm:gap-3">
                        <EditableRich
                          single
                          fieldKey={`t:${key}:term`}
                          value={t.term}
                          placeholder="용어"
                          label={`용어 ${i + 1}`}
                          className="font-bold sm:w-36 sm:shrink-0"
                          maxLength={100}
                          onCommit={(v) => setTerm(i, { term: v })}
                        />
                        <EditableRich
                          fieldKey={`t:${key}:meaning`}
                          value={t.meaning}
                          placeholder="뜻을 적어요"
                          label={`용어 ${i + 1} 뜻`}
                          className="mt-0.5 text-[15px] sm:mt-0 sm:min-w-0 sm:flex-1"
                          maxLength={1500}
                          onCommit={(v) => setTerm(i, { meaning: v })}
                        />
                      </div>
                      <div className="absolute right-1.5 top-1.5">
                        <Menu
                          small
                          label={`${name} 메뉴`}
                          items={[
                            ...moveItems(i, note.terms.length, (to) => moveTerm(i, to)),
                            { label: '용어 지우기', icon: ICONS.trash, danger: true, onSelect: () => deleteTerm(i) },
                          ]}
                        />
                      </div>
                    </div>
                  );
                }}
              />
              <AddRow onClick={addTerm}>용어 추가</AddRow>
            </>
          ) : (
            <dl className="divide-y divide-line overflow-hidden kok-card">
              {readTerms.map((t, i) => (
                // 폰: 용어 위, 뜻 아래 (뜻이 좁은 칸에 갇히지 않게). 넓은 화면: 두 칸
                <div key={i} className="px-4 py-3 sm:flex sm:items-start sm:gap-3">
                  <dt className="font-bold sm:w-36 sm:shrink-0">
                    <RichText text={t.term} />
                  </dt>
                  <dd className="mt-0.5 min-w-0 text-[15px] sm:mt-0 sm:flex-1">
                    <RichText text={t.meaning} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ) : null}

      {/* 비어 있는 칸은 여기서 더한다 (고치기 모드) */}
      {editing && (!showFormulas || !showTerms) ? (
        <div className="flex flex-wrap gap-2">
          {!showFormulas ? (
            <button
              type="button"
              className="press inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-3"
              onClick={addFormula}
            >
              <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
              공식 추가
            </button>
          ) : null}
          {!showTerms ? (
            <button
              type="button"
              className="press inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-3"
              onClick={addTerm}
            >
              <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
              용어 추가
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 내가 쓴 글: 확인할 것, AI가 고친 것 */}
      {note.checks.length ? (
        <section className="rounded-2xl border border-warn/40 bg-warn-soft p-4">
          <h3 className="mb-2 font-bold text-warn">한 번 확인해 보세요</h3>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {note.checks.map((c, i) => (
              <li key={i}>
                <RichText text={c.text} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {note.changes.length ? <ChangesCard changes={note.changes} /> : null}

      {editing && undo ? (
        <UndoBar
          text={undo.text}
          onUndo={() => {
            undo.restore();
            setUndo(null);
          }}
          onClose={() => setUndo(null)}
        />
      ) : null}
    </div>
  );

  // 고치기 모드를 켜고 끄는 사이에도 카드는 그대로 둔다 (다시 그리지 않아 보던 자리가 움직이지 않게)
  return (
    <EditSessionProvider root={rootRef} apiRef={session} active={editing}>
      {body}
    </EditSessionProvider>
  );
}

function ChangesCard({ changes }: { changes: Note['changes'] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="kok-card p-4">
      <button type="button" className="flex w-full items-center justify-between text-left font-bold" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        AI가 정리하며 바꾼 것 {changes.length}개<span className="text-sm text-muted">{open ? '접기' : '펼치기'}</span>
      </button>
      {open ? (
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted">
          {changes.map((c, i) => (
            <li key={i}>{c.text}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
