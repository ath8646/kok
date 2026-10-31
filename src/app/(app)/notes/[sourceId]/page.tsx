'use client';
// 노트: 탭 정리 · 그림 · 문제 · 원본 (처리 중이면 진행 상태). 오른쪽 아래 버튼은 노트 채팅이다.
// 정리 탭의 '고치기'(위 띠)를 누르면 고치기 모드: 정리·노트 이름·단원을 그 자리에서 고치고 저절로 저장한다(NoteView). '완료'로 끝낸다.
// 노트에 자료를 더하면(Pro) 버전이 쌓인다. 원본 탭의 버전 기록에서 지난 버전을 열어(?v=번호) 보고 고치거나,
// 그 버전을 지금 버전으로 쓰거나 지울 수 있다. 지난 버전에서 고친 것은 그 버전에 저장된다.
// DB 에 버전·채팅 표가 아직 없으면(me.features) 예전처럼 동작한다.
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { useConfirm } from '@/components/Confirm';
import { ReportSheet } from '@/components/ReportSheet';
import { SOURCES_CHANGED, SUBJECTS_CHANGED, useQuickAdd } from '@/components/QuickAdd';
import { NoteView, type NoteBody } from '@/components/NoteView';
import { ProcessingView } from '@/components/note/ProcessingView';
import { CoursePanel } from '@/components/course/CoursePanel';
import { NotePdfs } from '@/components/note/NotePdfs';
import { OriginalPanel } from '@/components/note/OriginalPanel';
import { OriginalTab } from '@/components/note/OriginalTab';
import { RelocateFiguresSheet } from '@/components/note/RelocateFigures';
import { AppendStatus } from '@/components/note/AppendStatus';
import { NoteChat } from '@/components/note/NoteChat';
import { useStuck } from '@/components/useStuck';
import { QuestionsPanel } from '@/components/note/QuestionsPanel';
import { VisualPanel, type NoteView as NoteViewPrefs, type VisualType, type Visuals } from '@/components/note/VisualPanel';
import type { CardInfo, QuestionRemoval } from '@/components/QuestionList';
import {
  Button,
  Chip,
  EmptyState,
  EnergyEstimate,
  ICONS,
  Icon,
  LargeHeader,
  LinkButton,
  Menu,
  STICKY_BELOW_TOPBAR,
  Spinner,
  api,
  cx,
  useToast,
  DONE,
} from '@/components/ui';
import { NoteInfoSheet, type NoteInfo } from '@/components/NoteInfoSheet';
import { UnitSheet, normalizeUnit } from '@/components/UnitPick';
import { ORGANIZE_COLS, SOURCE_COLS, fetchSubjects, questionCols, sb, type SourceRowWithUnit } from '@/lib/data';
import { readMergedMark } from '@/lib/note-merge';
import { estimateTokens, MERGE_OUT_TOKENS } from '@/lib/append-merge';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { keyPointMemory } from '@/lib/memory';
import { readFigures } from '@/lib/source-figures';
import { readPageLabels } from '@/lib/page-labels';
import { zMindmap, zNote, zTable, zTimeline, type Mindmap, type TableSpec, type TimelineSpec } from '@/lib/ai/schemas';
import type { QuestionRow, SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import {
  VERSION_LIST_COLS,
  VERSION_LIST_COLS_KIND,
  materialLabel,
  onlyInVersion,
  removalPlan,
  toVersionRow,
  type ChildSource,
  type VersionRow,
} from '@/lib/versions';
import { previewText } from '@/lib/richtext';
import { officeFileName, officeLabel } from '@/lib/office/names';
import { starredFirst } from '@/lib/note-order';
import { practiceHref, rememberPracticeFrom } from '@/lib/review-mode';
import { prefersReducedMotion } from '@/components/useReducedMotion';

type Tab = 'note' | 'visual' | 'questions' | 'course' | 'original';
type SourceFull = SourceRowWithUnit & { text_content: string | null; parent_id?: string | null };
type NoteRow = { id: string; title: string; subject_id: string; body: Record<string, unknown>; updated_at: string; current_version?: number };
/** 지난 버전: 그 버전 행에 저장된 정리·그림·문제 목록 */
/** qkeys: 그 버전의 문제가 가리키는 개념 번호 {문제: 개념} (없으면 null: 예전 버전·칸이 없는 DB) */
type OldDoc = {
  number: number;
  title: string;
  body: Record<string, unknown>;
  visuals: Visuals;
  questionIds: string[];
  qkeys: Record<string, string | null> | null;
  updatedAt: string;
};

function readQkeys(v: unknown): Record<string, string | null> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string | null> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = typeof x === 'string' ? x : null;
  return out;
}
/** 저장할 때 '읽은 그대로인지' 확인하는 표 (행 번호와 그때의 updated_at) */
type RowToken = { id: string; updatedAt: string };

/** 탭 차례. '레슨'(단계별 학습, Pro)은 DB 에 표가 있을 때만 보인다 (features.courses) */
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'note', label: '정리' },
  { id: 'visual', label: '그림' },
  { id: 'questions', label: '문제' },
  { id: 'course', label: '레슨' },
  { id: 'original', label: '원본' },
];

const CHILD_COLS = `${SOURCE_COLS}, text_content, parent_id`;
const VISUAL_TYPES: VisualType[] = ['mindmap', 'table', 'timeline'];
const STALE_LIVE = '그사이 다른 곳에서 노트가 바뀌어서 방금 고친 것은 저장하지 못했어요. 새로 불러왔어요.';
const STALE_OLD = '이 버전이 그사이 다른 곳에서 바뀌어서 저장하지 못했어요. 새로 불러왔어요.';
const APPEND_LOCK = '이 노트에 자료를 더하는 중이에요. 끝나면 고칠 수 있어요.';
const REORG_LOCK = 'AI가 노트를 다시 정리하고 있어요. 끝나면 고칠 수 있어요.';

type Bundle = {
  source: SourceFull | null;
  note: NoteRow | null;
  visuals: Visuals;
  /** 그림 행마다 번호와 updated_at: 그사이 바뀐 그림(다른 탭, 새 버전)은 덮어쓰지 않는다 */
  visualRows: Partial<Record<VisualType, RowToken>>;
  /** 이 노트의 문제 모두 (지금 버전에 없는 숨긴 문제도: 지난 버전 보기에 쓴다) */
  questions: QuestionRow[];
  cards: Map<string, CardInfo>;
  subject: SubjectRow | null;
  versions: VersionRow[];
};

function toVisuals(rows: Array<{ type: string; spec: unknown }>): Visuals {
  const visuals: Visuals = {};
  for (const row of rows) {
    try {
      if (row.type === 'mindmap') visuals.mindmap = zMindmap.parse(row.spec);
      if (row.type === 'table') visuals.table = zTable.parse(row.spec);
      if (row.type === 'timeline') visuals.timeline = zTimeline.parse(row.spec);
    } catch {
      // 모양이 깨진 그림은 건너뛴다 (노트는 그대로 보이게)
    }
  }
  return visuals;
}

