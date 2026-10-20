'use client';
// 노트 합치기 (자료함에서 여러 개 고른 뒤 '합치기'): 남길 노트를 고르면 나머지 노트를 그 노트에 이어 붙인다.
// AI 를 쓰지 않아서 번개가 들지 않는다 (/api/notes/merge). 합친 노트에서 Pro 는 'AI로 다시 정리'로 겹치는 개념을 다듬는다
import { useEffect, useState } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { sb } from '@/lib/data';
import { MERGE_MAX_NOTES } from '@/lib/note-merge';
import { toVersionRow } from '@/lib/versions';
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

/**
 * 합치기 전에 알아 둘 것 (노트마다). 합쳐지는 노트는 지금 쓰는 버전만 들어가서, 그 밖의 더한 자료가 있으면 합치지 않는다
 * (DB 함수 kok_merge_notes 와 같은 규칙: 지울 수밖에 없는 자료를 남기려고)
 */
type NoteCheck = {
  /** 버전 기록이 있다 */
  versions: boolean;
  /** 더하지 못하고 멈춘 자료가 있다 */
  failed: boolean;
  /** 지금 쓰는 버전에 없는 더한 자료가 있다 (지난 버전을 쓰고 있거나, 다른 갈래의 버전에만 있는 자료) */
  oldVersion: boolean;
};

/** 고른 노트들의 버전·더한 자료를 읽어 NoteCheck 를 만든다 (못 읽으면 빈 결과: 서버가 다시 확인한다) */
async function checkNotes(sourceIds: string[]): Promise<Map<string, NoteCheck>> {
  const out = new Map<string, NoteCheck>();
  const [nq, kq] = await Promise.all([
    sb().from('notes').select('id, source_id, current_version').in('source_id', sourceIds),
    sb().from('sources').select('id, parent_id, status').in('parent_id', sourceIds),
  ]);
  if (nq.error || kq.error) return out;
  const notes = (nq.data ?? []) as Array<{ id: string; source_id: string; current_version: number }>;
  const kids = (kq.data ?? []) as Array<{ id: string; parent_id: string; status: string }>;
  const vq = notes.length ? await sb().from('note_versions').select('note_id, number, materials').in('note_id', notes.map((n) => n.id)) : null;
  if (vq?.error) return out;
  const rows = ((vq?.data ?? []) as Array<Record<string, unknown>>).map((r) => ({ noteId: String(r.note_id), row: toVersionRow(r) }));
  for (const n of notes) {
    const mine = rows.filter((r) => r.noteId === n.id).map((r) => r.row);
    const myKids = kids.filter((k) => k.parent_id === n.source_id);
    const cur = mine.find((r) => r.number === n.current_version);
    const inCurrent = new Set([n.source_id, ...(cur?.materials ?? []).map((m) => m.source_id)]);
    out.set(n.source_id, {
      versions: mine.length > 0,
      failed: myKids.some((k) => k.status === 'error'),
      oldVersion: mine.length > 0 && myKids.some((k) => k.status === 'ready' && !inCurrent.has(k.id)),
    });
  }
  return out;
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
  const [checked, setChecked] = useState<{ key: string; map: Map<string, NoteCheck> } | null>(null);
  const ready = notes.filter((n) => n.status === 'ready');
  const readyKey = ready.map((n) => n.id).join(',');
  const skipped = notes.length - ready.length;
  const keep = main && ready.some((n) => n.id === main) ? main : (ready[0]?.id ?? null);
  const keepRow = ready.find((n) => n.id === keep) ?? null;
  const subjectOf = (id: string) => subjects.find((s) => s.id === id) ?? null;
  const multiSubject = new Set(ready.map((n) => n.subject_id)).size > 1;
  const tooMany = ready.length > MERGE_MAX_NOTES;

  // 시트를 열 때 고른 노트의 버전·더한 자료를 본다 (합치면 자료를 잃는 노트는 미리 알려 준다)
  useEffect(() => {
    if (!open || !readyKey) return;
    let alive = true;
    checkNotes(readyKey.split(',')).then((map) => {
      if (alive) setChecked({ key: readyKey, map });
    });
    return () => {
      alive = false;
    };
  }, [open, readyKey]);
  const checks = checked?.key === readyKey ? checked.map : null;
  const checkOf = (id: string) => checks?.get(id) ?? null;
  /** 합쳐지는 노트(남길 노트 말고)의 막힌 까닭 */
  const issueOf = (id: string): string | null => {
    const c = id === keep ? null : checkOf(id);
    if (c?.failed) return '더하지 못한 자료가 있어요';
    if (c?.oldVersion) return '다른 버전에만 있는 자료가 있어요';
    return null;
  };
  const blocked = ready.find((n) => issueOf(n.id)) ?? null;
  const keepHasVersions = !!(keep && checkOf(keep)?.versions);
  const othersHaveVersions = ready.some((n) => n.id !== keep && checkOf(n.id)?.versions);
  const can = !!keep && ready.length >= 2 && !tooMany && !blocked;

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
                    {issueOf(n.id) ? <span className="block text-xs font-semibold text-warn">{issueOf(n.id)}</span> : null}
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
          {blocked ? (
            <p className="text-xs font-semibold leading-relaxed text-bad" role="status">
              {checkOf(blocked.id)?.failed
                ? `'${blocked.title || '제목 없는 자료'}' 노트에 더하지 못한 자료가 있어서 합칠 수 없어요. 그 노트에서 다시 하거나 지운 뒤 합쳐 주세요.`
                : `'${blocked.title || '제목 없는 자료'}' 노트에는 지금 쓰는 버전에 없는 자료(다른 버전에만 있는 자료)가 있어서, 합치면 그 자료를 잃어요. 그 노트를 남길 노트로 고르면 합칠 수 있어요.`}
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
          {keepHasVersions && keepRow ? (
            <li className="flex gap-2.5">
              <Icon d={ICONS.file} size={18} className="mt-0.5 shrink-0 text-muted" />
              <span>
                &lsquo;{keepRow.title || '제목 없는 자료'}&rsquo; 노트에 새 버전이 생겨요. 합치기 전 노트는 원본 탭의 버전 기록에 남아요.
              </span>
            </li>
          ) : null}
          {othersHaveVersions ? (
            <li className="flex gap-2.5">
              <Icon d={ICONS.file} size={18} className="mt-0.5 shrink-0 text-muted" />
              <span>합쳐지는 노트는 지금 쓰는 버전만 들어가요. 그 노트의 지난 버전 기록은 남지 않아요.</span>
            </li>
          ) : null}
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
