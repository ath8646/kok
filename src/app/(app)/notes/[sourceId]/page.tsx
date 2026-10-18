'use client';
// 노트: 탭 정리 · 그림 · 문제 · 원본 (처리 중이면 진행 상태). 오른쪽 아래 주황 버튼은 노트 채팅이다.
// 노트에 자료를 더하면(Pro) 버전이 쌓인다. 원본 탭의 버전 기록에서 지난 버전을 열어(?v=번호) 보고 고치거나,
// 그 버전을 지금 버전으로 쓰거나 지울 수 있다. 지난 버전에서 고친 것은 그 버전에 저장된다.
// DB 에 버전·채팅 표가 아직 없으면(me.features) 예전처럼 동작한다.
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { SOURCES_CHANGED, useQuickAdd } from '@/components/QuickAdd';
import { NoteView, type NoteBody } from '@/components/NoteView';
import { ProcessingView } from '@/components/note/ProcessingView';
import { OriginalPanel } from '@/components/note/OriginalPanel';
import { OriginalTab } from '@/components/note/OriginalTab';
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
  ICONS,
  LargeHeader,
  LinkButton,
  Menu,
  STICKY_BELOW_TOPBAR,
  Sheet,
  Spinner,
  api,
  cx,
  inputClass,
  useToast,
} from '@/components/ui';
import { SOURCE_COLS, sb, type SourceRowWithUnit } from '@/lib/data';
import { zMindmap, zNote, zTable, zTimeline, type Mindmap, type TableSpec, type TimelineSpec } from '@/lib/ai/schemas';
import type { QuestionRow, SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { VERSION_LIST_COLS, removalPlan, toVersionRow, type ChildSource, type VersionRow } from '@/lib/versions';
import { previewText } from '@/lib/richtext';
import { starredFirst } from '@/lib/note-order';

type Tab = 'note' | 'visual' | 'questions' | 'original';
type SourceFull = SourceRowWithUnit & { text_content: string | null; parent_id?: string | null };
type NoteRow = { id: string; title: string; subject_id: string; body: Record<string, unknown>; updated_at: string; current_version?: number };
/** 지난 버전: 그 버전 행에 저장된 정리·그림·문제 목록 */
type OldDoc = { number: number; title: string; body: Record<string, unknown>; visuals: Visuals; questionIds: string[]; updatedAt: string };
/** 저장할 때 '읽은 그대로인지' 확인하는 표 (행 번호와 그때의 updated_at) */
type RowToken = { id: string; updatedAt: string };

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'note', label: '정리' },
  { id: 'visual', label: '그림' },
  { id: 'questions', label: '문제' },
  { id: 'original', label: '원본' },
];

const Q_COLS =
  'id, note_id, subject_id, key_point_id, type, prompt, choices, answer, accepted, explanation, difficulty, pages, created_by, locked, edited, status, created_at';
const CHILD_COLS = `${SOURCE_COLS}, text_content, parent_id`;
const VISUAL_TYPES: VisualType[] = ['mindmap', 'table', 'timeline'];
const STALE_LIVE = '그사이 다른 곳에서 노트가 바뀌어서 방금 고친 것은 저장하지 못했어요. 새로 불러왔어요.';
const STALE_OLD = '이 버전이 그사이 다른 곳에서 바뀌어서 저장하지 못했어요. 새로 불러왔어요.';
const APPEND_LOCK = '이 노트에 자료를 더하는 중이에요. 끝나면 고칠 수 있어요.';

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

