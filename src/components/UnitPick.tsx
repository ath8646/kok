'use client';
// 단원 고르기: 단원 없음 · 이 과목에 있는 단원(최근 쓴 차례) · 새 단원. 자료 넣기 입력창과 노트 고치기가 같이 쓴다.
// 단원은 학생이 고른 것만 쓴다 (AI 는 정하지 않는다: AI 가 읽은 단원은 노트 고치기의 목록에 'AI 추천'으로만 보인다).
import { useEffect, useId, useState } from 'react';
import { sb } from '@/lib/data';
import { isSubmitKey } from '@/lib/quick-add';
import { Icon, ICONS, Sheet, cx } from '@/components/ui';

export const UNIT_MAX = 40;

/** 단원 이름 다듬기 (빈칸 하나로, 앞뒤 빈칸 없이, 40자까지) */
export function normalizeUnit(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, UNIT_MAX);
}

/** 이 과목의 단원들 (최근 넣은 자료의 단원부터, 겹치지 않게) */
export async function fetchUnits(subjectId: string): Promise<string[]> {
  const { data } = await sb()
    .from('sources')
    .select('unit, created_at')
    .eq('subject_id', subjectId)
    .neq('unit', '')
    .order('created_at', { ascending: false })
    .limit(400);
  const out: string[] = [];
  for (const r of (data ?? []) as Array<{ unit: string | null }>) {
    const u = normalizeUnit(r.unit ?? '');
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/** 과목이 바뀌면 그 과목의 단원을 읽는다 (open 일 때만) */
export function useSubjectUnits(subjectId: string | null | undefined, open: boolean): string[] | null {
  const [got, setGot] = useState<{ id: string; units: string[] } | null>(null);
  useEffect(() => {
    if (!open || !subjectId) return;
    let alive = true;
    fetchUnits(subjectId)
      .then((units) => {
        if (alive) setGot({ id: subjectId, units });
      })
      .catch(() => {
        if (alive) setGot({ id: subjectId, units: [] });
      });
    return () => {
      alive = false;
    };
  }, [subjectId, open]);
  return got && got.id === subjectId ? got.units : null;
}

/** 고르는 목록: 단원 없음 → (AI 추천) → 있는 단원들 → 새 단원 적기 */
export function UnitOptions({
  value,
  units,
  suggest,
  onPick,
  autoFocusNew = false,
}: {
  value: string;
  units: string[] | null;
  /** AI 가 읽은 단원 (노트 고치기만) */
  suggest?: string;
  onPick: (unit: string) => void;
  autoFocusNew?: boolean;
}) {
  const newId = useId();
  const [typed, setTyped] = useState('');
  const sug = normalizeUnit(suggest ?? '');
  const list = [...(sug && !(units ?? []).includes(sug) ? [sug] : []), ...(units ?? [])];
  if (value && !list.includes(value)) list.unshift(value);
  const made = normalizeUnit(typed);
  const row = (unit: string, label: string, note?: string) => {
    const on = unit === value;
    return (
      <button
        key={unit || '∅'}
        type="button"
        role="radio"
        aria-checked={on}
        className={cx('flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[15px] hover:bg-surface-2', on && 'font-bold')}
        onClick={() => onPick(unit)}
      >
        <span
          className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-accent bg-accent text-accent-ink' : 'border-line')}
          aria-hidden="true"
        >
          {on ? <Icon d={ICONS.check} size={12} strokeWidth={3} /> : null}
        </span>
        <span className={cx('min-w-0 flex-1 truncate', !unit && 'text-muted')}>{label}</span>
        {note ? <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">{note}</span> : null}
      </button>
    );
  };
  return (
    <div className="grid gap-1">
      <div className="grid max-h-64 gap-0.5 overflow-y-auto" role="radiogroup" aria-label="단원">
        {row('', '단원 없음')}
        {list.map((u) => row(u, u, u === sug ? 'AI 추천' : undefined))}
        {units === null ? <p className="px-3 py-2 text-sm text-muted">단원을 불러오는 중…</p> : null}
      </div>
      <div className="mt-1 flex gap-1.5 border-t border-line px-1 pt-2">
        <label htmlFor={newId} className="sr-only">
          새 단원 이름
        </label>
        <input
          id={newId}
          className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="새 단원 (예: 2. 광합성)"
          value={typed}
          maxLength={UNIT_MAX}
          autoFocus={autoFocusNew}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e.nativeEvent)) {
              e.preventDefault();
              e.stopPropagation();
              if (made) onPick(made);
            }
          }}
        />
        <button
          type="button"
          className="press rounded-xl bg-ink px-3.5 text-sm font-semibold text-surface disabled:opacity-40"
          disabled={!made}
          onClick={() => onPick(made)}
        >
          쓰기
        </button>
      </div>
    </div>
  );
}

/** 노트 고치기의 단원 바꾸기 창 */
export function UnitSheet({
  open,
  onClose,
  subjectId,
  value,
  suggest,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  subjectId: string;
  value: string;
  suggest?: string;
  onPick: (unit: string) => void;
}) {
  const units = useSubjectUnits(subjectId, open);
  return (
    <Sheet open={open} onClose={onClose} title="단원">
      <p className="mb-3 text-sm text-muted">같은 단원의 노트는 자료함에서 한데 묶여요.</p>
      <UnitOptions value={value} units={units} suggest={suggest} onPick={onPick} />
    </Sheet>
  );
}
