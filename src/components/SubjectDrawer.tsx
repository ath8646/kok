'use client';
// 과목 서랍: 과목이 많을 때 한눈에 찾고 고른다 (자료함·복습 고르기의 '모든 과목').
// 고정한 과목 → 최근 쓴 과목 → 보관한 과목(접어 둠) 차례이고, 과목이 많으면 이름이나 첫 자음('ㄱㅎ')으로 찾는다.
// 자료함(manage)에서는:
// - 과목마다 ⋯ → 과목 고치기(이름·색·위에 고정·보관·합치기: 자료함의 과목 고치기 시트) · 과목 삭제(확인 화면)
// - 과목을 꾹 누르면 여러 과목 고르기: 아래 띠에서 한꺼번에 위에 고정·보관·삭제
// - 삭제는 늘 확인 화면을 거친다 (지울 과목과 자료 수, 대신 보관하기)
// 과목 차례는 자료함 과목 칩을 꾹 눌러 끌어 바꾼다 (서랍에서는 바꾸지 않는다). 차례 규칙은 src/lib/subject-order.ts
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { drawerGroups } from '@/lib/subject-order';
import { useLongPress } from './useLongPress';
import { Button, ICONS, Icon, Menu, Sheet, Spinner, cx, inputClass, type MenuItem } from './ui';
import { confirmOpen } from './Confirm';

/** 이만큼 넘으면 찾기 칸을 보인다 */
const SEARCH_FROM = 7;

/** 자료함에서 과목을 관리하는 일. false 를 돌려주면 하지 못한 것 (고르던 과목을 그대로 둔다) */
export type DrawerManage = {
  /** 위에 고정·고정 풀기 (여러 과목 고르기). 보관한 과목을 고정하면 보관도 푼다 */
  onPin: (list: SubjectRow[], on: boolean) => Promise<boolean | void> | void;
  /** 보관하기·보관 풀기 */
  onArchive: (list: SubjectRow[], on: boolean) => Promise<boolean | void> | void;
  /** 과목 고치기 (서랍을 닫고 자료함의 과목 고치기로: 이름·색·고정·보관·합치기) */
  onEdit?: (s: SubjectRow) => void;
  /** 과목 삭제 (서랍의 확인 화면에서 누른 뒤). 하나 지울 때마다 progress(지운 수). 모두 지웠으면 true */
  onDelete?: (list: SubjectRow[], progress: (done: number) => void) => Promise<boolean>;
};

