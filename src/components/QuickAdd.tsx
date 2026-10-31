'use client';
// 빠른 추가: 어디서나 오른쪽 아래 + 버튼 → 입력창(엔터 = AI가 바로 정리),
// 파일을 화면에 끌어다 놓거나 붙여 넣으면 검사하고 바로 정리, 올리는 중인 것은 오른쪽 아래 띠에 보여 준다.
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse, SubjectRow } from '@/lib/types';
import { fetchSources, fetchSubjects, sb } from '@/lib/data';
import { coverWanted, estimateCover, estimateEnergy, estimateFigures, estimateRedraws, estimateSmallTask, figuresWanted, redrawsWanted } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { energyWindow, refillText } from '@/lib/plans';
import { pictureToJpeg, shrinkImage } from '@/lib/image';
import {
  FILE_ACCEPT,
  MAX_TEXT_PARTS,
  MIN_TEXT_CHARS,
  checkText,
  fileKind,
  groupFiles,
  isSubmitKey,
  splitComposer,
  splitForLimit,
  titleFromName,
} from '@/lib/quick-add';
import { officeLabel, officeTextHeader } from '@/lib/office/names';
import { stripPictureMarks } from '@/lib/doc-pictures';
import { SUBJECT_COLORS } from '@/lib/settings';
import { subjectVar } from '@/lib/colors';
import { matchesSubject, pickerOrder } from '@/lib/subject-order';
import { UnitOptions, useSubjectUnits } from './UnitPick';
import { SOURCES_CHANGED, SUBJECTS_CHANGED } from '@/lib/events';
import { topFileSink } from '@/lib/file-sink';
import { ApiError, Button, EnergyEstimate, ICONS, Icon, Sheet, Spinner, api, cx, inputClass, useToast } from './ui';

/** 동시에 정리할 수 있는 자료 수 (서버와 같다) */
const MAX_PARALLEL = 3;
/** 이보다 큰 PDF 는 브라우저에서 쪽수를 세지 않는다 (폰 메모리를 아끼고, 쪽수는 서버가 센다) */
const BIG_PDF_BYTES = 30 * 1024 * 1024;
const MB = 1024 * 1024;
/** 자료 목록·과목이 바뀌었다고 화면들에 알리는 이벤트 */
export { SOURCES_CHANGED, SUBJECTS_CHANGED };

type Job =
  /** pictures: 한글·워드·PPT 의 뒤 조각에 든 그림 (JPEG, 글의 [[picture N]] 차례) */
  | { kind: 'text'; text: string; title: string; pictures?: Blob[] }
  | { kind: 'textfile'; file: File; title: string }
  /** 한글·워드·PPT: 브라우저에서 글과 그림을 꺼내 글 자료(+ 그림 파일)로 (길면 여러 자료로 나눈다) */
  | { kind: 'office'; file: File; title: string }
  | { kind: 'pdf'; file: File; title: string }
  | { kind: 'image'; files: File[]; title: string };

type Status = 'waiting' | 'preparing' | 'slot' | 'appendWait' | 'busy' | 'uploading' | 'starting' | 'done' | 'error';

/** 노트 화면: 끌어다 놓기·붙여 넣기를 이 노트에 더한다 (Pro) */
export type NoteTarget = {
  /** 노트의 자료 번호 (더한 자료의 부모) */
  sourceId: string;
  subjectId: string;
  title: string;
  /** 노트에 자료 더하기를 쓸 수 있는지 (Pro) */
  canAppend: boolean;
  /** 이 화면은 + 버튼 대신 다른 버튼(노트 채팅)을 쓴다 */
  hideFab: boolean;
  /** DB 에 버전 표가 있는지. 없으면 끌어다 놓기·붙여 넣기는 예전처럼 새 노트로 정리한다 */
  versions: boolean;
};

type Item = {
  key: string;
  sourceId: string;
  job: Job;
  subjectId: string;
  /** 노트에 더하는 자료면 그 노트의 자료 번호와 제목 */
  parentId?: string;
  noteTitle?: string;
  status: Status;
  done: number;
  total: number;
  error?: string;
  /** 이 자료 번호로 다 올린 파일 (있으면 '다시 하기'는 올리기를 건너뛰고 같은 번호로 만들기만 다시 한다) */
  files?: string[];
  /** 올리는 파일 크기 합 (큰 파일은 띠에 MB 로 보여 준다) */
  bytes?: number;
  /** false 면 이 노트의 문제를 복습에 넣지 않는다 (자료 넣기 창에서 끈 것) */
  review?: boolean;
  /** 자료 넣기 창에서 고른 단원 (없으면 단원 없이: AI 가 정하지 않는다) */
  unit?: string;
};

/** 올리기 전에 한 번 준비한 것 (다시 하기에서 사진을 또 줄이지 않게). 글 자료의 blobs 는 문서 속 그림 */
type Prepared = { kind: 'text' | 'pdf' | 'image'; text: string; pages: number; blobs: Blob[] };

/** 입력창에 붙인 파일 (같은 이름의 사진이 여러 장이어도 구별되게 번호를 붙인다) */
type Attachment = { id: string; file: File };
const toAttachments = (files: File[]): Attachment[] => files.map((file) => ({ id: newId(), file }));

type Ctx = {
  /** 입력창 열기 (과목을 정해서 열 수도 있다) */
  openComposer: (subjectId?: string) => void;
  /** 파일을 바로 정리하기 */
  addFiles: (files: File[]) => void;
  /** 지금 보고 있는 과목 (자료함에서 과목을 고르면 그 과목에 넣는다) */
  setContextSubject: (id: string | null) => void;
  /** 노트 화면: 끌어다 놓기·붙여 넣기를 이 노트에 더한다 (null 이면 보통 화면) */
  setNoteTarget: (t: NoteTarget | null) => void;
  /** 지금 노트에 파일·글을 더한다 (ask 면 먼저 한 번 묻는다) */
  addToNote: (files: File[], text?: string, ask?: boolean) => void;
  /** + 버튼을 잠깐 숨긴다 (자료함에서 여러 개 고르는 동안: 아래 띠가 그 자리를 쓴다) */
  setFabHidden: (hidden: boolean) => void;
  enabled: boolean;
};

const QuickAddCtx = createContext<Ctx>({
  openComposer: () => {},
  addFiles: () => {},
  setContextSubject: () => {},
  setNoteTarget: () => {},
  addToNote: () => {},
  setFabHidden: () => {},
  enabled: false,
});

export function useQuickAdd() {
  return useContext(QuickAddCtx);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function newId() {
  return crypto.randomUUID();
}

function lastKey(userId: string) {
  return `kok:last-subject:${userId}`;
}
function readLast(userId: string): string | null {
  try {
    return window.localStorage.getItem(lastKey(userId));
  } catch {
    return null;
  }
}
function writeLast(userId: string, id: string) {
  try {
    window.localStorage.setItem(lastKey(userId), id);
  } catch {
    /* 저장이 막힌 브라우저 */
  }
}

async function countPdfPages(file: File): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new Error('PDF를 열 수 없어요. 다른 프로그램에서 PDF로 다시 저장해 넣어 주세요.');
  }
  if (doc.isEncrypted) throw new Error('암호가 걸린 PDF는 읽을 수 없어요. 암호를 풀고 다시 넣어 주세요.');
  return doc.getPageCount();
}

function jobLabel(job: Job): string {
  if (job.title) return job.title;
  if (job.kind === 'text') return job.text.replace(/\s+/g, ' ').slice(0, 28) + (job.text.length > 28 ? '…' : '');
  if (job.kind === 'image') return `사진 ${job.files.length}장`;
  return job.file.name;
}

function jobIcon(job: Job): string {
  // 그림을 들고 가는 글 조각은 한글·워드·PPT 문서의 뒤 조각
  if (job.kind === 'text' && job.pictures?.length) return ICONS.file;
  return job.kind === 'pdf' || job.kind === 'office' ? ICONS.file : job.kind === 'image' ? ICONS.image : ICONS.pen;
}

