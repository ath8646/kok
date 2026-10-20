'use client';
// 과목 서랍: 과목이 많을 때 한눈에 찾고 고른다 (자료함·복습 고르기의 '모든 과목').
// 고정한 과목 → 최근 쓴 과목 → 보관한 과목(접어 둠) 차례이고, 과목이 많으면 이름이나 첫 자음('ㄱㅎ')으로 찾는다.
// 자료함에서는 과목마다 ⋮ 에서 위에 고정·보관을 바꾼다 (보관 = 목록에서만 뺀다, 복습은 그대로). 차례 규칙은 src/lib/subject-order.ts
import { useMemo, useState } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { drawerGroups } from '@/lib/subject-order';
import { daysUntil } from '@/lib/time';
import { ICONS, Icon, Menu, Sheet, cx, inputClass, type MenuItem } from './ui';

/** 이만큼 넘으면 찾기 칸을 보인다 */
const SEARCH_FROM = 7;

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
  /** 자료함: 위에 고정·보관 바꾸기 */
  manage?: { onPin: (s: SubjectRow, on: boolean) => void; onArchive: (s: SubjectRow, on: boolean) => void };
  /** 고른 칸에 붙는 말 (자료함 '보는 중', 복습 '고름') */
  currentLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const groups = useMemo(() => drawerGroups(subjects, query), [subjects, query]);
  const archivedAll = subjects.filter((s) => s.archived).length;
  const searching = !!query.trim();
  // 찾는 중이면 보관한 과목도 펼쳐서 보인다
  const archivedOpen = showArchived || searching;
  const nothing = !groups.pinned.length && !groups.recent.length && !groups.archived.length;
  const pick = (id: string | null) => {
    onPick(id);
    onClose();
  };

  const tile = (s: SubjectRow) => {
    const on = selected === s.id;
    const n = counts?.get(s.id);
    const d = s.exam_date ? daysUntil(s.exam_date) : null;
    const menu: MenuItem[] = manage
      ? [
          s.archived
            ? { label: '보관 풀기', icon: ICONS.archive, onSelect: () => manage.onArchive(s, false) }
            : { label: s.pinned ? '고정 풀기' : '위에 고정', icon: ICONS.pin, onSelect: () => manage.onPin(s, !s.pinned) },
          ...(s.archived ? [] : [{ label: '보관하기', icon: ICONS.archive, onSelect: () => manage.onArchive(s, true) }]),
        ]
      : [];
    return (
      <li key={s.id} className="relative min-w-0">
        <button
          type="button"
          aria-current={on ? 'true' : undefined}
          onClick={() => pick(s.id)}
          className={cx(
            'press grid w-full min-w-0 gap-1 rounded-2xl p-3 text-left transition-shadow duration-200',
            manage && 'pr-9',
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
          <div className="absolute right-0.5 top-1 z-10">
            <Menu small label={`'${s.name}' 과목 메뉴`} items={menu} />
          </div>
        ) : null}
      </li>
    );
  };

  const section = (title: string, list: SubjectRow[], id: string) =>
    list.length ? (
      <section className="grid gap-2" aria-labelledby={id}>
        <h3 id={id} className="text-xs font-bold text-muted">
          {title}
        </h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{list.map(tile)}</ul>
      </section>
    ) : null;

  return (
    <Sheet
      open={open}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title="모든 과목"
    >
      <div className="grid gap-4">
        {manage ? (
          <p className="-mt-1 text-xs text-muted">
            자주 쓰는 과목은 ⋮에서 &lsquo;위에 고정&rsquo;, 다 끝난 과목은 &lsquo;보관하기&rsquo;를 누르면 목록이 깔끔해져요. 보관해도 복습은 그대로 나와요.
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
            {archivedOpen ? (
              groups.archived.length ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="보관한 과목">
                  {groups.archived.map(tile)}
                </ul>
              ) : null
            ) : null}
          </div>
        ) : null}
        {nothing ? <p className="py-6 text-center text-sm text-muted">&lsquo;{query.trim()}&rsquo;에 맞는 과목이 없어요.</p> : null}
      </div>
    </Sheet>
  );
}
