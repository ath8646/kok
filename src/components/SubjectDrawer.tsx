'use client';
// 과목 서랍: 과목이 많을 때 한눈에 찾고 고른다 (자료함·복습 고르기의 '모든 과목').
// 고정한 과목 → 최근 쓴 과목 → 보관한 과목(접어 둠) 차례이고, 과목이 많으면 이름이나 첫 자음('ㄱㅎ')으로 찾는다.
// 자료함(manage)에서는:
// - 과목마다 ⋯ → 같은 시트 안의 '과목 관리': 위에 고정·고정 순서(앞으로·뒤로)·보관·이름 바꾸기·다른 과목과 합치기·
//   여러 과목 고르기·지우기를 설명과 함께 (보관 = 목록에서만 뺀다, 복습은 그대로)
// - 과목을 꾹 누르면 여러 과목 고르기: 아래 띠에서 한꺼번에 위에 고정·보관·지우기
// - '고정한 과목' 옆 '순서 바꾸기'를 켜면 고정한 과목을 꾹 눌러 끌어 차례를 바꾼다 (마우스는 끌기, 키보드는 스페이스·화살표).
//   끄면 꾹 누르기는 다시 여러 과목 고르기다
// - 지우기는 늘 확인 화면을 거친다 (지울 과목과 자료 수, 대신 보관하기)
// 차례 규칙은 src/lib/subject-order.ts
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { drawerGroups } from '@/lib/subject-order';
import { daysUntil } from '@/lib/time';
import { SubjectPickList } from './SubjectPick';
import { useLongPress } from './useLongPress';
import { useReducedMotion } from './useReducedMotion';
import { Button, ICONS, Icon, Sheet, Spinner, cx, inputClass } from './ui';
import { confirmOpen, useConfirm } from './Confirm';
import { josa } from '@/lib/josa';

/** 이만큼 넘으면 찾기 칸을 보인다 */
const SEARCH_FROM = 7;

/** 자료함에서 과목을 관리하는 일 (없는 것은 과목 관리에 보이지 않는다). false 를 돌려주면 하지 못한 것 (고르던 과목을 그대로 둔다) */
export type DrawerManage = {
  /** 위에 고정·고정 풀기 (과목 관리, 여러 과목 고르기). 보관한 과목을 고정하면 보관도 푼다 */
  onPin: (list: SubjectRow[], on: boolean) => Promise<boolean | void> | void;
  /** 보관하기·보관 풀기 */
  onArchive: (list: SubjectRow[], on: boolean) => Promise<boolean | void> | void;
  /** 고정한 과목의 새 차례 (순서 바꾸기를 켜고 꾹 눌러 끌기, 과목 관리의 앞으로·뒤로) */
  onReorder?: (pinnedIds: string[]) => void;
  /** 이름·색·시험 날 바꾸기 (서랍을 닫고 과목 고치기로) */
  onEdit?: (s: SubjectRow) => void;
  /** 다른 과목과 합치기: 끝나면 true (서랍은 부른 쪽이 닫는다) */
  onMerge?: (from: SubjectRow, into: SubjectRow) => Promise<boolean>;
  /** 과목 지우기 (서랍의 확인 화면에서 누른 뒤). 하나 지울 때마다 progress(지운 수). 모두 지웠으면 true */
  onDelete?: (list: SubjectRow[], progress: (done: number) => void) => Promise<boolean>;
};

type View =
  | { kind: 'list' }
  | { kind: 'subject'; id: string }
  | { kind: 'merge'; id: string }
  /** 지우기 확인. from: 돌아갈 곳 (여러 과목 고르기 목록 / 그 과목의 과목 관리) */
  | { kind: 'delete'; ids: string[]; from: 'list' | 'subject' };

/** 순서 바꾸기에서 칸을 잡는 손잡이 (dnd-kit: 칸 전체가 손잡이) */
type SortHandle = { ref: (el: HTMLElement | null) => void; props: Record<string, unknown> };

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 진동이 없는 기기 */
  }
}

