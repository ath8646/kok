'use client';
// 홈의 최근 노트: 누르면 노트로, 꾹 누르면 여러 개 고르기 (자료함과 같은 아래 띠: 별표·복습·옮기기·합치기·지우기).
// 고르는 동안에도 카드 모양은 그대로이고 모서리에 동그라미만 걸린다 (SelectionBar.tsx PickBadge)
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type KeyboardEvent } from 'react';
import { useConfirm } from './Confirm';
import { MergeNotesSheet } from './MergeNotesSheet';
import { SOURCES_CHANGED, SUBJECTS_CHANGED } from './QuickAdd';
import { BarAction, PICKED_RING, PickBadge, SelectionBar, type useMultiSelect } from './SelectionBar';
import { SubjectPickSheet } from './SubjectPick';
import { useLongPress } from './useLongPress';
import { DONE, ICONS, Icon, IconButton, SectionTitle, api, cx, useToast } from './ui';
import { sb } from '@/lib/data';
import { subjectVar } from '@/lib/colors';
import type { Recent } from '@/lib/home-data';
import { BULK_MAX, bulkLabels } from '@/lib/library-order';
import { previewText } from '@/lib/richtext';
import type { SubjectRow } from '@/lib/types';

type Select = ReturnType<typeof useMultiSelect>;