function statusText(it: Item): string {
  switch (it.status) {
    case 'waiting':
      return '차례를 기다려요';
    case 'preparing':
      return it.job.kind === 'image'
        ? `사진 줄이는 중 ${it.done}/${it.total}`
        : it.job.kind === 'pdf'
          ? 'PDF 확인하는 중'
          : it.job.kind === 'office'
            ? `${officeLabel(it.job.file.name)} 문서 읽는 중${it.total > 1 ? ` · 그림 ${it.done}/${it.total}` : ''}`
            : '준비하는 중';
    case 'slot':
      return '정리 중인 자료가 끝나면 시작해요';
    case 'appendWait':
      return '이 노트에 먼저 더하는 자료가 끝나면 시작해요';
    case 'busy':
      return '요청이 많아서 잠깐 기다려요';
    case 'uploading':
      if (it.total > 1) return `올리는 중 ${it.done}/${it.total}`;
      return it.bytes && it.bytes >= 5 * MB ? `올리는 중 (${Math.round(it.bytes / MB)}MB, 큰 파일은 조금 걸려요)` : '올리는 중';
    case 'starting':
      return it.parentId ? '노트에 더하기 시작하는 중' : '정리 시작하는 중';
    case 'done':
      return it.parentId ? '노트에 더하는 중이에요. 원본 탭에서 볼 수 있어요' : '정리를 시작했어요';
    case 'error':
      return it.error ?? '넣지 못했어요';
  }
}

