'use client';
// 과목 서랍: 과목이 많을 때 한눈에 찾고 고른다 (자료함·복습 고르기의 '모든 과목').
// 고정한 과목 → 최근 쓴 과목 → 보관한 과목(접어 둠) 차례이고, 과목이 많으면 이름이나 첫 자음('ㄱㅎ')으로 찾는다.
// 자료함에서는 과목마다 ⋯ 를 누르면 서랍 안에서 '과목 관리'가 열린다: 위에 고정·고정 순서·보관·이름 바꾸기·
// 다른 과목과 합치기·지우기를 설명과 함께 (보관 = 목록에서만 뺀다, 복습은 그대로). 고정한 과목은 꾹 눌러 끌면 순서가 바뀐다.
// 차례 규칙은 src/lib/subject-order.ts
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { drawerGroups } from '@/lib/subject-order';
import { daysUntil } from '@/lib/time';
import { SubjectPickList } from './SubjectPick';
import { useReducedMotion } from './useReducedMotion';
import { Button, ICONS, Icon, Sheet, cx, inputClass } from './ui';

/** 이만큼 넘으면 찾기 칸을 보인다 */
const SEARCH_FROM = 7;

/** 자료함에서 과목을 관리하는 일 (없는 것은 과목 관리에 보이지 않는다) */
export type DrawerManage = {
  onPin: (s: SubjectRow, on: boolean) => void;
  onArchive: (s: SubjectRow, on: boolean) => void;
  /** 고정한 과목의 새 차례 (꾹 눌러 끌기, 과목 관리의 앞으로·뒤로) */
  onReorder?: (pinnedIds: string[]) => void;
  /** 이름·색·시험 날 바꾸기 (서랍을 닫고 과목 고치기로) */
  onEdit?: (s: SubjectRow) => void;
  /** 다른 과목과 합치기: 끝나면 true (서랍은 부른 쪽이 닫는다) */
  onMerge?: (from: SubjectRow, into: SubjectRow) => Promise<boolean>;
  /** 과목 지우기 */
  onDelete?: (s: SubjectRow) => void;
};