export function RecentNotes({
  recent,
  subjects,
  organize,
  merge,
  select,
  onLocal,
  onChanged,
}: {
  recent: Recent[];
  subjects: SubjectRow[];
  /** 별표·복습 칸이 DB 에 있다 (features.organize) */
  organize: boolean;
  /** 옮기기·합치기를 쓸 수 있다 (features.merge) */
  merge: boolean;
  /** 여러 개 고르기 (홈이 들고 있다: 고르는 동안 화면 아래를 띠만큼 띄운다) */
  select: Select;
  /** 화면에서 바로 고친다 (지운 노트 빼기, 별표·복습·과목 바꾸기) */
  onLocal: (fn: (rows: Recent[]) => Recent[]) => void;
  /** 바꾼 뒤 홈을 다시 읽는다 */
  onChanged: () => void;
}) {
  const { selecting, picked, setPicked, startSelect, endSelect, togglePick } = select;
  const toast = useToast();
  const ask = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState<'star' | 'review' | 'delete' | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [merging, setMerging] = useState(false);
  const subjectOf = new Map(subjects.map((s) => [s.id, s]));
  const pickedRows = recent.filter((s) => picked.has(s.id));
  const labels = bulkLabels(pickedRows);
  const off = !pickedRows.length || !!busy;
  const allPicked = recent.length > 0 && pickedRows.length === recent.length;

  /** 별표·복습을 한꺼번에 (화면은 저장한 뒤에 바꾼다) */
  const patch = async (kind: 'star' | 'review') => {
    const ids = pickedRows.map((s) => s.id);
    if (!ids.length) return;
    const p = kind === 'star' ? { starred: labels.star } : { in_review: labels.review };
    setBusy(kind);
    let failed = false;
    for (let i = 0; i < ids.length; i += BULK_MAX) {
      const { error } = await sb()
        .from('sources')
        .update(p)
        .in('id', ids.slice(i, i + BULK_MAX));
      if (error) failed = true;
    }
    setBusy(null);
    if (failed) {
      toast('저장하지 못했어요. 다시 해 주세요.', 'bad');
      onChanged();
      return;
    }
    onLocal((rows) => rows.map((r) => (ids.includes(r.id) ? { ...r, ...p } : r)));
    // 홈 카드에는 별이 없어서 별표도 알려 준다
    toast(
      kind === 'star'
        ? labels.star
          ? `노트 ${ids.length}개에 별표했어요.`
          : `노트 ${ids.length}개의 별표를 뺐어요.`
        : labels.review
          ? `${ids.length}개 노트를 복습에 넣었어요.`
          : `${ids.length}개 노트를 복습에서 뺐어요.`,
      'plain',
      DONE,
    );
    endSelect();
    onChanged();
  };

  const remove = async () => {
    const ids = pickedRows.map((s) => s.id);
    if (!ids.length) return;
    if (
      !(await ask({
        title: '자료 지우기',
        body: `고른 자료 ${ids.length}개와 그 노트·문제·복습 기록을 모두 지울까요?`,
        note: '되돌릴 수 없어요.',
        ok: `${ids.length}개 지우기`,
        danger: true,
      }))
    )
      return;
    setBusy('delete');
    try {
      let deleted = 0;
      for (let i = 0; i < ids.length; i += BULK_MAX) {
        const r = await api<{ deleted: number }>('/api/sources/delete', { method: 'POST', body: JSON.stringify({ ids: ids.slice(i, i + BULK_MAX) }) });
        deleted += r.deleted;
      }
      onLocal((rows) => rows.filter((r) => !ids.includes(r.id)));
      toast(`${deleted}개를 지웠어요.`, 'plain', DONE);
      endSelect();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  /** 다른 과목으로 옮기기 (노트·문제·복습 기록이 함께 간다) */
  const move = async (ids: string[], target: SubjectRow): Promise<boolean> => {
    try {
      let moved = 0;
      for (let i = 0; i < ids.length; i += BULK_MAX) {
        const r = await api<{ moved: number }>('/api/sources/move', {
          method: 'POST',
          body: JSON.stringify({ ids: ids.slice(i, i + BULK_MAX), subject: target.id }),
        });
        moved += r.moved;
      }
      onLocal((rows) => rows.map((r) => (ids.includes(r.id) ? { ...r, subject_id: target.id } : r)));
      toast(moved ? `노트 ${moved}개를 '${target.name}' 과목으로 옮겼어요.` : `이미 '${target.name}' 과목에 있어요.`, 'plain', DONE);
      endSelect();
      window.dispatchEvent(new Event(SUBJECTS_CHANGED));
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return false;
    }
  };

  const movingFrom = moving ? [...new Set(recent.filter((s) => moving.includes(s.id)).map((s) => s.subject_id))] : [];

  return (
    <>
      <SectionTitle
        action={
          selecting ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                // 화면 바탕 위 글자는 본문·흐린 글자만(화면 빛 위에서 읽히게, fx.ts): 포인트 글자는 연한 알약 안에
                className="press rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent hover:brightness-95"
                onClick={() => setPicked(allPicked ? new Set() : new Set(recent.map((s) => s.id)))}
              >
                {allPicked ? '모두 풀기' : '모두 고르기'}
              </button>
              {/* 손가락이 닿는 크기(44px)지만 줄 높이는 알약과 같게 (고르기를 시작해도 아래가 밀리지 않게) */}
              <IconButton label="고르기 끝내기" className="-my-2 -mr-2" onClick={endSelect}>
                <Icon d={ICONS.close} size={18} />
              </IconButton>
            </span>
          ) : (
            // 화면 바탕 위 글자는 본문·흐린 글자만(화면 빛 위에서 읽히게, fx.ts): 포인트 글자는 연한 알약 안에.
            // 여러 개 고르기는 카드를 꾹 누르면 (키보드는 메뉴 키·Shift+F10)
            <Link href="/library" className="press rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent hover:brightness-95">
              자료함 →
            </Link>
          )
        }
      >
        {selecting ? (
          <span key={pickedRows.length ? 'n' : 'none'} className="kok-swap">
            {pickedRows.length ? `${pickedRows.length}개 선택` : '노트 고르기'}
          </span>
        ) : (
          '최근 노트'
        )}
      </SectionTitle>
      {/* 위·아래 여유(pt-2·-mt-2): 고르기 동그라미와 고른 카드 테두리가 가로 스크롤 칸에 잘리지 않게 (자리는 그대로).
          scroll-px-4: 카드가 화면 끝이 아니라 여백(16px)에 맞춰 멈춘다 (snap-start 가 첫 카드를 화면 끝에 붙이지 않게) */}
      <div
        role={selecting ? 'group' : undefined}
        aria-label={selecting ? '최근 노트 고르기' : undefined}
        className="no-scrollbar -mx-4 -mt-2 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 pt-2 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0"
      >
        {recent.map((s, i) => (
          <RecentCard
            key={s.id}
            s={s}
            index={i}
            subject={subjectOf.get(s.subject_id) ?? null}
            selecting={selecting}
            picked={picked.has(s.id)}
            onPick={() => togglePick(s.id)}
            onLongPress={() => (selecting ? togglePick(s.id) : startSelect(s.id))}
          />
        ))}
      </div>

      {/* 여러 개 고르기: 아래 띠 (폰은 아래 메뉴 자리, 넓은 화면은 가운데 떠 있는 띠) */}
      {selecting ? (
        <SelectionBar count={pickedRows.length} noun="노트">
          {organize ? (
            <BarAction icon={ICONS.star} label={labels.star ? '별표' : '별표 빼기'} disabled={off} busy={busy === 'star'} onClick={() => void patch('star')} />
          ) : null}
          {organize ? (
            <BarAction
              icon={labels.review ? ICONS.review : ICONS.reviewOff}
              label={labels.review ? '복습 켜기' : '복습 끄기'}
              disabled={off}
              busy={busy === 'review'}
              onClick={() => void patch('review')}
            />
          ) : null}
          {merge ? <BarAction icon={ICONS.move} label="옮기기" disabled={off} onClick={() => setMoving(pickedRows.map((s) => s.id))} /> : null}
          {merge ? <BarAction icon={ICONS.merge} label="합치기" disabled={off || pickedRows.length < 2} onClick={() => setMerging(true)} /> : null}
          <BarAction icon={ICONS.trash} label="지우기" danger disabled={off} busy={busy === 'delete'} onClick={() => void remove()} />
        </SelectionBar>
      ) : null}

      <SubjectPickSheet
        open={!!moving}
        onClose={() => setMoving(null)}
        title="다른 과목으로 옮기기"
        intro={<>{moving && moving.length > 1 ? `고른 노트 ${moving.length}개` : '이 노트'}를 옮길 과목을 골라요. 노트·문제·복습 기록이 함께 옮겨져요.</>}
        subjects={subjects}
        exclude={movingFrom.length === 1 ? movingFrom : []}
        allowNew
        actionLabel={(name) => (name ? `'${name}' 과목으로 옮기기` : '옮길 과목을 골라 주세요')}
        onConfirm={(target) => (moving ? move(moving, target) : Promise.resolve(false))}
      />
      <MergeNotesSheet
        open={merging}
        onClose={() => setMerging(false)}
        notes={pickedRows}
        subjects={subjects}
        onMerged={(keepId, count) => {
          setMerging(false);
          endSelect();
          window.dispatchEvent(new CustomEvent(SOURCES_CHANGED));
          toast(`노트 ${count}개를 한 노트로 합쳤어요.`, 'plain', DONE);
          router.push(`/notes/${keepId}`);
        }}
      />
    </>
  );
}

/** 최근 노트 카드 하나: 누르면 노트, 꾹 누르면 고르기 (고르는 동안은 어디를 눌러도 고르기만) */
function RecentCard({
  s,
  index,
  subject,
  selecting,
  picked,
  onPick,
  onLongPress,
}: {
  s: Recent;
  index: number;
  subject: SubjectRow | null;
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  onLongPress: () => void;
}) {
  const press = useLongPress(onLongPress, true);
  const busy = s.status === 'queued' || s.status === 'processing';
  const title = s.title || '제목 없는 자료';
  // 고르는 중: 스페이스·엔터로 고른다 (링크로 가지 않는다)
  const pickKeys = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onPick();
    }
  };
  const selectProps = selecting ? { role: 'checkbox' as const, 'aria-checked': picked, 'aria-label': title, onKeyDown: pickKeys } : {};
  return (
    <div
      className="kok-no-callout relative shrink-0 snap-start"
      {...press}
      onClickCapture={(e) => {
        press.onClickCapture(e);
        if (e.defaultPrevented) return;
        if (selecting) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        }
      }}
    >
      <Link
        href={`/notes/${s.id}`}
        // 꾹 누른 채 움직여도 링크를 끌지 않는다 (꾹 누르기는 고르기)
        draggable={false}
        className={cx(
          'kok-card kok-detail-card press flex h-[150px] w-[150px] flex-col overflow-hidden p-3.5 md:w-auto',
          !selecting && 'kok-card-hover',
          selecting && picked && PICKED_RING,
        )}
        style={{ ['--i' as string]: index }}
        {...selectProps}
      >
        <p className={cx('kok-fill line-clamp-3 min-h-0 flex-1 text-xs leading-relaxed text-muted', busy && 'kok-shimmer rounded-lg')}>
          {busy
            ? '정리하는 중이에요…'
            : s.status === 'error'
              ? '멈췄어요. 눌러서 다시 해 보세요.'
              : s.summary
                ? previewText(s.summary)
                : s.manual
                  ? '직접 만든 노트예요.'
                  : '정리 노트가 준비됐어요.'}
        </p>
        <p className="kok-fill line-clamp-2 text-sm font-bold leading-snug">{title}</p>
        <p className="kok-fill mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted">
          {subject ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectVar(subject.color) }} aria-hidden="true" /> : null}
          <span className="truncate">{subject?.name ?? ''}</span>
        </p>
      </Link>
      {selecting ? <PickBadge picked={picked} /> : null}
    </div>
  );
}
