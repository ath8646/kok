'use client';
// 정리 노트: 한 줄 요약, 핵심 개념(별표한 것이 맨 위), 공식, 용어, 확인할 것, AI가 바꾼 것.
// 고치기: 칸마다 쉬운 꾸미기(굵게·형광펜·빨간 글씨·목록·수식)와 미리보기 (note/NoteEditors).
// 순서 바꾸기: 개념·공식·용어 머리의 '순서 바꾸기' → 줄을 꾹 눌러 끌기 (note/SortList).
// 개념 순서 = 저장된 배열 순서. 화면에는 별표한 개념을 먼저 (별표끼리·나머지끼리는 그 순서대로).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { KeyPoint, Note } from '@/lib/ai/schemas';
import { previewText } from '@/lib/richtext';
import { starredFirst } from '@/lib/note-order';
import { RichText, Tex } from './RichText';
import { Button, Chip, Icon, ICONS, cx, useToast } from './ui';
import { StarButton, StarGlyph } from './note/StarButton';
import { SortList } from './note/SortList';
import { FormulaEditor, KeyPointEditor, SummaryEditor, TermEditor, type KeyPointDraft } from './note/NoteEditors';
import { prefersReducedMotion } from './useReducedMotion';

export type NoteBody = Note & { recommended?: string };

type Sorting = 'kp' | 'formula' | 'term' | null;
type Linked = { text: string; key_point_id: string; edited?: boolean };

const IMPORTANCE: Record<KeyPoint['importance'], { label: string; tone: 'bad' | 'accent' | 'plain' }> = {
  high: { label: '꼭 외우기', tone: 'bad' },
  medium: { label: '중요', tone: 'accent' },
  low: { label: '참고', tone: 'plain' },
};

const SORT_ICON = 'M8 5v14M4.5 8.5L8 5l3.5 3.5M16 19V5M12.5 15.5L16 19l3.5-3.5';

export function pageLabel(kind: string, p: number): string {
  return kind === 'image' ? `사진 ${p}` : `${p}쪽`;
}

/** 카드 이름을 화면 읽기·순서 줄에 쓸 글로 (꾸미기 기호·수식 표시 없이) */
function plain(text: string): string {
  return previewText(text) || text;
}

/** 개념에 딸린 함정·예시를 새 글들로 바꾼다 (같은 글은 '고침' 표시 그대로, 자리는 처음 것이 있던 곳) */
function replaceLinked<T extends Linked>(list: T[], kpId: string, texts: string[]): T[] {
  const old = list.filter((p) => p.key_point_id === kpId);
  const rest = list.filter((p) => p.key_point_id !== kpId);
  const first = list.findIndex((p) => p.key_point_id === kpId);
  const at = first < 0 ? rest.length : list.slice(0, first).filter((p) => p.key_point_id !== kpId).length;
  const next = texts.map((text) => old.find((p) => p.text === text) ?? ({ text, key_point_id: kpId, edited: true } as T));
  return [...rest.slice(0, at), ...next, ...rest.slice(at)];
}

/** 새 개념 번호: 개념은 물론 함정·예시가 가리키는 번호와도 겹치지 않게 (주인 없는 함정이 새 개념에 붙지 않게) */
function newKeyPointId(note: Note): string {
  const used = new Set([...note.key_points.map((k) => k.id), ...note.pitfalls.map((p) => p.key_point_id), ...note.examples.map((p) => p.key_point_id)]);
  let n = note.key_points.length + 1;
  while (used.has(`k${n}`)) n++;
  return `k${n}`;
}

/**
 * 순서가 바뀌면 카드가 원래 자리에서 새 자리로 미끄러진다 (FLIP: 바뀌기 전 자리를 재고, 바뀐 뒤 거꾸로 옮겼다가 풀어 준다).
 * 움직이는 카드(lead)는 다른 카드 위로 살짝 떠서 지나간다. 움직임 줄이기면 바로 바뀐다
 */
function useFlip(root: RefObject<HTMLElement | null>, orderKey: string, onLeadAway: (up: boolean) => void) {
  const before = useRef<Map<string, number> | null>(null);
  const lead = useRef<string | null>(null);
  const away = useRef(onLeadAway);
  useEffect(() => {
    away.current = onLeadAway;
  }, [onLeadAway]);
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
      // 움직인 카드가 화면 밖으로 갔으면 알려 준다
      if (isLead && (rect.bottom < 90 || rect.top > window.innerHeight - 40)) away.current(dy > 0);
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

function PencilButton({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'press inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink',
        className,
      )}
      aria-label={label}
    >
      <Icon d={ICONS.edit} size={14} strokeWidth={2} />
      고치기
    </button>
  );
}

