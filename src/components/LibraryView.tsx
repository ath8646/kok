'use client';
// 자료함: 과목(폴더) 칩 + 노트 카드 격자. 파일은 화면에 끌어다 놓고, 글은 + 버튼에서 엔터로 넣는다.
// 카드를 꾹 누르면(또는 메뉴의 '여러 개 고르기') 여러 개를 골라 한꺼번에 별표·복습 켜고 끄기·지우기 (삼성 노트처럼).
// 별표한 자료가 맨 위, 과목 안에서는 '순서 바꾸기'로 정한 순서 (src/lib/library-order.ts)
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useMe, EnergyPill } from './AppShell';
import { SOURCES_CHANGED, SUBJECTS_CHANGED, useQuickAdd } from './QuickAdd';
import { stepLabel, useActiveSources } from './ProcessingList';
import { SubjectForm } from './SubjectForm';
import { StarButton, StarGlyph, useStarRefocus } from './note/StarButton';
import { SortList } from './note/SortList';
import { useLongPress } from './useLongPress';
import { prefersReducedMotion } from './useReducedMotion';
import {
  Button,
  EmptyState,
  ICONS,
  Icon,
  IconButton,
  LargeHeader,
  Menu,
  ProgressRing,
  Sheet,
  Spinner,
  api,
  cx,
  inputClass,
  useToast,
  type MenuItem,
} from './ui';
import {
  NOTE_PEEK,
  ORGANIZE_COLS,
  SOURCE_COLS,
  fetchAll,
  fetchSubjects,
  peekText,
  sb,
  topLevelSources,
  type NotePeek,
  type SourceRowWithUnit,
} from '@/lib/data';
import { BULK_MAX, bulkLabels, flattenOrder, libraryOrder, withPositions } from '@/lib/library-order';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { previewText } from '@/lib/richtext';
import { daysUntil } from '@/lib/time';
import { dropView, readView, writeView } from '@/lib/view-cache';
import { QUICK_MAX, quickSubjects } from '@/lib/subject-order';
import { SubjectDrawer } from './SubjectDrawer';

/** manual: AI 없이 직접 만든 노트 */
type LibSource = SourceRowWithUnit & { summary: string | null; manual?: boolean };
type LibData = { subjects: SubjectRow[]; sources: LibSource[] };

/** 자료함 목록을 기억해 두는 이름 (다시 들어오면 바로 보이고, 뒤에서 새로 읽는다) */
export const LIBRARY_VIEW = 'library';

/** 카드가 나타나는 방법: 기억해 둔 목록이면 그대로(none), 그 밖에는 카드 자리에서 글만 번진다(fill) */
type Enter = 'none' | 'fill';