export function QuickAddProvider({
  me,
  refreshMe,
  enabled,
  children,
}: {
  me: MeResponse;
  refreshMe: () => Promise<void>;
  enabled: boolean;
  children: ReactNode;
}) {
  const toast = useToast();
  const router = useRouter();
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  // ---------------------------------------------------------- 과목
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const subjectsRef = useRef<SubjectRow[]>([]);
  const contextSubject = useRef<string | null>(null);
  const noteTargetRef = useRef<NoteTarget | null>(null);
  const [noteTarget, setNoteTargetState] = useState<NoteTarget | null>(null);
  const [fabHidden, setFabHidden] = useState(false);
  const [pendingAppend, setPendingAppend] = useState<{ files: File[]; text: string } | null>(null);
  const loadSubjects = useCallback(async () => {
    try {
      const list = await fetchSubjects();
      subjectsRef.current = list;
      setSubjects(list);
      return list;
    } catch {
      return subjectsRef.current;
    }
  }, []);
  /**
   * 보관한 과목에 자료를 넣으면 DB(kok_touch_subject)가 보관을 푼다: 여기 목록도 바로 고치고 다른 화면(자료함 등)에도 알린다
   * (그대로 두면 방금 넣은 과목이 고르는 목록·처음 과목에서 빠진다)
   */
  const touchSubject = useCallback((id: string) => {
    if (!subjectsRef.current.find((s) => s.id === id)?.archived) return;
    const list = subjectsRef.current.map((s) => (s.id === id ? { ...s, archived: false } : s));
    subjectsRef.current = list;
    setSubjects(list);
    window.dispatchEvent(new Event(SUBJECTS_CHANGED));
  }, []);
  useEffect(() => {
    let alive = true;
    fetchSubjects()
      .then((list) => {
        if (!alive) return;
        subjectsRef.current = list;
        setSubjects(list);
      })
      .catch(() => {});
    const onChanged = () => {
      loadSubjects();
    };
    window.addEventListener(SUBJECTS_CHANGED, onChanged);
    return () => {
      alive = false;
      window.removeEventListener(SUBJECTS_CHANGED, onChanged);
    };
  }, [loadSubjects]);

  const resolveSubject = useCallback((): string => {
    const list = subjectsRef.current;
    const has = (id: string | null | undefined) => !!id && list.some((s) => s.id === id);
    // 보고 있는 과목(자료함·노트)은 보관한 과목이어도 그대로 (넣으면 보관이 풀린다)
    if (has(contextSubject.current)) return contextSubject.current!;
    // 지난번 과목·첫 과목은 보관하지 않은 것 중에서 (고정 → 최근 쓴 차례)
    const last = readLast(meRef.current.userId);
    if (has(last) && !list.find((s) => s.id === last)?.archived) return last!;
    return pickerOrder(list)[0]?.id ?? list[0]?.id ?? '';
  }, []);

  // ---------------------------------------------------------- 올리기 줄
  const itemsRef = useRef<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const commit = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const update = useCallback((key: string, patch: Partial<Item>) => commit(itemsRef.current.map((i) => (i.key === key ? { ...i, ...patch } : i))), [commit]);
  const remove = useCallback((key: string) => commit(itemsRef.current.filter((i) => i.key !== key)), [commit]);

  /**
   * 동시에 정리하는 자료가 3개면 하나가 끝날 때까지 기다린다 (올리기 전에 기다려야 파일이 오래 남지 않는다).
   * Supabase 에서 직접 세어 보므로 AI 요청 한도를 쓰지 않는다. 서버가 막 '꽉 찼다'고 했으면(after) 한 번은 쉬고 센다.
   */
  const waitForSlot = useCallback(
    async (key: string, after = false) => {
      if (meRef.current.isAdmin) return;
      for (let i = 0; i < 720; i++) {
        if (after || i > 0) await sleep(5000);
        let busy: number | null = null;
        try {
          const rows = await fetchSources({ active: true, limit: 20, withChildren: true });
          busy = rows.filter((r) => r.status === 'queued' || r.status === 'processing').length;
        } catch {
          busy = null; // 셀 수 없으면 조금 뒤에 다시 센다
        }
        if (busy !== null && busy < MAX_PARALLEL) return;
        update(key, { status: 'slot' });
      }
      throw new Error('정리 중인 자료가 오래 끝나지 않아요. 잠시 뒤에 다시 해 주세요.');
    },
    [update],
  );

  /** 한 노트에는 자료를 하나씩 더한다: 앞서 더하는 자료가 끝날 때까지 기다린다 (Supabase 에서 직접 센다) */
  const waitForAppend = useCallback(
    async (key: string, parentId: string, after = false) => {
      for (let i = 0; i < 720; i++) {
        if (after || i > 0) await sleep(5000);
        let busy: number | null = null;
        try {
          const { data, error } = await sb().from('sources').select('id').eq('parent_id', parentId).in('status', ['queued', 'processing']).limit(1);
          busy = error ? null : (data ?? []).length;
        } catch {
          busy = null;
        }
        if (busy === 0) return;
        update(key, { status: 'appendWait' });
      }
      throw new Error('노트에 더하는 자료가 오래 끝나지 않아요. 잠시 뒤에 다시 해 주세요.');
    },
    [update],
  );

  const prepared = useRef(new Map<string, Prepared>());

  const prepare = useCallback(
    async (key: string, job: Job): Promise<Prepared> => {
      const m = meRef.current;
      update(key, { status: 'preparing', done: 0, total: job.kind === 'image' ? job.files.length : 1 });
      if (job.kind === 'text') return { kind: 'text', text: job.text, pages: 0, blobs: job.pictures ?? [] };
      if (job.kind === 'textfile') {
        const c = checkText(await job.file.text(), m.plan);
        if (!c.ok) throw new Error(`'${job.file.name}': ${c.reason}`);
        return { kind: 'text', text: c.text, pages: 0, blobs: [] };
      }
      if (job.kind === 'office') {
        // 문서 읽기 코드는 이때만 불러온다
        const { extractOffice } = await import('@/lib/office');
        const { picturesForParts } = await import('@/lib/office/pictures');
        let doc: Awaited<ReturnType<typeof extractOffice>>;
        try {
          doc = await extractOffice(job.file);
        } catch (e) {
          throw new Error(`'${job.file.name}': ${(e as Error).message || '문서를 읽지 못했어요.'}`);
        }
        // 한 자료의 글 한도보다 길면 여러 자료로 나눈다 (뒤 조각은 같은 과목·단원·복습 설정의 새 글 자료).
        // 조각마다 첫 줄에 어느 파일인지 적는다 (원본 탭에 보이고, 정리는 학생이 직접 쓴 글이 아닌 자료로 다룬다)
        const header = officeTextHeader(job.file.name);
        const parts = splitForLimit(doc.text.replace(/\r\n/g, '\n').trim(), m.plan.textChars - header.length);
        if (parts.length > MAX_TEXT_PARTS)
          throw new Error(
            `'${job.file.name}': 글이 ${doc.text.length.toLocaleString()}자라 한 번에 넣기엔 너무 길어요. 문서를 ${MAX_TEXT_PARTS}개 이하로 나눠서 넣어 주세요.`,
          );
        // 조각마다 그림: 큰 그림부터 자료 하나의 그림 한도(사진 한도와 같다)까지 JPEG 로 바꾼다 (못 바꾼 그림은 건너뛴다)
        const max = Math.max(0, m.plan.images);
        const { parts: done, left } = await picturesForParts(
          parts,
          doc.pictures,
          max,
          (p) => pictureToJpeg(p),
          (n, total) => update(key, { done: n, total }),
        );
        const ready = done.map((d) => ({ text: header + d.text, blobs: d.files }));
        if (left) toast(`'${job.file.name}'은 그림이 많아서 큰 그림부터 자료 하나에 ${max}장까지 넣어요.`);
        if (ready.length > 1) {
          const it = itemsRef.current.find((i) => i.key === key);
          const base = job.title || titleFromName(job.file.name) || '문서';
          const name = (i: number) => `${base} (${i + 1}/${ready.length})`.slice(0, 120);
          if (it) {
            update(key, { job: { ...job, title: name(0) } });
            const rest: Item[] = ready.slice(1).map((r, i) => ({
              key: newId(),
              sourceId: newId(),
              job: { kind: 'text', text: r.text, title: name(i + 1), ...(r.blobs.length ? { pictures: r.blobs } : {}) },
              subjectId: it.subjectId,
              status: 'waiting',
              done: 0,
              total: 0,
              ...(it.parentId ? { parentId: it.parentId, noteTitle: it.noteTitle } : {}),
              ...(it.review === false ? { review: false } : {}),
              ...(it.unit ? { unit: it.unit } : {}),
            }));
            // 이 자료 바로 뒤에 차례대로
            const at = itemsRef.current.findIndex((i) => i.key === key);
            commit([...itemsRef.current.slice(0, at + 1), ...rest, ...itemsRef.current.slice(at + 1)]);
            toast(`'${job.file.name}'은 글이 길어서 ${ready.length}개 자료로 나눠 넣어요.`);
          }
        }
        // 그림만 있는 문서인데 이 기기가 그림을 하나도 읽지 못했다
        if (!ready[0].blobs.length && ready[0].text.slice(header.length).trim().length < MIN_TEXT_CHARS)
          throw new Error(`'${job.file.name}': 문서 속 그림을 읽지 못했어요. PDF로 저장해서 넣어 주세요.`);
        const c = checkText(ready[0].text, m.plan);
        if (!c.ok) throw new Error(`'${job.file.name}': ${c.reason}`);
        return { kind: 'text', text: c.text, pages: 0, blobs: ready[0].blobs };
      }
      if (job.kind === 'pdf') {
        // 아주 큰 PDF 는 여기서 열지 않는다 (쪽수 검사는 서버가 한다)
        const pages = job.file.size > BIG_PDF_BYTES ? 0 : await countPdfPages(job.file);
        if (pages > m.plan.pdfPages) throw new Error(`PDF가 ${pages}쪽이에요. 한 번에 ${m.plan.pdfPages}쪽까지 넣을 수 있어요. 나눠서 넣어 주세요.`);
        return { kind: 'pdf', text: '', pages, blobs: [job.file] };
      }
      const blobs: Blob[] = [];
      for (let i = 0; i < job.files.length; i++) {
        blobs.push(await shrinkImage(job.files[i]));
        update(key, { done: i + 1 });
      }
      return { kind: 'image', text: '', pages: 0, blobs };
    },
    [update, commit, toast],
  );

  /** 한 번짜리 올리기 주소를 받아 파일을 올린다 → 올린 경로 */
  const upload = useCallback(
    async (key: string, sourceId: string, prep: Prepared): Promise<string[]> => {
      update(key, { status: 'uploading', done: 0, total: prep.blobs.length, bytes: prep.blobs.reduce((n, b) => n + b.size, 0) });
      // 글 자료의 파일은 문서 속 그림 (사진처럼 JPEG 로 올린다). 요청이 빠르면 조금 기다렸다 다시 (올리기 자리는 아직 만들지 않았다)
      let uploads: Array<{ path: string; token: string }> = [];
      for (let wait = 0; ; wait++) {
        try {
          ({ uploads } = await api<{ uploads: Array<{ path: string; token: string }> }>('/api/uploads', {
            method: 'POST',
            body: JSON.stringify({ sourceId, kind: prep.kind === 'pdf' ? 'pdf' : 'image', files: prep.blobs.map((b) => ({ size: b.size })) }),
          }));
          break;
        } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'rate_limited' || wait >= 6) throw e;
          update(key, { status: 'busy' });
          await sleep(20_000);
          update(key, { status: 'uploading' });
        }
      }
      const bucket = sb().storage.from('sources');
      for (let i = 0; i < uploads.length; i++) {
        const { error } = await bucket.uploadToSignedUrl(uploads[i].path, uploads[i].token, prep.blobs[i], {
          contentType: prep.kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
        });
        if (error) {
          // 저장소 한도보다 큰 파일 (Supabase 전체 업로드 한도를 확인해야 한다)
          const tooBig = /exceed|too large|maximum allowed size|payload/i.test(error.message ?? '') || (error as { status?: number }).status === 413;
          throw new Error(
            tooBig ? '파일이 저장소 한도보다 커서 올리지 못했어요. 더 작게 나눠서 넣어 주세요.' : '파일을 올리지 못했어요. 인터넷 연결을 확인해 주세요.',
          );
        }
        update(key, { done: i + 1 });
      }
      return uploads.map((u) => u.path);
    },
    [update],
  );

  /**
   * 자료 만들기. 자리가 없으면(too_many_running) AI 요청을 쓰지 않는 방법으로 기다렸다 다시 보내고,
   * 앞선 요청이 이미 만들었으면(duplicate: 응답만 못 받음) 성공으로 본다. 파일이 지워졌으면 'files_gone'.
   */
  const create = useCallback(
    async (it: Item, sourceId: string, prep: Prepared, files: string[]): Promise<'ok' | 'files_gone'> => {
      let slotWaits = 0;
      let rateWaits = 0;
      for (;;) {
        update(it.key, { status: 'starting' });
        // 제목은 지금 것으로 (긴 문서를 나누면 준비하는 동안 '(1/3)' 이 붙는다)
        const title = (itemsRef.current.find((i) => i.key === it.key) ?? it).job.title;
        try {
          await api('/api/sources', {
            method: 'POST',
            body: JSON.stringify({
              id: sourceId,
              subjectId: it.subjectId,
              kind: prep.kind,
              title,
              text: prep.kind === 'text' ? prep.text : undefined,
              files,
              ...(it.parentId ? { parentId: it.parentId } : {}),
              ...(it.review === false ? { review: false } : {}),
              ...(it.unit ? { unit: it.unit } : {}),
            }),
          });
          return 'ok';
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          if (e.code === 'duplicate') return 'ok';
          if (e.code === 'file_missing') return 'files_gone';
          if (e.code === 'too_many_running' && slotWaits++ < 120) {
            await waitForSlot(it.key, true);
            continue;
          }
          if (e.code === 'append_busy' && it.parentId && slotWaits++ < 120) {
            await waitForAppend(it.key, it.parentId, true);
            continue;
          }
          if (e.code === 'rate_limited' && rateWaits++ < 6) {
            update(it.key, { status: 'busy' });
            await sleep(20_000);
            continue;
          }
          throw e;
        }
      }
    },
    [update, waitForSlot, waitForAppend],
  );

  const runItem = useCallback(
    async (it: Item) => {
      try {
        const m = meRef.current;
        let prep = prepared.current.get(it.key);
        if (!prep) {
          prep = await prepare(it.key, it.job);
          prepared.current.set(it.key, prep);
        }
        let sourceId = it.sourceId;
        let files = it.files;
        if (!files) {
          // 에너지가 모자라면 올리기 전에 멈춘다 (마지막 검사는 서버가 한다)
          const model = clientModel(m, m.settings.models.organize);
          // 노트에 더하는 자료는 지금 노트와 합치는 값도, Pro 그림 풀이를 만들면 그 값도 든다 (서버 계산과 같게)
          const figures = figuresWanted({ canFigures: m.canFigures, figuresSetting: m.settings.quiz.figures, featureOn: m.features.figures });
          const redraws = redrawsWanted({
            kind: prep.kind,
            pictures: prep.blobs.length,
            canFigures: m.canFigures,
            sourceFiguresSetting: m.settings.quiz.sourceFigures,
            featureOn: m.features.sourceFigures,
          });
          const cover = coverWanted({ canFigures: m.canFigures, autoCover: m.settings.visual.autoCover, featureOn: m.features.covers, append: !!it.parentId });
          const est =
            estimateEnergy({ kind: prep.kind, pages: prep.pages, images: prep.blobs.length, chars: prep.text.length }, model, m.usdPerEnergy) +
            (it.parentId ? Math.ceil(estimateSmallTask(model, m.usdPerEnergy, 9000, 3000)) : 0) +
            (figures ? estimateFigures(clientModel(m, m.settings.models.quiz), m.usdPerEnergy) : 0) +
            (redraws ? estimateRedraws(clientModel(m, m.settings.models.visual), m.usdPerEnergy) : 0) +
            (cover ? estimateCover(clientModel(m, m.settings.models.visual), m.usdPerEnergy) : 0);
          const left = m.energy.unlimited ? Infinity : (m.energy.remaining ?? 0);
          if (est > left) {
            throw new Error(`에너지가 부족해요. 필요: 약 ${est}, 남음: ${Math.floor(left)}. ${refillText(m.planInfo, energyWindow(m.energy))}`);
          }
        }
        for (let round = 0; ; round++) {
          if (!files) {
            if (it.parentId) await waitForAppend(it.key, it.parentId);
            await waitForSlot(it.key);
            try {
              files = prep.blobs.length ? await upload(it.key, sourceId, prep) : [];
            } catch (e) {
              // 문서 속 그림을 오늘 더 올릴 수 없다 (하루 올리기 수·아직 정리하지 않은 파일 수): 그림은 빼고 글만 넣는다
              // (이 거절은 올리기 자리를 만들기 전이라 같은 번호로 그대로 만든다)
              const full = e instanceof ApiError && (e.code === 'upload_limit' || e.code === 'upload_pending');
              if (!(full && prep.kind === 'text' && prep.blobs.length)) throw e;
              prep = { ...prep, text: stripPictureMarks(prep.text), blobs: [] };
              prepared.current.set(it.key, prep);
              files = [];
              toast(`${e.message} 문서 속 그림은 빼고 글만 넣어요.`);
            }
            update(it.key, { files });
          }
          const r = await create(it, sourceId, prep, files);
          if (r === 'ok') break;
          // 올린 파일이 없어졌다 (거절된 뒤 지워짐 등): 새 번호로 한 번만 다시 올린다
          if (round >= 1) throw new Error('올린 파일을 찾을 수 없어요. 다시 넣어 주세요.');
          sourceId = newId();
          files = undefined;
          update(it.key, { sourceId, files: undefined });
        }
        prepared.current.delete(it.key);
        update(it.key, { status: 'done', sourceId });
        touchSubject(it.subjectId);
        window.dispatchEvent(new CustomEvent(SOURCES_CHANGED, { detail: { id: sourceId } }));
        refreshMe().catch(() => {});
        setTimeout(() => remove(it.key), 2600);
      } catch (e) {
        update(it.key, { status: 'error', error: (e as Error).message || '넣지 못했어요.' });
      }
    },
    [update, remove, waitForSlot, waitForAppend, prepare, upload, create, refreshMe, touchSubject, toast],
  );

  /**
   * 노트에 더하는 자료는 노트마다 따로 줄을 세운다: 한 노트에는 하나씩 더해야 해서 앞 자료가 끝날 때까지 기다리는데,
   * 그동안 다른 자료(새 노트, 다른 노트에 더하기)는 막지 않고 올린다.
   */
  const appendChains = useRef(new Set<string>());
  const runAppendChain = useCallback(
    (parentId: string) => {
      if (appendChains.current.has(parentId)) return;
      appendChains.current.add(parentId);
      (async () => {
        try {
          for (;;) {
            const next = itemsRef.current.find((i) => i.status === 'waiting' && i.parentId === parentId);
            if (!next) break;
            await runItem(next);
          }
        } finally {
          appendChains.current.delete(parentId);
        }
      })();
    },
    [runItem],
  );

  const running = useRef(false);
  const pump = useCallback(async () => {
    for (const it of itemsRef.current) if (it.status === 'waiting' && it.parentId) runAppendChain(it.parentId);
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'waiting' && !i.parentId);
        if (!next) break;
        await runItem(next);
      }
    } finally {
      running.current = false;
    }
  }, [runItem, runAppendChain]);

  const enqueue = useCallback(
    (jobs: Job[], subjectId: string, into?: { parentId: string; noteTitle: string }, opts: { review?: boolean; unit?: string } = {}) => {
      if (!jobs.length) return;
      const added: Item[] = jobs.map((job) => ({
        key: newId(),
        sourceId: newId(),
        job,
        subjectId,
        status: 'waiting',
        done: 0,
        total: 0,
        ...(into ? { parentId: into.parentId, noteTitle: into.noteTitle } : {}),
        ...(opts.review === false ? { review: false } : {}),
        ...(opts.unit && !into ? { unit: opts.unit } : {}),
      }));
      commit([...itemsRef.current, ...added]);
      if (!into) writeLast(meRef.current.userId, subjectId);
      pump();
    },
    [commit, pump],
  );

  const retry = useCallback(
    (key: string) => {
      const it = itemsRef.current.find((i) => i.key === key);
      if (!it) return;
      // 파일을 다 올렸거나 (그림 없는) 글이면 같은 번호로 다시 (이미 만들어졌으면 서버가 duplicate 로 알려 준다),
      // 올리다 멈췄으면 그 번호의 올리기 표가 남아 있으니 새 번호로 처음부터 (문서 속 그림을 올리는 글도)
      const pictures = prepared.current.get(key)?.blobs.length ?? (it.job.kind === 'text' ? (it.job.pictures?.length ?? 0) : 0);
      const textish = it.job.kind === 'text' || it.job.kind === 'textfile' || it.job.kind === 'office';
      const sameId = !!it.files || (textish && !pictures);
      update(key, { status: 'waiting', error: undefined, done: 0, ...(sameId ? {} : { sourceId: newId(), files: undefined }) });
      pump();
    },
    [update, pump],
  );

  const dismiss = useCallback(
    (key: string) => {
      prepared.current.delete(key);
      remove(key);
    },
    [remove],
  );

  /** 파일 → 할 일 (PDF 하나씩, 사진 묶음, 글 파일, 한글·워드·PPT) */
  const filesToJobs = useCallback(
    (files: File[], titleForFiles = ''): Job[] => {
      const g = groupFiles(files, meRef.current.plan);
      for (const r of g.rejected) toast(`${r.name}: ${r.reason}`, 'bad');
      return [
        ...g.pdfs.map((file): Job => ({ kind: 'pdf', file, title: titleForFiles || titleFromName(file.name) })),
        ...g.imageGroups.map((group): Job => ({ kind: 'image', files: group, title: titleForFiles })),
        ...g.textFiles.map((file): Job => ({ kind: 'textfile', file, title: titleForFiles || titleFromName(file.name) })),
        ...g.officeFiles.map((file): Job => ({ kind: 'office', file, title: titleForFiles || titleFromName(file.name) })),
      ];
    },
    [toast],
  );

  const ensureSubject = useCallback(async (): Promise<string> => {
    let id = resolveSubject();
    if (!id) {
      await loadSubjects();
      id = resolveSubject();
    }
    return id;
  }, [resolveSubject, loadSubjects]);

  // ---------------------------------------------------------- 입력창
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [composerSubject, setComposerSubject] = useState('');
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** 이번에 만드는 노트를 복습에 넣을지 (창을 열 때마다 켠 채로 시작한다) */
  const [review, setReview] = useState(true);
  /** 이번에 만드는 노트의 단원 (창을 열 때마다·과목을 바꾸면 '단원 없음'으로 시작한다) */
  const [unit, setUnit] = useState('');

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const openComposer = useCallback(
    (subjectId?: string) => {
      if (!enabled) return;
      // 닫히는 중에 다시 열면 닫기를 취소한다
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      setComposerSubject(subjectId || resolveSubject());
      setReview(true);
      setUnit('');
      setClosing(false);
      setOpen(true);
      // 과목 목록을 아직 못 읽었을 때 열었으면, 읽은 뒤에 과목을 골라 둔다
      loadSubjects().then(() => setComposerSubject((cur) => cur || resolveSubject()));
    },
    [enabled, resolveSubject, loadSubjects],
  );
  const closeComposer = useCallback(() => {
    setClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setClosing(false);
    }, 140);
  }, []);
  // 입력창이 사라지면 + 버튼으로 돌아간다 (키보드로 쓰는 사람이 길을 잃지 않게)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (!document.activeElement || document.activeElement === document.body) fabRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!enabled || !files.length) return;
      if (!meRef.current.aiEnabled) {
        toast('지금은 AI 기능을 잠깐 쉬고 있어요.', 'bad');
        return;
      }
      const subjectId = await ensureSubject();
      if (!subjectId) {
        toast('먼저 과목을 만들어 주세요.', 'bad');
        openComposer();
        return;
      }
      const jobs = filesToJobs(files);
      if (jobs.length) enqueue(jobs, subjectId);
    },
    [enabled, ensureSubject, filesToJobs, enqueue, toast, openComposer],
  );

  const submitComposer = useCallback(() => {
    const subjectId = composerSubject;
    if (!subjectId) {
      toast('과목을 골라 주세요.', 'bad');
      return;
    }
    const { textAsSource, titleForFiles } = splitComposer(text, attachments.length);
    const attachedFiles = attachments.map((a) => a.file);
    const jobs: Job[] = [];
    if (textAsSource !== null) {
      const c = checkText(textAsSource, meRef.current.plan);
      if (!c.ok) {
        toast(c.reason, 'bad');
        return;
      }
      jobs.push({ kind: 'text', text: c.text, title: '' });
    }
    jobs.push(...filesToJobs(attachedFiles, titleForFiles));
    if (!jobs.length) return;
    enqueue(jobs, subjectId, undefined, { review, unit });
    setText('');
    setAttachments([]);
    closeComposer();
  }, [composerSubject, text, attachments, filesToJobs, enqueue, closeComposer, toast, review, unit]);

  /** 빈 노트: AI 없이 직접 채우는 노트를 만들고 그 노트로 간다 (에너지를 쓰지 않는다) */
  const createBlank = useCallback(
    async (title: string): Promise<boolean> => {
      const subjectId = composerSubject;
      if (!subjectId) {
        toast('과목을 골라 주세요.', 'bad');
        return false;
      }
      try {
        const r = await api<{ id: string }>('/api/notes/blank', {
          method: 'POST',
          body: JSON.stringify({ subjectId, title, ...(unit ? { unit } : {}), ...(review ? {} : { review: false }) }),
        });
        writeLast(meRef.current.userId, subjectId);
        touchSubject(subjectId);
        window.dispatchEvent(new CustomEvent(SOURCES_CHANGED, { detail: { id: r.id } }));
        closeComposer();
        // 빈 노트는 고치기 모드로 연다 (바로 적을 수 있게)
        router.push(`/notes/${r.id}?edit=1`);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : '빈 노트를 만들지 못했어요.', 'bad');
        return false;
      }
    },
    [composerSubject, toast, closeComposer, router, review, touchSubject, unit],
  );

  // ---------------------------------------------------------- 끌어다 놓기, 붙여 넣기
  const [dragging, setDragging] = useState(false);
  const [dropSubjectName, setDropSubjectName] = useState('');
  const dragDepth = useRef(0);

  // + 버튼을 쓰지 않는 화면으로 가면 입력창과 끌기 안내를 닫는다 (뒤로 가기로 돌아와도 다시 열리지 않게)
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    if (!enabled) {
      setOpen(false);
      setClosing(false);
      setDragging(false);
    }
  }
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!enabled) return;
    dragDepth.current = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      // 채팅 창처럼 파일을 받는 창이 열려 있으면 그 창이 받는다 (자료 넣기 안내를 띄우지 않는다)
      if (topFileSink()) return;
      dragDepth.current += 1;
      if (dragDepth.current === 1) {
        const id = openRef.current ? '' : resolveSubject();
        setDropSubjectName(noteTargetRef.current?.versions && !openRef.current ? '' : (subjectsRef.current.find((s) => s.id === id)?.name ?? ''));
        setDragging(true);
      }
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      const sink = topFileSink();
      if (sink) {
        sink(files);
        return;
      }
      // 입력창이 열려 있으면 그 안에 붙이고, 노트 화면이면 이 노트에 더하고, 아니면 바로 정리
      if (openRef.current) setAttachments((a) => [...a, ...toAttachments(files)]);
      else if (noteTargetRef.current?.versions) setPendingAppend({ files, text: '' });
      else addFiles(files);
    };
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      const pasted = cd?.getData('text/plain') ?? '';
      let files = Array.from(cd?.files ?? []);
      // 엑셀·PPT·원노트는 글을 복사하면 그 글의 그림도 같이 넣는다: 글이 있으면 글을 붙여 넣는 것으로 본다
      const textWithPicture = !!pasted.trim() && Array.from(cd?.types ?? []).includes('text/html') && files.every((f) => f.type.startsWith('image/'));
      if (textWithPicture) files = [];
      const sink = topFileSink();
      if (sink) {
        // 채팅 창이 열려 있으면 붙여 넣은 파일은 채팅에 붙이고, 글은 그 창의 입력칸이 받는다
        if (files.length) {
          e.preventDefault();
          sink(files);
        }
        return;
      }
      if (files.length && openRef.current) {
        e.preventDefault();
        setAttachments((a) => [...a, ...toAttachments(files)]);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return;
      if (files.length) {
        e.preventDefault();
        if (noteTargetRef.current?.versions) setPendingAppend({ files, text: '' });
        else addFiles(files);
        return;
      }
      // 노트 화면에서 글을 붙여 넣으면 이 노트에 더할지 묻는다
      if (!openRef.current && noteTargetRef.current?.versions && pasted.trim().length >= MIN_TEXT_CHARS) {
        e.preventDefault();
        setPendingAppend({ files: [], text: pasted });
        return;
      }
      // 글을 붙여 넣으면 입력창을 열어 그 글을 넣어 둔다 (엔터를 누르면 정리)
      if (!openRef.current && pasted.trim().length >= MIN_TEXT_CHARS) {
        e.preventDefault();
        setText((cur) => (cur.trim() ? `${cur}\n${pasted}` : pasted));
        openComposer();
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [enabled, addFiles, resolveSubject, openComposer]);

  // + 버튼이 없는 화면(복습·설정 등): 파일을 끌고 오면 어디에 놓으면 되는지 알려 주고,
  // 놓기는 막아서 브라우저가 파일을 열어 버리지 않게 한다
  const lastHint = useRef(0);
  useEffect(() => {
    if (enabled) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || Date.now() - lastHint.current < 4000) return;
      lastHint.current = Date.now();
      toast('자료함이나 홈 화면에 끌어다 놓아 주세요.');
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [enabled, toast]);

  const setContextSubject = useCallback((id: string | null) => {
    contextSubject.current = id;
  }, []);

  const setNoteTarget = useCallback((t: NoteTarget | null) => {
    noteTargetRef.current = t;
    setNoteTargetState(t);
  }, []);
  /** 지금 노트에 더할 자료를 줄에 넣는다 (Pro 가 아니면 하지 않는다: 서버도 막는다) */
  const enqueueAppend = useCallback(
    (p: { files: File[]; text: string }) => {
      const t = noteTargetRef.current;
      if (!t || !t.canAppend) return;
      if (!meRef.current.aiEnabled) {
        toast('지금은 AI 기능을 잠깐 쉬고 있어요.', 'bad');
        return;
      }
      const jobs: Job[] = [];
      if (p.text.trim()) {
        const c = checkText(p.text, meRef.current.plan);
        if (!c.ok) {
          toast(c.reason, 'bad');
          return;
        }
        jobs.push({ kind: 'text', text: c.text, title: '' });
      }
      jobs.push(...filesToJobs(p.files));
      enqueue(jobs, t.subjectId, { parentId: t.sourceId, noteTitle: t.title });
    },
    [filesToJobs, enqueue, toast],
  );
  /** 노트에 더하기 전에 한 번 묻는다 (Pro 가 아니면 새 노트로 넣을지 묻는다). ask=false 면 묻지 않고 바로 더한다 */
  const addToNote = useCallback(
    (files: File[], text = '', ask = true) => {
      if (!files.length && !text.trim()) return;
      if (ask || !noteTargetRef.current?.canAppend) setPendingAppend({ files, text });
      else enqueueAppend({ files, text });
    },
    [enqueueAppend],
  );
  const confirmAppend = useCallback(() => {
    const p = pendingAppend;
    setPendingAppend(null);
    if (p) enqueueAppend(p);
  }, [pendingAppend, enqueueAppend]);
  const appendAsNew = useCallback(() => {
    const p = pendingAppend;
    setPendingAppend(null);
    if (!p) return;
    if (p.files.length) addFiles(p.files);
    if (p.text.trim()) {
      setText((cur) => (cur.trim() ? `${cur}\n${p.text}` : p.text));
      openComposer();
    }
  }, [pendingAppend, addFiles, openComposer]);

  const ctx = useMemo<Ctx>(
    () => ({ openComposer, addFiles, setContextSubject, setNoteTarget, addToNote, setFabHidden, enabled }),
    [openComposer, addFiles, setContextSubject, setNoteTarget, addToNote, enabled],
  );

  return (
    <QuickAddCtx.Provider value={ctx}>
      {/* 입력창이 열려 있으면 뒤 화면은 누르거나 Tab 으로 갈 수 없다 */}
      <div inert={open}>{children}</div>
      {enabled ? (
        <>
          {/* 노트 화면은 + 버튼 대신 노트 채팅 버튼을 쓴다. 자료함에서 여러 개 고르는 동안은 숨긴다 */}
          {noteTarget?.hideFab || fabHidden ? null : (
            <button
              ref={fabRef}
              type="button"
              className={cx(
                'kok-fab fixed bottom-[calc(80px+var(--tab-float)*10px+env(safe-area-inset-bottom))] right-4 grid h-[58px] w-[58px] place-items-center rounded-full bg-fab text-fab-ink md:bottom-8 md:right-8',
                open ? 'z-[56]' : 'z-40',
              )}
              aria-label={open ? '입력창 닫기' : '자료 넣기'}
              aria-expanded={open && !closing}
              onClick={() => (open ? closeComposer() : openComposer())}
            >
              <span className="kok-fab-icon grid place-items-center">
                <Icon d={ICONS.plus} size={28} strokeWidth={2.4} />
              </span>
            </button>
          )}
          <Tray items={items} subjects={subjects ?? []} onRetry={retry} onRemove={dismiss} />
          {open ? (
            <Composer
              me={me}
              closing={closing}
              subjects={subjects ?? []}
              subjectId={composerSubject}
              onSubject={(id) => {
                if (id !== composerSubject) setUnit('');
                setComposerSubject(id);
                writeLast(me.userId, id);
              }}
              onSubjectsChanged={async () => {
                await loadSubjects();
                window.dispatchEvent(new Event(SUBJECTS_CHANGED));
              }}
              text={text}
              onText={setText}
              attachments={attachments}
              onAttach={(fs) => setAttachments((a) => [...a, ...toAttachments(fs)])}
              onDetach={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
              onSubmit={submitComposer}
              onBlank={createBlank}
              onClose={closeComposer}
              review={review}
              onReview={setReview}
              unit={unit}
              onUnit={setUnit}
            />
          ) : null}
          {dragging ? <DropOverlay subjectName={dropSubjectName} intoComposer={open} note={open ? null : noteTarget} /> : null}
          <AppendSheet
            target={noteTarget}
            pending={pendingAppend}
            me={me}
            onConfirm={confirmAppend}
            onAsNew={appendAsNew}
            onClose={() => setPendingAppend(null)}
          />
        </>
      ) : null}
    </QuickAddCtx.Provider>
  );
}

// ------------------------------------------------------------- 입력창
function Composer({
  me,
  closing,
  subjects,
  subjectId,
  onSubject,
  onSubjectsChanged,
  text,
  onText,
  attachments,
  onAttach,
  onDetach,
  onSubmit,
  onBlank,
  onClose,
  review,
  onReview,
  unit,
  onUnit,
}: {
  me: MeResponse;
  closing: boolean;
  subjects: SubjectRow[];
  subjectId: string;
  onSubject: (id: string) => void;
  onSubjectsChanged: () => Promise<void>;
  text: string;
  onText: (t: string) => void;
  attachments: Attachment[];
  onAttach: (files: File[]) => void;
  onDetach: (id: string) => void;
  onSubmit: () => void;
  /** 빈 노트 만들기 (이름) → 만들었는지 */
  onBlank: (title: string) => Promise<boolean>;
  onClose: () => void;
  /** 이번에 만드는 노트를 복습에 넣을지 */
  review: boolean;
  onReview: (on: boolean) => void;
  /** 이번에 만드는 노트의 단원 ('' = 단원 없음) */
  unit: string;
  onUnit: (unit: string) => void;
}) {
  const toast = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  // 단원 고르기 (단원 없음 · 이 과목에 있는 단원 · 새 단원)
  const [unitPicking, setUnitPicking] = useState(false);
  const units = useSubjectUnits(subjectId, unitPicking);
  // 과목이 많으면 찾기 (이름이나 첫 자음)
  const [pickQuery, setPickQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // 빈 노트 만들기 (AI 없이): 이름만 받는다
  const [blank, setBlank] = useState(false);
  const [blankTitle, setBlankTitle] = useState('');
  const [blankBusy, setBlankBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (blank) titleInput.current?.focus();
  }, [blank]);

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 글 길이에 맞춰 입력칸 높이를 늘린다
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  // 고르는 목록: 고정 → 최근 쓴 과목 (보관한 과목은 빼고, 지금 고른 것은 남긴다)
  const pickList = pickerOrder(subjects, subjectId).filter((s) => matchesSubject(s.name, pickQuery));
  const pickSearch = subjects.length >= 7;
  const togglePicking = () => {
    setPicking((p) => !p);
    setUnitPicking(false);
    setPickQuery('');
  };
  const trimmed = text.trim();
  const { textAsSource } = splitComposer(text, attachments.length);
  const textReady = textAsSource !== null && trimmed.length >= MIN_TEXT_CHARS;
  const canSend = !!subjectId && me.aiEnabled && (attachments.length > 0 || textReady);
  const model = clientModel(me, me.settings.models.organize);
  const est = textReady ? estimateEnergy({ kind: 'text', chars: trimmed.length }, model, me.usdPerEnergy) : 0;
  const left = me.energy.unlimited ? null : Math.floor(me.energy.remaining ?? 0);

  const startBlank = () => {
    // 한 줄짜리 짧은 글을 적어 두었으면 그 글을 노트 이름으로
    setBlankTitle(!trimmed.includes('\n') && trimmed.length <= 60 ? trimmed : '');
    setBlank(true);
  };
  const makeBlank = async () => {
    if (blankBusy) return;
    const t = blankTitle.trim();
    setBlankBusy(true);
    const ok = await onBlank(t);
    setBlankBusy(false);
    if (ok && t && t === trimmed) onText('');
  };

  // 복습에 넣기 켜고 끄기 (DB 에 칸이 있을 때만): 과목 옆의 '복습 켬·끔'. 끄면 아래에 한 줄로 알려 준다
  const reviewToggle = me.features.organize ? (
    <button
      type="button"
      role="switch"
      aria-checked={review}
      aria-label="복습에 넣기"
      title={review ? '이 노트 문제를 복습에 넣어요 · 누르면 빼요' : '복습에 넣지 않아요 · 누르면 다시 넣어요'}
      className={cx(
        'press inline-flex shrink-0 items-center gap-1 rounded-full py-1.5 pl-2.5 pr-3 text-sm font-semibold',
        review ? 'bg-surface-2 text-muted hover:text-ink' : 'bg-warn-soft text-warn',
      )}
      onClick={() => onReview(!review)}
    >
      <Icon d={review ? ICONS.review : ICONS.reviewOff} size={16} />
      {review ? '복습 켬' : '복습 끔'}
    </button>
  ) : null;
  const reviewNote =
    me.features.organize && !review ? (
      <p className="kok-appear -mt-1 flex items-center gap-1.5 px-1 text-xs font-semibold text-warn" role="status">
        <Icon d={ICONS.reviewOff} size={14} className="shrink-0" />이 노트는 복습에 나오지 않아요. 자료함·노트에서 다시 켤 수 있어요.
      </p>
    ) : null;

  const createSubject = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const color = SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length];
    const { data, error } = await sb().from('subjects').insert({ name, color, position: subjects.length }).select('id').single();
    setCreating(false);
    if (error || !data) {
      toast('과목을 만들지 못했어요.', 'bad');
      return;
    }
    await onSubjectsChanged();
    onSubject(data.id as string);
    setNewName('');
    setPicking(false);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="자료 넣기">
      <button type="button" aria-label="닫기" className="kok-scrim absolute inset-0 cursor-default" onClick={onClose} />
      <form
        data-closing={closing}
        className="kok-composer kok-card absolute inset-x-3 top-[calc(12px+env(safe-area-inset-top))] grid gap-3 rounded-[28px] p-4 shadow-[0_24px_60px_var(--shadow-strong)] sm:inset-x-auto sm:bottom-[104px] sm:right-8 sm:top-auto sm:w-[460px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (blank) makeBlank();
          else if (canSend) onSubmit();
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div className="relative min-w-0">
              <button
                type="button"
                className="press inline-flex max-w-[200px] items-center gap-2 rounded-full bg-surface-2 py-1.5 pl-3 pr-2.5 text-sm font-semibold"
                aria-haspopup="listbox"
                aria-expanded={picking}
                onClick={togglePicking}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(subject?.color) }} aria-hidden="true" />
                <span className="truncate">{subject?.name ?? '과목 고르기'}</span>
                <span className="text-muted" aria-hidden="true">
                  ▾
                </span>
              </button>
              {picking ? (
                <div className="kok-pop absolute left-0 top-10 z-10 grid w-60 origin-top-left rounded-2xl bg-surface p-1.5 shadow-[0_12px_32px_var(--shadow-strong)] ring-1 ring-line sm:bottom-10 sm:top-auto sm:origin-bottom-left">
                  {pickSearch ? (
                    <input
                      type="search"
                      aria-label="과목 찾기"
                      className="mb-1 min-w-0 rounded-xl bg-surface-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      placeholder="과목 찾기 (ㄱㅎ처럼도)"
                      value={pickQuery}
                      onChange={(e) => setPickQuery(e.target.value)}
                      onKeyDown={(e) => {
                        // 입력창(form) 안이라 엔터가 자료 보내기가 되지 않게: 맞는 첫 과목을 고른다
                        if (isSubmitKey(e.nativeEvent)) {
                          e.preventDefault();
                          const first = pickList[0];
                          if (!first) return;
                          onSubject(first.id);
                          setPicking(false);
                          setPickQuery('');
                          area.current?.focus();
                        }
                      }}
                    />
                  ) : null}
                  <div className="grid max-h-60 gap-0.5 overflow-y-auto" role="listbox" aria-label="과목">
                    {pickList.length === 0 ? <p className="px-3 py-2 text-sm text-muted">맞는 과목이 없어요</p> : null}
                    {pickList.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="option"
                        aria-selected={s.id === subjectId}
                        className={cx(
                          'flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[15px] hover:bg-surface-2',
                          s.id === subjectId && 'font-bold',
                        )}
                        onClick={() => {
                          onSubject(s.id);
                          setPicking(false);
                          setPickQuery('');
                          area.current?.focus();
                        }}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        {s.pinned && !s.archived ? <Icon d={ICONS.pin} size={13} strokeWidth={2.2} className="shrink-0 text-muted" /> : null}
                        {s.id === subjectId ? <Icon d={ICONS.check} size={16} className="text-accent" /> : null}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 flex gap-1.5 border-t border-line px-1 pt-2">
                    <input
                      aria-label="새 과목 이름"
                      className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      placeholder="새 과목"
                      value={newName}
                      maxLength={40}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (isSubmitKey(e.nativeEvent)) {
                          e.preventDefault();
                          createSubject();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="press rounded-xl bg-ink px-3 text-sm font-semibold text-surface disabled:opacity-40"
                      disabled={!newName.trim() || creating}
                      onClick={createSubject}
                    >
                      만들기
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {/* 단원: 고르지 않으면 단원 없이 (AI 가 정하지 않는다) */}
            <div className="relative min-w-0">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={unitPicking}
                aria-label={`단원: ${unit || '단원 없음'}`}
                className={cx(
                  'press inline-flex max-w-[170px] items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2.5 text-sm font-semibold',
                  unit ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted hover:text-ink',
                )}
                onClick={() => {
                  setUnitPicking((p) => !p);
                  setPicking(false);
                }}
              >
                <span className="truncate">{unit || '단원 없음'}</span>
                <span aria-hidden="true">▾</span>
              </button>
              {unitPicking ? (
                <div
                  role="dialog"
                  aria-label="단원 고르기"
                  className="kok-pop absolute left-0 top-10 z-10 w-64 origin-top-left rounded-2xl bg-surface p-1.5 shadow-[0_12px_32px_var(--shadow-strong)] ring-1 ring-line sm:bottom-10 sm:top-auto sm:origin-bottom-left"
                  onKeyDown={(e) => {
                    // Esc 는 단원 고르기만 닫는다 (입력창은 그대로)
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setUnitPicking(false);
                    }
                  }}
                >
                  <UnitOptions
                    value={unit}
                    units={units}
                    onPick={(u) => {
                      onUnit(u);
                      setUnitPicking(false);
                      area.current?.focus();
                    }}
                  />
                </div>
              ) : null}
            </div>
            {reviewToggle}
          </div>
          <span className="shrink-0 text-xs font-semibold text-muted">{blank ? 'AI 없이 · 에너지 0' : <EnergyEstimate est={est || null} left={left} />}</span>
        </div>

        {blank ? (
          <div className="kok-appear grid gap-3">
            <div className="grid gap-0.5 px-1">
              <p className="font-display text-lg">빈 노트 만들기</p>
              <p className="text-sm text-muted">AI 없이 내가 직접 채우는 노트예요. 개념·공식·용어를 하나씩 적을 수 있어요.</p>
            </div>
            <input
              ref={titleInput}
              aria-label="노트 이름"
              className={inputClass}
              placeholder="노트 이름 (비우면 '새 노트')"
              value={blankTitle}
              maxLength={120}
              enterKeyHint="done"
              onChange={(e) => setBlankTitle(e.target.value)}
              onKeyDown={(e) => {
                if (isSubmitKey(e.nativeEvent)) {
                  e.preventDefault();
                  makeBlank();
                }
              }}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="press inline-flex h-10 items-center gap-1 rounded-full pl-2 pr-3.5 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
                onClick={() => {
                  setBlank(false);
                  requestAnimationFrame(() => area.current?.focus());
                }}
              >
                <Icon d={ICONS.back} size={18} />
                AI 정리로
              </button>
              <span className="flex-1" />
              <button
                type="submit"
                className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-ink transition-opacity disabled:opacity-35"
                disabled={!subjectId || blankBusy}
              >
                {blankBusy ? <Spinner /> : <Icon d={ICONS.check} size={18} strokeWidth={2.4} />}
                만들기
              </button>
            </div>
            {reviewNote}
          </div>
        ) : (
          <>
            <textarea
              ref={area}
              rows={3}
              enterKeyHint="send"
              className="max-h-[260px] min-h-[84px] w-full resize-none bg-transparent px-1 text-[16px] leading-relaxed text-ink placeholder:text-muted/80 focus:outline-none"
              placeholder={attachments.length ? '제목이나 설명 (없어도 돼요)' : '공부한 내용을 적거나 붙여 넣고 엔터를 눌러요'}
              value={text}
              maxLength={me.plan.textChars + 1000}
              onChange={(e) => onText(e.target.value)}
              onKeyDown={(e) => {
                if (isSubmitKey(e.nativeEvent)) {
                  e.preventDefault();
                  if (canSend) onSubmit();
                  else if (!subjectId && (textReady || attachments.length)) {
                    setPicking(true);
                    toast('과목을 골라 주세요.');
                  } else if (!attachments.length && trimmed) toast(`${MIN_TEXT_CHARS}자 이상 적어 주세요. (지금 ${trimmed.length}자)`);
                }
              }}
              aria-label="공부한 내용"
            />

            {attachments.length ? (
              <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5" aria-label="붙인 파일">
                {attachments.map((a) => (
                  <AttachmentChip key={a.id} file={a.file} onRemove={() => onDetach(a.id)} />
                ))}
              </ul>
            ) : null}

            <div className="flex items-center gap-1">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={FILE_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  onAttach(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  onAttach(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="press grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
                aria-label="파일 붙이기"
                title="PDF·사진·한글·워드·PPT·글 파일 붙이기"
                onClick={() => fileInput.current?.click()}
              >
                <Icon d={ICONS.clip} size={21} />
              </button>
              <button
                type="button"
                className="press grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
                aria-label="사진 찍기"
                title="교과서·학습지를 사진으로 찍어 넣기"
                onClick={() => cameraInput.current?.click()}
              >
                <Icon d={ICONS.camera} size={21} />
              </button>
              <button
                type="button"
                className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
                title="AI 없이 직접 채우는 노트"
                onClick={startBlank}
              >
                <Icon d={ICONS.pen} size={19} />빈 노트
              </button>
              <p className="ml-1 hidden min-w-0 flex-1 truncate text-xs text-muted sm:block">엔터: 정리 시작 · Shift+엔터: 줄바꿈</p>
              <span className="flex-1 sm:hidden" />
              <button
                type="submit"
                className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-ink transition-opacity disabled:opacity-35"
                disabled={!canSend}
                aria-label="AI 정리 시작"
              >
                정리
                <Icon d={ICONS.send} size={18} strokeWidth={2.2} />
              </button>
            </div>
            {reviewNote}
            {!me.aiEnabled ? <p className="text-xs font-semibold text-bad">지금은 AI 기능을 잠깐 쉬고 있어요.</p> : null}
            {trimmed && !attachments.length && trimmed.length < MIN_TEXT_CHARS ? (
              <p className="-mt-1 px-1 text-xs text-muted">
                {MIN_TEXT_CHARS}자 이상 적으면 정리할 수 있어요 ({trimmed.length}/{MIN_TEXT_CHARS})
              </p>
            ) : null}
          </>
        )}
      </form>
    </div>
  );
}

function AttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith('image/');
  // 미리보기 주소는 그림을 다 불러온 뒤 바로 돌려준다 (불러온 그림은 그대로 보인다)
  const [url] = useState(() => (isImage ? URL.createObjectURL(file) : null));
  const kind = fileKind(file);
  return (
    <li
      className={cx(
        'kok-attach relative flex h-16 shrink-0 items-center overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-inset ring-line',
        url ? 'w-16' : 'max-w-[200px] gap-2 pl-2 pr-9',
      )}
      title={file.name}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={file.name}
          className="h-full w-full object-cover"
          onLoad={() => URL.revokeObjectURL(url)}
          onError={() => URL.revokeObjectURL(url)}
        />
      ) : (
        <>
          <span
            className={cx(
              'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
              kind === 'pdf' ? 'bg-bad-soft text-bad' : kind === 'text' || kind === 'office' ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted',
            )}
          >
            <Icon d={kind === 'pdf' || kind === 'office' ? ICONS.file : ICONS.pen} size={20} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold">{file.name}</span>
            <span className="block text-[11px] text-muted">
              {kind === 'pdf' ? 'PDF' : kind === 'text' ? '글 파일' : kind === 'office' ? officeLabel(file.name) : '파일'} ·{' '}
              {Math.max(1, Math.round(file.size / 1024))}KB
            </span>
          </span>
        </>
      )}
      <button
        type="button"
        aria-label={`${file.name} 빼기`}
        className="press absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
        onClick={onRemove}
      >
        <Icon d={ICONS.close} size={12} strokeWidth={2.8} />
      </button>
    </li>
  );
}

// ------------------------------------------------------------- 끌어다 놓기 안내
/** 노트에 더하기 전에 한 번 묻는다. Pro 가 아니면 새 노트로 넣을지 묻는다 */
function AppendSheet({
  target,
  pending,
  me,
  onConfirm,
  onAsNew,
  onClose,
}: {
  target: NoteTarget | null;
  pending: { files: File[]; text: string } | null;
  me: MeResponse;
  onConfirm: () => void;
  onAsNew: () => void;
  onClose: () => void;
}) {
  const open = !!pending && !!target;
  const items = pending
    ? [...pending.files.map((f) => f.name), ...(pending.text.trim() ? [`글: ${pending.text.trim().replace(/\s+/g, ' ').slice(0, 40)}…`] : [])]
    : [];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={target?.canAppend ? '이 노트에 더할까요?' : '노트에 더하기는 Pro 기능이에요'}
      footer={
        target?.canAppend ? (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onConfirm} disabled={!me.aiEnabled}>
              노트에 더하기
            </Button>
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onAsNew}>
              새 노트로 넣기
            </Button>
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
          </div>
        )
      }
    >
      {target ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted">
            {target.canAppend
              ? `'${target.title}'에 아래 자료를 더해요. AI가 지금 노트와 합쳐 새 버전을 만들고, 지금 버전은 원본 탭에 그대로 남아요.`
              : 'Pro에서는 지금 노트에 자료를 더해 새 버전을 만들 수 있어요. 지금은 따로 새 노트로 넣을 수 있어요.'}
          </p>
          <ul className="grid gap-1.5">
            {items.map((x, i) => (
              <li key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <Icon d={x.startsWith('글:') ? ICONS.pen : ICONS.file} size={16} className="shrink-0 text-muted" />
                <span className="truncate">{x}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}

function DropOverlay({ subjectName, intoComposer, note }: { subjectName: string; intoComposer: boolean; note: NoteTarget | null }) {
  return (
    <div className="kok-drop pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-[color-mix(in_srgb,var(--bg)_72%,transparent)] p-6 backdrop-blur-[6px]">
      <div className="kok-drop-card relative grid w-full max-w-md justify-items-center gap-3 rounded-[32px] bg-surface px-8 py-12 text-center shadow-2xl">
        <svg className="pointer-events-none absolute inset-3 h-[calc(100%-24px)] w-[calc(100%-24px)] overflow-visible" aria-hidden="true">
          <rect className="kok-dash" x="0" y="0" width="100%" height="100%" rx="22" fill="none" stroke="var(--fab)" strokeWidth="2.5" strokeDasharray="10 14" />
        </svg>
        <div className="kok-float grid h-16 w-16 place-items-center rounded-full bg-fab text-fab-ink shadow-lg">
          <Icon d={ICONS.upload} size={30} strokeWidth={2.2} />
        </div>
        <p className="font-display text-xl">
          {intoComposer ? '여기에 놓으면 입력창에 붙여요' : note ? '여기에 놓으면 이 노트에 더해요' : '여기에 놓으면 KOK이 정리해요'}
        </p>
        <p className="text-sm text-muted">
          PDF · 사진 · 한글 · 워드 · PPT · 글 파일
          {note ? (
            <>
              {' '}
              → <b className="text-ink">{note.title}</b>
              {note.canAppend ? '' : ' (Pro)'}
            </>
          ) : null}
          {!intoComposer && !note && subjectName ? (
            <>
              {' '}
              → <b className="text-ink">{subjectName}</b>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- 올리는 중 띠
function Tray({
  items,
  subjects,
  onRetry,
  onRemove,
}: {
  items: Item[];
  subjects: SubjectRow[];
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  if (!items.length) return null;
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name;
  return (
    <div
      className="fixed bottom-[calc(150px+env(safe-area-inset-bottom))] right-4 z-40 grid w-[min(320px,calc(100vw-32px))] gap-2 md:bottom-28 md:right-8"
      aria-live="polite"
      aria-label="넣는 중인 자료"
    >
      {items.slice(-4).map((it) => {
        const pct = it.total ? Math.round((it.done / it.total) * 100) : 0;
        const busy = it.status !== 'done' && it.status !== 'error';
        return (
          <div key={it.key} className="kok-tray-item kok-card flex items-center gap-3 rounded-2xl p-3 shadow-[0_10px_30px_var(--shadow-strong)]">
            <span
              className={cx(
                'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
                it.status === 'error' ? 'bg-bad-soft text-bad' : it.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent',
              )}
            >
              {it.status === 'done' ? <Icon d={ICONS.check} size={20} strokeWidth={2.4} /> : <Icon d={jobIcon(it.job)} size={20} />}
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-sm font-bold">{jobLabel(it.job)}</span>
              <span
                className={cx(
                  'text-xs',
                  // 오류는 이유까지 읽을 수 있게 조금 더 길게
                  it.status === 'error' ? 'line-clamp-4 text-bad' : it.status === 'done' ? 'line-clamp-2 text-ok' : 'line-clamp-2 text-muted',
                )}
              >
                {it.status !== 'error' && (it.noteTitle || subjectName(it.subjectId))
                  ? `${it.noteTitle ? `→ ${it.noteTitle}` : subjectName(it.subjectId)} · `
                  : ''}
                {statusText(it)}
              </span>
              {busy && (it.status === 'uploading' || it.status === 'preparing') && it.total > 1 ? (
                <span className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-fab transition-[width] duration-300" style={{ width: `${pct}%` }} />
                </span>
              ) : null}
            </span>
            {busy ? <Spinner className="h-4 w-4 shrink-0 text-muted" /> : null}
            {it.status === 'error' ? (
              <span className="flex shrink-0 gap-0.5">
                <button
                  type="button"
                  className="press grid h-8 w-8 place-items-center rounded-full hover:bg-surface-2"
                  aria-label="다시 하기"
                  onClick={() => onRetry(it.key)}
                >
                  <Icon d={ICONS.retry} size={17} />
                </button>
                <button
                  type="button"
                  className="press grid h-8 w-8 place-items-center rounded-full hover:bg-surface-2"
                  aria-label="닫기"
                  onClick={() => onRemove(it.key)}
                >
                  <Icon d={ICONS.close} size={16} />
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
