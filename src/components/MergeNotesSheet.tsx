'use client';
// 노트 합치기 (자료함에서 여러 개 고른 뒤 '합치기'): 남길 노트를 고르면 나머지 노트를 그 노트에 이어 붙인다.
// AI 를 쓰지 않아서 번개가 들지 않는다 (/api/notes/merge). 합친 노트에서 Pro 는 'AI로 다시 정리'로 겹치는 개념을 다듬는다
import { useState } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { MERGE_MAX_NOTES } from '@/lib/note-merge';
import { Button, ICONS, Icon, Sheet, api, cx, useToast } from './ui';

export type MergeCandidate = {
  id: string;
  title: string;
  subject_id: string;
  kind: 'text' | 'pdf' | 'image';
  status: string;
  manual?: boolean;
  created_at: string;
};

const KIND_LABEL = { text: '글', pdf: 'PDF', image: '사진' } as const;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export function MergeNotesSheet({
  open,
  onClose,
  notes,
  subjects,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  /** 고른 노트 (자료함에 보이는 차례대로) */
  notes: MergeCandidate[];
  subjects: SubjectRow[];
  /** 합친 뒤: 남긴 노트의 자료 번호와 합친 노트 수 */
  onMerged: (keepId: string, count: number) => void;
}) {
  const toast = useToast();
  const [main, setMain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = notes.filter((n) => n.status === 'ready');
  const skipped = notes.length - ready.length;
  const keep = main && ready.some((n) => n.id === main) ? main : (ready[0]?.id ?? null);
  const keepRow = ready.find((n) => n.id === keep) ?? null;
  const subjectOf = (id: string) => subjects.find((s) => s.id === id) ?? null;
  const multiSubject = new Set(ready.map((n) => n.subject_id)).size > 1;
  const tooMany = ready.length > MERGE_MAX_NOTES;
  const can = !!keep && ready.length >= 2 && !tooMany;

  const run = async () => {
    if (!can || !keep) return;
    setBusy(true);
    try {
      const from = ready.filter((n) => n.id !== keep).map((n) => n.id);
      await api('/api/notes/merge', { method: 'POST', body: JSON.stringify({ into: keep, from }) });
      setMain(null);
      onMerged(keep, from.length + 1);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (busy) return;
        setMain(null);
        onClose();
      }}
      title="노트 합치기"
      footer={
        <Button className="w-full" disabled={!can} busy={busy} onClick={run}>
          {ready.length >= 2 ? `노트 ${ready.length}개 합치기` : '노트를 두 개 이상 골라 주세요'}
        </Button>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm leading-relaxed text-muted">고른 노트를 한 노트로 합쳐요. AI를 쓰지 않아서 번개가 들지 않아요.</p>
        <section className="grid gap-2" aria-labelledby="merge-keep">
          <h3 id="merge-keep" className="text-xs font-bold text-muted">
            어느 노트에 합칠까요?
          </h3>
          <div role="radiogroup" aria-labelledby="merge-keep" className="grid gap-1.5">
            {ready.map((n) => {
              const on = n.id === keep;
              const subj = subjectOf(n.subject_id);
              return (
                <button
                  key={n.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMain(n.id)}
                  className={cx(
                    'press flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-shadow duration-200',
                    on ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent)]' : 'bg-surface-2 hover:bg-surface-3',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{n.title || '제목 없는 자료'}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                      {subj ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectVar(subj.color) }} aria-hidden="true" /> : null}
                      <span className="truncate">
                        {[subj?.name ?? '', n.manual ? '직접 만든 노트' : KIND_LABEL[n.kind], shortDate(n.created_at)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </span>
                  {on ? <span className="shrink-0 text-xs font-bold text-accent">남길 노트</span> : null}
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
          </div>
          {keepRow ? (
            <p className="text-xs leading-relaxed text-muted">
              고른 노트의 이름{multiSubject ? '·과목' : ''}이 남아요
              {multiSubject ? ` (합친 노트는 '${subjectOf(keepRow.subject_id)?.name ?? ''}' 과목에 있어요)` : ''}. 나머지 노트는 이 노트 안으로 들어가요.
            </p>
          ) : null}
        </section>
        <ul className="grid gap-2.5 rounded-2xl bg-surface-2 p-4 text-sm leading-relaxed">
          <li className="flex gap-2.5">
            <Icon d={ICONS.check} size={18} strokeWidth={2.4} className="mt-0.5 shrink-0 text-ok" />
            <span>개념·용어·공식·문제가 한 노트에 모여요. 푼 기록과 원본 자료도 그대로 남아요.</span>
          </li>
          <li className="flex gap-2.5">
            <Icon d={ICONS.sparkle} size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>겹치는 개념은 합친 노트에서 직접 고치거나, Pro는 &lsquo;AI로 다시 정리&rsquo;로 한 번에 다듬을 수 있어요.</span>
          </li>
          <li className="flex gap-2.5">
            <Icon d={ICONS.lock} size={18} className="mt-0.5 shrink-0 text-muted" />
            <span>합친 뒤에는 다시 나눌 수 없어요.</span>
          </li>
        </ul>
        {skipped ? (
          <p className="text-xs font-semibold text-warn" role="status">
            정리 중이거나 멈춘 노트 {skipped}개는 빼고 합쳐요.
          </p>
        ) : null}
        {tooMany ? (
          <p className="text-xs font-semibold text-bad" role="status">
            한 번에 {MERGE_MAX_NOTES}개까지 합칠 수 있어요. 몇 개를 빼 주세요.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