export function SubjectDrawer({
  open,
  onClose,
  subjects,
  selected,
  onPick,
  counts,
  countLabel = (n) => `자료 ${n}`,
  all,
  manage,
  currentLabel = '보는 중',
}: {
  open: boolean;
  onClose: () => void;
  /** 보일 과목 (보관한 과목도 넣으면 맨 아래 접힌 묶음에) */
  subjects: SubjectRow[];
  /** 지금 고른 과목 (null = 전체) */
  selected: string | null;
  onPick: (id: string | null) => void;
  counts?: Map<string, number>;
  countLabel?: (n: number) => string;
  /** '전체' 칸 (없으면 안 보인다) */
  all?: { label: string; count?: number };
  /** 자료함: 과목 관리 (위에 고정·보관·순서·고치기·합치기·지우기, 여러 과목 고르기) */
  manage?: DrawerManage;
  /** 고른 칸에 붙는 말 (자료함 '보는 중', 복습 '고름') */
  currentLabel?: string;
}) {
  const ask = useConfirm();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [target, setTarget] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  /** '순서 바꾸기' 스위치 */
  const [reordering, setReordering] = useState(false);
  /** 여러 과목 고르기 (null = 고르는 중이 아님) */
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<null | 'pin' | 'archive' | 'delete'>(null);
  const [progress, setProgress] = useState(0);
  /** 순서 바꾸기 알림을 넣을 곳 (시트 안) */
  const [liveEl, setLiveEl] = useState<HTMLDivElement | null>(null);

  // 열 때마다 처음 모습으로 (찾던 글·펼친 보관 묶음·고르던 과목·순서 바꾸기 없이). 닫을 때 지우면 닫히는 동안
  // 화면이 바뀌어서, 다시 열 때 지운다 (부른 쪽이 서랍을 바로 닫아도: 과목 고치기로 갈 때)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setShowArchived(false);
      setView({ kind: 'list' });
      setTarget(null);
      setReordering(false);
      setPicked(null);
    }
  }

  const groups = useMemo(() => drawerGroups(subjects, query), [subjects, query]);
  const full = useMemo(() => drawerGroups(subjects), [subjects]);
  /** 서랍에 보이는 차례 그대로 (고정 → 최근 → 보관) */
  const ordered = useMemo(() => [...full.pinned, ...full.recent, ...full.archived], [full]);
  const allPinned = full.pinned;
  const archivedAll = full.archived.length;
  const searching = !!query.trim();
  // 찾는 중이면 보관한 과목도 펼쳐서 보인다
  const archivedOpen = showArchived || searching;
  const nothing = !groups.pinned.length && !groups.recent.length && !groups.archived.length;
  const selecting = !!manage && picked !== null;
  const pickedSet = new Set(picked ?? []);
  const pickedRows = ordered.filter((s) => pickedSet.has(s.id));
  // 순서 바꾸기: 고정한 과목이 둘 이상이고, 찾는 중(일부만 보임)·고르는 중이 아닐 때
  const canReorder = !!manage?.onReorder && !searching && !selecting && groups.pinned.length > 1;
  const sorting = reordering && canReorder;

  // 보던 과목이 없어졌으면(합침·지움) 목록으로
  const viewId = view.kind === 'subject' || view.kind === 'merge' ? view.id : null;
  const current = viewId ? (subjects.find((s) => s.id === viewId) ?? null) : null;
  const deleteIds = view.kind === 'delete' ? view.ids : null;
  const deleteRows = deleteIds ? ordered.filter((s) => deleteIds.includes(s.id)) : [];
  const shown: View = view.kind === 'list' || current || deleteRows.length ? view : { kind: 'list' };
  const viewKey = shown.kind === 'list' ? 'list' : shown.kind === 'delete' ? `delete:${shown.ids.join(',')}` : `${shown.kind}:${shown.id}`;

  const close = () => {
    if (merging || busy) return;
    // 키보드로 든 칸이 있으면 먼저 내려놓는다 (dnd-kit 이 키보드 듣기를 떼게)
    cancelDrag();
    onClose();
  };
  const pick = (id: string | null) => {
    onPick(id);
    onClose();
  };

  // 키보드 초점: 다른 화면으로 들어가면 '뒤로'에, 할 일을 마치거나 돌아오면 정해 둔 곳(그 과목의 ⋯, 스위치, 바뀐 줄 …)에 둔다
  // (누른 단추가 사라지면 초점이 화면 맨 처음으로 가 버리니까)
  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<string | null>(null);
  const focusedView = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const focusSoon = (sel: string) => {
    refocus.current = sel;
    setFocusTick((t) => t + 1);
  };
  useEffect(() => {
    if (!open) {
      focusedView.current = null;
      return;
    }
    const sel = refocus.current;
    if (sel) {
      refocus.current = null;
      // 아래 띠(시트 footer)의 단추도 찾게 시트 전체에서
      const root = rootRef.current?.closest('[role="dialog"]') ?? rootRef.current;
      const el = root?.querySelector<HTMLElement>(sel);
      if (el) {
        focusedView.current = viewKey;
        el.focus();
        return;
      }
    }
    if (viewKey !== 'list' && focusedView.current !== viewKey) backRef.current?.focus();
    focusedView.current = viewKey;
  }, [open, viewKey, selecting, sorting, focusTick]);

  const startSelect = (id: string) => {
    setReordering(false);
    setPicked([id]);
  };
  const togglePick = (id: string) => setPicked((cur) => ((cur ?? []).includes(id) ? (cur ?? []).filter((x) => x !== id) : [...(cur ?? []), id]));
  const endSelect = () => {
    // 끝내기 단추가 사라지니 고르던 첫 과목 칸(없으면 첫 칸)에 초점을 둔다
    refocus.current = pickedRows[0] ? `[data-tile="${pickedRows[0].id}"]` : '[data-tile]';
    setPicked(null);
  };

  const back = () => {
    if (shown.kind === 'merge') {
      setTarget(null);
      setView({ kind: 'subject', id: shown.id });
      return;
    }
    if (shown.kind === 'delete') {
      const one = shown.ids.length === 1 ? shown.ids[0] : null;
      if (shown.from === 'subject' && one && subjects.some((s) => s.id === one)) {
        setView({ kind: 'subject', id: one });
        return;
      }
      refocus.current = '[data-select-delete]';
      setView({ kind: 'list' });
      return;
    }
    // 과목 번호는 uuid 라 따옴표 안에 그대로 써도 된다
    if (shown.kind === 'subject') refocus.current = `[data-manage="${shown.id}"]`;
    setView({ kind: 'list' });
  };

  // Esc: 다른 화면이면 한 단계 뒤로, 순서 바꾸기·고르기 중이면 그것만 끈다 (시트가 닫히기 전에 창의 capture 단계에서 먼저 받는다).
  // 끄는 중이면 dnd-kit 이 끌기를 그만두게 그대로 보내고, 시트는 닫지 않게 표시만 한다 (preventDefault)
  const draggingRef = useRef(false);
  /**
   * 키보드로 든 칸을 내려놓게 한다 (dnd-kit 6 은 끄는 중에 칸이 사라지거나 시트가 닫혀도 문서의 키 듣기를 떼지 않아서,
   * 그대로 두면 다른 곳의 스페이스·화살표를 먹는다). 놓기 대신 Esc 를 보내 그만두게 한다
   */
  const cancelDrag = () => {
    if (!draggingRef.current) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    draggingRef.current = false;
  };
  const escRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    escRef.current = (e: KeyboardEvent) => {
      if (draggingRef.current) {
        e.preventDefault();
        return;
      }
      if (merging || busy) {
        e.stopPropagation();
        return;
      }
      if (shown.kind !== 'list') {
        e.stopPropagation();
        back();
        return;
      }
      if (sorting) {
        e.stopPropagation();
        refocus.current = '[data-reorder-switch]';
        setReordering(false);
        return;
      }
      if (selecting) {
        e.stopPropagation();
        endSelect();
      }
    };
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 확인 창이 떠 있으면 그 창만 닫는다 (서랍은 한 단계 뒤로 가지 않는다)
      if (e.key === 'Escape' && !confirmOpen()) escRef.current(e);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  /** 고정한 과목 차례를 바꾼다 (from 자리의 과목을 to 자리로) */
  const movePinned = (from: number, to: number) => {
    if (!manage?.onReorder || from === to || from < 0 || to < 0 || to >= allPinned.length) return;
    manage.onReorder(arrayMove(allPinned, from, to).map((s) => s.id));
  };

  /** 고른 과목을 한꺼번에 위에 고정·보관 (다 되면 고르기를 끝낸다) */
  const allPinnedPicked = pickedRows.length > 0 && pickedRows.every((s) => s.pinned && !s.archived);
  const allArchivedPicked = pickedRows.length > 0 && pickedRows.every((s) => s.archived);
  const runBulk = async (kind: 'pin' | 'archive') => {
    if (!manage || !pickedRows.length || busy) return;
    setBusy(kind);
    try {
      const first = pickedRows[0];
      const r = kind === 'pin' ? await manage.onPin(pickedRows, !allPinnedPicked) : await manage.onArchive(pickedRows, !allArchivedPicked);
      if (r !== false) {
        if (kind === 'archive' && !allArchivedPicked) setShowArchived(true);
        setPicked(null);
        focusSoon(`[data-tile="${first.id}"]`);
      }
    } finally {
      setBusy(null);
    }
  };

  const tileFor = (s: SubjectRow, sortHandle?: SortHandle) => (
    <SubjectTile
      s={s}
      mode={sortHandle ? 'sort' : selecting ? 'select' : 'open'}
      current={selected === s.id}
      picked={pickedSet.has(s.id)}
      // 수를 주면 없는 과목은 0 (칸 높이가 고르게)
      count={counts ? (counts.get(s.id) ?? 0) : undefined}
      countLabel={countLabel}
      currentLabel={currentLabel}
      onOpen={() => pick(s.id)}
      onManage={manage ? () => setView({ kind: 'subject', id: s.id }) : undefined}
      onLongPress={manage ? () => (selecting ? togglePick(s.id) : startSelect(s.id)) : undefined}
      onToggle={() => togglePick(s.id)}
      sortHandle={sortHandle}
    />
  );

  // 순서 바꾸는 동안 다른 것은 흐리게, 누를 수 없게 (고정한 과목만 옮긴다)
  const quiet = sorting ? 'pointer-events-none opacity-40 transition-opacity duration-200' : 'transition-opacity duration-200';

  const section = (title: string, list: SubjectRow[], id: string) =>
    list.length ? (
      <section className={cx('grid gap-2', quiet)} aria-labelledby={id} inert={sorting || undefined}>
        <h3 id={id} className="text-xs font-bold text-muted">
          {title}
        </h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((s) => (
            <li key={s.id} className="relative min-w-0">
              {tileFor(s)}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  // 고정한 과목: '순서 바꾸기'를 켜면 꾹 눌러(마우스는 끌어서, 키보드는 스페이스·화살표) 차례를 바꾼다
  const pinnedSection = groups.pinned.length ? (
    <section className="grid gap-2" aria-labelledby="drawer-pinned">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 id="drawer-pinned" className="text-xs font-bold text-muted">
          고정한 과목
        </h3>
        {canReorder ? (
          <button
            type="button"
            role="switch"
            aria-checked={sorting}
            data-reorder-switch=""
            onClick={() => {
              cancelDrag();
              setReordering((v) => !v);
            }}
            className="press -my-1 inline-flex shrink-0 items-center gap-2 rounded-full py-1 pl-2.5 pr-1 text-xs font-bold text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Icon d={ICONS.reorder} size={14} strokeWidth={2.2} />
            순서 바꾸기
            <span
              aria-hidden="true"
              className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200', sorting ? 'bg-fab' : 'bg-surface-3')}
            >
              <span
                className={cx('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200', sorting && 'translate-x-4')}
              />
            </span>
          </button>
        ) : null}
      </div>
      {sorting ? (
        <>
          <p className="kok-appear -mt-1 text-xs text-muted" role="status">
            꾹 눌러 끌면 순서가 바뀌어요
          </p>
          <PinnedGrid
            list={groups.pinned}
            onReorder={(ids) => manage?.onReorder?.(ids)}
            onDragging={(v) => {
              draggingRef.current = v;
            }}
            renderTile={tileFor}
            liveEl={liveEl}
          />
          {/* 끌기 안내·알림을 시트(aria-modal) 안에 둔다: 시트 밖(body)에 두면 화면 읽기 프로그램이 건너뛸 수 있다 */}
          <div ref={setLiveEl} />
        </>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {groups.pinned.map((s) => (
            <li key={s.id} className="relative min-w-0">
              {tileFor(s)}
            </li>
          ))}
        </ul>
      )}
    </section>
  ) : null;

  let body: ReactNode = (
    <div className="grid gap-4">
      {selecting ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold" aria-live="polite">
            {pickedRows.length ? `과목 ${pickedRows.length}개를 골랐어요` : '정리할 과목을 눌러 골라요'}
          </p>
          <Button size="sm" variant="secondary" onClick={endSelect} disabled={!!busy}>
            끝내기
          </Button>
        </div>
      ) : manage ? (
        <p className={cx('text-xs leading-relaxed text-muted', quiet)} inert={sorting || undefined}>
          과목의 <Icon d={ICONS.more} size={13} strokeWidth={3} className="inline align-[-2px]" />를 누르면 고정·보관·합치기를 할 수 있어요. 과목을 꾹 누르면
          여러 개를 골라 한꺼번에 지울 수 있어요.
        </p>
      ) : null}
      {/* 찾던 글이 남아 있으면 과목이 줄어도 칸을 둔다 (지울 수 있게) */}
      {subjects.length >= SEARCH_FROM || query ? (
        <input
          type="search"
          className={cx(inputClass, quiet)}
          inert={sorting || undefined}
          placeholder="과목 찾기 (첫 글자 ㄱㅎ처럼도 돼요)"
          aria-label="과목 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {all && !searching && !selecting ? (
        <button
          type="button"
          inert={sorting || undefined}
          aria-current={selected === null ? 'true' : undefined}
          onClick={() => pick(null)}
          className={cx(
            'press flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-[15px] font-semibold',
            selected === null ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent)]' : 'bg-surface-2 hover:bg-surface-3',
            quiet,
          )}
        >
          {all.label}
          {typeof all.count === 'number' ? <span className="text-sm tabular-nums text-muted">{countLabel(all.count)}</span> : null}
        </button>
      ) : null}
      {pinnedSection}
      {section(groups.pinned.length ? '최근 쓴 과목' : '과목 (최근 쓴 차례)', groups.recent, 'drawer-recent')}
      {archivedAll ? (
        <div className={cx('grid gap-2', quiet)} inert={sorting || undefined}>
          {!searching ? (
            <button
              type="button"
              aria-expanded={archivedOpen}
              onClick={() => setShowArchived((v) => !v)}
              className="press flex items-center gap-1.5 justify-self-start rounded-full px-1 py-1 text-xs font-bold text-muted hover:text-ink"
            >
              <Icon d={ICONS.archive} size={14} strokeWidth={2.2} />
              보관한 과목 {archivedAll}개
              <Icon d={ICONS.chevronDown} size={14} strokeWidth={2.4} className={cx('transition-transform duration-200', archivedOpen && 'rotate-180')} />
            </button>
          ) : null}
          {archivedOpen && groups.archived.length ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="보관한 과목">
              {groups.archived.map((s) => (
                <li key={s.id} className="relative min-w-0">
                  {tileFor(s)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {nothing ? <p className="py-6 text-center text-sm text-muted">{searching ? `‘${query.trim()}’에 맞는 과목이 없어요.` : '과목이 없어요.'}</p> : null}
    </div>
  );
  let footer: ReactNode = undefined;
  if (selecting && shown.kind === 'list') {
    const off = !pickedRows.length || !!busy;
    footer = (
      <div
        role="toolbar"
        aria-label={`고른 과목 ${pickedRows.length}개`}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${manage?.onDelete ? 3 : 2}, minmax(0, 1fr))` }}
      >
        <ToolAction
          icon={allPinnedPicked ? ICONS.unpin : ICONS.pin}
          label={allPinnedPicked ? '고정 풀기' : '위에 고정'}
          disabled={off}
          busy={busy === 'pin'}
          onClick={() => runBulk('pin')}
        />
        <ToolAction
          icon={allArchivedPicked ? ICONS.unarchive : ICONS.archive}
          label={allArchivedPicked ? '보관 풀기' : '보관하기'}
          disabled={off}
          busy={busy === 'archive'}
          onClick={() => runBulk('archive')}
        />
        {manage?.onDelete ? (
          <ToolAction
            icon={ICONS.trash}
            label="지우기"
            danger
            marker
            disabled={off}
            busy={false}
            onClick={() => setView({ kind: 'delete', ids: pickedRows.map((s) => s.id), from: 'list' })}
          />
        ) : null}
      </div>
    );
  }

  if (current && manage && shown.kind === 'subject') {
    const s = current;
    const n = counts?.get(s.id) ?? 0;
    const d = s.exam_date ? daysUntil(s.exam_date) : null;
    const at = allPinned.findIndex((x) => x.id === s.id);
    const meta = [
      `자료 ${n}개`,
      d !== null && d >= 0 ? (d === 0 ? '시험 D-DAY' : `시험 D-${d}`) : '',
      s.archived ? '보관한 과목' : s.pinned ? '위에 고정함' : '',
    ].filter(Boolean);
    const first = at <= 0;
    const last = at >= allPinned.length - 1;
    body = (
      <div className="kok-appear grid gap-4">
        <BackButton ref={backRef} onClick={back} label="모든 과목" />
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl">{s.name}</h3>
            <p className="text-sm text-muted">{meta.join(' · ')}</p>
          </div>
        </div>
        <Button className="w-full" onClick={() => pick(s.id)}>
          이 과목 열기
        </Button>
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-surface-2">
          {s.archived ? (
            <ActionRow
              icon={ICONS.unarchive}
              title="보관 풀기"
              desc="자료함 목록과 과목 칩에 다시 보여요"
              action="unarchive"
              onClick={() => {
                manage.onArchive([s], false);
                focusSoon('[data-action="archive"]');
              }}
            />
          ) : (
            <>
              <ActionRow
                icon={s.pinned ? ICONS.unpin : ICONS.pin}
                title={s.pinned ? '고정 풀기' : '위에 고정'}
                desc={s.pinned ? '최근 쓴 차례로 돌아가요' : '과목 칩 줄 맨 앞에 늘 보여요'}
                onClick={() => manage.onPin([s], !s.pinned)}
              />
              {s.pinned && at >= 0 && allPinned.length > 1 && manage.onReorder ? (
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink" aria-hidden="true">
                    <Icon d={ICONS.reorder} size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">고정 순서</span>
                    <span className="block text-xs text-muted" aria-live="polite">
                      고정한 과목 {allPinned.length}개 중 {at + 1}번째
                    </span>
                  </span>
                  {/* 끝에 닿아도 disabled 로 바꾸지 않는다: 누른 단추에 초점이 그대로 남게 (aria-disabled) */}
                  <button
                    type="button"
                    aria-label="앞으로 옮기기"
                    title="앞으로"
                    aria-disabled={first}
                    onClick={() => {
                      if (!first) movePinned(at, at - 1);
                    }}
                    className={cx(
                      'press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink hover:bg-surface-3',
                      first && 'cursor-default opacity-35',
                    )}
                  >
                    <Icon d={ICONS.back} size={18} strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    aria-label="뒤로 옮기기"
                    title="뒤로"
                    aria-disabled={last}
                    onClick={() => {
                      if (!last) movePinned(at, at + 1);
                    }}
                    className={cx(
                      'press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink hover:bg-surface-3',
                      last && 'cursor-default opacity-35',
                    )}
                  >
                    <Icon d={ICONS.forward} size={18} strokeWidth={2.2} />
                  </button>
                </div>
              ) : null}
              <ActionRow
                icon={ICONS.archive}
                title="보관하기"
                desc="다 끝난 과목을 목록에서 빼요. 복습은 그대로 나와요"
                action="archive"
                onClick={() => {
                  setShowArchived(true);
                  manage.onArchive([s], true);
                  focusSoon('[data-action="unarchive"]');
                }}
              />
            </>
          )}
          {manage.onEdit ? (
            <ActionRow icon={ICONS.edit} title="이름·색·시험 날 바꾸기" desc="과목 정보를 고쳐요" chevron onClick={() => manage.onEdit?.(s)} />
          ) : null}
          {manage.onMerge && subjects.length > 1 ? (
            <ActionRow
              icon={ICONS.merge}
              title="다른 과목과 합치기"
              desc="자료·노트·문제·복습 기록을 한 과목으로 모아요"
              chevron
              onClick={() => {
                setTarget(null);
                setView({ kind: 'merge', id: s.id });
              }}
            />
          ) : null}
          {subjects.length > 1 ? (
            <ActionRow
              icon={ICONS.select}
              title="여러 과목 고르기"
              desc="이 과목부터 골라서 한꺼번에 고정·보관·지워요"
              onClick={() => {
                refocus.current = `[data-tile="${s.id}"]`;
                startSelect(s.id);
                setView({ kind: 'list' });
              }}
            />
          ) : null}
        </div>
        {manage.onDelete ? (
          <div className="overflow-hidden rounded-2xl bg-surface-2">
            <ActionRow
              icon={ICONS.trash}
              title="과목 지우기"
              desc="자료·노트·문제·복습 기록까지 모두 지워져요"
              danger
              chevron
              onClick={() => setView({ kind: 'delete', ids: [s.id], from: 'subject' })}
            />
          </div>
        ) : null}
      </div>
    );
  } else if (current && manage?.onMerge && shown.kind === 'merge') {
    const s = current;
    const n = counts?.get(s.id) ?? 0;
    const into = subjects.find((x) => x.id === target) ?? null;
    const onMerge = manage.onMerge;
    body = (
      <div className="kok-appear grid gap-4">
        <BackButton ref={backRef} onClick={back} label={s.name} disabled={merging} />
        <div className="grid gap-1">
          <h3 className="font-display text-lg leading-snug">&lsquo;{s.name}&rsquo; 과목을 어느 과목으로 합칠까요?</h3>
          <p className="text-sm leading-relaxed text-muted">
            고른 과목으로 자료 {n}개와 노트·문제·복습 기록을 모두 옮기고, &lsquo;{s.name}&rsquo; 과목은 없어져요. 고른 과목의 이름과 색은 그대로예요.
          </p>
        </div>
        <SubjectPickList subjects={subjects} exclude={[s.id]} value={target} onChange={setTarget} counts={counts} label="합칠 과목" />
      </div>
    );
    footer = (
      <Button
        className="w-full"
        disabled={!into}
        busy={merging}
        onClick={async () => {
          if (!into) return;
          if (
            !(await ask({
              title: '과목 합치기',
              body: `'${s.name}' 과목의 자료 ${n}개와 복습 기록을 ${josa(`'${into.name}' 과목`, '으로')} 옮기고 '${s.name}' 과목을 없앨까요?`,
              note: '되돌릴 수 없어요.',
              ok: '합치기',
              danger: true,
            }))
          )
            return;
          setMerging(true);
          try {
            if (await onMerge(s, into)) {
              setView({ kind: 'list' });
              setTarget(null);
            }
          } finally {
            setMerging(false);
          }
        }}
      >
        {into ? `'${into.name}' 과목으로 합치기` : '합칠 과목을 골라 주세요'}
      </Button>
    );
  } else if (manage?.onDelete && shown.kind === 'delete' && deleteRows.length) {
    // 지우기 확인: 무엇이 지워지는지(과목·자료 수) 보이고, 다 끝난 과목이면 보관을 권한다
    const rows = deleteRows;
    const total = rows.reduce((n, s) => n + (counts?.get(s.id) ?? 0), 0);
    const one = rows.length === 1 ? rows[0] : null;
    const archivable = rows.filter((s) => !s.archived);
    const onDelete = manage.onDelete;
    body = (
      <div className="kok-appear grid gap-4">
        <BackButton ref={backRef} onClick={back} label={shown.from === 'subject' && one ? one.name : '과목 고르기'} disabled={!!busy} />
        <div className="grid gap-1">
          <h3 className="break-keep font-display text-lg leading-snug">{one ? `‘${one.name}’ 과목을 지울까요?` : `과목 ${rows.length}개를 지울까요?`}</h3>
          <p className="break-keep text-sm leading-relaxed text-muted">
            {counts ? `과목 안의 자료 ${total}개와 ` : '과목 안의 자료와 '}노트·문제·복습 기록이 모두 지워져요. 되돌릴 수 없어요.
          </p>
        </div>
        <ul className="grid gap-1.5" aria-label="지울 과목">
          {rows.map((s) => (
            <li key={s.id} className="flex min-h-12 items-center gap-3 rounded-2xl bg-surface-2 px-4 py-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{s.name}</span>
              {counts ? <span className="shrink-0 text-xs tabular-nums text-muted">자료 {counts.get(s.id) ?? 0}개</span> : null}
            </li>
          ))}
        </ul>
        {archivable.length ? (
          <div className="flex items-start gap-3 rounded-2xl border border-line p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink" aria-hidden="true">
              <Icon d={ICONS.archive} size={19} />
            </span>
            <div className="grid min-w-0 gap-2.5">
              <p className="break-keep text-sm leading-relaxed">다 끝난 과목이면 지우지 말고 보관해 보세요. 목록에서만 빠지고, 복습은 그대로 나와요.</p>
              <Button
                size="sm"
                variant="secondary"
                className="justify-self-start"
                busy={busy === 'archive'}
                disabled={!!busy}
                onClick={async () => {
                  setBusy('archive');
                  try {
                    const r = await manage.onArchive(archivable, true);
                    if (r !== false) {
                      setShowArchived(true);
                      setPicked(null);
                      refocus.current = `[data-tile="${archivable[0].id}"]`;
                      setView({ kind: 'list' });
                    }
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                대신 보관하기
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
    footer = (
      <Button
        className="w-full"
        variant="danger"
        busy={busy === 'delete'}
        disabled={!!busy && busy !== 'delete'}
        onClick={async () => {
          if (busy) return;
          setBusy('delete');
          setProgress(0);
          try {
            if (await onDelete(rows, setProgress)) {
              setPicked(null);
              refocus.current = '[data-tile], input[type="search"]';
              setView({ kind: 'list' });
            }
          } finally {
            setBusy(null);
          }
        }}
      >
        {busy === 'delete' && rows.length > 1 ? `지우는 중 (${progress}/${rows.length})` : one ? '과목 지우기' : `과목 ${rows.length}개 지우기`}
      </Button>
    );
  }

  const title =
    shown.kind === 'subject'
      ? '과목 관리'
      : shown.kind === 'merge'
        ? '과목 합치기'
        : shown.kind === 'delete'
          ? '과목 지우기'
          : selecting
            ? '과목 고르기'
            : '모든 과목';
  return (
    <Sheet open={open} onClose={close} title={title} footer={footer}>
      <div ref={rootRef}>{body}</div>
    </Sheet>
  );
}

/** 과목 칸 하나. open: 누르면 그 과목 / select: 누르면 고르기 / sort: 꾹 눌러 끌어 차례 바꾸기 (칸 전체가 손잡이) */
function SubjectTile({
  s,
  mode,
  current,
  picked,
  count,
  countLabel,
  currentLabel,
  onOpen,
  onManage,
  onLongPress,
  onToggle,
  sortHandle,
}: {
  s: SubjectRow;
  mode: 'open' | 'select' | 'sort';
  /** 지금 보는 과목 */
  current: boolean;
  picked: boolean;
  count?: number;
  countLabel: (n: number) => string;
  currentLabel: string;
  onOpen: () => void;
  /** 과목 관리 열기 (없으면 ⋯ 이 없다) */
  onManage?: () => void;
  /** 꾹 누르기 (없으면 꾹 누르기를 쓰지 않는다) */
  onLongPress?: () => void;
  onToggle: () => void;
  sortHandle?: SortHandle;
}) {
  const sort = mode === 'sort';
  const select = mode === 'select';
  const press = useLongPress(() => onLongPress?.(), !!onLongPress && !sort);
  const d = s.exam_date ? daysUntil(s.exam_date) : null;
  const on = select ? picked : current && !sort;
  return (
    <>
      <button
        type="button"
        ref={sortHandle?.ref}
        {...(sortHandle?.props ?? {})}
        {...(onLongPress && !sort ? press : {})}
        data-tile={s.id}
        {...(select ? { role: 'checkbox' as const, 'aria-checked': picked } : {})}
        aria-current={!select && !sort && current ? 'true' : undefined}
        onClick={() => {
          if (sort) return;
          if (select) onToggle();
          else onOpen();
        }}
        className={cx(
          'press relative grid w-full min-w-0 gap-1 rounded-2xl p-3 text-left',
          (onManage || select || sort) && 'pr-10',
          onLongPress && 'kok-no-callout',
          sort && 'cursor-grab',
          // 고른 칸·보는 칸은 카드 색 + 포인트 테두리 (흐린 글자·D-day 가 늘 읽히는 바탕)
          on ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent)]' : 'bg-surface-2 hover:bg-surface-3',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
          <span className="min-w-0 truncate text-[15px] font-semibold">{s.name}</span>
          {s.pinned && !s.archived ? (
            <span className="shrink-0 text-muted" title="위에 고정">
              <Icon d={ICONS.pin} size={13} strokeWidth={2.2} />
              <span className="sr-only">(고정)</span>
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {typeof count === 'number' ? <span className="tabular-nums">{countLabel(count)}</span> : null}
          {d !== null && d >= 0 && d <= 30 ? <span className="font-bold text-bad">{d === 0 ? 'D-DAY' : `D-${d}`}</span> : null}
          {current && !select && !sort ? (
            <span className="ml-auto font-semibold text-accent">
              <Icon d={ICONS.check} size={14} strokeWidth={2.8} className="inline" /> {currentLabel}
            </span>
          ) : null}
        </span>
      </button>
      {select ? (
        // 고르기 동그라미 (오른쪽 위, ⋯ 자리): 고르면 채워지며 체크가 톡
        <span
          className={cx(
            'kok-appear pointer-events-none absolute right-2.5 top-2.5 z-10 grid h-6 w-6 place-items-center rounded-full transition-colors duration-150',
            picked ? 'bg-accent text-accent-ink' : 'bg-surface/90 ring-2 ring-inset ring-line',
          )}
          aria-hidden="true"
        >
          {picked ? <Icon key="on" d={ICONS.check} size={14} strokeWidth={3} className="kok-check-in" /> : null}
        </span>
      ) : sort ? (
        // 잡는 곳 표시 (칸 어디를 잡아도 된다)
        <span className="kok-appear pointer-events-none absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center text-muted" aria-hidden="true">
          <Icon d={ICONS.grip} size={18} strokeWidth={3} />
        </span>
      ) : onManage ? (
        <button
          type="button"
          data-manage={s.id}
          aria-label={`'${s.name}' 과목 관리`}
          title="과목 관리"
          onClick={onManage}
          className="press absolute right-1 top-1 z-10 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
        >
          <Icon d={ICONS.more} size={18} strokeWidth={3} />
        </button>
      ) : null}
    </>
  );
}

/** 과목 관리·합치기·지우기의 '뒤로' (위 왼쪽) */
function BackButton({ ref, onClick, label, disabled }: { ref: Ref<HTMLButtonElement>; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="press inline-flex min-w-0 max-w-full items-center gap-1 justify-self-start rounded-full py-1 pl-1 pr-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
    >
      <Icon d={ICONS.back} size={18} strokeWidth={2.2} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** 과목 관리의 한 줄: 아이콘 + 할 일 + 한 줄 설명 (다음 화면으로 가는 줄은 오른쪽 꺾쇠) */
function ActionRow({
  icon,
  title,
  desc,
  onClick,
  chevron,
  danger,
  action,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
  chevron?: boolean;
  danger?: boolean;
  /** 이 줄을 찾는 이름 (눌러서 줄이 바뀌면 바뀐 줄에 초점을 둔다) */
  action?: string;
}) {
  return (
    <button type="button" data-action={action} onClick={onClick} className="press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-3">
      <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full', danger ? 'bg-bad-soft text-bad' : 'bg-surface text-ink')} aria-hidden="true">
        <Icon d={icon} size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block text-[15px] font-semibold', danger ? 'text-bad' : 'text-ink')}>{title}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
      {chevron ? <Icon d={ICONS.chevronRight} size={18} strokeWidth={2.2} className="shrink-0 text-muted" /> : null}
    </button>
  );
}

/** 여러 과목 고르기의 아래 띠 단추 (자료함 고르기 띠와 같은 모양: 아이콘 위, 글 아래) */
function ToolAction({
  icon,
  label,
  onClick,
  disabled,
  busy,
  danger,
  marker,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  danger?: boolean;
  /** 지우기 확인에서 돌아오면 이 단추에 초점을 둔다 */
  marker?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-select-delete={marker ? '' : undefined}
      className={cx(
        'press flex flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[12px] font-semibold transition-opacity hover:bg-surface-2 disabled:opacity-40',
        danger ? 'text-bad' : 'text-ink',
      )}
    >
      <span className="grid h-6 place-items-center">{busy ? <Spinner /> : <Icon d={icon} size={22} />}</span>
      {label}
    </button>
  );
}

/**
 * 순서 바꾸기를 켰을 때의 고정한 과목: 꾹 누르면(손가락 0.25초, 마우스는 조금 끌면) 들려서 옮길 수 있다.
 * 키보드는 칸에서 스페이스(엔터)로 들고 화살표로 옮긴 뒤 다시 스페이스로 놓는다 (과목 관리의 앞으로·뒤로도 있다)
 */
function PinnedGrid({
  list,
  onReorder,
  onDragging,
  renderTile,
  liveEl,
}: {
  list: SubjectRow[];
  onReorder: (ids: string[]) => void;
  /** 끄는 중인지 (Esc 를 끌기 그만두기로 남겨 둔다) */
  onDragging: (on: boolean) => void;
  renderTile: (s: SubjectRow, handle: SortHandle) => ReactNode;
  /** 끌기 안내·알림을 넣을 곳 (시트 안) */
  liveEl: HTMLElement | null;
}) {
  // 끄는 중에 이 칸들이 사라지면(시트를 닫음 등) 끌기를 그만두게 한다: dnd-kit 6 은 키보드 듣기를 스스로 떼지 않는다
  const activeRef = useRef(false);
  useEffect(
    () => () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    },
    [],
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = list.map((s) => s.id);
  const nameOf = (id: UniqueIdentifier) => `'${list.find((s) => s.id === id)?.name ?? '과목'}'`;
  const at = (id: UniqueIdentifier) => ids.indexOf(String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} 들었어요. 지금 ${at(active.id) + 1}번째예요.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)}: ${at(over.id) + 1}번째 자리예요.` : `${nameOf(active.id)}: 목록 밖이에요.`),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} ${at(over.id) + 1}번째에 놓았어요.` : `${nameOf(active.id)} 제자리에 놓았어요.`),
    onDragCancel: ({ active }) => `${nameOf(active.id)} 옮기기를 그만뒀어요.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    activeRef.current = false;
    onDragging(false);
    if (!over || active.id === over.id) return;
    const from = at(active.id);
    const to = at(over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
    buzz(8);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => {
        activeRef.current = true;
        onDragging(true);
        buzz(12);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        activeRef.current = false;
        onDragging(false);
      }}
      accessibility={{
        container: liveEl ?? undefined,
        announcements,
        screenReaderInstructions: {
          draggable:
            '꾹 누른 채 끌면 순서가 바뀌어요. 키보드는 스페이스나 엔터로 들고, 화살표로 옮긴 뒤 다시 스페이스나 엔터로 놓아요. Esc 를 누르면 그만둬요.',
        },
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((s) => (
            <PinnedTile key={s.id} id={s.id}>
              {(handle) => renderTile(s, handle)}
            </PinnedTile>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function PinnedTile({ id, children }: { id: string; children: (handle: SortHandle) => ReactNode }) {
  const reduced = useReducedMotion();
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    transition: reduced ? null : { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    attributes: { roleDescription: '순서를 바꿀 수 있는 과목' },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: reduced ? undefined : transition }}
      className={cx('kok-drag-tile relative min-w-0', isDragging && 'is-dragging')}
    >
      {children({ ref: setActivatorNodeRef, props: { ...attributes, ...listeners } })}
    </li>
  );
}
