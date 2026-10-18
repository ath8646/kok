'use client';
// 자료함: 과목(폴더) 칩 + 노트 카드 격자. 파일은 화면에 끌어다 놓고, 글은 + 버튼에서 엔터로 넣는다.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMe, EnergyPill } from './AppShell';
import { SOURCES_CHANGED, SUBJECTS_CHANGED, useQuickAdd } from './QuickAdd';
import { stepLabel, useActiveSources } from './ProcessingList';
import { SubjectForm } from './SubjectForm';
import { Button, EmptyState, ICONS, Icon, IconButton, LargeHeader, Menu, ProgressRing, Sheet, api, cx, inputClass, useToast, type MenuItem } from './ui';
import { SOURCE_COLS, fetchAll, fetchSubjects, sb, topLevelSources, type SourceRowWithUnit } from '@/lib/data';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { previewText } from '@/lib/richtext';
import { daysUntil } from '@/lib/time';

type LibSource = SourceRowWithUnit & { summary: string | null };

async function fetchLibrary(): Promise<{ subjects: SubjectRow[]; sources: LibSource[] }> {
  const [subjects, sources, notes] = await Promise.all([
    fetchSubjects(),
    fetchAll<SourceRowWithUnit>((a, b) =>
      topLevelSources<SourceRowWithUnit[]>((onlyTop) => {
        let q = sb().from('sources').select(SOURCE_COLS);
        if (onlyTop) q = q.is('parent_id', null);
        return q.order('created_at', { ascending: false }).order('id').range(a, b) as unknown as PromiseLike<{
          data: SourceRowWithUnit[] | null;
          error: unknown;
        }>;
      }),
    ),
    fetchAll<{ source_id: string; summary: string | null }>(
      (a, b) =>
        sb().from('notes').select('source_id, summary:body->>summary').order('id').range(a, b) as unknown as PromiseLike<{
          data: Array<{ source_id: string; summary: string | null }> | null;
          error: unknown;
        }>,
    ),
  ]);
  const sum = new Map(notes.map((n) => [n.source_id, n.summary]));
  return { subjects, sources: sources.map((s) => ({ ...s, summary: sum.get(s.id) ?? null })) };
}

const KIND_ICON = { text: ICONS.pen, pdf: ICONS.file, image: ICONS.image } as const;
const KIND_LABEL = { text: '글', pdf: 'PDF', image: '사진' } as const;

function shortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ko-KR', sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** /library/<과목> 에서 과목 번호 */
function subjectFromPath(pathname: string): string | null {
  const m = /^\/library\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/** 과목 칩을 바꾸면 화면을 다시 그리지 않고 주소만 바꾼다 (새로 고침·공유해도 같은 과목이 열린다) */
function setUrl(subjectId: string | null) {
  const url = subjectId ? `/library/${subjectId}` : '/library';
  if (window.location.pathname !== url || window.location.search) window.history.replaceState(null, '', url);
}

export function LibraryView() {
  const { me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const quick = useQuickAdd();
  const active = useActiveSources();
  const reloadActive = active.reload;
  const [data, setData] = useState<{ subjects: SubjectRow[]; sources: LibSource[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(() => subjectFromPath(pathname));
  // 뒤로 가기 등으로 주소가 바뀌면 고른 과목도 따라간다
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (pathname === '/library' || pathname.startsWith('/library/')) setSelected(subjectFromPath(pathname));
  }
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [editingSubject, setEditingSubject] = useState<SubjectRow | 'new' | null>(null);
  const [renaming, setRenaming] = useState<LibSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const searchRef = useRef<HTMLInputElement>(null);

  // 불러오기 (처음, 새 자료가 들어왔을 때, 정리가 끝났을 때)
  useEffect(() => {
    let alive = true;
    fetchLibrary()
      .then((r) => {
        if (alive) setData(r);
      })
      .catch(() => {
        if (!alive) return;
        toast('자료함을 불러오지 못했어요.', 'bad');
        setData((d) => d ?? { subjects: [], sources: [] });
      });
    return () => {
      alive = false;
    };
  }, [version, active.doneCount, toast]);

  // 새로 넣은 자료는 카드가 반짝이며 나타난다
  useEffect(() => {
    const onAdded = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) {
        setFresh((s) => new Set(s).add(id));
        setTimeout(
          () =>
            setFresh((s) => {
              const n = new Set(s);
              n.delete(id);
              return n;
            }),
          2400,
        );
      }
      reload();
      reloadActive();
    };
    const onSubjects = () => reload();
    window.addEventListener(SOURCES_CHANGED, onAdded);
    window.addEventListener(SUBJECTS_CHANGED, onSubjects);
    return () => {
      window.removeEventListener(SOURCES_CHANGED, onAdded);
      window.removeEventListener(SUBJECTS_CHANGED, onSubjects);
    };
  }, [reload, reloadActive]);

  // + 버튼과 끌어다 놓기는 지금 고른 과목에 넣는다
  useEffect(() => {
    quick.setContextSubject(selected);
    return () => quick.setContextSubject(null);
  }, [quick, selected]);

  // 처음 들어올 때 ?compose=1 이면 입력창을 연다 (가입 직후, 예전 '자료 넣기' 주소)
  const composeAsked = useRef(false);
  useEffect(() => {
    if (composeAsked.current || !data) return;
    composeAsked.current = true;
    const p = new URLSearchParams(window.location.search);
    if (p.get('compose') === '1') {
      setUrl(selected);
      quick.openComposer(selected ?? undefined);
    }
  }, [data, quick, selected]);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  // 고른 과목 칩이 가려져 있으면 가로로 밀어 가운데에 보이게 한다
  const chipsRef = useRef<HTMLDivElement>(null);
  const chipCount = data?.subjects.length ?? 0;
  useEffect(() => {
    const box = chipsRef.current;
    const chip = box?.querySelector<HTMLElement>(`[data-chip="${selected ?? 'all'}"]`);
    if (!box || !chip) return;
    const left = chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [selected, chipCount]);

  // 정리 중인 자료의 진행률은 4초마다 새로 받은 값으로 덮는다
  const live = useMemo(() => new Map((active.items ?? []).map((s) => [s.id, s])), [active.items]);
  const subjects = useMemo(() => data?.subjects ?? [], [data]);
  const subject = selected ? (subjects.find((s) => s.id === selected) ?? null) : null;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data?.sources ?? []) m.set(s.subject_id, (m.get(s.subject_id) ?? 0) + 1);
    return m;
  }, [data]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.sources ?? [])
      .filter((s) => !selected || s.subject_id === selected)
      .filter((s) => !q || [s.title, s.unit, s.summary ? previewText(s.summary) : ''].some((x) => (x ?? '').toLowerCase().includes(q)))
      .map((s) => {
        const l = live.get(s.id);
        return l ? { ...s, ...l, summary: s.summary } : s;
      });
  }, [data, selected, query, live]);

  // 과목을 고르고 단원이 있으면 단원별로 묶는다
  const groups = useMemo(() => {
    if (!selected || !shown.some((s) => s.unit?.trim())) return [{ unit: '', list: shown }];
    const m = new Map<string, LibSource[]>();
    for (const s of shown) {
      const u = s.unit?.trim() || '';
      m.set(u, [...(m.get(u) ?? []), s]);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0], 'ko', { numeric: true })))
      .map(([unit, list]) => ({ unit: unit || '단원 없음', list }));
  }, [selected, shown]);

  const select = (id: string | null) => {
    setSelected(id);
    setUrl(id);
  };

  if (!me) return null;
  if (selected && data && !subject) {
    // 지워진 과목 주소로 들어왔다
    return (
      <div className="grid gap-1">
        <LargeHeader title="자료함" subtitle="과목을 찾을 수 없어요" />
        <EmptyState title="지워졌거나 없는 과목이에요" action={<Button onClick={() => select(null)}>자료함 전체 보기</Button>} />
      </div>
    );
  }

  const exam = subject?.exam_date ? daysUntil(subject.exam_date) : null;
  const total = selected ? (counts.get(selected) ?? 0) : (data?.sources.length ?? 0);
  const subtitle = data ? (
    <span className="flex flex-wrap items-center gap-x-2">
      <span>자료 {total}개</span>
      {exam !== null && exam >= 0 ? (
        <span className={cx('font-semibold', exam <= 3 ? 'text-bad' : 'text-accent')}>· 시험 {exam === 0 ? 'D-DAY' : `D-${exam}`}</span>
      ) : null}
    </span>
  ) : (
    ' '
  );

  const headerMenu: MenuItem[] = subject
    ? [
        { label: '이 과목만 복습', icon: ICONS.retry, onSelect: () => router.push(`/review?subject=${subject.id}`) },
        { label: '문제 모아 보기', icon: ICONS.grid, onSelect: () => router.push(`/questions?subject=${subject.id}`) },
        { label: '과목 고치기', icon: ICONS.edit, onSelect: () => setEditingSubject(subject) },
      ]
    : [
        { label: '새 과목', icon: ICONS.folder, onSelect: () => setEditingSubject('new') },
        { label: '문제 모아 보기', icon: ICONS.grid, onSelect: () => router.push('/questions') },
      ];

  return (
    <div className="grid gap-1">
      <LargeHeader
        title={subject?.name ?? (selected && !data ? ' ' : '자료함')}
        subtitle={subtitle}
        actions={
          <>
            <IconButton
              label="검색"
              aria-pressed={searching}
              onClick={() => {
                if (searching) setQuery('');
                setSearching(!searching);
              }}
            >
              <Icon d={ICONS.search} />
            </IconButton>
            <Menu label={subject ? '과목 메뉴' : '자료함 메뉴'} items={headerMenu} />
            <span className="ml-1 md:hidden">
              <EnergyPill me={me} />
            </span>
          </>
        }
      />

      {searching ? (
        <div className="kok-attach mb-2">
          <input
            ref={searchRef}
            type="search"
            className={inputClass}
            placeholder="제목·단원·내용으로 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="자료 찾기"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                setSearching(false);
              }
            }}
          />
        </div>
      ) : null}

      {/* 과목 칩 (폴더) */}
      <div ref={chipsRef} className="no-scrollbar relative -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6" role="tablist" aria-label="과목">
        <FolderChip id="all" on={!selected} onClick={() => select(null)} label="전체" count={data?.sources.length} />
        {subjects.map((s) => {
          const d = s.exam_date ? daysUntil(s.exam_date) : null;
          return (
            <FolderChip
              key={s.id}
              id={s.id}
              on={selected === s.id}
              onClick={() => select(s.id)}
              label={s.name}
              count={counts.get(s.id) ?? 0}
              color={subjectVar(s.color)}
              badge={d !== null && d >= 0 && d <= 14 ? (d === 0 ? 'D-DAY' : `D-${d}`) : undefined}
            />
          );
        })}
        <button
          type="button"
          className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border-2 border-dashed border-line px-4 text-sm font-semibold text-muted hover:text-ink"
          onClick={() => setEditingSubject('new')}
        >
          <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />새 과목
        </button>
      </div>

      {data === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="kok-card kok-shimmer h-[196px]" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        query ? (
          <EmptyState title="찾는 자료가 없어요" body={`'${query}'가 들어간 자료가 없어요.`} />
        ) : (
          <DropHint onAdd={() => quick.openComposer(selected ?? undefined)} subjectName={subject?.name} />
        )
      ) : (
        groups.map((g) => (
          <section key={g.unit || 'all'} className="grid gap-2">
            {g.unit ? <h2 className="mt-3 px-1 text-sm font-bold text-muted">{g.unit}</h2> : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {g.list.map((s, i) => (
                <NoteCard
                  key={s.id}
                  s={s}
                  index={i}
                  isNew={fresh.has(s.id)}
                  subject={selected ? null : (subjects.find((x) => x.id === s.subject_id) ?? null)}
                  onRename={() => setRenaming(s)}
                  onDelete={async () => {
                    if (!confirm(`'${s.title || '이 자료'}'와 노트·문제를 지울까요? 되돌릴 수 없어요.`)) return;
                    try {
                      await api(`/api/sources/${s.id}`, { method: 'DELETE' });
                      setData((cur) => (cur ? { ...cur, sources: cur.sources.filter((x) => x.id !== s.id) } : cur));
                      toast('지웠어요.');
                      reload();
                    } catch (e) {
                      toast((e as Error).message, 'bad');
                    }
                  }}
                  onRetry={async () => {
                    try {
                      await api(`/api/sources/${s.id}/retry`, { method: 'POST', body: '{}' });
                      toast('다시 시작했어요.');
                      active.reload();
                      reload();
                    } catch (e) {
                      toast((e as Error).message, 'bad');
                    }
                  }}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {/* 과목 만들기·고치기 */}
      <Sheet open={!!editingSubject} onClose={() => setEditingSubject(null)} title={editingSubject === 'new' ? '새 과목' : '과목 고치기'}>
        {editingSubject ? (
          <div className="grid gap-6">
            <SubjectForm
              initial={editingSubject === 'new' ? undefined : editingSubject}
              saving={saving}
              onCancel={() => setEditingSubject(null)}
              onSave={async (d) => {
                setSaving(true);
                if (editingSubject === 'new') {
                  const { data: row, error } = await sb()
                    .from('subjects')
                    .insert({ name: d.name, color: d.color, exam_date: d.exam_date, position: subjects.length })
                    .select('id')
                    .single();
                  setSaving(false);
                  if (error || !row) return toast('과목을 만들지 못했어요.', 'bad');
                  const made: SubjectRow = {
                    id: row.id as string,
                    name: d.name,
                    color: d.color,
                    exam_date: d.exam_date,
                    position: subjects.length,
                    created_at: new Date().toISOString(),
                  };
                  // 새 과목 칩이 바로 보이게 먼저 넣어 두고, 서버 목록은 뒤에서 다시 받는다
                  setData((cur) => (cur ? { ...cur, subjects: [...cur.subjects, made] } : cur));
                  setEditingSubject(null);
                  window.dispatchEvent(new Event(SUBJECTS_CHANGED));
                  select(made.id);
                } else {
                  const { error } = await sb().from('subjects').update({ name: d.name, color: d.color, exam_date: d.exam_date }).eq('id', editingSubject.id);
                  setSaving(false);
                  if (error) return toast('저장하지 못했어요.', 'bad');
                  setEditingSubject(null);
                  window.dispatchEvent(new Event(SUBJECTS_CHANGED));
                }
              }}
            />
            {editingSubject !== 'new' ? (
              <div className="border-t border-line pt-4">
                <Button
                  variant="ghost"
                  className="text-bad"
                  onClick={async () => {
                    if (!confirm(`'${editingSubject.name}' 과목과 그 안의 자료·노트·문제·복습 기록을 모두 지울까요? 되돌릴 수 없어요.`)) return;
                    try {
                      await api(`/api/subjects/${editingSubject.id}`, { method: 'DELETE' });
                      setEditingSubject(null);
                      select(null);
                      window.dispatchEvent(new Event(SUBJECTS_CHANGED));
                    } catch (e) {
                      toast((e as Error).message, 'bad');
                    }
                  }}
                >
                  과목 지우기
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* 자료 이름·단원 */}
      <Sheet open={!!renaming} onClose={() => setRenaming(null)} title="자료 이름·단원">
        {renaming ? (
          <RenameForm
            key={renaming.id}
            s={renaming}
            units={[...new Set((data?.sources ?? []).filter((x) => x.subject_id === renaming.subject_id && x.unit).map((x) => x.unit))]}
            onDone={() => {
              setRenaming(null);
              reload();
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function FolderChip({
  id,
  on,
  onClick,
  label,
  count,
  color,
  badge,
}: {
  id: string;
  on: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  color?: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      data-chip={id}
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cx(
        'press inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors duration-200',
        on ? 'bg-ink text-surface' : 'bg-surface text-ink shadow-[0_1px_2px_var(--shadow)] hover:bg-surface-2',
      )}
    >
      {color ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" /> : null}
      <span className="max-w-[9rem] truncate">{label}</span>
      {typeof count === 'number' ? <span className={cx('tabular-nums', on ? 'opacity-70' : 'text-muted')}>{count}</span> : null}
      {badge ? <span className={cx('rounded-full px-1.5 text-[11px] font-bold', on ? 'bg-surface/20' : 'bg-bad-soft text-bad')}>{badge}</span> : null}
    </button>
  );
}

function NoteCard({
  s,
  index,
  isNew,
  subject,
  onRename,
  onDelete,
  onRetry,
}: {
  s: LibSource;
  index: number;
  isNew: boolean;
  subject: SubjectRow | null;
  onRename: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const processing = s.status === 'queued' || s.status === 'processing';
  const failed = s.status === 'error';
  const items: MenuItem[] = [
    ...(failed ? [{ label: '다시 하기', icon: ICONS.retry, onSelect: onRetry }] : []),
    { label: '이름·단원 바꾸기', icon: ICONS.edit, onSelect: onRename },
    { label: '지우기', icon: ICONS.trash, onSelect: onDelete, danger: true },
  ];
  const href = `/notes/${s.id}`;
  const footer = (
    <>
      <p className="line-clamp-2 text-[15px] font-bold leading-snug">{s.title || (processing ? '정리하는 중…' : '제목 없는 자료')}</p>
      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted">
        {subject ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectVar(subject.color) }} aria-hidden="true" /> : null}
        <Icon d={KIND_ICON[s.kind]} size={13} className="shrink-0" />
        <span className="truncate">
          {KIND_LABEL[s.kind]}
          {s.page_count ? ` ${s.page_count}${s.kind === 'image' ? '장' : '쪽'}` : ''} · {shortDate(s.created_at)}
        </span>
      </p>
    </>
  );
  const fade = <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent" aria-hidden="true" />;
  return (
    <div className={cx('relative', isNew ? 'kok-new rounded-[22px]' : 'kok-rise')} style={{ ['--i' as string]: index }}>
      {failed ? (
        // 멈춘 자료: 카드 안에서 바로 다시 하기 (단추를 링크 안에 넣지 않도록 제목만 링크)
        <div className="kok-card flex h-[196px] flex-col overflow-hidden ring-2 ring-bad/40">
          <div className="relative grid min-h-0 flex-1 content-start gap-1.5 overflow-hidden px-4 pt-4">
            <span className="pr-7 text-xs font-bold text-bad">멈췄어요 · 에너지는 돌려줬어요</span>
            <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{s.error ?? '정리하다가 문제가 생겼어요.'}</p>
            <button
              type="button"
              className="press mt-0.5 inline-flex items-center gap-1 justify-self-start rounded-full bg-bad px-3 py-1.5 text-xs font-bold text-white"
              onClick={onRetry}
            >
              <Icon d={ICONS.retry} size={14} strokeWidth={2.2} />
              다시 하기
            </button>
          </div>
          <Link href={href} className="press px-4 pb-3.5 pt-1.5" aria-label={`${s.title || '제목 없는 자료'} (멈췄어요)`}>
            {footer}
          </Link>
        </div>
      ) : (
        <Link
          href={href}
          className="kok-card kok-card-hover press flex h-[196px] flex-col overflow-hidden"
          aria-label={`${s.title || '제목 없는 자료'}${processing ? ` (${stepLabel(s)})` : ''}`}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden px-4 pt-4">
            {processing ? (
              <div className="grid gap-2">
                <div className="flex items-center gap-2.5 pr-7">
                  <ProgressRing value={s.progress} label={`${s.title || '자료'} 진행`} />
                  <span className="min-w-0 text-xs font-bold leading-snug text-accent">{stepLabel(s)}</span>
                </div>
                <div className="kok-shimmer mt-1 h-2.5 w-[88%] rounded-full bg-surface-2" />
                <div className="kok-shimmer h-2.5 w-[70%] rounded-full bg-surface-2" />
                <div className="kok-shimmer h-2.5 w-[80%] rounded-full bg-surface-2" />
              </div>
            ) : (
              <p className="kok-fade line-clamp-5 text-[13px] leading-relaxed text-muted">
                <span className="float-right h-5 w-6" aria-hidden="true" />
                {s.summary ? previewText(s.summary) : '정리 노트가 준비됐어요.'}
              </p>
            )}
            {fade}
          </div>
          <div className="px-4 pb-3.5 pt-1.5">{footer}</div>
        </Link>
      )}
      <div className="absolute right-1.5 top-1.5 z-10">
        <Menu label={`${s.title || '자료'} 메뉴`} items={items} small />
      </div>
    </div>
  );
}

/** 자료가 없을 때: 끌어다 놓거나 + 를 누르라고 알려 준다 */
function DropHint({ onAdd, subjectName }: { onAdd: () => void; subjectName?: string }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="press kok-rise grid w-full justify-items-center gap-3 rounded-[28px] border-2 border-dashed border-line bg-surface/60 px-6 py-14 text-center hover:border-fab"
    >
      <span className="kok-float grid h-16 w-16 place-items-center rounded-full bg-fab text-fab-ink shadow-lg">
        <Icon d={ICONS.plus} size={30} strokeWidth={2.4} />
      </span>
      <span className="font-display text-xl">{subjectName ? `${subjectName}에 첫 자료를 넣어 보세요` : '첫 자료를 넣어 보세요'}</span>
      <span className="max-w-sm text-sm text-muted">PDF·사진을 이 화면에 끌어다 놓거나, 여기를 눌러 공부한 내용을 적고 엔터를 누르면 AI가 정리해요.</span>
    </button>
  );
}

function RenameForm({ s, units, onDone }: { s: LibSource; units: string[]; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(s.title ?? '');
  const [unit, setUnit] = useState(s.unit ?? '');
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await sb()
          .from('sources')
          .update({ title: title.trim().slice(0, 120), unit: unit.trim().slice(0, 40) })
          .eq('id', s.id);
        if (error) toast('저장하지 못했어요.', 'bad');
        else onDone();
      }}
    >
      <label className="grid gap-1.5 text-sm font-semibold">
        자료 이름
        <input className={inputClass} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        단원 (같은 이름끼리 묶여요)
        <input className={inputClass} value={unit} maxLength={40} list="unit-list" onChange={(e) => setUnit(e.target.value)} />
        <datalist id="unit-list">
          {units.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </label>
      <Button type="submit" className="justify-self-start">
        저장
      </Button>
    </form>
  );
}