async function fetchBundle(sourceId: string, versionsOn: boolean, restedOn: boolean): Promise<Bundle> {
  const empty: Bundle = { source: null, note: null, visuals: {}, visualRows: {}, questions: [], cards: new Map(), subject: null, versions: [] };
  const { data: s } = await sb()
    .from('sources')
    .select(`${SOURCE_COLS}, text_content${versionsOn ? ', parent_id' : ''}`)
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
      .select(restedOn ? `${Q_COLS}, rested_hidden` : Q_COLS)
      .eq('note_id', note.id)
      .order('created_at')
      .order('id'),
    sb().from('subjects').select('id, name, color, exam_date, position, created_at').eq('id', note.subject_id).maybeSingle(),
    versionsOn
      ? sb().from('note_versions').select(VERSION_LIST_COLS).eq('note_id', note.id).order('number')
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

async function fetchOldDoc(noteId: string, number: number): Promise<OldDoc | null> {
  const { data } = await sb()
    .from('note_versions')
    .select('number, title, body, visuals, question_ids, updated_at')
    .eq('note_id', noteId)
    .eq('number', number)
    .maybeSingle();
  if (!data) return null;
  return {
    number: Number(data.number),
    title: typeof data.title === 'string' ? data.title : '',
    body: (data.body ?? {}) as Record<string, unknown>,
    visuals: toVisuals(Array.isArray(data.visuals) ? (data.visuals as Array<{ type: string; spec: unknown }>) : []),
    questionIds: Array.isArray(data.question_ids) ? data.question_ids.map(String) : [],
    updatedAt: String(data.updated_at),
  };
}

function initialParam(name: string): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);
}