/** organize: 자료함 정리 칸(복습에 넣기·별표·순서)이 DB 에 있을 때만 읽는다 */
async function fetchLibrary(organize: boolean): Promise<LibData> {
  const [subjects, sources, notes] = await Promise.all([
    fetchSubjects(),
    fetchAll<SourceRowWithUnit>((a, b) =>
      topLevelSources<SourceRowWithUnit[]>((onlyTop) => {
        let q = sb()
          .from('sources')
          .select(organize ? `${SOURCE_COLS}, ${ORGANIZE_COLS}` : SOURCE_COLS);
        if (onlyTop) q = q.is('parent_id', null);
        return q.order('created_at', { ascending: false }).order('id').range(a, b) as unknown as PromiseLike<{
          data: SourceRowWithUnit[] | null;
          error: unknown;
        }>;
      }),
    ),
    fetchAll<NotePeek>(
      (a, b) =>
        sb().from('notes').select(NOTE_PEEK).order('id').range(a, b) as unknown as PromiseLike<{
          data: NotePeek[] | null;
          error: unknown;
        }>,
    ),
  ]);
  const sum = new Map(notes.map((n) => [n.source_id, n]));
  return {
    subjects,
    sources: sources.map((s) => {
      const n = sum.get(s.id);
      return { ...s, summary: n ? peekText(n) : null, manual: n?.manual === 'true' };
    }),
  };
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
  const owner = me?.userId;
  // 방금 본 목록이 있으면 바로 보여 주고(빈 자리 없이), 뒤에서 새로 읽어 덮는다
  const [data, setData] = useState<LibData | null>(() => readView<LibData>(LIBRARY_VIEW, owner) ?? null);
  // 처음 새로 읽은 목록이 들어온 뒤부터는 새로 생기는 카드가 자리에서 번지며 나타난다
  const [painted, setPainted] = useState(false);
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
  // 과목 서랍 ('모든 과목')
  const [drawer, setDrawer] = useState(false);
  const [renaming, setRenaming] = useState<LibSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const searchRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------- 여러 개 고르기 (카드를 꾹 누르거나 메뉴에서)
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState<'star' | 'review' | 'delete' | null>(null);
  const [ordering, setOrdering] = useState(false);
  const startSelect = useCallback((id?: string) => {
    setSelecting(true);
    setPicked(new Set(id ? [id] : []));
  }, []);
  const endSelect = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
  }, []);
  const togglePick = useCallback(
    (id: string) =>
      setPicked((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  // 고르는 동안 + 버튼은 숨기고(아래 띠가 그 자리를 쓴다), Esc 로 끝낸다
  const setFabHidden = quick.setFabHidden;
  useEffect(() => {
    if (!selecting) return;
    setFabHidden(true);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') endSelect();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      setFabHidden(false);
    };
  }, [selecting, setFabHidden, endSelect]);

  // 화면에서 바로 고친 것(별표·복습·순서)이 읽는 사이에 생겼으면, 읽은 목록은 옛것이라 버리고 저장이 끝난 뒤 다시 읽는다
  const edits = useRef({ seq: 0, saving: 0, stale: false });

  // 카드에서 별표를 누르면: 별이 튀고 빛이 번지는 동안 자리를 그대로 두었다가 맨 위로 미끄러진다
  const [hold, setHold] = useState<string[] | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  // 불러오기 (처음, 새 자료가 들어왔을 때, 정리가 끝났을 때)
  const organize = !!me?.features.organize;
  useEffect(() => {
    let alive = true;
    const seq = edits.current.seq;
    fetchLibrary(organize)
      .then((r) => {
        if (!alive) return;
        const e = edits.current;
        if (e.seq !== seq || e.saving) {
          e.stale = true;
          if (!e.saving) reload();
          return;
        }
        writeView(LIBRARY_VIEW, owner, r);
        setData(r);
        setPainted(true);
      })
      .catch(() => {
        if (!alive) return;
        toast('자료함을 불러오지 못했어요.', 'bad');
        setData((d) => d ?? { subjects: [], sources: [] });
        setPainted(true);
      });
    return () => {
      alive = false;
    };
  }, [version, active.doneCount, toast, owner, organize, reload]);

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
  // 과목 서랍 (features.subjectDrawer): 칩 줄에는 고정 + 최근 쓴 과목만, 보관한 과목은 '전체'에서도 뺀다 (찾을 때는 보인다)
  const drawerOn = !!me?.features.subjectDrawer;
  const archivedIds = useMemo(() => new Set(drawerOn ? subjects.filter((s) => s.archived).map((s) => s.id) : []), [subjects, drawerOn]);
  const chipSubjects = useMemo(() => (drawerOn ? quickSubjects(subjects, QUICK_MAX, selected) : subjects), [subjects, drawerOn, selected]);
  const moreSubjects = drawerOn && subjects.length > chipSubjects.length;
  const allCount = data ? data.sources.filter((s) => !archivedIds.has(s.subject_id)).length : undefined;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.sources ?? [])
      .filter((s) => (selected ? s.subject_id === selected : q || !archivedIds.has(s.subject_id)))
      .filter((s) => !q || [s.title, s.unit, s.summary ? previewText(s.summary) : ''].some((x) => (x ?? '').toLowerCase().includes(q)))
      .map((s) => {
        const l = live.get(s.id);
        // 진행률만 새 값으로 (별표·순서·복습 칸은 자료함이 고친 값 그대로)
        return l ? { ...s, ...l, summary: s.summary, starred: s.starred, position: s.position, in_review: s.in_review } : s;
      });
    // 별표한 자료가 맨 위, 과목 안에서는 내가 정한 순서
    const ordered = libraryOrder(list, !!selected && organize);
    if (!hold) return ordered;
    // 별이 튀는 동안에는 자리를 그대로 둔다 (그 뒤 새 자리로 미끄러진다)
    const at = new Map(hold.map((id, i) => [id, i]));
    return [...ordered].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
  }, [data, selected, query, live, organize, hold, archivedIds]);
  const gridRef = useRef<HTMLDivElement>(null);
  const flip = useGridFlip(gridRef, shown.map((s) => s.id).join('|'));
  // 키보드로 별표를 빼면 카드가 제자리로 옮겨 간 뒤 그 카드의 별 버튼으로 초점을 되돌린다
  const rememberStar = useStarRefocus(gridRef, hold !== null);

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
    // 다른 과목으로 가면 고르기는 끝낸다 (보이지 않는 자료를 바꾸지 않게)
    if (id !== selected) endSelect();
  };

  // 고른 자료: 지금 보이는 것만 (지워졌거나, 검색으로 가려진 것은 바꾸지 않는다)
  const pickedRows = shown.filter((s) => picked.has(s.id));
  const labels = bulkLabels(pickedRows);

  /** 화면에서 바로 고친 것을 저장하는 동안 (그사이에 읽은 목록은 버리고, 다 저장한 뒤 다시 읽는다) */
  const keepWhileSaving = async (work: () => Promise<void>) => {
    const e = edits.current;
    e.seq += 1;
    e.saving += 1;
    try {
      await work();
    } finally {
      e.saving -= 1;
      if (!e.saving && e.stale) {
        e.stale = false;
        reload();
      }
    }
  };

  /** 과목 위에 고정·보관 (과목 서랍). 화면은 바로 바꾸고, 저장하지 못하면 다시 읽는다 */
  const setSubjectFlag = async (s: SubjectRow, patch: { pinned?: boolean; archived?: boolean }) => {
    if (!data) return;
    const next = { ...data, subjects: data.subjects.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) };
    setData(next);
    writeView(LIBRARY_VIEW, owner, next);
    let failed = false;
    await keepWhileSaving(async () => {
      const { error } = await sb().from('subjects').update(patch).eq('id', s.id);
      if (error) failed = true;
    });
    if (failed) {
      toast('저장하지 못했어요. 다시 해 주세요.', 'bad');
      reload();
      return;
    }
    // 다른 화면(자료 넣기 등)의 과목 목록도 새로
    window.dispatchEvent(new Event(SUBJECTS_CHANGED));
    if (patch.archived === true) toast(`'${s.name}' 과목을 보관했어요. 복습은 그대로 나오고, '모든 과목'에서 다시 꺼낼 수 있어요.`);
    else if (patch.archived === false) toast(`'${s.name}' 과목을 다시 꺼냈어요.`);
  };

  /**
   * 자료 칸을 한꺼번에 바꾼다: 화면은 바로 바꾸고(카드가 새 자리로 미끄러진다), 저장하지 못하면 다시 읽는다.
   * holdMs: 그동안은 카드 자리를 그대로 두고(별이 튀고 빛이 번지는 것을 본 뒤) 새 자리로 미끄러진다
   */
  const patchSources = async (ids: string[], patch: { starred?: boolean; in_review?: boolean }, done: string | null, holdMs = 0): Promise<boolean> => {
    if (!ids.length || !data) return false;
    if (holdMs > 0) {
      setHold(shown.map((s) => s.id));
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        flip();
        setHold(null);
      }, holdMs);
    } else flip();
    const next = { ...data, sources: data.sources.map((s) => (ids.includes(s.id) ? { ...s, ...patch } : s)) };
    setData(next);
    writeView(LIBRARY_VIEW, owner, next);
    let failed = false;
    await keepWhileSaving(async () => {
      for (let i = 0; i < ids.length; i += BULK_MAX) {
        const { error } = await sb()
          .from('sources')
          .update(patch)
          .in('id', ids.slice(i, i + BULK_MAX));
        if (error) failed = true;
      }
    });
    if (failed) {
      toast('저장하지 못했어요. 다시 해 주세요.', 'bad');
      reload();
      return false;
    }
    if (done) toast(done);
    return true;
  };
  const starOne = (s: LibSource) => {
    rememberStar(s.id);
    // 별표는 카드의 별과 빛으로 보여서 알림을 띄우지 않는다 (저장하지 못했을 때만 알린다)
    return patchSources([s.id], { starred: !s.starred }, null, s.starred ? 80 : 220);
  };
  const reviewOne = (s: LibSource) =>
    patchSources([s.id], { in_review: s.in_review === false }, s.in_review === false ? '다시 복습에 넣었어요.' : '복습에서 뺐어요.');

  const bulkStar = async () => {
    const ids = pickedRows.map((s) => s.id);
    setBulkBusy('star');
    const ok = await patchSources(ids, { starred: labels.star }, null);
    setBulkBusy(null);
    if (ok) endSelect();
  };
  const bulkReview = async () => {
    const ids = pickedRows.map((s) => s.id);
    setBulkBusy('review');
    const ok = await patchSources(
      ids,
      { in_review: labels.review },
      labels.review ? `${ids.length}개 노트를 복습에 넣었어요.` : `${ids.length}개 노트를 복습에서 뺐어요.`,
    );
    setBulkBusy(null);
    if (ok) endSelect();
  };
  const bulkDelete = async () => {
    const ids = pickedRows.map((s) => s.id);
    if (!ids.length) return;
    if (!confirm(`고른 자료 ${ids.length}개와 그 노트·문제·복습 기록을 모두 지울까요? 되돌릴 수 없어요.`)) return;
    setBulkBusy('delete');
    try {
      let deleted = 0;
      for (let i = 0; i < ids.length; i += BULK_MAX) {
        const r = await api<{ deleted: number }>('/api/sources/delete', { method: 'POST', body: JSON.stringify({ ids: ids.slice(i, i + BULK_MAX) }) });
        deleted += r.deleted;
      }
      dropView(LIBRARY_VIEW);
      setData((cur) => (cur ? { ...cur, sources: cur.sources.filter((s) => !ids.includes(s.id)) } : cur));
      toast(`${deleted}개를 지웠어요.`);
      endSelect();
      reload();
      active.reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
      reload();
    } finally {
      setBulkBusy(null);
    }
  };

  /** 순서 바꾸기: 화면은 바로, 저장은 서버 함수가 한 번에 (내 자료만). 빨리 여러 번 옮기면 한 줄로 세워 마지막 순서만 저장한다 */
  const orderQueue = useRef<{ running: boolean; next: string[] | null }>({ running: false, next: null });
  const saveOrder = (order: string[]) => {
    setData((cur) => {
      if (!cur) return cur;
      const next = { ...cur, sources: withPositions(cur.sources, order) };
      writeView(LIBRARY_VIEW, owner, next);
      return next;
    });
    const q = orderQueue.current;
    q.next = order;
    if (q.running) return;
    q.running = true;
    void keepWhileSaving(async () => {
      while (q.next) {
        const o = q.next;
        q.next = null;
        const { error } = await sb().rpc('kok_reorder_sources', { p_ids: o });
        if (error) {
          q.next = null;
          toast('순서를 저장하지 못했어요. 다시 해 주세요.', 'bad');
          edits.current.stale = true;
          break;
        }
      }
    }).finally(() => {
      q.running = false;
    });
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
  const total = selected ? (counts.get(selected) ?? 0) : (allCount ?? 0);
  // 읽는 동안에도 줄 높이를 지켜서, 다 읽었을 때 제목이 위로 튀지 않게 한다
  const subtitle = data ? (
    <span key={`${total}:${exam ?? ''}`} className="kok-swap flex flex-wrap items-center gap-x-2">
      <span>자료 {total}개</span>
      {exam !== null && exam >= 0 ? (
        // 큰 제목 아래(화면 위 빛 위)라 색 글자는 연한 알약 안에
        <span className={cx('rounded-full px-2 text-sm font-semibold', exam <= 3 ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent')}>
          시험 {exam === 0 ? 'D-DAY' : `D-${exam}`}
        </span>
      ) : null}
      {subject?.archived ? <span>· 보관한 과목</span> : null}
    </span>
  ) : (
    <span className="kok-skel inline-block h-6 align-top" aria-hidden="true">
      <span className="kok-bone mt-[7px] h-2.5 w-16" />
    </span>
  );
  // 기억해 둔 목록으로 처음 그린 카드는 그대로, 새로 읽은 뒤에 생기는 카드는 자리에서 글이 번진다
  const enter: Enter = painted ? 'fill' : 'none';

  // 여러 개 고르기·순서 바꾸기 (자료가 있을 때만. 순서는 과목 안에서만 정한다)
  // 순서는 과목 안에서 정한다: 자료가 둘 이상인 과목. 전체 보기에서 고르면 그 과목으로 가서 연다
  // 순서 바꾸기 과목: 자료가 둘 이상인 과목 (보관한 과목은 빼고, 보고 있는 과목은 남긴다)
  const orderable = subjects.filter((x) => (counts.get(x.id) ?? 0) > 1 && (!archivedIds.has(x.id) || x.id === selected));
  const canOrder = organize && !query && (subject ? shown.length > 1 : orderable.length > 0);
  const organizeMenu: MenuItem[] = [
    ...(total ? [{ label: '여러 개 고르기', icon: ICONS.select, onSelect: () => startSelect() }] : []),
    ...(canOrder
      ? [
          {
            label: '순서 바꾸기',
            icon: ICONS.reorder,
            onSelect: () => {
              if (!subject) select(orderable[0].id);
              setOrdering(true);
            },
          },
        ]
      : []),
  ];
  const headerMenu: MenuItem[] = subject
    ? [
        ...organizeMenu,
        { label: '이 과목만 복습', icon: ICONS.retry, onSelect: () => router.push(`/review?subject=${subject.id}`) },
        { label: '문제 모아 보기', icon: ICONS.grid, onSelect: () => router.push(`/questions?subject=${subject.id}`) },
        { label: '과목 고치기', icon: ICONS.edit, onSelect: () => setEditingSubject(subject) },
        ...(drawerOn
          ? subject.archived
            ? [{ label: '보관 풀기', icon: ICONS.archive, onSelect: () => setSubjectFlag(subject, { archived: false }) }]
            : [
                { label: subject.pinned ? '고정 풀기' : '위에 고정', icon: ICONS.pin, onSelect: () => setSubjectFlag(subject, { pinned: !subject.pinned }) },
                { label: '보관하기', icon: ICONS.archive, onSelect: () => setSubjectFlag(subject, { archived: true }) },
              ]
          : []),
      ]
    : [
        ...organizeMenu,
        { label: '새 과목', icon: ICONS.folder, onSelect: () => setEditingSubject('new') },
        { label: '문제 모아 보기', icon: ICONS.grid, onSelect: () => router.push('/questions') },
      ];
  const allPicked = shown.length > 0 && shown.every((s) => picked.has(s.id));

  return (
    <div className="grid gap-1">
      <LargeHeader
        title={
          selecting ? (
            <span key={pickedRows.length ? 'n' : 'none'} className="kok-swap">
              {pickedRows.length ? `${pickedRows.length}개 선택` : '자료 고르기'}
            </span>
          ) : (
            (subject?.name ??
            (selected && !data ? (
              <span className="kok-skel inline-block h-[1.25em] align-top" aria-hidden="true">
                <span className="kok-bone mt-[0.3em] h-[0.65em] w-32" />
              </span>
            ) : (
              '자료함'
            )))
          )
        }
        compactTitle={selecting ? (pickedRows.length ? `${pickedRows.length}개 선택` : '자료 고르기') : undefined}
        subtitle={selecting ? <span className="kok-swap">카드를 눌러 고르고, 아래에서 한꺼번에 바꿔요</span> : subtitle}
        actions={
          selecting ? (
            <>
              <button
                type="button"
                // 위 띠 글자는 화면 위 빛 위에 놓이지 않게 알약 안에 (화면 바탕 위 글자는 본문·흐린 글자만: fx.ts)
                className="press rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent hover:brightness-95"
                onClick={() => setPicked(allPicked ? new Set() : new Set(shown.map((s) => s.id)))}
              >
                {allPicked ? '모두 풀기' : '모두 고르기'}
              </button>
              <IconButton label="고르기 끝내기" onClick={endSelect}>
                <Icon d={ICONS.close} />
              </IconButton>
            </>
          ) : (
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
          )
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
        <FolderChip id="all" on={!selected} onClick={() => select(null)} label="전체" count={allCount} loading={!data} />
        {/* 과목을 읽는 동안: 과목 칩 자리 */}
        {!data ? [0, 1].map((i) => <span key={i} className="kok-skel kok-bone h-10 w-20 shrink-0" aria-hidden="true" />) : null}
        {chipSubjects.map((s) => {
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
              enter={enter}
            />
          );
        })}
        {/* 칩 줄에 안 보이는 과목(최근에 안 쓴 것·보관한 것)은 서랍에서 */}
        {moreSubjects ? (
          <button
            type="button"
            aria-haspopup="dialog"
            className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-semibold text-ink shadow-[0_1px_2px_var(--shadow)] hover:bg-surface-2"
            onClick={() => setDrawer(true)}
          >
            <Icon d={ICONS.grid} size={16} strokeWidth={2.2} />
            모든 과목 <span className="tabular-nums text-muted">{subjects.length}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border-2 border-dashed border-line px-4 text-sm font-semibold text-muted hover:text-ink"
          onClick={() => setEditingSubject('new')}
        >
          <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />새 과목
        </button>
      </div>
      {drawerOn ? (
        <SubjectDrawer
          open={drawer}
          onClose={() => setDrawer(false)}
          subjects={subjects}
          selected={selected}
          onPick={(id) => select(id)}
          counts={counts}
          all={{ label: '전체', count: allCount }}
          manage={{ onPin: (x, on) => setSubjectFlag(x, { pinned: on }), onArchive: (x, on) => setSubjectFlag(x, { archived: on }) }}
        />
      ) : null}
      {subject?.archived && drawerOn && !selecting ? (
        <div className="kok-attach mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-3 shadow-[0_1px_2px_var(--shadow)]">
          <p className="min-w-0 flex-1 text-sm text-muted">보관한 과목이에요. 자료함 목록에는 안 보이고, 복습은 그대로 나와요.</p>
          <Button size="sm" variant="secondary" onClick={() => setSubjectFlag(subject, { archived: false })}>
            보관 풀기
          </Button>
        </div>
      ) : null}

      {data === null ? (
        <div className="kok-skel grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
          <span className="sr-only">자료를 불러오는 중이에요</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        query ? (
          <EmptyState title="찾는 자료가 없어요" body={`'${query}'가 들어간 자료가 없어요.`} />
        ) : !selected && data.sources.length > 0 ? (
          // 자료가 모두 보관한 과목에 있다 ('전체'에서는 빼서)
          <EmptyState
            title="보관한 과목의 자료만 있어요"
            body="'모든 과목'에서 보관한 과목을 열거나 다시 꺼낼 수 있어요. 새 자료를 넣어도 좋아요."
            action={<Button onClick={() => setDrawer(true)}>모든 과목 보기</Button>}
          />
        ) : (
          <DropHint onAdd={() => quick.openComposer(selected ?? undefined)} subjectName={subject?.name} />
        )
      ) : (
        // 카드 순서가 바뀌면(별표) 원래 자리에서 새 자리로 미끄러진다 (data-flip)
        <div ref={gridRef} className="grid gap-1">
          {groups.map((g) => (
            <section key={g.unit || 'all'} className="grid gap-2">
              {g.unit ? <h2 className="mt-3 px-1 text-sm font-bold text-muted">{g.unit}</h2> : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.list.map((s, i) => (
                  <NoteCard
                    key={s.id}
                    s={s}
                    index={i}
                    isNew={fresh.has(s.id)}
                    enter={enter}
                    subject={selected ? null : (subjects.find((x) => x.id === s.subject_id) ?? null)}
                    organize={organize}
                    selecting={selecting}
                    picked={picked.has(s.id)}
                    onPick={() => togglePick(s.id)}
                    onLongPress={() => (selecting ? togglePick(s.id) : startSelect(s.id))}
                    onStar={() => starOne(s)}
                    onReview={() => reviewOne(s)}
                    onSelectMode={() => startSelect(s.id)}
                    onRename={() => setRenaming(s)}
                    onDelete={async () => {
                      if (!confirm(`'${s.title || '이 자료'}'와 노트·문제를 지울까요? 되돌릴 수 없어요.`)) return;
                      try {
                        await api(`/api/sources/${s.id}`, { method: 'DELETE' });
                        dropView(LIBRARY_VIEW);
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
                        dropView(LIBRARY_VIEW);
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
          ))}
        </div>
      )}

      {/* 여러 개 고르기: 아래 띠 (폰은 아래 메뉴 자리, 넓은 화면은 가운데 떠 있는 띠) */}
      {selecting ? (
        <SelectionBar
          count={pickedRows.length}
          organize={organize}
          labels={labels}
          busy={bulkBusy}
          onStar={bulkStar}
          onReview={bulkReview}
          onDelete={bulkDelete}
        />
      ) : null}

      {/* 순서 바꾸기 (과목 안에서). 과목이 여럿이면 위의 칩으로 과목을 바꾼다 (뒤의 자료함도 그 과목으로) */}
      <Sheet open={ordering && !!subject} onClose={() => setOrdering(false)} title={subject ? `${subject.name} 순서 바꾸기` : '순서 바꾸기'}>
        {ordering && subject ? (
          <div className="grid gap-4">
            {orderable.length > 1 ? (
              <div role="group" aria-label="과목" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
                {orderable.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={x.id === subject.id}
                    onClick={() => select(x.id)}
                    className={cx(
                      'press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors duration-200',
                      x.id === subject.id ? 'kok-chip-on' : 'bg-surface-2 text-ink hover:bg-surface-3',
                    )}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(x.color) }} aria-hidden="true" />
                    <span className="max-w-[8rem] truncate">{x.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <ReorderList key={subject.id} groups={groups} onOrder={saveOrder} />
          </div>
        ) : null}
      </Sheet>

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
  loading,
  color,
  badge,
  enter = 'none',
}: {
  id: string;
  on: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  /** 수를 읽는 중이면 그 자리를 남겨 둔다 (다 읽었을 때 옆 칩이 밀리지 않게) */
  loading?: boolean;
  color?: string;
  badge?: string;
  enter?: Enter;
}) {
  // 나타나는 방법은 처음 그릴 때 정한 그대로 (다시 그려도 움직임이 다시 돌지 않게)
  const [mode] = useState(enter);
  return (
    <button
      type="button"
      data-chip={id}
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cx(
        'press inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors duration-200',
        // 고른 칩은 테마의 두 색 (화면 꾸미기 C, globals.css .kok-chip-on)
        on ? 'kok-chip-on' : 'bg-surface text-ink shadow-[0_1px_2px_var(--shadow)] hover:bg-surface-2',
        mode === 'fill' && 'kok-fill',
      )}
    >
      {color ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" /> : null}
      <span className="max-w-[9rem] truncate">{label}</span>
      {typeof count === 'number' ? (
        <span key="n" className={cx('tabular-nums', !on && 'text-muted', loading === false && 'kok-swap')}>
          {count}
        </span>
      ) : loading ? (
        <span className="inline-block h-2 w-3 rounded-full bg-current opacity-20" aria-hidden="true" />
      ) : null}
      {badge ? <span className={cx('rounded-full px-1.5 text-[11px] font-bold', on ? 'ring-1 ring-inset ring-current' : 'bg-bad-soft text-bad')}>{badge}</span> : null}
    </button>
  );
}

function NoteCard({
  s,
  index,
  isNew,
  enter,
  subject,
  organize,
  selecting,
  picked,
  onPick,
  onLongPress,
  onStar,
  onReview,
  onSelectMode,
  onRename,
  onDelete,
  onRetry,
}: {
  s: LibSource;
  index: number;
  isNew: boolean;
  enter: Enter;
  subject: SubjectRow | null;
  /** 자료함 정리 칸(별표·복습)이 있는지 */
  organize: boolean;
  /** 여러 개 고르는 중 (카드를 누르면 고르기) */
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  /** 카드를 꾹 눌렀다 (고르기 시작, 고르는 중이면 고르기) */
  onLongPress: () => void;
  onStar: () => void;
  onReview: () => void;
  onSelectMode: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const processing = s.status === 'queued' || s.status === 'processing';
  const failed = s.status === 'error';
  const reviewOff = organize && s.in_review === false;
  // 나타나는 방법과 '정리 중이던 카드인지'는 처음 그릴 때 정한 그대로 (다시 그려도 움직임이 다시 돌지 않게)
  const [mode] = useState(enter);
  const [startedBusy] = useState(processing);
  const fill = !isNew && mode === 'fill' ? 'kok-fill' : undefined;
  const press = useLongPress(onLongPress, true);
  const items: MenuItem[] = [
    ...(failed ? [{ label: '다시 하기', icon: ICONS.retry, onSelect: onRetry }] : []),
    ...(organize
      ? [
          { label: s.starred ? '별표 빼기' : '별표', icon: ICONS.star, onSelect: onStar },
          reviewOff
            ? { label: '복습에 다시 넣기', icon: ICONS.review, onSelect: onReview }
            : { label: '복습에서 빼기', icon: ICONS.reviewOff, onSelect: onReview },
        ]
      : []),
    { label: '여러 개 고르기', icon: ICONS.select, onSelect: onSelectMode },
    { label: '이름·단원 바꾸기', icon: ICONS.edit, onSelect: onRename },
    { label: '지우기', icon: ICONS.trash, onSelect: onDelete, danger: true },
  ];
  const href = `/notes/${s.id}`;
  const name = s.title || (processing ? '정리하는 중…' : '제목 없는 자료');
  // 화면 읽기 이름: 제목(없으면 '제목 없는 자료') + 진행·별표·복습 끔
  const label = s.title || '제목 없는 자료';
  const marks = `${organize && s.starred ? ' (별표)' : ''}${reviewOff ? ' (복습 끔)' : ''}`;
  // 별표한 카드는 별에서부터 별표 빛이 번진다 (멈춘 카드는 빨간 테두리가 먼저라 빛을 켜지 않는다)
  const glowing = organize && !!s.starred && !failed;
  // 오른쪽 위 버튼 자리 (별표 + 메뉴, 또는 메뉴만): 글이 버튼 밑으로 들어가지 않게
  const corner = organize ? 'pr-14' : 'pr-7';
  const footer = (
    <>
      <p className="line-clamp-2 text-[15px] font-bold leading-snug">{name}</p>
      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted">
        {subject ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectVar(subject.color) }} aria-hidden="true" /> : null}
        {reviewOff ? (
          <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-warn">
            <Icon d={ICONS.reviewOff} size={13} className="shrink-0" />
            복습 끔
          </span>
        ) : (
          <Icon d={KIND_ICON[s.kind]} size={13} className="shrink-0" />
        )}
        <span className="truncate">
          {reviewOff ? '· ' : ''}
          {s.manual ? '직접 만든 노트' : KIND_LABEL[s.kind]}
          {s.page_count ? ` ${s.page_count}${s.kind === 'image' ? '장' : '쪽'}` : ''} · {shortDate(s.created_at)}
        </span>
      </p>
    </>
  );
  // 고르는 중: 카드를 누르면 고르기 (링크로 가지 않는다). 키보드는 스페이스·엔터
  const pickKeys = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onPick();
    }
  };
  // (누르기는 바깥 칸이 먼저 받아서 고르기만 한다: 아래 onClickCapture)
  const selectProps = selecting ? { role: 'checkbox' as const, 'aria-checked': picked, onKeyDown: pickKeys } : {};
  const ring = selecting && picked ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : '';
  return (
    <div
      data-flip={s.id}
      className={cx('kok-no-callout relative', isNew && 'kok-new rounded-[22px]')}
      style={{ ['--i' as string]: index }}
      {...press}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button, [role="menu"]')) return;
        press.onPointerDown(e);
      }}
      onClickCapture={(e) => {
        press.onClickCapture(e);
        if (e.defaultPrevented) return;
        // 고르는 중에는 카드 안 어디를 눌러도(다시 하기 단추도) 고르기만 한다
        if (selecting) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        }
      }}
    >
      {failed ? (
        // 멈춘 자료: 카드 안에서 바로 다시 하기 (단추를 링크 안에 넣지 않도록 제목만 링크)
        <div className={cx('kok-card flex h-[196px] flex-col overflow-hidden', ring || 'ring-2 ring-bad/40')}>
          <div className={cx('relative grid min-h-0 flex-1 content-start gap-1.5 overflow-hidden px-4 pt-4', fill)}>
            <span className={cx('text-xs font-bold text-bad', selecting ? 'pl-7' : corner)}>멈췄어요 · 에너지는 돌려줬어요</span>
            <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{s.error ?? '정리하다가 문제가 생겼어요.'}</p>
            <button
              type="button"
              tabIndex={selecting ? -1 : undefined}
              className="press mt-0.5 inline-flex items-center gap-1 justify-self-start rounded-full bg-bad px-3 py-1.5 text-xs font-bold text-white"
              onClick={onRetry}
            >
              <Icon d={ICONS.retry} size={14} strokeWidth={2.2} />
              다시 하기
            </button>
          </div>
          <Link href={href} draggable={false} className={cx('press px-4 pb-3.5 pt-1.5', fill)} aria-label={`${label} (멈췄어요)${marks}`} {...selectProps}>
            {footer}
          </Link>
        </div>
      ) : (
        <Link
          href={href}
          // 꾹 누른 채 움직여도 링크를 끌지 않는다 (꾹 누르기는 고르기)
          draggable={false}
          // 카드 밖으로 번지는 별표 빛이 잘리지 않게 카드는 자르지 않는다 (글은 안쪽 칸이 자른다)
          className={cx('kok-card kok-glow press flex h-[196px] flex-col', glowing && 'is-starred', !selecting && 'kok-card-hover', ring)}
          aria-label={`${label}${processing ? ` (${stepLabel(s)})` : ''}${marks}`}
          {...selectProps}
        >
          {/* 아래 끝은 바탕(별표 빛·테마)과 상관없이 흐려지게 mask 로 */}
          <div
            className={cx('relative min-h-0 flex-1 overflow-hidden px-4 pt-4 [mask-image:linear-gradient(to_bottom,#000_calc(100%-2rem),transparent)]', fill)}
          >
            {processing ? (
              <div className="grid gap-2">
                <div className={cx('flex items-center gap-2.5', selecting ? 'pl-7' : corner)}>
                  <ProgressRing value={s.progress} label={`${s.title || '자료'} 진행`} />
                  <span className="min-w-0 text-xs font-bold leading-snug text-accent">{stepLabel(s)}</span>
                </div>
                <div className="kok-shimmer mt-1 h-2.5 w-[88%] rounded-full bg-surface-2" />
                <div className="kok-shimmer h-2.5 w-[70%] rounded-full bg-surface-2" />
                <div className="kok-shimmer h-2.5 w-[80%] rounded-full bg-surface-2" />
              </div>
            ) : (
              // 정리 중이던 카드가 끝나면 미리보기가 번지며 나타난다
              <p className={cx('line-clamp-5 text-[13px] leading-relaxed text-muted', startedBusy && 'kok-fade')}>
                <span className={cx('h-5', selecting ? 'float-left w-6' : organize ? 'float-right w-14' : 'float-right w-6')} aria-hidden="true" />
                {s.summary ? previewText(s.summary) : s.manual ? '직접 만든 노트예요. 눌러서 채워 보세요.' : '정리 노트가 준비됐어요.'}
              </p>
            )}
          </div>
          <div className={cx('px-4 pb-3.5 pt-1.5', fill)}>{footer}</div>
        </Link>
      )}
      {selecting ? (
        // 고르기 동그라미 (왼쪽 위): 고르면 채워지며 체크가 톡
        <span
          className={cx(
            'kok-appear pointer-events-none absolute left-2.5 top-2.5 z-10 grid h-6 w-6 place-items-center rounded-full transition-colors duration-150',
            picked ? 'bg-accent text-accent-ink' : 'bg-surface/90 ring-2 ring-inset ring-line',
          )}
          aria-hidden="true"
        >
          {picked ? <Icon key="on" d={ICONS.check} size={14} strokeWidth={3} className="kok-check-in" /> : null}
        </span>
      ) : (
        // 오른쪽 위: 별표(한 번 누르면 별이 튀고 카드가 맨 위로) + 메뉴
        <div className="absolute right-1.5 top-1.5 z-10 flex items-center">
          {organize ? <StarButton small starFor={s.id} on={!!s.starred} label={`${label} 별표`} onToggle={onStar} /> : null}
          <Menu label={`${s.title || '자료'} 메뉴`} items={items} small />
        </div>
      )}
    </div>
  );
}

/** 카드 순서가 바뀌면 원래 자리에서 새 자리로 미끄러진다 (FLIP: 바뀌기 전 자리를 재고, 바뀐 뒤 거꾸로 옮겼다가 풀어 준다).
 * 바뀌기 바로 전에 돌려준 함수를 부른다. 움직임 줄이기면 바로 바뀐다 */
function useGridFlip(root: RefObject<HTMLElement | null>, orderKey: string) {
  const before = useRef<Map<string, DOMRect> | null>(null);
  const lastKey = useRef(orderKey);
  // 그릴 때마다: 잰 자리는 바로 다음 그리기에서만 쓴다 (순서가 그대로면 버린다. 나중에 스크롤한 뒤 엉뚱하게 움직이지 않게)
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    const changed = lastKey.current !== orderKey;
    lastKey.current = orderKey;
    const el = root.current;
    if (!prev || !changed || !el || prefersReducedMotion()) return;
    for (const n of Array.from(el.querySelectorAll<HTMLElement>('[data-flip]'))) {
      const r0 = prev.get(n.dataset.flip ?? '');
      if (!r0) continue;
      const r = n.getBoundingClientRect();
      const dx = r0.left - r.left;
      const dy = r0.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
    }
  });
  return () => {
    const el = root.current;
    if (el) before.current = new Map(Array.from(el.querySelectorAll<HTMLElement>('[data-flip]'), (n) => [n.dataset.flip ?? '', n.getBoundingClientRect()]));
  };
}

/** 여러 개 고르는 동안 아래 띠: 별표 · 복습 켜고 끄기 · 지우기 (폰은 아래 메뉴 자리를 덮고, 넓은 화면은 가운데에 뜬다) */
function SelectionBar({
  count,
  organize,
  labels,
  busy,
  onStar,
  onReview,
  onDelete,
}: {
  count: number;
  organize: boolean;
  labels: { star: boolean; review: boolean };
  busy: 'star' | 'review' | 'delete' | null;
  onStar: () => void;
  onReview: () => void;
  onDelete: () => void;
}) {
  const off = !count || !!busy;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 md:bottom-6 md:left-60 md:flex md:justify-center">
      <div
        role="toolbar"
        aria-label={`고른 자료 ${count}개`}
        className={cx(
          'kok-selbar pointer-events-auto grid border-t border-line bg-surface px-2 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1.5 md:w-[440px] md:rounded-[24px] md:border md:pb-1.5 md:shadow-[0_12px_36px_var(--shadow-strong)]',
          organize ? 'grid-cols-3' : 'grid-cols-1',
        )}
      >
        {organize ? (
          <>
            <BarAction icon={ICONS.star} label={labels.star ? '별표' : '별표 빼기'} disabled={off} busy={busy === 'star'} onClick={onStar} />
            <BarAction
              icon={labels.review ? ICONS.review : ICONS.reviewOff}
              label={labels.review ? '복습 켜기' : '복습 끄기'}
              disabled={off}
              busy={busy === 'review'}
              onClick={onReview}
            />
          </>
        ) : null}
        <BarAction icon={ICONS.trash} label="지우기" danger disabled={off} busy={busy === 'delete'} onClick={onDelete} />
      </div>
    </div>
  );
}

function BarAction({
  icon,
  label,
  onClick,
  disabled,
  busy,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
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

/** 순서 바꾸기: 단원마다, 별표한 자료와 다른 자료를 따로 끌어서 옮긴다 (자료함에 보이는 차례 그대로) */
function ReorderList({ groups, onOrder }: { groups: Array<{ unit: string; list: LibSource[] }>; onOrder: (order: string[]) => void }) {
  // 단원 × (별표·다른 자료) 묶음. 옮기면 그 묶음만 바꾸고 전체 차례를 다시 만든다
  const sets = groups.map((g) => ({ unit: g.unit, starred: g.list.filter((s) => s.starred), others: g.list.filter((s) => !s.starred) }));
  const move = (gi: number, starred: boolean, next: LibSource[]) => {
    const lists = sets.flatMap((g, i) => {
      const st = i === gi && starred ? next : g.starred;
      const ot = i === gi && !starred ? next : g.others;
      return [st, ot];
    });
    onOrder(flattenOrder(lists));
  };
  const row = (s: LibSource) => (
    <span className="min-w-0 flex-1" data-source={s.id}>
      <span className="flex items-center gap-1.5 text-[15px] font-semibold">
        {s.starred ? <StarGlyph on size={14} /> : null}
        <span className="truncate">{s.title || '제목 없는 자료'}</span>
      </span>
      <span className="block truncate text-xs text-muted">
        {s.manual ? '직접 만든 노트' : KIND_LABEL[s.kind]} · {shortDate(s.created_at)}
        {s.in_review === false ? ' · 복습 끔' : ''}
      </span>
    </span>
  );
  // 단원이 여럿이면 목록 이름에 단원을 붙인다 (화면 읽기에서 어느 단원 목록인지)
  const named = (unit: string, name: string) => (unit && groups.length > 1 ? `${unit} · ${name}` : name);
  return (
    <div className="grid gap-4">
      <p className="rounded-2xl bg-surface-2 px-4 py-2.5 text-sm text-muted">줄을 꾹 누른 채로 끌면 순서가 바뀌어요. 별표한 자료는 늘 맨 위에 있어요.</p>
      {sets.map((g, gi) => (
        <section key={g.unit || 'all'} className="grid gap-2">
          {g.unit && groups.length > 1 ? <h3 className="px-1 text-sm font-bold text-muted">{g.unit}</h3> : null}
          {g.starred.length ? (
            <div className="grid gap-2">
              {g.others.length ? (
                <p className="flex items-center gap-1 px-1 text-xs font-bold text-muted">
                  <StarGlyph on size={13} /> 별표한 자료
                </p>
              ) : null}
              <SortList
                items={g.starred}
                keyOf={(s) => s.id}
                label={named(g.unit, '별표한 자료 순서')}
                nameOf={(s) => s.title || '제목 없는 자료'}
                render={row}
                onReorder={(next) => move(gi, true, next)}
              />
            </div>
          ) : null}
          {g.others.length ? (
            <div className="grid gap-2">
              {g.starred.length ? <p className="px-1 text-xs font-bold text-muted">다른 자료</p> : null}
              <SortList
                items={g.others}
                keyOf={(s) => s.id}
                label={named(g.unit, '자료 순서')}
                nameOf={(s) => s.title || '제목 없는 자료'}
                render={row}
                onReorder={(next) => move(gi, false, next)}
              />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** 불러오는 동안 카드 자리: 실제 카드와 같은 크기·모양이라 다 읽었을 때 자리가 움직이지 않는다 */
function CardSkeleton() {
  return (
    <div className="kok-card kok-shimmer flex h-[196px] flex-col justify-between px-4 pb-3.5 pt-4" aria-hidden="true">
      <div className="grid gap-2 pt-1">
        <span className="kok-bone h-2.5 w-[92%]" />
        <span className="kok-bone h-2.5 w-[78%]" />
        <span className="kok-bone h-2.5 w-[86%]" />
        <span className="kok-bone h-2.5 w-[55%]" />
      </div>
      <div className="grid gap-2">
        <span className="kok-bone h-3.5 w-[70%]" />
        <span className="kok-bone h-2.5 w-[45%]" />
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
  // 적는 글로 시작하는 단원 먼저, 많으면 12개까지
  const typed = unit.trim();
  const suggest = [
    ...units.filter((u) => typed && u !== typed && u.startsWith(typed)),
    ...units.filter((u) => !typed || u === typed || !u.startsWith(typed)),
  ].slice(0, 12);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = title.trim().slice(0, 120);
        const { error } = await sb()
          .from('sources')
          .update({ title: t, unit: unit.trim().slice(0, 40) })
          .eq('id', s.id);
        if (error) {
          toast('저장하지 못했어요.', 'bad');
          return;
        }
        // 노트 화면의 제목도 같이 (노트가 있으면). 이름이 바뀔 때만
        if (t && t !== (s.title ?? '')) await sb().from('notes').update({ title: t }).eq('source_id', s.id);
        onDone();
      }}
    >
      <label className="grid gap-1.5 text-sm font-semibold">
        자료 이름
        <input className={inputClass} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-semibold">
          단원 (같은 이름끼리 묶여요)
          <input className={inputClass} value={unit} maxLength={40} onChange={(e) => setUnit(e.target.value)} />
        </label>
        {/* 이 과목에 있는 단원: 눌러서 고른다 (브라우저 기본 펼침 목록 대신) */}
        {suggest.length ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="있는 단원">
            {suggest.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={u === unit.trim()}
                onClick={() => setUnit(u)}
                className={cx(
                  'press rounded-full px-3 py-1 text-sm font-semibold',
                  u === unit.trim() ? 'kok-chip-on' : 'bg-surface-2 text-ink hover:bg-surface-3',
                )}
              >
                {u}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Button type="submit" className="justify-self-start">
        저장
      </Button>
    </form>
  );
}