async function fetchBundle(
  sourceId: string,
  versionsOn: boolean,
  restedOn: boolean,
  figuresOn: boolean,
  organizeOn: boolean,
  sourceFiguresOn: boolean,
  /** 버전이 생긴 까닭 칸 (note_versions.kind, features.merge) */
  kindOn: boolean,
): Promise<Bundle> {
  const empty: Bundle = { source: null, note: null, visuals: {}, visualRows: {}, questions: [], cards: new Map(), subject: null, versions: [] };
  const { data: s } = await sb()
    .from('sources')
    .select(`${SOURCE_COLS}, text_content${versionsOn ? ', parent_id' : ''}${organizeOn ? `, ${ORGANIZE_COLS}` : ''}`)
    .eq('id', sourceId)
    .maybeSingle();
  const source = (s as SourceFull | null) ?? null;
  if (!source || source.status !== 'ready' || source.parent_id) return { ...empty, source };
  const { data: n } = await sb()
    .from('notes')
    .select(`id, title, subject_id, body, updated_at${versionsOn ? ', current_version' : ''}`)
    .eq('source_id', sourceId)
    .maybeSingle();
  if (!n) return { ...empty, source };
  const note = n as unknown as NoteRow;
  const [{ data: vs }, { data: qs }, { data: subj }, vr] = await Promise.all([
    sb().from('visuals').select('id, type, spec, updated_at').eq('note_id', note.id),
    sb()
      .from('questions')
      .select(questionCols({ rested: restedOn, figures: figuresOn, sourceFigures: sourceFiguresOn }))
      .eq('note_id', note.id)
      .order('created_at')
      .order('id'),
    sb().from('subjects').select('id, name, color, exam_date, position, created_at').eq('id', note.subject_id).maybeSingle(),
    versionsOn
      ? sb()
          .from('note_versions')
          .select(kindOn ? VERSION_LIST_COLS_KIND : VERSION_LIST_COLS)
          .eq('note_id', note.id)
          .order('number')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const questions = (qs ?? []) as unknown as QuestionRow[];
  let cards = new Map<string, CardInfo>();
  for (let i = 0; i < questions.length; i += 200) {
    const { data: cs } = await sb()
      .from('cards')
      .select('question_id, lapses, wrong_count, in_wrong_note, due, reps')
      .in(
        'question_id',
        questions.slice(i, i + 200).map((q) => q.id),
      );
    cards = new Map([...cards, ...(cs ?? []).map((c) => [c.question_id as string, c as unknown as CardInfo] as const)]);
  }
  const visualRows = (vs ?? []) as Array<{ id: string; type: string; spec: unknown; updated_at: string }>;
  return {
    source,
    note,
    visuals: toVisuals(visualRows),
    visualRows: Object.fromEntries(
      visualRows.filter((r) => VISUAL_TYPES.includes(r.type as VisualType)).map((r) => [r.type, { id: r.id, updatedAt: r.updated_at }]),
    ),
    questions,
    cards,
    subject: (subj as SubjectRow) ?? null,
    versions: ((vr.data ?? []) as Record<string, unknown>[]).map(toVersionRow),
  };
}

async function fetchKids(parentId: string): Promise<ChildSource[]> {
  const { data, error } = await sb().from('sources').select(CHILD_COLS).eq('parent_id', parentId).order('created_at');
  if (error) return [];
  return (data ?? []) as unknown as ChildSource[];
}

async function fetchOldDoc(noteId: string, number: number, withKeys: boolean): Promise<OldDoc | null> {
  // qkeys 칸은 schema.sql 을 다시 실행한 DB 에만 있다 (features.merge)
  const cols = withKeys ? 'number, title, body, visuals, question_ids, updated_at, qkeys' : 'number, title, body, visuals, question_ids, updated_at';
  const { data: row } = await sb().from('note_versions').select(cols).eq('note_id', noteId).eq('number', number).maybeSingle();
  const data = row as unknown as Record<string, unknown> | null;
  if (!data) return null;
  return {
    number: Number(data.number),
    title: typeof data.title === 'string' ? data.title : '',
    body: (data.body ?? {}) as Record<string, unknown>,
    visuals: toVisuals(Array.isArray(data.visuals) ? (data.visuals as Array<{ type: string; spec: unknown }>) : []),
    questionIds: Array.isArray(data.question_ids) ? data.question_ids.map(String) : [],
    qkeys: withKeys ? readQkeys(data.qkeys) : null,
    updatedAt: String(data.updated_at),
  };
}

/** 주소의 ?이름= 을 바꾼다 (방문 기록은 그대로). 새로 고치거나 뒤로 와도 같은 탭·버전이 열리게 */
function setQueryParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(name) === value) return;
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** 보는 버전을 주소에 적는다 */
function setViewParam(v: number | null) {
  setQueryParam('v', v === null ? null : String(v));
}

export default function NotePage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const { me } = useMe();
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  // 처음 연 주소의 ?tab= · ?kp= · ?v= (다른 화면에서 눌러 들어오면 그리는 동안 window.location 은 아직 앞 화면 주소라 useSearchParams 로 읽는다)
  const params = useSearchParams();
  const [opened] = useState(() => ({ tab: params.get('tab'), kp: params.get('kp'), v: params.get('v'), edit: params.get('edit') === '1' }));
  const versionsOn = !!me?.features.versions;
  const restedOn = !!me?.features.restedHidden;
  const figuresOn = !!me?.features.figures;
  const organizeOn = !!me?.features.organize;
  const sourceFiguresOn = !!me?.features.sourceFigures;
  const chatOn = !!me?.features.chat;
  // 노트 옮기기·합친 노트 다시 정리·버전 까닭 (schema.sql 을 다시 실행한 뒤)
  const mergeOn = !!me?.features.merge;
  const coursesOn = !!me?.features.courses;
  const pdfsOn = !!me?.features.pdfs;
  const canAppend = !!me?.canAppend;
  const [bundle, setBundle] = useState<Bundle | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  // 탭 띠가 위에 붙었을 때만 바탕을 칠한다 (테마 배경이 띠 뒤에서 끊기지 않게)
  const [subbarEl, subbarRef] = useState<HTMLDivElement | null>(null);
  const subbarStuck = useStuck(subbarEl);
  const [tab, setTab] = useState<Tab>(() => {
    const t = opened.tab;
    return t === 'note' || t === 'visual' || t === 'questions' || t === 'course' || t === 'original' ? t : 'note';
  });
  // 보는 탭은 주소에 적어 둔다 (문제 풀기에서 뒤로 오거나 새로 고쳐도 그 탭이 열리게)
  useEffect(() => {
    setQueryParam('tab', tab === 'note' ? null : tab);
  }, [tab]);
  const [kp, setKp] = useState<string | null>(() => opened.kp);
  const [page, setPage] = useState<number | null>(null);
  const [glance, setGlance] = useState(true);
  const [reporting, setReporting] = useState(false);
  // 자료 그림 다시 찾기 (원본에서 그림 자리를 새 방법으로)
  const [relocating, setRelocating] = useState(false);
  // 고치기 모드 (정리 탭): 새로 만든 빈 노트는 ?edit=1 로 바로 고치기 모드로 연다
  const [editMode, setEditMode] = useState(() => opened.edit);
  const [focusTitle, setFocusTitle] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  // 고치는 동안의 저장 상태 (위 띠에 '저장 중'·'저장됨')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => {
    if (opened.edit) setQueryParam('edit', null);
  }, [opened.edit]);
  // 다른 탭으로 가면 고치기를 끝낸다
  const [editTab, setEditTab] = useState(tab);
  if (editTab !== tab) {
    setEditTab(tab);
    if (tab !== 'note') setEditMode(false);
  }
  const [viewing, setViewing] = useState<number | null>(() => {
    const v = Number(opened.v);
    return Number.isInteger(v) && v >= 1 ? v : null;
  });
  const [oldDoc, setOldDoc] = useState<OldDoc | null>(null);
  const [kids, setKids] = useState<ChildSource[]>([]);
  const [kidsTick, setKidsTick] = useState(0);
  const [verBusy, setVerBusy] = useState<string | null>(null);
  // 합친 노트를 AI 로 다시 정리하는 중 (노트 → 그림 차례), 다른 과목으로 옮기기 (고를 과목 목록)
  const [reorg, setReorg] = useState<'note' | 'visual' | null>(null);
  /** 노트 정보(이름·과목·단원) 시트: 열 때 읽은 과목 목록 */
  const [infoSubjects, setInfoSubjects] = useState<SubjectRow[] | null>(null);
  const reload = useCallback(() => setTick((v) => v + 1), []);
  // 저장할 때 '읽은 그대로인지' 확인하는 값 (노트·그림 행·지난 버전 행의 updated_at). 저장하면 새 값으로 바꾼다
  const noteToken = useRef<string | null>(null);
  const visualTokens = useRef<Partial<Record<VisualType, RowToken>>>({});
  // 지난 버전은 번호마다 따로 (다른 버전을 열어도 줄 서 있던 저장이 자기 버전의 값으로 확인하게)
  const oldTokens = useRef<Map<number, string>>(new Map());
  // 저장이 시작·끝날 때마다 늘어나는 수와 진행 중인 저장 수: 읽는 사이에 저장이 끼어들면 읽은 것을 버리고 다시 읽는다
  // (저장보다 먼저 읽은 옛 내용·옛 확인 값으로 화면과 다음 저장을 되돌리지 않게)
  const saveGen = useRef(0);
  const savesPending = useRef(0);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  /** 읽기 시작할 때의 저장 상태 → 읽은 것을 써도 되는지 (안 되면 저장이 끝난 뒤 다시 읽는다) */
  const freshSince = useCallback((gen: number): boolean => {
    if (saveGen.current === gen && savesPending.current === 0) return true;
    saveChain.current.then(() => setTick((t) => t + 1));
    return false;
  }, []);

  useEffect(() => {
    let alive = true;
    const gen = saveGen.current;
    fetchBundle(sourceId, versionsOn, restedOn, figuresOn, organizeOn, sourceFiguresOn, mergeOn)
      .then((b) => {
        if (!alive || !freshSince(gen)) return;
        noteToken.current = b.note?.updated_at ?? null;
        visualTokens.current = b.visualRows;
        setBundle(b);
      })
      .catch(() => {
        if (alive) setBundle((cur) => cur ?? null);
      });
    return () => {
      alive = false;
    };
  }, [sourceId, tick, versionsOn, restedOn, figuresOn, organizeOn, sourceFiguresOn, mergeOn, freshSince]);

  const source = bundle === undefined ? undefined : (bundle?.source ?? null);
  const note = bundle?.note ?? null;
  const visuals = bundle?.visuals;
  const questions = bundle?.questions;
  const cards = useMemo(() => bundle?.cards ?? new Map<string, CardInfo>(), [bundle]);
  const subject = bundle?.subject ?? null;
  const versions = useMemo(() => bundle?.versions ?? [], [bundle]);
  const noteId = note?.id;
  const cur = note?.current_version ?? 1;
  const parentId = source?.parent_id ?? null;
  // 이 노트를 복습에 넣는지 (자료함 정리 칸이 있을 때만. 바꾸면 바로 보여 주고, 저장하지 못하면 되돌린다)
  const [reviewOverride, setReviewOverride] = useState<{ id: string; on: boolean } | null>(null);
  const inReview = (reviewOverride?.id === sourceId ? reviewOverride.on : null) ?? source?.in_review ?? true;
  const setInReview = async (on: boolean) => {
    setReviewOverride({ id: sourceId, on });
    const { error } = await sb().from('sources').update({ in_review: on }).eq('id', sourceId);
    if (error) {
      setReviewOverride(null);
      toast('저장하지 못했어요.', 'bad');
      return;
    }
    // 자료함·홈이 새로 읽게 (기억해 둔 목록도 버린다)
    window.dispatchEvent(new CustomEvent(SOURCES_CHANGED));
    toast(on ? '다시 복습에 넣었어요.' : '복습에서 뺐어요.', 'plain', DONE);
  };

  // 노트에 더한 자료의 주소로 들어오면 그 노트로 보낸다
  useEffect(() => {
    if (parentId) router.replace(`/notes/${parentId}?tab=original`);
  }, [parentId, router]);

  // 노트에 더한 자료 (정리 중·실패·끝남). 막 끝난 자료가 있으면 노트를 다시 읽는다 (새 버전)
  const prevKids = useRef<Map<string, string>>(new Map());
  const nudged = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!versionsOn || !noteId) return;
    let alive = true;
    fetchKids(sourceId).then((rows) => {
      if (!alive) return;
      const finished = rows.some((r) => r.status === 'ready' && prevKids.current.has(r.id) && prevKids.current.get(r.id) !== 'ready');
      prevKids.current = new Map(rows.map((r) => [r.id, r.status]));
      setKids(rows);
      if (finished) {
        toast('자료를 더해 새 버전을 만들었어요.', 'ok', DONE);
        setTick((t) => t + 1);
      }
      // 멈춘 처리는 이어서 하게 한다 (화면이 열려 있을 때)
      for (const r of rows) {
        if (r.status !== 'queued' && r.status !== 'processing') continue;
        const lockedFree = !r.locked_until || Date.parse(r.locked_until) < Date.now();
        const stale = Date.now() - Date.parse(r.updated_at) > 45_000;
        const last = nudged.current.get(r.id) ?? 0;
        if (lockedFree && stale && Date.now() - last > 60_000) {
          nudged.current.set(r.id, Date.now());
          api(`/api/sources/${r.id}/process`, { method: 'POST', body: '{}' }).catch(() => {});
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [sourceId, versionsOn, noteId, kidsTick, tick, toast]);
  const kidsActive = kids.some((k) => k.status === 'queued' || k.status === 'processing');
  useEffect(() => {
    if (!kidsActive) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setKidsTick((x) => x + 1);
    }, 4000);
    return () => clearInterval(t);
  }, [kidsActive]);
  useEffect(() => {
    const on = () => setKidsTick((x) => x + 1);
    window.addEventListener(SOURCES_CHANGED, on);
    return () => window.removeEventListener(SOURCES_CHANGED, on);
  }, []);

  // 지난 버전 보기
  const showOld = versionsOn && !!note && viewing !== null && viewing !== cur;
  useEffect(() => {
    if (!showOld || !noteId || viewing === null) return;
    let alive = true;
    const gen = saveGen.current;
    fetchOldDoc(noteId, viewing, mergeOn).then((d) => {
      if (!alive || !freshSince(gen)) return;
      if (d) {
        oldTokens.current.set(d.number, d.updatedAt);
        setOldDoc(d);
      } else {
        toast('그 버전을 찾을 수 없어요.', 'bad');
        setViewing(null);
        setViewParam(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [showOld, noteId, viewing, tick, toast, freshSince, mergeOn]);
  const old = showOld && oldDoc && oldDoc.number === viewing ? oldDoc : null;

  // + 버튼·끌어다 놓기는 이 노트의 과목에 넣고, 노트 화면에서는 이 노트에 더한다 (Pro)
  const quick = useQuickAdd();
  const contextSubject = note?.subject_id ?? (source ? source.subject_id : null);
  useEffect(() => {
    quick.setContextSubject(contextSubject);
    return () => quick.setContextSubject(null);
  }, [quick, contextSubject]);
  const targetSubject = note?.subject_id ?? null;
  const targetTitle = note?.title || source?.title || '';
  useEffect(() => {
    if (!targetSubject) return;
    quick.setNoteTarget({
      sourceId,
      subjectId: targetSubject,
      title: targetTitle,
      canAppend: canAppend && versionsOn,
      hideFab: chatOn && !showOld,
      versions: versionsOn,
    });
    return () => quick.setNoteTarget(null);
  }, [quick, sourceId, targetSubject, targetTitle, canAppend, versionsOn, chatOn, showOld]);

  // 약점 개념에서 왔으면 그 개념으로 스크롤
  useEffect(() => {
    const target = opened.kp;
    if (noteId && target) setTimeout(() => document.getElementById(`kp-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
  }, [noteId, opened.kp]);

  // 지금 보는 것: 지금 버전(노트) 또는 지난 버전
  const raw = old ? old.body : note?.body;
  const body = useMemo<NoteBody | null>(() => (raw ? ({ ...zNote.parse(raw), recommended: raw.recommended as string | undefined } as NoteBody) : null), [raw]);
  const docVisuals = useMemo<Visuals>(() => (old ? old.visuals : (visuals ?? {})), [old, visuals]);
  // 자료 그림 (PDF·사진 속 그림을 잘라 둔 것, Pro 는 다시 그린 그림도): 개념 카드 안에 보인다
  const docFigures = useMemo(() => readFigures(raw), [raw]);
  // 다시 찾을 수 있는 그림: PDF·사진에서 자른 것 (한글·워드·PPT 속 그림은 그림 전체를 그대로 써서 찾을 자리가 없다)
  const relocatable = useMemo(() => {
    const textSources = new Set([...(source?.kind === 'text' ? [source.id] : []), ...kids.filter((k) => k.kind === 'text').map((k) => k.id)]);
    return docFigures.filter((f) => !textSources.has(f.crop.split('/')[2]));
  }, [docFigures, source, kids]);
  // 인쇄된 쪽 번호 (책의 쪽): 쪽 표시만 바뀌고 원본 열기는 PDF 쪽 그대로
  const pageLabels = useMemo(() => readPageLabels(raw), [raw]);
  const liveQuestions = useMemo(() => (questions ?? []).filter((q) => q.status !== 'hidden'), [questions]);
  // 풀 수 있는 문제 (쉬는 문제 빼고)가 있을 때만 '이 노트 문제 풀기'
  const canPractice = useMemo(() => liveQuestions.some((q) => q.status === 'active'), [liveQuestions]);
  // 지난 버전의 문제는 그 버전의 개념 번호로 보인다 (qkeys: 'AI로 다시 정리'가 지금 버전에서 바꾼 번호가 아니라)
  const docQuestions = useMemo(() => {
    if (!old) return liveQuestions;
    const keys = old.qkeys;
    return (questions ?? [])
      .filter((q) => old.questionIds.includes(q.id))
      .map((q) => (keys && Object.prototype.hasOwnProperty.call(keys, q.id) ? { ...q, key_point_id: keys[q.id] } : q));
  }, [old, questions, liveQuestions]);
  // 개념마다 기억 상태 (마인드맵 가지 색 점, 가지 자세히): 지금 복습에 나오는 문제의 카드로
  const memory = useMemo(() => keyPointMemory(liveQuestions, cards), [liveQuestions, cards]);
  /** 마인드맵 가지 자세히의 '정리에서 보기': 정리 탭으로 가서 그 개념을 칠해 보여 준다 */
  const showInNote = useCallback((kpId: string) => {
    setTab('note');
    setKp(kpId);
    setTimeout(() => document.getElementById(`kp-${kpId}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' }), 250);
  }, []);
  const existing = useMemo(() => new Set((questions ?? []).map((q) => q.id)), [questions]);
  const view = (raw?.view ?? {}) as NoteViewPrefs;
  // 문제 만들기·채팅에서 쓰는 개념: 노트에 보이는 순서(별표 먼저), 이름은 꾸미기 기호 없이 글로
  const keyPoints = useMemo(() => starredFirst(body?.key_points ?? []).map((k) => ({ id: k.id, title: previewText(k.title) || k.title })), [body]);
  const noteChars = useMemo(() => (note ? JSON.stringify(note.body).length : 0), [note]);
  // 문제·마인드맵이 가리키는 개념 번호: 새로 만드는 개념에는 쓰지 않는다 (지운 개념의 문제가 새 개념에 붙지 않게)
  const reservedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const q of questions ?? []) if (q.key_point_id) ids.add(q.key_point_id);
    for (const n of docVisuals.mindmap?.nodes ?? []) if (n.key_point_id) ids.add(n.key_point_id);
    return ids;
  }, [questions, docVisuals]);

  // 예전 화면에서 고쳐서 저장되지 않았을 때 (다른 탭·기기에서 자료를 더했거나 버전을 바꿈): 알려 주고 새로 읽는다
  const staleAt = useRef(0);
  const staleReload = useCallback(
    (message: string) => {
      if (Date.now() - staleAt.current > 4000) {
        staleAt.current = Date.now();
        toast(message, 'bad');
      }
      reload();
    },
    [toast, reload],
  );

  // 저장은 한 줄로 세운다: 앞 저장이 받은 새 updated_at 으로 다음 저장을 확인한다 (빨리 여러 번 눌러도)
  const queued = <T,>(fn: () => Promise<T>): Promise<T> => {
    saveGen.current++;
    savesPending.current++;
    const done = () => {
      saveGen.current++;
      savesPending.current--;
    };
    const p = saveChain.current.then(fn, fn).finally(done);
    saveChain.current = p.catch(() => undefined);
    return p;
  };

  /** 지난 버전 행 고치기. 읽은 뒤에 바뀌었으면(지금 버전으로 씀, 지움, 다른 탭에서 고침) 저장하지 않는다 */
  const saveOld = async (number: number, patch: Record<string, unknown>): Promise<boolean | 'stale'> => {
    if (!note) return false;
    // 그 버전을 읽은 값이 없으면 확인할 수 없으니 저장하지 않고 새로 읽는다
    const tok = oldTokens.current.get(number);
    if (!tok) {
      staleReload(STALE_OLD);
      return 'stale';
    }
    const { data, error } = await sb()
      .from('note_versions')
      .update(patch)
      .eq('note_id', note.id)
      .eq('number', number)
      .eq('updated_at', tok)
      .select('updated_at');
    if (error) return false;
    const row = data?.[0];
    if (!row) {
      oldTokens.current.delete(number);
      staleReload(STALE_OLD);
      return 'stale';
    }
    oldTokens.current.set(number, String(row.updated_at));
    return true;
  };

  const saveBody = async (next: Record<string, unknown>) => {
    if (!note) return;
    // 자료를 더하는 동안에는 지금 버전을 고치지 않는다 (열려 있던 고치기 칸에서 저장해도)
    if (!old && appendRunning) {
      toast(APPEND_LOCK, 'bad');
      return;
    }
    // AI 가 다시 정리하는 동안에도 (끝나면 새 버전이 되어 고친 것이 덮인다)
    if (!old && reorg) {
      toast(REORG_LOCK, 'bad');
      return;
    }
    setSaveState('saving');
    const settled = (ok: boolean) => setSaveState(ok ? (savesPending.current > 0 ? 'saving' : 'saved') : 'error');
    if (old) {
      const number = old.number;
      setOldDoc((d) => (d && d.number === number ? { ...d, body: next } : d));
      const r = await queued(() => saveOld(number, { body: next }));
      if (r === false) toast('저장하지 못했어요.', 'bad');
      settled(r === true);
      return;
    }
    setBundle((b) => (b && b.note ? { ...b, note: { ...b.note, body: next } } : b));
    // 읽은 노트 그대로일 때만 저장한다 (예전 화면이 합친 새 버전이나 다른 탭에서 고친 것을 덮어쓰지 않게)
    const ok = await queued(async () => {
      let q = sb().from('notes').update({ body: next }).eq('id', note.id);
      if (noteToken.current) q = q.eq('updated_at', noteToken.current);
      const { data, error } = await q.select('updated_at');
      if (error) {
        toast('저장하지 못했어요.', 'bad');
        return false;
      }
      const row = data?.[0];
      if (!row) {
        staleReload(STALE_LIVE);
        return false;
      }
      noteToken.current = String(row.updated_at);
      return true;
    });
    settled(ok);
  };

  /** 노트 이름 바꾸기 (지금 버전): 노트와 자료 이름을 같이 바꾼다 (자료함·홈은 자료 이름을 보여 준다) */
  const rename = async (to: string) => {
    const t = to.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!note || !t) return;
    setSaveState('saving');
    try {
      // 정리 안의 제목도 같이 (AI 에 보내는 노트 제목). 자료를 더하는 중에는 정리를 건드리지 않는다 (합치기를 다시 하지 않게)
      const withBody = !(versionsOn && kidsActive);
      const r = await queued(async (): Promise<boolean | 'stale'> => {
        let q = sb()
          .from('notes')
          .update(withBody ? { title: t, body: { ...note.body, title: t } } : { title: t })
          .eq('id', note.id);
        if (noteToken.current) q = q.eq('updated_at', noteToken.current);
        const { data, error } = await q.select('updated_at');
        if (error) return false;
        const row = data?.[0];
        if (!row) return 'stale';
        noteToken.current = String(row.updated_at);
        return true;
      });
      if (r === 'stale') {
        staleReload(STALE_LIVE);
        setSaveState('error');
        return;
      }
      if (!r) {
        toast('이름을 바꾸지 못했어요.', 'bad');
        setSaveState('error');
        return;
      }
      await sb().from('sources').update({ title: t }).eq('id', sourceId);
      setBundle((b) =>
        b && b.note
          ? {
              ...b,
              note: { ...b.note, title: t, body: withBody ? { ...b.note.body, title: t } : b.note.body },
              source: b.source ? { ...b.source, title: t } : b.source,
            }
          : b,
      );
      window.dispatchEvent(new Event(SOURCES_CHANGED));
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  /** 단원 바꾸기 (자료 행의 단원: 자료함이 단원마다 묶는다) */
  const changeUnit = async (to: string) => {
    const unit = normalizeUnit(to);
    setUnitOpen(false);
    if (!source || unit === (source.unit ?? '')) return;
    setSaveState('saving');
    const { error } = await sb().from('sources').update({ unit }).eq('id', sourceId);
    if (error) {
      toast('단원을 바꾸지 못했어요.', 'bad');
      setSaveState('error');
      return;
    }
    setBundle((b) => (b && b.source ? { ...b, source: { ...b.source, unit } } : b));
    window.dispatchEvent(new Event(SOURCES_CHANGED));
    setSaveState('saved');
  };

  /** 지금 버전의 그림 저장: 읽은 그림 행 그대로일 때만 (새 버전이면 행이 새로 생겨 0행) */
  const saveLiveVisual = async (t: VisualType, spec: Mindmap | TableSpec | TimelineSpec): Promise<boolean | 'stale'> => {
    // 자료를 더하거나 AI 가 다시 정리하는 동안에는 지금 버전의 그림을 고치지 않는다 (알리고 새로 읽어 고친 것을 되돌린다)
    if (appendRunning || reorg) {
      staleReload(appendRunning ? APPEND_LOCK : REORG_LOCK);
      return 'stale';
    }
    return queued(async () => {
      const tok = visualTokens.current[t];
      if (!note || !tok) return false;
      const { data, error } = await sb().from('visuals').update({ spec }).eq('id', tok.id).eq('updated_at', tok.updatedAt).select('updated_at');
      if (error) return false;
      const row = data?.[0];
      if (!row) {
        staleReload(STALE_LIVE);
        return 'stale';
      }
      visualTokens.current = { ...visualTokens.current, [t]: { id: tok.id, updatedAt: String(row.updated_at) } };
      return true;
    });
  };

  /** 지난 버전의 그림 저장 (그 버전 행의 visuals 를 통째로 바꾼다) */
  const saveOldVisual = async (t: VisualType, spec: Mindmap | TableSpec | TimelineSpec): Promise<boolean | 'stale'> => {
    if (!note || !old) return false;
    const number = old.number;
    const next: Visuals = { ...old.visuals, [t]: spec };
    const rows = VISUAL_TYPES.filter((k) => next[k]).map((k) => ({ type: k, spec: next[k] }));
    const r = await queued(() => saveOld(number, { visuals: rows }));
    if (r === true) setOldDoc((d) => (d && d.number === number ? { ...d, visuals: next } : d));
    return r;
  };

  /**
   * 지난 버전에서 문제의 개념 바꾸기: 그 버전 행의 qkeys 에만 적는다 (문제 행의 개념은 지금 버전의 것이라 그대로 둔다).
   * 그 버전을 쓰면 서버가 qkeys 대로 되돌린다 (kok_switch_version)
   */
  const setOldConcept = async (questionId: string, keyPointId: string | null): Promise<boolean> => {
    if (!note || !old) return false;
    const number = old.number;
    const next = { ...(old.qkeys ?? {}), [questionId]: keyPointId };
    const r = await queued(() => saveOld(number, { qkeys: next }));
    if (r !== true) return false;
    setOldDoc((d) => (d && d.number === number ? { ...d, qkeys: next } : d));
    return true;
  };

  /** 지난 버전의 문제 목록 바꾸기 */
  const setOldQuestionIds = async (ids: string[]): Promise<boolean> => {
    if (!note || !old) return false;
    const number = old.number;
    const r = await queued(() => saveOld(number, { question_ids: ids }));
    if (r !== true) return false;
    setOldDoc((d) => (d && d.number === number ? { ...d, questionIds: ids } : d));
    return true;
  };

  // 버전이 있으면 문제 지우기는 다른 버전의 문제를 남긴다
  const removal =
    versionsOn && versions.length
      ? (q: QuestionRow): QuestionRemoval => {
          const plan = removalPlan(q.id, versions, cur, old ? old.number : cur, q.status !== 'hidden');
          if (plan === 'hide') {
            return {
              label: '이 버전에서 빼기',
              confirm: '이 문제를 지금 버전에서 뺄까요?',
              note: '다른 버전에는 그대로 남아요.',
              // 쉬는 중이던 문제는 그것도 기억해 둔다 (그 버전으로 돌아오면 다시 쉬는 중)
              run: async () =>
                !(
                  await sb()
                    .from('questions')
                    .update({ status: 'hidden', ...(restedOn ? { rested_hidden: q.status === 'suspended' } : {}) })
                    .eq('id', q.id)
                ).error,
            };
          }
          if (plan === 'unlist') {
            return {
              label: '이 버전에서 빼기',
              confirm: '이 문제를 이 버전에서 뺄까요?',
              note: '다른 버전에는 그대로 남아요.',
              run: () => setOldQuestionIds((old?.questionIds ?? []).filter((x) => x !== q.id)),
            };
          }
          return {
            label: '지우기',
            confirm: '이 문제를 지울까요?',
            note: '푼 기록도 같이 지워지고 되돌릴 수 없어요.',
            danger: true,
            run: async () => {
              const ok = !(await sb().from('questions').delete().eq('id', q.id)).error;
              if (ok && old) await setOldQuestionIds(old.questionIds.filter((x) => x !== q.id));
              return ok;
            },
          };
        }
      : undefined;

  const openVersion = (n: number) => {
    const v = n === cur ? null : n;
    setViewing(v);
    setViewParam(v);
    setTab('note');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const switchTo = async (n: number) => {
    if (!note) return;
    if (
      !(await ask({
        title: `버전 ${n} 쓰기`,
        body: '이 버전을 지금 버전으로 쓸까요?',
        note: '복습에는 이 버전의 문제가 나와요. 지금 쓰던 버전도 기록에 그대로 남아요.',
        ok: '이 버전 쓰기',
      }))
    )
      return;
    setVerBusy(`use-${n}`);
    try {
      await api(`/api/notes/${note.id}/versions`, { method: 'POST', body: JSON.stringify({ action: 'switch', number: n }) });
      setViewing(null);
      setViewParam(null);
      toast(`지금 버전을 바꿨어요 (버전 ${n}).`, 'ok', DONE);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setVerBusy(null);
    }
  };

  const deleteVersion = async (n: number) => {
    if (!note) return;
    // 같이 지워지는 자료를 이름으로 알려 준다 (그 버전에만 있는 더한 자료·합쳐 들어온 노트의 자료)
    const gone = onlyInVersion(versions, n, sourceId);
    const goneNames = gone.length
      ? `${gone
          .slice(0, 3)
          .map((m) => `'${materialLabel(m)}'`)
          .join(', ')}${gone.length > 3 ? ` 외 ${gone.length - 3}개` : ''}`
      : '';
    if (
      !(await ask({
        title: `버전 ${n} 지우기`,
        body: '이 버전을 지울까요? 이 버전에만 있던 문제(푼 기록 포함)도 함께 지워져요.',
        note: (
          <>
            {goneNames ? <span className="block">함께 지워지는 자료: {goneNames} (그 자료로 만든 문제와 푼 기록도)</span> : null}
            {n === cur ? <span className="block">지금 쓰는 버전이라, 지우면 남은 버전 중 가장 최근 버전을 쓰게 돼요.</span> : null}
            <span className="block">되돌릴 수 없어요.</span>
          </>
        ),
        ok: '지우기',
        danger: true,
      }))
    )
      return;
    setVerBusy(`del-${n}`);
    try {
      await api(`/api/notes/${note.id}/versions`, { method: 'POST', body: JSON.stringify({ action: 'delete', number: n }) });
      if (viewing === n) {
        setViewing(null);
        setViewParam(null);
      }
      toast('버전을 지웠어요.', 'ok', DONE);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setVerBusy(null);
    }
  };

  /** 합친 노트 안내 닫기 (메뉴의 'AI로 다시 정리'는 남는다) */
  const hideMerged = () => {
    const mark = readMergedMark(note?.body);
    if (!note || !mark) return;
    saveBody({ ...note.body, merged: { ...mark, hide: true } });
  };

  /**
   * 합친 노트를 AI 로 다시 정리 (Pro): 겹치는 개념을 하나로 묶고 차례를 다듬어 새 버전으로. 이어서 새 정리에 맞게 그림을 다시 그린다.
   * 그림을 못 그려도 노트는 다시 정리된 채로 둔다 (그림 탭에서 다시 만들 수 있다)
   */
  const reorganize = async () => {
    if (!note || reorg) return;
    if (
      !(await ask({
        title: 'AI로 다시 정리',
        body: '겹치는 개념을 AI가 하나로 묶고 차례를 다듬을까요?',
        note: '지금 노트는 원본 탭의 버전 기록에 남아서 언제든 돌아갈 수 있어요. 문제와 푼 기록은 그대로예요.',
        ok: '다시 정리',
      }))
    )
      return;
    setReorg('note');
    try {
      await api(`/api/notes/${note.id}/reorganize`, { method: 'POST', body: '{}' });
    } catch (e) {
      setReorg(null);
      toast((e as Error).message, 'bad');
      reload();
      return;
    }
    setReorg('visual');
    try {
      type Preview = {
        version: number | null;
        preview: { recommended: string; mindmap: unknown; table: unknown; timeline: unknown };
      };
      const p = await api<Preview>(`/api/notes/${note.id}/visual`, { method: 'POST', body: JSON.stringify({ action: 'preview' }) });
      await api(`/api/notes/${note.id}/visual`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'apply',
          version: p.version ?? undefined,
          recommended: p.preview.recommended,
          mindmap: p.preview.mindmap,
          table: p.preview.table,
          timeline: p.preview.timeline,
        }),
      });
      toast('AI로 다시 정리했어요. 정리하기 전 노트는 원본 탭의 버전 기록에 있어요.', 'ok', DONE);
    } catch (e) {
      toast(`노트는 다시 정리했어요. 그림은 다시 그리지 못했으니 그림 탭에서 다시 만들어 주세요. (${(e as Error).message})`, 'bad');
    } finally {
      setReorg(null);
      reload();
      window.dispatchEvent(new Event(SOURCES_CHANGED));
    }
  };

  /** 노트 정보(이름·과목·단원): 고를 과목 목록을 읽고 시트를 연다 */
  const openInfo = async () => {
    try {
      setInfoSubjects(await fetchSubjects());
    } catch {
      toast('과목 목록을 불러오지 못했어요.', 'bad');
    }
  };

  /**
   * 노트 정보 저장: 이름(노트·자료 같이)·단원을 먼저 고치고, 과목을 바꿨으면 마지막에 옮긴다
   * (옮기면 노트 행이 바뀌어서, 그 전에 이름을 읽은 그대로 저장한다). 옮긴 뒤에는 새로 읽는다
   */
  const saveInfo = async (next: NoteInfo, moveTo: SubjectRow | null): Promise<boolean> => {
    if (next.title !== (note?.title ?? source?.title ?? '')) await rename(next.title);
    if (next.unit !== (source?.unit ?? '')) await changeUnit(next.unit);
    if (!moveTo) {
      toast('저장했어요.', 'plain', DONE);
      return true;
    }
    try {
      await api('/api/sources/move', { method: 'POST', body: JSON.stringify({ ids: [sourceId], subject: moveTo.id }) });
      toast(`'${moveTo.name}' 과목으로 옮겼어요.`, 'plain', DONE);
      window.dispatchEvent(new Event(SOURCES_CHANGED));
      window.dispatchEvent(new Event(SUBJECTS_CHANGED));
      reload();
      return true;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return false;
    }
  };

  if (!me) return null;
  const back = { href: subject ? `/library/${subject.id}` : source?.subject_id ? `/library/${source.subject_id}` : '/library', label: '자료함으로' };
  if (source === undefined || parentId)
    return (
      <div className="grid gap-3">
        <LargeHeader size="compact" back={back} title=" " />
        {/* 읽는 동안의 자리: 조금 늦게 나타나 금방 읽히면 보이지 않는다 */}
        <div className="kok-card kok-shimmer kok-skel h-48" aria-hidden="true" />
      </div>
    );
  if (source === null)
    return (
      <div className="grid gap-3">
        <LargeHeader size="compact" back={{ href: '/library', label: '자료함으로' }} title="자료를 찾을 수 없어요" />
        <EmptyState title="지워졌거나 없는 자료예요" action={<LinkButton href="/library">자료함으로</LinkButton>} />
      </div>
    );

  const ready = source.status === 'ready' && !!note && !!body;
  const manual = !!body?.manual;
  // 한글·워드·PPT 에서 꺼낸 글이면 그 파일 이름 (머리의 자료 종류: '워드 문서 · 그림 2장')
  const docFile = source.kind === 'text' ? officeFileName(source.text_content) : null;
  // 직접 만든 노트는 AI 가 만든 것이 없으면 신고할 것도 없다 (자료를 더해 AI 가 합쳤으면 신고할 수 있다)
  const reportable = !manual || versions.length > 0;
  const title = old?.title || note?.title || source.title || (ready ? '새 자료' : '정리하는 중…');
  /** 이 노트 문제 풀기로 갈 때: 노트에서 왔다고 남기고(돌아갈 때 뒤로 가기·제목 먼저 보이기) 주소를 준다 */
  const openPractice = () => {
    rememberPracticeFrom(sourceId, note?.title || source.title || '');
    return practiceHref(sourceId);
  };
  // 고칠 수 있는지 (자료를 더하는 중·AI 가 다시 정리하는 중에는 지금 버전을 고치지 않는다)
  const editableNow = !(versionsOn && kidsActive && !old) && !(reorg && !old);
  const editOn = editMode && tab === 'note' && ready && editableNow;
  const startEdit = (title = false) => {
    setTab('note');
    setSaveState('idle');
    setEditMode(true);
    if (title) setFocusTitle(true);
  };
  const finishEdit = () => {
    // 켜져 있는 글 칸의 마지막 글을 먼저 알린다
    (document.activeElement as HTMLElement | null)?.blur?.();
    setEditMode(false);
  };
  const meta = (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      {subject ? (
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: subjectVar(subject.color) }} aria-hidden="true" />
          {subject.name}
        </span>
      ) : null}
      {editOn && !old ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`단원: ${source.unit || '단원 없음'} (바꾸기)`}
          onClick={() => setUnitOpen(true)}
          className="press inline-flex items-center gap-0.5 rounded-full border border-dashed border-accent px-2.5 py-0.5 text-xs font-semibold text-accent hover:bg-accent-soft"
        >
          {source.unit || '단원 없음'}
          <Icon d={ICONS.chevronDown} size={13} strokeWidth={2.4} />
        </button>
      ) : source.unit ? (
        <Chip>{source.unit}</Chip>
      ) : null}
      <span>
        ·{' '}
        {manual
          ? '직접 만든 노트'
          : source.kind === 'pdf'
            ? `PDF ${source.page_count ?? ''}쪽`
            : source.kind === 'image'
              ? `사진 ${source.page_count ?? ''}장`
              : docFile
                ? `${officeLabel(docFile)} 문서${source.file_paths?.length ? ` · 그림 ${source.file_paths.length}장` : ''}`
                : '직접 쓴 글'}
      </span>
      {versions.length ? <span>· 버전 {old ? old.number : cur}</span> : null}
      {manual && !versions.length ? null : <span>· AI 정리</span>}
    </span>
  );

  if (!ready) {
    return (
      <div className="grid gap-3">
        <LargeHeader size="compact" back={back} title={title} subtitle={meta} />
        {source.status === 'ready' ? (
          // 정리는 끝났는데 노트가 없다 (만들다 멈춘 빈 노트 등)
          <EmptyState
            title="노트를 불러오지 못했어요"
            body="잠시 뒤에 다시 불러와 보세요. 계속 안 되면 자료함에서 지우고 다시 만들어 주세요."
            action={<Button onClick={reload}>다시 불러오기</Button>}
          />
        ) : (
          <ProcessingView source={source} onReload={reload} />
        )}
      </div>
    );
  }

  const loadingOld = showOld && !old;
  // 자료를 더하는 동안에는 지금 노트의 정리·그림을 고치지 않는다 (합치는 바탕이 바뀌면 처음부터 다시 합쳐야 해서)
  const appendRunning = versionsOn && kidsActive && !old;
  const aiLocked = old
    ? '지난 버전에서는 AI로 다시 만들 수 없어요. 이 버전을 쓰면 할 수 있어요.'
    : appendRunning
      ? APPEND_LOCK
      : reorg
        ? REORG_LOCK
        : undefined;
  const editLocked = appendRunning ? APPEND_LOCK : reorg && !old ? REORG_LOCK : undefined;
  // 여러 노트를 합친 노트 (지금 버전만): 'AI로 다시 정리' 안내 (Pro). 다시 정리하면 표시가 없어진다
  const mergedMark = !old && mergeOn ? readMergedMark(note.body) : null;
  // 다시 정리의 예상 번개: 노트를 다시 쓰는 답 + 이어서 그림 다시 그리기
  const reorgEst = (() => {
    if (!mergedMark) return null;
    const json = JSON.stringify(note.body);
    const out = Math.min(MERGE_OUT_TOKENS, estimateTokens(json) + 400);
    const noteEst = estimateSmallTask(clientModel(me, me.settings.models.organize), me.usdPerEnergy, 1500 + Math.ceil(json.length * 0.9), out);
    const visualEst = estimateSmallTask(clientModel(me, me.settings.models.visual), me.usdPerEnergy, 4500, 2500);
    return Math.round((noteEst + visualEst) * 10) / 10;
  })();

  return (
    <div className="grid gap-4">
      <LargeHeader
        size="compact"
        flush
        back={back}
        title={editOn && !old ? <TitleField value={title} onCommit={rename} autoFocus={focusTitle} onFocused={() => setFocusTitle(false)} /> : title}
        compactTitle={title}
        subtitle={meta}
        actions={
          <>
            {tab === 'note' && !loadingOld ? (
              editOn ? (
                <>
                  <SaveBadge state={saveState} />
                  <Button size="sm" onClick={finishEdit}>
                    완료
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={!editableNow}
                  title={editableNow ? '정리를 그 자리에서 고쳐요' : (editLocked ?? undefined)}
                  onClick={() => startEdit()}
                  className="press mr-0.5 inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-sm font-bold text-ink hover:bg-surface-3 disabled:opacity-40"
                >
                  <Icon d={ICONS.edit} size={16} />
                  고치기
                </button>
              )
            ) : null}
            {editOn ? null : (
              <Menu
                label="노트 메뉴"
                items={[
                  ...(canPractice ? [{ label: '이 노트 문제 풀기', icon: ICONS.retry, onSelect: () => router.push(openPractice()) }] : []),
                  ...(old ? [] : [{ label: '이름·과목·단원 바꾸기', icon: ICONS.pen, onSelect: () => void openInfo() }]),
                  ...(organizeOn && !old
                    ? [
                        inReview
                          ? { label: '복습에서 빼기', icon: ICONS.reviewOff, onSelect: () => setInReview(false) }
                          : { label: '복습에 다시 넣기', icon: ICONS.review, onSelect: () => setInReview(true) },
                      ]
                    : []),
                  ...(mergedMark
                    ? [{ label: 'AI로 다시 정리', icon: ICONS.sparkle, onSelect: () => (me.canAppend ? reorganize() : router.push('/plan')) }]
                    : []),
                  ...(versionsOn ? [{ label: versions.length ? '버전 기록' : '자료 더하기', icon: ICONS.file, onSelect: () => setTab('original') }] : []),
                  ...(sourceFiguresOn && !old && !appendRunning && relocatable.length
                    ? [{ label: '자료 그림 다시 찾기', icon: ICONS.image, onSelect: () => setRelocating(true) }]
                    : []),
                  ...(reportable ? [{ label: '이상해요 (신고)', icon: ICONS.edit, onSelect: () => setReporting(true) }] : []),
                ]}
              />
            )}
          </>
        }
      />
      <div ref={subbarRef} className={cx(STICKY_BELOW_TOPBAR, 'kok-subbar z-20 -mx-4 -mt-4 px-4 pb-2.5 pt-1 md:-mx-6 md:px-6', subbarStuck && 'is-stuck')}>
        <div
          className={cx('kok-seg grid gap-1 rounded-full bg-surface-2 p-1', coursesOn ? 'grid-cols-5' : 'grid-cols-4')}
          role="tablist"
          aria-label="노트 보기"
        >
          {TABS.filter((t) => t.id !== 'course' || coursesOn).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'press min-h-[40px] rounded-full py-2 text-sm font-bold',
                tab === t.id ? 'kok-seg-on bg-raised text-ink shadow-[0_1px_3px_var(--shadow-strong)]' : 'text-muted hover:text-ink',
              )}
            >
              {t.label}
              {t.id === 'questions' ? <span className="ml-1 tabular-nums opacity-60">{docQuestions.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {versionsOn ? <AppendStatus kids={kids} onChanged={() => setKidsTick((x) => x + 1)} /> : null}

      {me.isAdmin && !old ? <FigureLogLine body={note.body} /> : null}

      {/* 여러 노트를 합친 노트: 겹치는 개념을 AI 가 하나로 다듬을 수 있다 (Pro). 닫아도 메뉴에 남는다 */}
      {mergedMark && (!mergedMark.hide || reorg) ? (
        <section className="kok-card kok-rise grid gap-3 p-4" aria-label="합친 노트">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
              <Icon d={ICONS.merge} size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">노트 {mergedMark.count}개를 합친 노트예요</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">
                {me.canAppend
                  ? '겹치는 개념은 AI가 하나로 묶고 차례를 다듬어 줄 수 있어요. 지금 노트는 버전 기록에 남아요.'
                  : '겹치는 개념은 정리 탭에서 직접 고칠 수 있어요. Pro에서는 AI가 한 번에 다듬어 줘요.'}
              </p>
            </div>
            {!reorg ? (
              <button
                type="button"
                aria-label="합친 노트 안내 닫기"
                title="닫기"
                onClick={hideMerged}
                disabled={appendRunning}
                className="press -mr-1.5 -mt-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon d={ICONS.close} size={18} />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-12">
            {me.canAppend ? (
              <Button size="sm" busy={!!reorg} disabled={!!reorg || appendRunning || !me.aiEnabled} onClick={reorganize}>
                {!reorg ? <Icon d={ICONS.sparkle} size={16} /> : null}
                AI로 다시 정리
                {reorgEst !== null ? (
                  <span className="opacity-85">
                    <EnergyEstimate est={reorgEst} />
                  </span>
                ) : null}
              </Button>
            ) : (
              <LinkButton href="/plan" size="sm" variant="secondary">
                Pro 알아보기
              </LinkButton>
            )}
          </div>
          {reorg ? (
            <p className="flex items-center gap-2 pl-12 text-sm text-muted" role="status">
              <Spinner />
              {reorg === 'note' ? 'AI가 노트를 다시 정리하고 있어요. 1~2분쯤 걸려요.' : '새 정리에 맞게 그림을 다시 그리고 있어요.'}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* 복습에서 뺀 노트: 문제는 여기서 직접 풀 수 있고, 바로 다시 넣을 수 있다 */}
      {organizeOn && !inReview && !old ? (
        <section className="kok-card kok-rise flex items-center gap-3 p-3 pl-3.5" role="status" aria-label="복습에서 뺀 노트">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warn-soft text-warn" aria-hidden="true">
            <Icon d={ICONS.reviewOff} size={19} />
          </span>
          <p className="min-w-0 flex-1 text-sm leading-snug">
            <b>복습에서 뺀 노트예요.</b> <span className="text-muted">문제는 여기서 직접 풀 수 있어요.</span>
          </p>
          <Button size="sm" variant="secondary" onClick={() => setInReview(true)}>
            다시 넣기
          </Button>
        </section>
      ) : null}

      {showOld ? (
        <section className="kok-card kok-rise grid gap-2.5 p-4 ring-2 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-lg">지난 버전을 보고 있어요</p>
            <Chip tone="accent">버전 {viewing}</Chip>
          </div>
          <p className="text-sm text-muted">여기서 고친 내용은 이 버전에 저장돼요. 복습에는 지금 쓰는 버전(버전 {cur})의 문제가 나와요.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={kidsActive || !!verBusy} busy={verBusy === `use-${viewing}`} onClick={() => viewing !== null && switchTo(viewing)}>
              이 버전 쓰기
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openVersion(cur)}>
              지금 버전으로 돌아가기
            </Button>
          </div>
        </section>
      ) : null}

      {loadingOld ? (
        <div className="grid gap-3" aria-busy="true">
          <div className="kok-card kok-shimmer h-40" />
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> 지난 버전을 여는 중
          </p>
        </div>
      ) : (
        <>
          {tab === 'note' ? (
            <div className="grid gap-4">
              {docVisuals.mindmap || docVisuals.table || docVisuals.timeline ? (
                <section className="kok-card kok-rise p-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-1 font-display text-lg"
                    onClick={() => setGlance((g) => !g)}
                    aria-expanded={glance}
                  >
                    한눈에 보기
                    <span className="text-sm font-normal text-muted">{glance ? '접기' : '펼치기'}</span>
                  </button>
                  {glance ? (
                    <div className="mt-2">
                      <VisualPanel
                        key={old ? `v${old.number}` : 'live'}
                        compact
                        me={me}
                        noteId={note.id}
                        subjectId={note.subject_id}
                        subjectColor={subject?.color ?? 'blue'}
                        visuals={docVisuals}
                        recommended={body.recommended}
                        view={view}
                        highlightKeyPoint={kp}
                        note={body}
                        memory={memory}
                        onSaved={reload}
                        onOpen={() => setTab('visual')}
                        saveSpec={old ? saveOldVisual : saveLiveVisual}
                        aiLocked={aiLocked}
                        editLocked={editLocked}
                      />
                      <button type="button" className="mt-2 text-sm font-semibold text-accent" onClick={() => setTab('visual')}>
                        그림 크게 보기·고치기 →
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <NoteView
                key={old ? `v${old.number}` : 'live'}
                note={body}
                kind={source.kind}
                editable={!appendRunning && !(reorg && !old)}
                editMode={editOn}
                onEditMode={(on) => (on ? startEdit() : setEditMode(false))}
                showImportance={!!me.settings.note?.importance}
                onChange={(next) => saveBody({ ...raw, ...next })}
                highlightKeyPoint={kp}
                onSelectKeyPoint={setKp}
                reservedIds={reservedIds}
                onOpenPage={(p) => {
                  setPage(p);
                  setTab('original');
                }}
                figures={docFigures}
                pageLabels={pageLabels}
                originalFirst={!!me?.settings.visual.originalFirst}
                onFiguresChange={(next) => saveBody({ ...raw, figures: next })}
              />
              {(!old && canPractice) || reportable ? (
                <div className="flex flex-wrap gap-2">
                  {!old && canPractice ? (
                    <LinkButton href={practiceHref(sourceId)} onClick={() => openPractice()}>
                      이 노트 문제 풀기
                    </LinkButton>
                  ) : null}
                  {reportable ? (
                    <Button variant="ghost" onClick={() => setReporting(true)}>
                      이상해요
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'visual' ? (
            <VisualPanel
              key={old ? `v${old.number}` : 'live'}
              me={me}
              noteId={note.id}
              subjectId={note.subject_id}
              subjectColor={subject?.color ?? 'blue'}
              visuals={docVisuals}
              recommended={body.recommended}
              view={view}
              highlightKeyPoint={kp}
              note={body}
              memory={memory}
              onShowInNote={showInNote}
              onSaved={reload}
              onViewChange={(v) => saveBody({ ...raw, view: v })}
              onReport={() => setReporting(true)}
              saveSpec={old ? saveOldVisual : saveLiveVisual}
              aiLocked={aiLocked}
              editLocked={editLocked}
            />
          ) : null}
          {tab === 'visual' && pdfsOn ? <NotePdfs noteId={note.id} noteTitle={title} canCreate={!old && !appendRunning && !reorg} /> : null}

          {tab === 'questions' ? (
            <QuestionsPanel
              me={me}
              noteId={note.id}
              subjectId={note.subject_id}
              questions={docQuestions}
              cards={cards}
              keyPoints={keyPoints}
              practice={canPractice ? { href: practiceHref(sourceId), onOpen: openPractice } : undefined}
              onChanged={reload}
              removal={removal}
              oldVersion={
                old
                  ? {
                      number: old.number,
                      addQuestion: (id) => setOldQuestionIds([...old.questionIds, id]),
                      // 개념 번호를 버전마다 기억하는 DB 에서만 (아니면 예전처럼 문제 행을 고친다)
                      setConcept: mergeOn ? setOldConcept : undefined,
                    }
                  : undefined
              }
              figures={docFigures}
            />
          ) : null}

          {tab === 'course' && coursesOn ? (
            <CoursePanel
              me={me}
              noteId={note.id}
              noteTitle={title}
              noteChars={noteChars}
              keyPoints={keyPoints.length}
              canCreate={!old && !appendRunning && !reorg}
            />
          ) : null}

          {tab === 'original' ? (
            versionsOn ? (
              <OriginalTab
                me={me}
                parent={source}
                kids={kids.filter((k) => k.status === 'ready')}
                versions={versions}
                current={cur}
                viewing={old ? old.number : cur}
                existing={existing}
                liveQuestionCount={liveQuestions.length}
                appendBusy={kidsActive}
                focusPage={page}
                pageLabels={pageLabels}
                busy={verBusy}
                onOpen={openVersion}
                onUse={switchTo}
                onDelete={deleteVersion}
                onAdd={(files, text) => quick.addToNote(files, text, false)}
              />
            ) : (
              <OriginalPanel
                kind={source.kind}
                text={source.text_content}
                paths={source.file_paths}
                expireAt={source.files_expire_at}
                focusPage={page}
                pageLabels={pageLabels}
              />
            )
          ) : null}
        </>
      )}

      {chatOn && !showOld ? (
        <NoteChat
          noteId={note.id}
          noteTitle={title}
          noteChars={noteChars}
          keyPointTitle={(id) => keyPoints.find((k) => k.id === id)?.title ?? null}
          onApplied={reload}
        />
      ) : null}

      {/* 노트 정보: 이름·과목·단원을 한 화면에서 (과목을 바꾸면 노트·문제·복습 기록이 함께 옮겨진다) */}
      {infoSubjects ? (
        <NoteInfoSheet
          open
          onClose={() => setInfoSubjects(null)}
          value={{ title: note.title || source.title || '', subjectId: note.subject_id, unit: source.unit ?? '' }}
          subjects={infoSubjects}
          canMove={mergeOn}
          suggestUnit={body.unit}
          onSave={saveInfo}
        />
      ) : null}

      {/* 단원 바꾸기 (고치기 모드에서 단원 칩을 누르면): AI 가 읽은 단원은 'AI 추천'으로만 */}
      <UnitSheet
        open={unitOpen}
        onClose={() => setUnitOpen(false)}
        subjectId={note.subject_id}
        value={source.unit ?? ''}
        suggest={body.unit}
        onPick={changeUnit}
      />

      {note ? (
        <RelocateFiguresSheet
          open={relocating}
          onClose={() => setRelocating(false)}
          noteId={note.id}
          figures={relocatable.map((f) => ({ id: f.id, title: f.title }))}
          onDone={reload}
        />
      ) : null}

      <ReportSheet what={reporting ? { kind: 'note', target: note.id } : null} onClose={() => setReporting(false)} />
    </div>
  );
}

/** 고치기 모드의 노트 이름 칸: 큰 제목 자리에서 그대로 고친다 (엔터·칸을 떠나면 저장, Esc 는 되돌리기) */
function TitleField({ value, onCommit, autoFocus, onFocused }: { value: string; onCommit: (t: string) => void; autoFocus: boolean; onFocused: () => void }) {
  const [v, setV] = useState(value);
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setV(value);
  }
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [v]);
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (el) {
      el.focus({ preventScroll: true });
      el.select();
    }
    onFocused();
  }, [autoFocus, onFocused]);
  const commit = () => {
    const t = v.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) setV(value);
    else if (t !== value) onCommit(t);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={v}
      maxLength={120}
      aria-label="노트 이름"
      placeholder="노트 이름"
      className="kok-title-input"
      onChange={(e) => setV(e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setV(value);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
    />
  );
}

/** 고치는 동안 위 띠의 저장 상태 */
function SaveBadge({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return null;
  return (
    <span
      className={cx('mr-1.5 inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold', state === 'error' ? 'text-bad' : 'text-muted')}
      role="status"
      aria-live="polite"
    >
      {state === 'saving' ? <Spinner className="h-3.5 w-3.5" /> : state === 'saved' ? <Icon d={ICONS.check} size={14} strokeWidth={2.6} /> : null}
      {state === 'saving' ? '저장 중' : state === 'saved' ? '저장됨' : '저장 못 함'}
    </span>
  );
}

const FIGURE_SKIP: Record<string, string> = {
  text: '글 자료라 그림을 찾지 않았어요',
  setting_off: "설정 '자료 그림'이 꺼져 있어요",
  db_outdated: 'DB 에 그림 칸이 없어요 (schema.sql 다시 실행)',
  last_try: '마지막 시도라 그림을 찾지 않았어요',
  full: '그림이 이미 가득 찼어요',
};

/** 관리자만: 이 노트를 만들 때 자료 그림이 어디까지 됐는지 (그림 문제가 없을 때 까닭을 찾게) */
function FigureLogLine({ body }: { body: unknown }) {
  const log = body && typeof body === 'object' ? (body as { figure_log?: Record<string, unknown> }).figure_log : undefined;
  if (!log || typeof log !== 'object') return null;
  const n = (k: string) => Number(log[k] ?? 0);
  const skipped = typeof log.skipped === 'string' ? (FIGURE_SKIP[log.skipped] ?? log.skipped) : '';
  const errors = Array.isArray(log.errors) ? log.errors.map(String) : [];
  return (
    <p className="rounded-2xl bg-surface-2 px-4 py-2.5 text-xs text-muted">
      관리자 · 자료 그림: 찾은 조각 {n('looked')} · AI가 찾은 그림 {n('found')} · 자른 그림 {n('cut')}
      {n('missed') ? ` · 쪽에서 못 찾은 그림 ${n('missed')}` : ''} · 그림 문제 {n('questions')}
      {skipped ? ` · ${skipped}` : ''}
      {errors.length ? <span className="mt-0.5 block break-all">오류: {errors.join(' / ')}</span> : null}
    </p>
  );
}