type View = { kind: 'list' } | { kind: 'subject'; id: string } | { kind: 'merge'; id: string };

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
  /** 자료함: 과목 관리 (위에 고정·보관·순서·고치기·합치기·지우기) */
  manage?: DrawerManage;
  /** 고른 칸에 붙는 말 (자료함 '보는 중', 복습 '고름') */
  currentLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [target, setTarget] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const groups = useMemo(() => drawerGroups(subjects, query), [subjects, query]);
  const allPinned = useMemo(() => drawerGroups(subjects).pinned, [subjects]);
  const archivedAll = subjects.filter((s) => s.archived).length;
  const searching = !!query.trim();
  // 찾는 중이면 보관한 과목도 펼쳐서 보인다
  const archivedOpen = showArchived || searching;
  const nothing = !groups.pinned.length && !groups.recent.length && !groups.archived.length;
  // 보던 과목이 없어졌으면(합침·지움) 목록으로
  const current = view.kind === 'list' ? null : (subjects.find((s) => s.id === view.id) ?? null);
  const shown: View = current ? view : { kind: 'list' };

  const reset = () => {
    setQuery('');
    setShowArchived(false);
    setView({ kind: 'list' });
    setTarget(null);
  };
  const close = () => {
    if (merging) return;
    reset();
    onClose();
  };
  const pick = (id: string | null) => {
    onPick(id);
    // 다음에 열 때는 처음 모습으로 (찾던 글·펼친 보관 묶음 없이)
    reset();
    onClose();
  };

  // 키보드 초점: 과목 관리로 들어가면 '뒤로'에, 목록으로 돌아오면 그 과목의 ⋯ 에 둔다
  const listRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<string | null>(null);
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (!open) return;
    if (shown.kind !== 'list') {
      backRef.current?.focus();
      return;
    }
    const sel = refocus.current;
    if (!sel) return;
    refocus.current = null;
    listRef.current?.querySelector<HTMLElement>(sel)?.focus();
  }, [open, shown.kind, currentId]);
  const back = () => {
    if (shown.kind === 'merge') {
      setTarget(null);
      setView({ kind: 'subject', id: shown.id });
      return;
    }
    // 과목 번호는 uuid 라 따옴표 안에 그대로 써도 된다
    if (currentId) refocus.current = `[data-manage="${currentId}"]`;
    setView({ kind: 'list' });
  };

  // 과목 관리·합치기에서는 Esc 가 한 단계 뒤로 (시트가 닫히기 전에 창의 capture 단계에서 먼저 받는다)
  const backFn = useRef(back);
  useEffect(() => {
    backFn.current = back;
  });
  useEffect(() => {
    if (!open || shown.kind === 'list') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || merging) return;
      e.stopPropagation();
      backFn.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, shown.kind, merging]);

  /** 고정한 과목 차례를 바꾼다 (from 자리의 과목을 to 자리로) */
  const movePinned = (from: number, to: number) => {
    if (!manage?.onReorder || from === to || from < 0 || to < 0 || to >= allPinned.length) return;
    manage.onReorder(arrayMove(allPinned, from, to).map((s) => s.id));
  };

  // 고정한 과목을 끌고 난 바로 뒤의 누르기(손을 뗄 때 따라오는 click)는 고르기로 보지 않는다 (PinnedGrid 가 정한다)
  const quietRef = useRef(0);

  const tile = (s: SubjectRow) => {
    const on = selected === s.id;
    // 수를 주면 없는 과목은 0 (칸 높이가 고르게)
    const n = counts ? (counts.get(s.id) ?? 0) : undefined;
    const d = s.exam_date ? daysUntil(s.exam_date) : null;
    return (
      <>
        <button
          type="button"
          data-tile={s.id}
          aria-current={on ? 'true' : undefined}
          onClick={() => {
            // 끌어서 옮긴 바로 뒤에 따라오는 누르기는 고르기가 아니다
            if (Date.now() < quietRef.current) return;
            pick(s.id);
          }}
          className={cx(
            'press relative grid w-full min-w-0 gap-1 rounded-2xl p-3 text-left',
            manage && 'pr-10',
            // 고른 칸은 카드 색 + 포인트 테두리 (흐린 글자·D-day 가 늘 읽히는 바탕)
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
            {typeof n === 'number' ? <span className="tabular-nums">{countLabel(n)}</span> : null}
            {d !== null && d >= 0 && d <= 30 ? <span className="font-bold text-bad">{d === 0 ? 'D-DAY' : `D-${d}`}</span> : null}
            {on ? (
              <span className="ml-auto font-semibold text-accent">
                <Icon d={ICONS.check} size={14} strokeWidth={2.8} className="inline" /> {currentLabel}
              </span>
            ) : null}
          </span>
        </button>
        {manage ? (
          <button
            type="button"
            data-manage={s.id}
            aria-label={`'${s.name}' 과목 관리`}
            title="과목 관리"
            // 이 단추를 눌러 끌어도 칸을 옮기지 않는다
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={() => setView({ kind: 'subject', id: s.id })}
            className="press absolute right-1 top-1 z-10 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
          >
            <Icon d={ICONS.more} size={18} strokeWidth={3} />
          </button>
        ) : null}
      </>
    );
  };

  const section = (title: string, list: SubjectRow[], id: string) =>
    list.length ? (
      <section className="grid gap-2" aria-labelledby={id}>
        <h3 id={id} className="text-xs font-bold text-muted">
          {title}
        </h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((s) => (
            <li key={s.id} className="relative min-w-0">
              {tile(s)}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  // 고정한 과목: 꾹 눌러(마우스는 조금 끌어) 순서를 바꾼다. 찾는 중에는 일부만 보여서 옮기지 않는다
  const canDrag = !!manage?.onReorder && !searching && groups.pinned.length > 1;
  const pinnedSection = canDrag ? (
    <section className="grid gap-2" aria-labelledby="drawer-pinned">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 id="drawer-pinned" className="text-xs font-bold text-muted">
          고정한 과목
        </h3>
        <p className="text-xs text-muted">꾹 눌러 끌면 순서가 바뀌어요</p>
      </div>
      <PinnedGrid list={groups.pinned} quietRef={quietRef} onReorder={(ids) => manage?.onReorder?.(ids)} render={tile} />
    </section>
  ) : (
    section('고정한 과목', groups.pinned, 'drawer-pinned')
  );

  let body: ReactNode = (
    <div ref={listRef} className="grid gap-4">
      {manage ? (
        <p className="text-xs leading-relaxed text-muted">
          과목의 <Icon d={ICONS.more} size={13} strokeWidth={3} className="inline align-[-2px]" />를 누르면 위에 고정·보관·합치기를 할 수 있어요. 보관해도
          복습은 그대로 나와요.
        </p>
      ) : null}
      {subjects.length >= SEARCH_FROM ? (
        <input
          type="search"
          className={inputClass}
          placeholder="과목 찾기 (첫 글자 ㄱㅎ처럼도 돼요)"
          aria-label="과목 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {all && !searching ? (
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
      {pinnedSection}
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
                  {tile(s)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {nothing ? <p className="py-6 text-center text-sm text-muted">&lsquo;{query.trim()}&rsquo;에 맞는 과목이 없어요.</p> : null}
    </div>
  );
  let footer: ReactNode = undefined;

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
            <ActionRow icon={ICONS.unarchive} title="보관 풀기" desc="자료함 목록과 과목 칩에 다시 보여요" onClick={() => manage.onArchive(s, false)} />
          ) : (
            <>
              <ActionRow
                icon={s.pinned ? ICONS.unpin : ICONS.pin}
                title={s.pinned ? '고정 풀기' : '위에 고정'}
                desc={s.pinned ? '최근 쓴 차례로 돌아가요' : '과목 칩 줄 맨 앞에 늘 보여요'}
                onClick={() => manage.onPin(s, !s.pinned)}
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
                  <button
                    type="button"
                    aria-label="앞으로 옮기기"
                    title="앞으로"
                    disabled={at <= 0}
                    onClick={() => movePinned(at, at - 1)}
                    className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink hover:bg-surface-3 disabled:opacity-35"
                  >
                    <Icon d={ICONS.back} size={18} strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    aria-label="뒤로 옮기기"
                    title="뒤로"
                    disabled={at >= allPinned.length - 1}
                    onClick={() => movePinned(at, at + 1)}
                    className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink hover:bg-surface-3 disabled:opacity-35"
                  >
                    <Icon d={ICONS.forward} size={18} strokeWidth={2.2} />
                  </button>
                </div>
              ) : null}
              <ActionRow
                icon={ICONS.archive}
                title="보관하기"
                desc="다 끝난 과목을 목록에서 빼요. 복습은 그대로 나와요"
                onClick={() => {
                  setShowArchived(true);
                  manage.onArchive(s, true);
                }}
              />
            </>
          )}
          {manage.onEdit ? <ActionRow icon={ICONS.edit} title="이름·색·시험 날 바꾸기" desc="과목 정보를 고쳐요" chevron onClick={() => manage.onEdit?.(s)} /> : null}
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
        </div>
        {manage.onDelete ? (
          <div className="overflow-hidden rounded-2xl bg-surface-2">
            <ActionRow icon={ICONS.trash} title="과목 지우기" desc="자료·노트·문제·복습 기록까지 모두 지워져요" danger onClick={() => manage.onDelete?.(s)} />
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
          if (!confirm(`'${s.name}' 과목의 자료 ${n}개와 복습 기록을 '${into.name}' 과목으로 옮기고 '${s.name}' 과목을 없앨까요? 되돌릴 수 없어요.`)) return;
          setMerging(true);
          try {
            if (await onMerge(s, into)) reset();
          } finally {
            setMerging(false);
          }
        }}
      >
        {into ? `'${into.name}' 과목으로 합치기` : '합칠 과목을 골라 주세요'}
      </Button>
    );
  }

  return (
    <Sheet open={open} onClose={close} title={shown.kind === 'list' ? '모든 과목' : shown.kind === 'merge' ? '과목 합치기' : '과목 관리'} footer={footer}>
      {body}
    </Sheet>
  );
}

/** 과목 관리·합치기의 '뒤로' (위 왼쪽) */
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
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
  chevron?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-3">
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

/** 고정한 과목 칸: 꾹 누르면(손가락 0.25초, 마우스는 조금 끌면) 들려서 옮길 수 있다. 키보드는 과목 관리의 앞으로·뒤로 */
function PinnedGrid({
  list,
  quietRef,
  onReorder,
  render,
}: {
  list: SubjectRow[];
  /** 이 시각(ms)까지는 칸 누르기를 고르기로 보지 않는다: 끄는 동안과 놓은 바로 뒤 */
  quietRef: RefObject<number>;
  onReorder: (ids: string[]) => void;
  render: (s: SubjectRow) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
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
    quietRef.current = Date.now() + 400;
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
        quietRef.current = Number.MAX_SAFE_INTEGER;
        buzz(12);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        quietRef.current = Date.now() + 400;
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: '꾹 누른 채 끌면 순서가 바뀌어요. 키보드로는 과목 관리에서 앞으로·뒤로를 눌러요.' },
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((s) => (
            <PinnedTile key={s.id} id={s.id}>
              {render(s)}
            </PinnedTile>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function PinnedTile({ id, children }: { id: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    transition: reduced ? null : { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: reduced ? undefined : transition }}
      className={cx('kok-drag-tile relative min-w-0', isDragging && 'is-dragging')}
      {...listeners}
    >
      {children}
    </li>
  );
}
