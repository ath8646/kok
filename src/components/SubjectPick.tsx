'use client';
// 과목 하나 고르기 (자료를 다른 과목으로 옮길 때, 과목을 합칠 때). 고정 → 최근 쓴 차례 → 보관한 과목 차례이고,
// 과목이 많으면 이름이나 첫 자음('ㄱㅎ')으로 찾는다. 옮길 때는 여기서 새 과목도 만든다
import { useMemo, useState, type ReactNode } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { SUBJECT_COLORS } from '@/lib/settings';
import { drawerGroups } from '@/lib/subject-order';
import { sb } from '@/lib/data';
import { Button, ICONS, Icon, Sheet, cx, inputClass, useToast } from './ui';

/** 이만큼 넘으면 찾기 칸을 보인다 */
const SEARCH_FROM = 7;

export function SubjectPickList({
  subjects,
  value,
  onChange,
  exclude = [],
  counts,
  label,
  onCreated,
}: {
  subjects: SubjectRow[];
  value: string | null;
  onChange: (id: string) => void;
  /** 고를 수 없는 과목 (합치는 과목 자신, 지금 과목) */
  exclude?: string[];
  counts?: Map<string, number>;
  /** 목록 이름 (화면 읽기용) */
  label: string;
  /** 있으면 '새 과목 만들기' 줄을 보인다: 만든 과목을 알려 준다 */
  onCreated?: (s: SubjectRow) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const g = drawerGroups(
      subjects.filter((s) => !exclude.includes(s.id)),
      query,
    );
    return [...g.pinned, ...g.recent, ...g.archived];
  }, [subjects, exclude, query]);
  const many = subjects.length - exclude.length >= SEARCH_FROM;

  const create = async () => {
    const n = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!n || busy || !onCreated) return;
    setBusy(true);
    const color = SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length];
    const { data, error } = await sb().from('subjects').insert({ name: n, color, position: subjects.length }).select('*').single();
    setBusy(false);
    if (error || !data) {
      toast(/kok_row_limit/.test(error?.message ?? '') ? '과목은 100개까지 만들 수 있어요.' : '과목을 만들지 못했어요.', 'bad');
      return;
    }
    setName('');
    setMaking(false);
    onCreated(data as SubjectRow);
  };

  return (
    <div className="grid gap-2.5">
      {many ? (
        <input
          type="search"
          className={inputClass}
          placeholder="과목 찾기 (첫 글자 ㄱㅎ처럼도 돼요)"
          aria-label="과목 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      <div role="radiogroup" aria-label={label} className="grid gap-1.5">
        {list.map((s) => {
          const on = value === s.id;
          const n = counts ? (counts.get(s.id) ?? 0) : undefined;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(s.id)}
              className={cx(
                'press flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-shadow duration-200',
                on ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent)]' : 'bg-surface-2 hover:bg-surface-3',
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{s.name}</span>
                {typeof n === 'number' || s.archived ? (
                  <span className="block text-xs text-muted">
                    {[typeof n === 'number' ? `자료 ${n}개` : '', s.archived ? '보관한 과목' : ''].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
              <span
                className={cx(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors duration-150',
                  on ? 'bg-accent text-accent-ink' : 'ring-2 ring-inset ring-line',
                )}
                aria-hidden="true"
              >
                {on ? <Icon d={ICONS.check} size={14} strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
        {!list.length ? (
          <p className="py-4 text-center text-sm text-muted">{query.trim() ? `'${query.trim()}'에 맞는 과목이 없어요.` : '고를 수 있는 과목이 없어요.'}</p>
        ) : null}
      </div>
      {onCreated ? (
        making ? (
          <form
            className="kok-appear flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              className={cx(inputClass, 'min-w-0 flex-1')}
              aria-label="새 과목 이름"
              placeholder="새 과목 이름"
              maxLength={40}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm" busy={busy} disabled={!name.trim()}>
              만들기
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setMaking(true)}
            className="press flex min-h-12 items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 text-sm font-semibold text-muted hover:text-ink"
          >
            <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />새 과목 만들기
          </button>
        )
      ) : null}
    </div>
  );
}

/**
 * 과목을 골라 무언가를 하는 시트 (옮기기·합치기). 고르기 전에는 단추를 누를 수 없고,
 * 단추 글은 고른 과목 이름으로 바뀐다 ('물리' 과목으로 옮기기)
 */
export function SubjectPickSheet({
  open,
  onClose,
  title,
  intro,
  subjects,
  exclude,
  counts,
  actionLabel,
  danger,
  allowNew,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: ReactNode;
  subjects: SubjectRow[];
  exclude?: string[];
  counts?: Map<string, number>;
  /** 고른 과목 이름 → 단추 글 */
  actionLabel: (name: string | null) => string;
  danger?: boolean;
  /** 새 과목도 만들 수 있다 (자료 옮기기) */
  allowNew?: boolean;
  /** 고른 과목으로 한다. true 면 시트를 닫는다 */
  onConfirm: (target: SubjectRow) => Promise<boolean>;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [made, setMade] = useState<SubjectRow[]>([]);
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => [...subjects, ...made.filter((m) => !subjects.some((s) => s.id === m.id))], [subjects, made]);
  const picked = all.find((s) => s.id === target) ?? null;
  const close = () => {
    if (busy) return;
    setTarget(null);
    setMade([]);
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={close}
      title={title}
      footer={
        <Button
          className="w-full"
          variant={danger ? 'danger' : 'primary'}
          disabled={!picked}
          busy={busy}
          onClick={async () => {
            if (!picked) return;
            setBusy(true);
            try {
              if (await onConfirm(picked)) {
                setTarget(null);
                setMade([]);
                onClose();
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {actionLabel(picked?.name ?? null)}
        </Button>
      }
    >
      <div className="grid gap-4">
        <div className="text-sm leading-relaxed text-muted">{intro}</div>
        <SubjectPickList
          subjects={all}
          value={target}
          onChange={setTarget}
          exclude={exclude}
          counts={counts}
          label="과목"
          onCreated={
            allowNew
              ? (s) => {
                  setMade((m) => [...m, s]);
                  setTarget(s.id);
                }
              : undefined
          }
        />
      </div>
    </Sheet>
  );
}