/** 보는 버전을 주소에 적는다 (새로 고쳐도 같은 버전이 열리게) */
function setViewParam(v: number | null) {
  const url = new URL(window.location.href);
  if (v === null) url.searchParams.delete('v');
  else url.searchParams.set('v', String(v));
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function NotePage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const { me } = useMe();
  const router = useRouter();
  const toast = useToast();
  const versionsOn = !!me?.features.versions;
  const restedOn = !!me?.features.restedHidden;
  const chatOn = !!me?.features.chat;
  const canAppend = !!me?.canAppend;
  const [bundle, setBundle] = useState<Bundle | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  // 탭 띠가 위에 붙었을 때만 바탕을 칠한다 (테마 배경이 띠 뒤에서 끊기지 않게)
  const [subbarEl, subbarRef] = useState<HTMLDivElement | null>(null);
  const subbarStuck = useStuck(subbarEl);
  const [tab, setTab] = useState<Tab>(() => {
    const t = initialParam('tab');
    return t === 'note' || t === 'visual' || t === 'questions' || t === 'original' ? t : 'note';
  });
  const [kp, setKp] = useState<string | null>(() => initialParam('kp'));
  const [page, setPage] = useState<number | null>(null);
  const [glance, setGlance] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const renameInput = useRef<HTMLInputElement>(null);
  // 이름 칸을 열면 글을 골라 둔다 (바로 새 이름을 칠 수 있게). 시트가 먼저 자기에게 초점을 두어서 조금 뒤에
  useEffect(() => {
    if (!renaming) return;
    const t = setTimeout(() => renameInput.current?.select(), 60);
    return () => clearTimeout(t);
  }, [renaming]);
  const [viewing, setViewing] = useState<number | null>(() => {
    const v = Number(initialParam('v'));
    return Number.isInteger(v) && v >= 1 ? v : null;
  });
  const [oldDoc, setOldDoc] = useState<OldDoc | null>(null);
  const [kids, setKids] = useState<ChildSource[]>([]);
  const [kidsTick, setKidsTick] = useState(0);
  const [verBusy, setVerBusy] = useState<string | null>(null);
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
    fetchBundle(sourceId, versionsOn, restedOn)
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
  }, [sourceId, tick, versionsOn, restedOn, freshSince]);

  const source = bundle === undefined ? undefined : (bundle?.source ?? null);
  const note = bundle?.note ?? null;
  const visuals = bundle?.visuals;
  const questions = bundle?.questions;
  const cards = bundle?.cards ?? new Map<string, CardInfo>();
  const subject = bundle?.subject ?? null;
  const versions = useMemo(() => bundle?.versions ?? [], [bundle]);
  const noteId = note?.id;
  const cur = note?.current_version ?? 1;
  const parentId = source?.parent_id ?? null;

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
        toast('자료를 더해 새 버전을 만들었어요.', 'ok');
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
    fetchOldDoc(noteId, viewing).then((d) => {
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
  }, [showOld, noteId, viewing, tick, toast, freshSince]);
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
    const target = initialParam('kp');
    if (noteId && target) setTimeout(() => document.getElementById(`kp-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
  }, [noteId]);

  // 지금 보는 것: 지금 버전(노트) 또는 지난 버전
  const raw = old ? old.body : note?.body;
  const body = useMemo<NoteBody | null>(() => (raw ? ({ ...zNote.parse(raw), recommended: raw.recommended as string | undefined } as NoteBody) : null), [raw]);
  const docVisuals = old ? old.visuals : (visuals ?? {});
  const liveQuestions = useMemo(() => (questions ?? []).filter((q) => q.status !== 'hidden'), [questions]);
  const docQuestions = useMemo(() => (old ? (questions ?? []).filter((q) => old.questionIds.includes(q.id)) : liveQuestions), [old, questions, liveQuestions]);
  const existing = useMemo(() => new Set((questions ?? []).map((q) => q.id)), [questions]);
  const view = (raw?.view ?? {}) as NoteViewPrefs;
  // 문제 만들기·채팅에서 쓰는 개념: 노트에 보이는 순서(별표 먼저), 이름은 꾸미기 기호 없이 글로
  const keyPoints = useMemo(() => starredFirst(body?.key_points ?? []).map((k) => ({ id: k.id, title: previewText(k.title) || k.title })), [body]);
  const noteChars = useMemo(() => (note ? JSON.stringify(note.body).length : 0), [note]);

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
    if (old) {
      const number = old.number;
      setOldDoc((d) => (d && d.number === number ? { ...d, body: next } : d));
      const r = await queued(() => saveOld(number, { body: next }));
      if (r === false) toast('저장하지 못했어요.', 'bad');
      return;
    }
    setBundle((b) => (b && b.note ? { ...b, note: { ...b.note, body: next } } : b));
    // 읽은 노트 그대로일 때만 저장한다 (예전 화면이 합친 새 버전이나 다른 탭에서 고친 것을 덮어쓰지 않게)
    await queued(async () => {
      let q = sb().from('notes').update({ body: next }).eq('id', note.id);
      if (noteToken.current) q = q.eq('updated_at', noteToken.current);
      const { data, error } = await q.select('updated_at');
      if (error) return toast('저장하지 못했어요.', 'bad');
      const row = data?.[0];
      if (!row) return staleReload(STALE_LIVE);
      noteToken.current = String(row.updated_at);
    });
  };

  /** 노트 이름 바꾸기 (지금 버전): 노트와 자료 이름을 같이 바꾼다 (자료함·홈은 자료 이름을 보여 준다) */
  const rename = async () => {
    const t = newTitle.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!note || !t || renameBusy) return;
    setRenameBusy(true);
    try {
      const r = await queued(async (): Promise<boolean | 'stale'> => {
        let q = sb().from('notes').update({ title: t }).eq('id', note.id);
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
        return;
      }
      if (!r) {
        toast('이름을 바꾸지 못했어요.', 'bad');
        return;
      }
      await sb().from('sources').update({ title: t }).eq('id', sourceId);
      setBundle((b) => (b && b.note ? { ...b, note: { ...b.note, title: t }, source: b.source ? { ...b.source, title: t } : b.source } : b));
      window.dispatchEvent(new Event(SOURCES_CHANGED));
      setRenaming(false);
      toast('이름을 바꿨어요.', 'ok');
    } finally {
      setRenameBusy(false);
    }
  };

  /** 지금 버전의 그림 저장: 읽은 그림 행 그대로일 때만 (새 버전이면 행이 새로 생겨 0행) */
  const saveLiveVisual = async (t: VisualType, spec: Mindmap | TableSpec | TimelineSpec): Promise<boolean | 'stale'> => {
    // 자료를 더하는 동안에는 지금 버전의 그림을 고치지 않는다 (알리고 새로 읽어 고친 것을 되돌린다)
    if (appendRunning) {
      staleReload(APPEND_LOCK);
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
              confirm: '이 문제를 지금 버전에서 뺄까요? 다른 버전에는 그대로 남아요.',
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
              confirm: '이 문제를 이 버전에서 뺄까요? 다른 버전에는 그대로 남아요.',
              run: () => setOldQuestionIds((old?.questionIds ?? []).filter((x) => x !== q.id)),
            };
          }
          return {
            label: '지우기',
            confirm: '이 문제를 지울까요? 푼 기록도 같이 지워져요.',
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
    if (!confirm(`버전 ${n}: 이 버전을 지금 버전으로 쓸까요?\n복습에는 이 버전의 문제가 나와요. 지금 쓰던 버전도 기록에 그대로 남아요.`)) return;
    setVerBusy(`use-${n}`);
    try {
      await api(`/api/notes/${note.id}/versions`, { method: 'POST', body: JSON.stringify({ action: 'switch', number: n }) });
      setViewing(null);
      setViewParam(null);
      toast(`지금 버전을 바꿨어요 (버전 ${n}).`, 'ok');
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setVerBusy(null);
    }
  };

  const deleteVersion = async (n: number) => {
    if (!note) return;
    const warnCurrent = n === cur ? '\n지금 쓰는 버전이라, 지우면 남은 버전 중 가장 최근 버전을 쓰게 돼요.' : '';
    if (!confirm(`버전 ${n}: 이 버전을 지울까요?\n이 버전에만 있던 문제(푼 기록 포함)와 더한 자료도 함께 지워지고, 되돌릴 수 없어요.${warnCurrent}`)) return;
    setVerBusy(`del-${n}`);
    try {
      await api(`/api/notes/${note.id}/versions`, { method: 'POST', body: JSON.stringify({ action: 'delete', number: n }) });
      if (viewing === n) {
        setViewing(null);
        setViewParam(null);
      }
      toast('버전을 지웠어요.', 'ok');
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setVerBusy(null);
    }
  };

  if (!me) return null;
  const back = { href: subject ? `/library/${subject.id}` : source?.subject_id ? `/library/${source.subject_id}` : '/library', label: '자료함으로' };
  if (source === undefined || parentId)
    return (
      <div className="grid gap-3">
        <LargeHeader size="compact" back={back} title=" " />
        <div className="kok-card kok-shimmer h-48" />
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
  // 직접 만든 노트는 AI 가 만든 것이 없으면 신고할 것도 없다 (자료를 더해 AI 가 합쳤으면 신고할 수 있다)
  const reportable = !manual || versions.length > 0;
  const title = old?.title || note?.title || source.title || (ready ? '새 자료' : '정리하는 중…');
  const meta = (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      {subject ? (
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: subjectVar(subject.color) }} aria-hidden="true" />
          {subject.name}
        </span>
      ) : null}
      {source.unit ? <Chip>{source.unit}</Chip> : null}
      <span>
        ·{' '}
        {manual
          ? '직접 만든 노트'
          : source.kind === 'pdf'
            ? `PDF ${source.page_count ?? ''}쪽`
            : source.kind === 'image'
              ? `사진 ${source.page_count ?? ''}장`
              : '직접 쓴 글'}
      </span>
      {versions.length ? <span>· 버전 {old ? old.number : cur}</span> : null}
      {manual ? null : <span>· AI 정리</span>}
    </span>
  );

  if (!ready) {
    return (
      <div className="grid gap-3">
        <LargeHeader size="compact" back={back} title={title} subtitle={meta} />
        <ProcessingView source={source} onReload={reload} />
      </div>
    );
  }

  const loadingOld = showOld && !old;
  // 자료를 더하는 동안에는 지금 노트의 정리·그림을 고치지 않는다 (합치는 바탕이 바뀌면 처음부터 다시 합쳐야 해서)
  const appendRunning = versionsOn && kidsActive && !old;
  const aiLocked = old ? '지난 버전에서는 AI로 다시 만들 수 없어요. 이 버전을 쓰면 할 수 있어요.' : appendRunning ? APPEND_LOCK : undefined;
  const editLocked = appendRunning ? APPEND_LOCK : undefined;

  return (
    <div className="grid gap-4">
      <LargeHeader
        size="compact"
        flush
        back={back}
        title={title}
        subtitle={meta}
        actions={
          <Menu
            label="노트 메뉴"
            items={[
              ...(liveQuestions.length ? [{ label: '이 노트 문제 풀기', icon: ICONS.retry, onSelect: () => router.push(`/review?note=${note.id}`) }] : []),
              ...(old
                ? []
                : [
                    {
                      label: '이름 바꾸기',
                      icon: ICONS.pen,
                      onSelect: () => {
                        setNewTitle(note.title || source.title || '');
                        setRenaming(true);
                      },
                    },
                  ]),
              ...(versionsOn ? [{ label: versions.length ? '버전 기록' : '자료 더하기', icon: ICONS.file, onSelect: () => setTab('original') }] : []),
              ...(reportable ? [{ label: '이상해요 (신고)', icon: ICONS.edit, onSelect: () => setReporting(true) }] : []),
            ]}
          />
        }
      />
      <div ref={subbarRef} className={cx(STICKY_BELOW_TOPBAR, 'kok-subbar z-20 -mx-4 -mt-4 px-4 pb-2.5 pt-1 md:-mx-6 md:px-6', subbarStuck && 'is-stuck')}>
        <div className="grid grid-cols-4 gap-1 rounded-full bg-surface-2 p-1" role="tablist" aria-label="노트 보기">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'press rounded-full py-2 text-sm font-bold',
                tab === t.id ? 'bg-raised text-ink shadow-[0_1px_3px_var(--shadow-strong)]' : 'text-muted hover:text-ink',
              )}
            >
              {t.label}
              {t.id === 'questions' ? <span className="ml-1 tabular-nums opacity-60">{docQuestions.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {versionsOn ? <AppendStatus kids={kids} onChanged={() => setKidsTick((x) => x + 1)} /> : null}

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
                editable={!appendRunning}
                onChange={(next) => saveBody({ ...raw, ...next })}
                highlightKeyPoint={kp}
                onSelectKeyPoint={setKp}
                onOpenPage={(p) => {
                  setPage(p);
                  setTab('original');
                }}
              />
              {(!old && liveQuestions.length) || reportable ? (
                <div className="flex flex-wrap gap-2">
                  {!old && liveQuestions.length ? <LinkButton href={`/review?note=${note.id}`}>이 노트 문제 풀기</LinkButton> : null}
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
              onSaved={reload}
              onViewChange={(v) => saveBody({ ...raw, view: v })}
              onReport={() => setReporting(true)}
              saveSpec={old ? saveOldVisual : saveLiveVisual}
              aiLocked={aiLocked}
              editLocked={editLocked}
            />
          ) : null}

          {tab === 'questions' ? (
            <QuestionsPanel
              me={me}
              noteId={note.id}
              subjectId={note.subject_id}
              questions={docQuestions}
              cards={cards}
              keyPoints={keyPoints}
              onChanged={reload}
              removal={removal}
              oldVersion={old ? { number: old.number, addQuestion: (id) => setOldQuestionIds([...old.questionIds, id]) } : undefined}
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
                busy={verBusy}
                onOpen={openVersion}
                onUse={switchTo}
                onDelete={deleteVersion}
                onAdd={(files, text) => quick.addToNote(files, text, false)}
              />
            ) : (
              <OriginalPanel kind={source.kind} text={source.text_content} paths={source.file_paths} expireAt={source.files_expire_at} focusPage={page} />
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

      <Sheet open={renaming} onClose={() => setRenaming(false)} title="노트 이름">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <input
            ref={renameInput}
            aria-label="노트 이름"
            className={inputClass}
            value={newTitle}
            maxLength={120}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="예: 3단원 광합성"
          />
          <Button type="submit" className="justify-self-start" disabled={!newTitle.trim()} busy={renameBusy}>
            저장
          </Button>
        </form>
      </Sheet>

      <Sheet open={reporting} onClose={() => setReporting(false)} title="이상해요">
        <div className="grid gap-3">
          <p className="text-sm text-muted">정리나 그림에서 틀린 곳, 이상한 곳을 알려 주세요. 관리자가 확인해요. 직접 고칠 수도 있어요.</p>
          <textarea
            className={cx(inputClass, 'min-h-24')}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 2번 개념 설명이 교과서와 달라요"
          />
          <Button
            disabled={!reason.trim()}
            onClick={async () => {
              const { error } = await sb().from('reports').insert({ target_type: 'note', target_id: note.id, reason: reason.trim() });
              if (error) toast('보내지 못했어요.', 'bad');
              else {
                toast('신고했어요. 고마워요!', 'ok');
                setReason('');
                setReporting(false);
              }
            }}
          >
            보내기
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