function SectionHead({ title, count, canSort, sorting, onSort }: { title: string; count?: number; canSort: boolean; sorting: boolean; onSort: () => void }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-2">
      <h3 className="font-display text-lg">
        {title}
        {typeof count === 'number' ? <span className="ml-1.5 text-[15px] font-bold tabular-nums text-muted">{count}</span> : null}
      </h3>
      {canSort ? (
        sorting ? (
          <Button size="sm" onClick={onSort}>
            완료
          </Button>
        ) : (
          <button
            type="button"
            className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
            onClick={onSort}
          >
            <Icon d={SORT_ICON} size={17} />
            순서 바꾸기
          </button>
        )
      ) : null}
    </div>
  );
}

function SortHint({ children }: { children: ReactNode }) {
  return <p className="kok-appear px-1 text-sm text-muted">{children}</p>;
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

export function NoteView({
  note,
  kind,
  editable,
  onChange,
  highlightKeyPoint,
  onSelectKeyPoint,
  onOpenPage,
}: {
  note: NoteBody;
  kind: string;
  editable?: boolean;
  onChange?: (next: NoteBody) => void;
  highlightKeyPoint?: string | null;
  onSelectKeyPoint?: (id: string | null) => void;
  onOpenPage?: (page: number) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [sorting, setSorting] = useState<Sorting>(null);
  // 고칠 수 없게 되면(자료를 더하기 시작함 등) 열려 있던 고치기 칸과 순서 바꾸기를 닫는다
  const [wasEditable, setWasEditable] = useState(editable);
  if (wasEditable !== editable) {
    setWasEditable(editable);
    if (!editable) {
      setEditing(null);
      setSorting(null);
    }
  }
  const [showChanges, setShowChanges] = useState(false);
  const change = (next: NoteBody) => onChange?.(next);
  const save = (next: NoteBody) => {
    onChange?.(next);
    setEditing(null);
  };
  const open = (key: string) => {
    setSorting(null);
    setEditing(key);
  };
  const sortToggle = (s: Exclude<Sorting, null>) => {
    setEditing(null);
    setSorting((cur) => (cur === s ? null : s));
  };

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
  const onLeadAway = useCallback((up: boolean) => toast(up ? '★ 별표한 개념은 맨 위에 모여요.' : '별표를 빼서 원래 자리로 옮겼어요.'), [toast]);
  const flip = useFlip(listRef, ordered.map((k) => k.id).join('|'), onLeadAway);
  const toggleStar = (kp: KeyPoint) => {
    const on = !kp.starred;
    const key_points = note.key_points.map((x) => (x.id === kp.id ? { ...x, starred: on || undefined } : x));
    const now = ordered.map((k) => k.id);
    // 자리가 바뀔 때만 움직임을 잰다 (맨 위 카드에 별표하면 그대로)
    const moves = starredFirst(key_points)
      .map((k) => k.id)
      .some((id, i) => id !== now[i]);
    setHold(now);
    change({ ...note, key_points });
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

  const starredKps = useMemo(() => note.key_points.filter((k) => k.starred), [note.key_points]);
  const otherKps = useMemo(() => note.key_points.filter((k) => !k.starred), [note.key_points]);
  /** 같은 묶음(별표·나머지) 안에서 바꾼 순서를 전체 배열에 넣는다 */
  const reorderGroup = (starredGroup: boolean, next: KeyPoint[]) => {
    let g = 0;
    change({ ...note, key_points: note.key_points.map((k) => (!!k.starred === starredGroup ? next[g++] : k)) });
  };

  const saveKeyPoint = (d: KeyPointDraft, isNew: boolean) => {
    const kp = { ...d.kp, edited: true };
    save({
      ...note,
      key_points: isNew ? [...note.key_points, kp] : note.key_points.map((x) => (x.id === kp.id ? kp : x)),
      pitfalls: replaceLinked(note.pitfalls, kp.id, d.pitfalls),
      examples: replaceLinked(note.examples, kp.id, d.examples),
    });
  };

  const pages = (ps: number[]) =>
    ps.length && kind !== 'text' ? (
      <span className="flex flex-wrap gap-1">
        {ps.slice(0, 6).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onOpenPage?.(p)}
            className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
          >
            {pageLabel(kind, p)}
          </button>
        ))}
      </span>
    ) : null;

  const kpRow = (k: KeyPoint, n: number) => (
    <>
      <span
        className={cx(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums',
          k.starred ? 'bg-hl text-hl-ink' : 'bg-accent text-accent-ink',
        )}
      >
        {n}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{plain(k.title) || '이름 없는 개념'}</span>
      {k.starred ? <StarGlyph on size={18} /> : null}
    </>
  );

  const showFormulas = note.formulas.length > 0 || editing === 'f-new';
  const showTerms = note.terms.length > 0 || editing === 't-new';

  return (
    <div className="grid gap-5">
      {/* 한 줄 요약 (kok-paper: 테마의 노트 종이 무늬) */}
      <section className="kok-card kok-paper p-4">
        <div className="mb-1 flex min-h-8 items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-muted">한 줄 요약</h3>
          {editable && editing !== 'summary' ? <PencilButton label="요약 고치기" onClick={() => open('summary')} /> : null}
        </div>
        {editing === 'summary' ? (
          <SummaryEditor initial={note.summary} onCancel={() => setEditing(null)} onSave={(v) => save({ ...note, summary: v, summary_edited: true })} />
        ) : note.summary.trim() ? (
          <p className="text-[17px] font-semibold leading-relaxed">
            <span className="hl-mark">
              <RichText text={note.summary} />
            </span>
          </p>
        ) : (
          <p className="text-[15px] text-muted">{editable ? '이 노트를 한 줄로 적어 보세요.' : '요약이 아직 없어요.'}</p>
        )}
      </section>

      {/* 핵심 개념 */}
      <section className="grid gap-3">
        <SectionHead
          title="핵심 개념"
          count={note.key_points.length || undefined}
          canSort={!!editable && note.key_points.length > 1}
          sorting={sorting === 'kp'}
          onSort={() => sortToggle('kp')}
        />
        {sorting === 'kp' ? (
          <div className="grid gap-2.5">
            <SortHint>줄을 꾹 누른 채로 끌면 순서가 바뀌어요. 별표한 개념은 늘 맨 위에 있어요.</SortHint>
            {starredKps.length ? (
              <div className="grid gap-2">
                {otherKps.length ? (
                  <p className="flex items-center gap-1 px-1 text-xs font-bold text-muted">
                    <StarGlyph on size={14} /> 별표한 개념
                  </p>
                ) : null}
                <SortList
                  items={starredKps}
                  keyOf={(k) => k.id}
                  label="별표한 개념 순서"
                  nameOf={(k) => plain(k.title)}
                  render={(k, i) => kpRow(k, i + 1)}
                  onReorder={(next) => reorderGroup(true, next)}
                />
              </div>
            ) : null}
            {otherKps.length ? (
              <div className="grid gap-2">
                {starredKps.length ? <p className="px-1 text-xs font-bold text-muted">다른 개념</p> : null}
                <SortList
                  items={otherKps}
                  keyOf={(k) => k.id}
                  label="개념 순서"
                  nameOf={(k) => plain(k.title)}
                  render={(k, i) => kpRow(k, starredKps.length + i + 1)}
                  onReorder={(next) => reorderGroup(false, next)}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div ref={listRef} className="grid gap-3">
            {ordered.map((kp, idx) => {
              const imp = IMPORTANCE[kp.importance] ?? IMPORTANCE.medium;
              const hl = highlightKeyPoint === kp.id;
              const pits = note.pitfalls.filter((p) => p.key_point_id === kp.id);
              const exs = note.examples.filter((p) => p.key_point_id === kp.id);
              const editKey = `kp-${kp.id}`;
              const isEditing = editing === editKey;
              const name = plain(kp.title);
              return (
                <article
                  key={kp.id}
                  id={`kp-${kp.id}`}
                  data-flip={kp.id}
                  className={cx(
                    'kok-card kok-paper kok-kp p-4 transition-shadow',
                    hl && 'shadow-[0_0_0_3px_var(--hl)]',
                    kp.starred && 'is-starred',
                    flash === kp.id && 'is-flash',
                  )}
                  onClick={() => (isEditing ? undefined : onSelectKeyPoint?.(hl ? null : kp.id))}
                >
                  {isEditing ? (
                    // 고칠 때는 카드 너비를 다 쓴다 (폰에서 칸이 좁지 않게)
                    <div className="grid gap-3">
                      <p className="flex items-center gap-2 text-sm font-bold text-muted">
                        <span
                          className={cx(
                            'grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums',
                            kp.starred ? 'bg-hl text-hl-ink' : 'bg-accent text-accent-ink',
                          )}
                        >
                          {idx + 1}
                        </span>
                        개념 고치기
                      </p>
                      <KeyPointEditor
                        kp={kp}
                        pitfalls={pits.map((p) => p.text)}
                        examples={exs.map((p) => p.text)}
                        onCancel={() => setEditing(null)}
                        onSave={(d) => saveKeyPoint(d, false)}
                        onDelete={() =>
                          save({
                            ...note,
                            key_points: note.key_points.filter((x) => x.id !== kp.id),
                            pitfalls: note.pitfalls.filter((p) => p.key_point_id !== kp.id),
                            examples: note.examples.filter((p) => p.key_point_id !== kp.id),
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <span
                        className={cx(
                          'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums transition-colors',
                          kp.starred ? 'bg-hl text-hl-ink' : 'bg-accent text-accent-ink',
                          flash === kp.id && 'kok-badge-pop',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <>
                          <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', (editable || kp.starred) && 'pr-9')}>
                            <h4 className="text-[16px] font-bold">
                              <RichText text={kp.title} />
                            </h4>
                            <Chip tone={imp.tone}>{imp.label}</Chip>
                          </div>
                          {kp.explanation ? (
                            <p className="mt-1.5 text-[15px] leading-relaxed">
                              <RichText text={kp.explanation} />
                            </p>
                          ) : null}
                          {kp.why ? (
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
                          {kp.pages.length || editable ? (
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                              {pages(kp.pages)}
                              {editable ? <PencilButton className="ml-auto" label={`${name} 고치기`} onClick={() => open(editKey)} /> : null}
                            </div>
                          ) : null}
                        </>
                      </div>
                    </div>
                  )}
                  {isEditing ? null : editable ? (
                    <StarButton className="absolute right-2 top-2" on={!!kp.starred} label={`${name} 별표`} onToggle={() => toggleStar(kp)} />
                  ) : kp.starred ? (
                    <span className="absolute right-3.5 top-3.5" title="별표한 개념">
                      <StarGlyph on size={20} />
                    </span>
                  ) : null}
                </article>
              );
            })}
            {editing === 'kp-new' ? (
              <article className="kok-card kok-paper kok-kp kok-appear grid gap-3 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-muted">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink">
                    {note.key_points.length + 1}
                  </span>
                  새 개념
                </p>
                <KeyPointEditor
                  isNew
                  kp={{ id: newKeyPointId(note), title: '', explanation: '', why: '', importance: 'medium', pages: [] }}
                  pitfalls={[]}
                  examples={[]}
                  onCancel={() => setEditing(null)}
                  onSave={(d) => saveKeyPoint(d, true)}
                />
              </article>
            ) : !note.key_points.length ? (
              <div className="kok-card kok-paper grid justify-items-center gap-1.5 px-5 py-8 text-center">
                <p className="font-display text-lg">아직 개념이 없어요</p>
                <p className="max-w-xs text-sm text-muted">
                  {editable ? '외울 개념을 하나씩 적어 보세요. 굵게·형광펜으로 꾸밀 수도 있어요.' : '이 노트에는 개념이 없어요.'}
                </p>
                {editable ? (
                  <Button className="mt-3" onClick={() => open('kp-new')}>
                    첫 개념 적기
                  </Button>
                ) : null}
              </div>
            ) : editable ? (
              <AddRow onClick={() => open('kp-new')}>개념 추가</AddRow>
            ) : null}
          </div>
        )}
      </section>

      {/* 공식 */}
      {showFormulas ? (
        <section className="grid gap-2.5">
          <SectionHead
            title="공식"
            count={note.formulas.length || undefined}
            canSort={!!editable && note.formulas.length > 1}
            sorting={sorting === 'formula'}
            onSort={() => sortToggle('formula')}
          />
          {sorting === 'formula' ? (
            <>
              <SortHint>줄을 꾹 누른 채로 끌면 순서가 바뀌어요.</SortHint>
              <SortList
                items={note.formulas}
                label="공식 순서"
                nameOf={(f) => f.label || f.latex}
                render={(f) => (
                  <span className="min-w-0 flex-1">
                    {f.label ? <span className="block truncate text-sm font-bold">{plain(f.label)}</span> : null}
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                      <Tex tex={f.latex} />
                    </span>
                  </span>
                )}
                onReorder={(next) => change({ ...note, formulas: next })}
              />
            </>
          ) : (
            <>
              {note.formulas.map((f, i) =>
                editing === `f-${i}` ? (
                  <div key={i} className="kok-card p-4">
                    <FormulaEditor
                      initial={f}
                      onCancel={() => setEditing(null)}
                      onSave={(nf) => save({ ...note, formulas: note.formulas.map((x, j) => (j === i ? { ...nf, edited: true } : x)) })}
                      onDelete={() => save({ ...note, formulas: note.formulas.filter((_, j) => j !== i) })}
                    />
                  </div>
                ) : (
                  <div key={i} className="kok-card p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {f.label ? (
                          <p className="mb-1 text-sm font-semibold text-muted">
                            <RichText text={f.label} />
                          </p>
                        ) : null}
                        <div className="overflow-x-auto">
                          <Tex tex={f.latex} display />
                        </div>
                      </div>
                      {editable ? <PencilButton label={`${f.label ? plain(f.label) : `공식 ${i + 1}`} 고치기`} onClick={() => open(`f-${i}`)} /> : null}
                    </div>
                  </div>
                ),
              )}
              {editing === 'f-new' ? (
                <div className="kok-card kok-appear p-4">
                  <FormulaEditor
                    initial={{ latex: '', label: '' }}
                    onCancel={() => setEditing(null)}
                    onSave={(nf) => save({ ...note, formulas: [...note.formulas, { ...nf, edited: true }] })}
                  />
                </div>
              ) : editable ? (
                <AddRow onClick={() => open('f-new')}>공식 추가</AddRow>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* 용어 */}
      {showTerms ? (
        <section className="grid gap-2.5">
          <SectionHead
            title="용어"
            count={note.terms.length || undefined}
            canSort={!!editable && note.terms.length > 1}
            sorting={sorting === 'term'}
            onSort={() => sortToggle('term')}
          />
          {sorting === 'term' ? (
            <>
              <SortHint>줄을 꾹 누른 채로 끌면 순서가 바뀌어요.</SortHint>
              <SortList
                items={note.terms}
                label="용어 순서"
                nameOf={(t) => plain(t.term)}
                render={(t) => (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{plain(t.term)}</span>
                    <span className="block truncate text-sm text-muted">{plain(t.meaning)}</span>
                  </span>
                )}
                onReorder={(next) => change({ ...note, terms: next })}
              />
            </>
          ) : (
            <>
              {note.terms.length ? (
                <dl className="divide-y divide-line overflow-hidden kok-card">
                  {note.terms.map((t, i) =>
                    editing === `t-${i}` ? (
                      <div key={i} className="p-4">
                        <TermEditor
                          initial={t}
                          onCancel={() => setEditing(null)}
                          onSave={(nt) => save({ ...note, terms: note.terms.map((x, j) => (j === i ? { ...nt, edited: true } : x)) })}
                          onDelete={() => save({ ...note, terms: note.terms.filter((_, j) => j !== i) })}
                        />
                      </div>
                    ) : (
                      // 폰: 용어 위, 뜻 아래 (뜻이 좁은 칸에 갇히지 않게). 넓은 화면: 두 칸
                      <div key={i} className={cx('relative px-4 py-3 sm:flex sm:items-start sm:gap-3', editable && 'sm:pr-24')}>
                        <dt className={cx('font-bold sm:w-36 sm:shrink-0', editable && 'pr-20 sm:pr-0')}>
                          <RichText text={t.term} />
                        </dt>
                        <dd className="mt-0.5 min-w-0 text-[15px] sm:mt-0 sm:flex-1">
                          <RichText text={t.meaning} />
                          {editable ? (
                            <PencilButton className="absolute right-2 top-2" label={`${plain(t.term)} 고치기`} onClick={() => open(`t-${i}`)} />
                          ) : null}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              ) : null}
              {editing === 't-new' ? (
                <div className="kok-card kok-appear p-4">
                  <TermEditor
                    initial={{ term: '', meaning: '' }}
                    onCancel={() => setEditing(null)}
                    onSave={(nt) => save({ ...note, terms: [...note.terms, { ...nt, edited: true }] })}
                  />
                </div>
              ) : editable ? (
                <AddRow onClick={() => open('t-new')}>용어 추가</AddRow>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* 비어 있는 칸은 여기서 더한다 */}
      {editable && (!showFormulas || !showTerms) ? (
        <div className="flex flex-wrap gap-2">
          {!showFormulas ? (
            <button
              type="button"
              className="press inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-3"
              onClick={() => open('f-new')}
            >
              <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
              공식 추가
            </button>
          ) : null}
          {!showTerms ? (
            <button
              type="button"
              className="press inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-3"
              onClick={() => open('t-new')}
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
      {note.changes.length ? (
        <section className="kok-card p-4">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left font-bold"
            onClick={() => setShowChanges((v) => !v)}
            aria-expanded={showChanges}
          >
            AI가 정리하며 바꾼 것 {note.changes.length}개<span className="text-sm text-muted">{showChanges ? '접기' : '펼치기'}</span>
          </button>
          {showChanges ? (
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted">
              {note.changes.map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