type View =
  | { kind: 'list' }
  /** 삭제 확인. from: 돌아갈 곳 (여러 과목 고르기 목록 / 과목의 ⋯ 메뉴) */
  | { kind: 'delete'; ids: string[]; from: 'list' | 'menu' };

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
  /** 자료함: 과목 관리 (과목 고치기·삭제, 여러 과목 고르기로 고정·보관·삭제) */
  manage?: DrawerManage;
  /** 고른 칸에 붙는 말 (자료함 '보는 중', 복습 '고름') */
  currentLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  /** 여러 과목 고르기 (null = 고르는 중이 아님) */
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<null | 'pin' | 'archive' | 'delete'>(null);
  const [progress, setProgress] = useState(0);

  // 열 때마다 처음 모습으로 (찾던 글·펼친 보관 묶음·고르던 과목 없이). 닫을 때 지우면 닫히는 동안
  // 화면이 바뀌어서, 다시 열 때 지운다 (부른 쪽이 서랍을 바로 닫아도: 과목 고치기로 갈 때)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setShowArchived(false);
      setView({ kind: 'list' });
      setPicked(null);
    }
  }

  const groups = useMemo(() => drawerGroups(subjects, query), [subjects, query]);
  const full = useMemo(() => drawerGroups(subjects), [subjects]);
  /** 서랍에 보이는 차례 그대로 (고정 → 최근 → 보관) */
  const ordered = useMemo(() => [...full.pinned, ...full.recent, ...full.archived], [full]);
  const archivedAll = full.archived.length;
  const searching = !!query.trim();
  // 찾는 중이면 보관한 과목도 펼쳐서 보인다
  const archivedOpen = showArchived || searching;
  const nothing = !groups.pinned.length && !groups.recent.length && !groups.archived.length;
  const selecting = !!manage && picked !== null;
  const pickedSet = new Set(picked ?? []);
  const pickedRows = ordered.filter((s) => pickedSet.has(s.id));

  // 지울 과목이 없어졌으면(다른 곳에서 지움) 목록으로
  const deleteIds = view.kind === 'delete' ? view.ids : null;
  const deleteRows = deleteIds ? ordered.filter((s) => deleteIds.includes(s.id)) : [];
  const shown: View = view.kind === 'list' || deleteRows.length ? view : { kind: 'list' };
  const viewKey = shown.kind === 'list' ? 'list' : `delete:${shown.ids.join(',')}`;

  const close = () => {
    if (busy) return;
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
  }, [open, viewKey, selecting, focusTick]);

  const startSelect = (id: string) => setPicked([id]);
  const togglePick = (id: string) => setPicked((cur) => ((cur ?? []).includes(id) ? (cur ?? []).filter((x) => x !== id) : [...(cur ?? []), id]));
  const endSelect = () => {
    // 끝내기 단추가 사라지니 고르던 첫 과목 칸(없으면 첫 칸)에 초점을 둔다
    refocus.current = pickedRows[0] ? `[data-tile="${pickedRows[0].id}"]` : '[data-tile]';
    setPicked(null);
  };

  const back = () => {
    if (shown.kind !== 'delete') return;
    const one = shown.ids.length === 1 ? shown.ids[0] : null;
    // 과목 번호는 uuid 라 따옴표 안에 그대로 써도 된다: ⋯ 에서 왔으면 그 과목의 ⋯ 로, 고르기에서 왔으면 삭제 단추로
    refocus.current = shown.from === 'menu' && one ? `[data-tile="${one}"]` : '[data-select-delete]';
    setView({ kind: 'list' });
  };

  // Esc: 삭제 확인이면 목록으로, 고르기 중이면 고르기만 끈다 (시트가 닫히기 전에 창의 capture 단계에서 먼저 받는다)
  const escRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    escRef.current = (e: KeyboardEvent) => {
      if (busy) {
        e.stopPropagation();
        return;
      }
      if (shown.kind !== 'list') {
        e.stopPropagation();
        back();
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

  /** 과목의 ⋯ : 과목 고치기 · 과목 삭제 (자료함 과목 메뉴와 같은 말) */
  const menuFor = (s: SubjectRow): MenuItem[] | undefined => {
    if (!manage) return undefined;
    const items: MenuItem[] = [];
    if (manage.onEdit) items.push({ label: '과목 고치기', icon: ICONS.edit, onSelect: () => manage.onEdit?.(s) });
    if (manage.onDelete) items.push({ label: '과목 삭제', icon: ICONS.trash, danger: true, onSelect: () => setView({ kind: 'delete', ids: [s.id], from: 'menu' }) });
    return items.length ? items : undefined;
  };

  const tileFor = (s: SubjectRow) => (
    <SubjectTile
      s={s}
      mode={selecting ? 'select' : 'open'}
      current={selected === s.id}
      picked={pickedSet.has(s.id)}
      // 수를 주면 없는 과목은 0 (칸 높이가 고르게)
      count={counts ? (counts.get(s.id) ?? 0) : undefined}
      countLabel={countLabel}
      currentLabel={currentLabel}
      onOpen={() => pick(s.id)}
      menu={menuFor(s)}
      onLongPress={manage ? () => (selecting ? togglePick(s.id) : startSelect(s.id)) : undefined}
      onToggle={() => togglePick(s.id)}
    />
  );

  const section = (title: string, list: SubjectRow[], id: string) =>
    list.length ? (
      <section className="grid gap-2" aria-labelledby={id}>
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
        <p className="text-xs leading-relaxed text-muted">
          과목의 <Icon d={ICONS.more} size={13} strokeWidth={3} className="inline align-[-2px]" />에서 고치거나 삭제해요. 과목을 꾹 누르면 여러 개를 골라
          한꺼번에 고정·보관·삭제할 수 있어요.
        </p>
      ) : null}
      {/* 찾던 글이 남아 있으면 과목이 줄어도 칸을 둔다 (지울 수 있게) */}
      {subjects.length >= SEARCH_FROM || query ? (
        <input
          type="search"
          className={inputClass}
          placeholder="과목 찾기 (첫 글자 ㄱㅎ처럼도 돼요)"
          aria-label="과목 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {all && !searching && !selecting ? (
        <button
          type="button"
          aria-current={selected === null ? 'true' : undefined}
          onClick={() => pick(null)}
          className={cx(
            'press flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-[15px] font-semibold',
            selected === null ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent)]' : 'bg-surface-2 hover:bg-surface-3',
          )}
        >
          {all.label}
          {typeof all.count === 'number' ? <span className="text-sm tabular-nums text-muted">{countLabel(all.count)}</span> : null}
        </button>
      ) : null}
      {section('고정한 과목', groups.pinned, 'drawer-pinned')}
      {section(groups.pinned.length ? '최근 쓴 과목' : '과목 (최근 쓴 차례)', groups.recent, 'drawer-recent')}
      {archivedAll ? (
        <div className="grid gap-2">
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
            label="삭제"
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

  if (manage?.onDelete && shown.kind === 'delete' && deleteRows.length) {
    // 지우기 확인: 무엇이 지워지는지(과목·자료 수) 보이고, 다 끝난 과목이면 보관을 권한다
    const rows = deleteRows;
    const total = rows.reduce((n, s) => n + (counts?.get(s.id) ?? 0), 0);
    const one = rows.length === 1 ? rows[0] : null;
    const archivable = rows.filter((s) => !s.archived);
    const onDelete = manage.onDelete;
    body = (
      <div className="kok-appear grid gap-4">
        <BackButton ref={backRef} onClick={back} label={shown.from === 'menu' ? '모든 과목' : '과목 고르기'} disabled={!!busy} />
        <div className="grid gap-1">
          <h3 className="break-keep font-display text-lg leading-snug">{one ? `‘${one.name}’ 과목을 삭제할까요?` : `과목 ${rows.length}개를 삭제할까요?`}</h3>
          <p className="break-keep text-sm leading-relaxed text-muted">
            {counts ? `과목 안의 자료 ${total}개와 ` : '과목 안의 자료와 '}노트·문제·복습 기록이 모두 지워져요. 되돌릴 수 없어요.
          </p>
        </div>
        <ul className="grid gap-1.5" aria-label="삭제할 과목">
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
              <p className="break-keep text-sm leading-relaxed">다 끝난 과목이면 삭제하지 말고 보관해 보세요. 목록에서만 빠지고, 복습은 그대로 나와요.</p>
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
        {busy === 'delete' && rows.length > 1 ? `삭제하는 중 (${progress}/${rows.length})` : one ? '과목 삭제' : `과목 ${rows.length}개 삭제`}
      </Button>
    );
  }

  const title = shown.kind === 'delete' ? '과목 삭제' : selecting ? '과목 고르기' : '모든 과목';
  return (
    <Sheet open={open} onClose={close} title={title} footer={footer}>
      <div ref={rootRef}>{body}</div>
    </Sheet>
  );
}

/** 과목 칸 하나. open: 누르면 그 과목 / select: 누르면 고르기 (꾹 누르면 고르기를 시작한다) */
function SubjectTile({
  s,
  mode,
  current,
  picked,
  count,
  countLabel,
  currentLabel,
  onOpen,
  menu,
  onLongPress,
  onToggle,
}: {
  s: SubjectRow;
  mode: 'open' | 'select';
  /** 지금 보는 과목 */
  current: boolean;
  picked: boolean;
  count?: number;
  countLabel: (n: number) => string;
  currentLabel: string;
  onOpen: () => void;
  /** ⋯ 메뉴 (과목 고치기·과목 삭제, 없으면 ⋯ 이 없다) */
  menu?: MenuItem[];
  /** 꾹 누르기 (없으면 꾹 누르기를 쓰지 않는다) */
  onLongPress?: () => void;
  onToggle: () => void;
}) {
  const select = mode === 'select';
  const press = useLongPress(() => onLongPress?.(), !!onLongPress);
  const on = select ? picked : current;
  return (
    <>
      <button
        type="button"
        {...(onLongPress ? press : {})}
        data-tile={s.id}
        {...(select ? { role: 'checkbox' as const, 'aria-checked': picked } : {})}
        aria-current={!select && current ? 'true' : undefined}
        onClick={() => {
          if (select) onToggle();
          else onOpen();
        }}
        className={cx(
          'press relative grid w-full min-w-0 gap-1 rounded-2xl p-3 text-left',
          (menu || select) && 'pr-10',
          onLongPress && 'kok-no-callout',
          // 고른 칸·보는 칸은 카드 색 + 포인트 테두리 (흐린 글자가 늘 읽히는 바탕)
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
          {current && !select ? (
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
      ) : menu ? (
        <span className="absolute right-1 top-1 z-10" data-manage={s.id}>
          <Menu label={`'${s.name}' 과목 메뉴`} items={menu} small />
        </span>
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
