'use client';
// 빠른 추가: 어디서나 오른쪽 아래 + 버튼 → 입력창(엔터 = AI가 바로 정리),
// 파일을 화면에 끌어다 놓거나 붙여 넣으면 검사하고 바로 정리, 올리는 중인 것은 오른쪽 아래 띠에 보여 준다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse, SubjectRow } from '@/lib/types';
import { fetchSources, fetchSubjects, sb } from '@/lib/data';
import { estimateEnergy } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { shrinkImage } from '@/lib/image';
import { MIN_TEXT_CHARS, checkText, fileKind, groupFiles, isSubmitKey, splitComposer, titleFromName } from '@/lib/quick-add';
import { SUBJECT_COLORS } from '@/lib/settings';
import { subjectVar } from '@/lib/colors';
import { ApiError, ICONS, Icon, Spinner, api, cx, useToast } from './ui';

/** 동시에 정리할 수 있는 자료 수 (서버와 같다) */
const MAX_PARALLEL = 3;
/** 자료 목록이 바뀌었다고 화면들에 알리는 이벤트 */
export const SOURCES_CHANGED = 'kok:sources-changed';
/** 과목이 바뀌었다고 알리는 이벤트 */
export const SUBJECTS_CHANGED = 'kok:subjects-changed';

type Job =
  | { kind: 'text'; text: string; title: string }
  | { kind: 'textfile'; file: File; title: string }
  | { kind: 'pdf'; file: File; title: string }
  | { kind: 'image'; files: File[]; title: string };

type Status = 'waiting' | 'preparing' | 'slot' | 'uploading' | 'starting' | 'done' | 'error';

type Item = {
  key: string;
  sourceId: string;
  job: Job;
  subjectId: string;
  status: Status;
  done: number;
  total: number;
  error?: string;
};

type Ctx = {
  /** 입력창 열기 (과목을 정해서 열 수도 있다) */
  openComposer: (subjectId?: string) => void;
  /** 파일을 바로 정리하기 */
  addFiles: (files: File[]) => void;
  /** 지금 보고 있는 과목 (자료함에서 과목을 고르면 그 과목에 넣는다) */
  setContextSubject: (id: string | null) => void;
  enabled: boolean;
};

const QuickAddCtx = createContext<Ctx>({ openComposer: () => {}, addFiles: () => {}, setContextSubject: () => {}, enabled: false });

export function useQuickAdd() {
  return useContext(QuickAddCtx);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newId = () => crypto.randomUUID();

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
  return job.kind === 'pdf' ? ICONS.file : job.kind === 'image' ? ICONS.image : ICONS.pen;
}

function statusText(it: Item): string {
  switch (it.status) {
    case 'waiting':
      return '차례를 기다려요';
    case 'preparing':
      return it.job.kind === 'image' ? `사진 줄이는 중 ${it.done}/${it.total}` : it.job.kind === 'pdf' ? 'PDF 확인하는 중' : '준비하는 중';
    case 'slot':
      return '정리 중인 자료가 끝나면 시작해요';
    case 'uploading':
      return `올리는 중 ${it.done}/${it.total}`;
    case 'starting':
      return '정리 시작하는 중';
    case 'done':
      return '정리를 시작했어요';
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
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  // ---------------------------------------------------------- 과목
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const subjectsRef = useRef<SubjectRow[]>([]);
  const contextSubject = useRef<string | null>(null);
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
    if (has(contextSubject.current)) return contextSubject.current!;
    const last = readLast(meRef.current.userId);
    if (has(last)) return last!;
    return list[0]?.id ?? '';
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

  /** 동시에 정리하는 자료가 3개면 하나가 끝날 때까지 기다린다 (올리기 전에 기다려야 파일이 오래 남지 않는다) */
  const waitForSlot = useCallback(
    async (key: string) => {
      if (meRef.current.isAdmin) return;
      for (let i = 0; i < 720; i++) {
        let busy = 0;
        try {
          const rows = await fetchSources({ active: true, limit: 20 });
          busy = rows.filter((r) => r.status === 'queued' || r.status === 'processing').length;
        } catch {
          busy = 0;
        }
        if (busy < MAX_PARALLEL) return;
        update(key, { status: 'slot' });
        await sleep(5000);
      }
    },
    [update],
  );

  const runItem = useCallback(
    async (it: Item) => {
      const job = it.job;
      try {
        const m = meRef.current;
        update(it.key, { status: 'preparing', done: 0, total: job.kind === 'image' ? job.files.length : 1, error: undefined });
        let kind: 'text' | 'pdf' | 'image' = 'text';
        let text = '';
        let pages = 0;
        let blobs: Blob[] = [];
        if (job.kind === 'text') {
          text = job.text;
        } else if (job.kind === 'textfile') {
          const c = checkText(await job.file.text(), m.plan);
          if (!c.ok) throw new Error(`'${job.file.name}': ${c.reason}`);
          text = c.text;
        } else if (job.kind === 'pdf') {
          kind = 'pdf';
          pages = await countPdfPages(job.file);
          if (pages > m.plan.pdfPages) throw new Error(`PDF가 ${pages}쪽이에요. 한 번에 ${m.plan.pdfPages}쪽까지 넣을 수 있어요. 나눠서 넣어 주세요.`);
          blobs = [job.file];
        } else {
          kind = 'image';
          for (let i = 0; i < job.files.length; i++) {
            blobs.push(await shrinkImage(job.files[i]));
            update(it.key, { done: i + 1 });
          }
        }
        // 에너지가 모자라면 올리기 전에 멈춘다
        const model = clientModel(m, m.settings.models.organize);
        const est = estimateEnergy({ kind, pages, images: blobs.length, chars: text.length }, model, m.usdPerEnergy);
        const left = m.energy.unlimited ? Infinity : (m.energy.remaining ?? 0);
        if (est > left) {
          throw new Error(`에너지가 부족해요. 필요: 약 ${est}, 남음: ${Math.floor(left)}. ${m.energy.period === 'day' ? '내일' : '다음 달'} 다시 채워져요.`);
        }

        await waitForSlot(it.key);

        let files: string[] = [];
        if (blobs.length) {
          update(it.key, { status: 'uploading', done: 0, total: blobs.length });
          const { uploads } = await api<{ uploads: Array<{ path: string; token: string }> }>('/api/uploads', {
            method: 'POST',
            body: JSON.stringify({ sourceId: it.sourceId, kind, files: blobs.map((b) => ({ size: b.size })) }),
          });
          const bucket = sb().storage.from('sources');
          for (let i = 0; i < uploads.length; i++) {
            const { error } = await bucket.uploadToSignedUrl(uploads[i].path, uploads[i].token, blobs[i], {
              contentType: kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
            });
            if (error) throw new Error('파일을 올리지 못했어요. 인터넷 연결을 확인해 주세요.');
            update(it.key, { done: i + 1 });
          }
          files = uploads.map((u) => u.path);
        }

        update(it.key, { status: 'starting' });
        for (let attempt = 0; ; attempt++) {
          try {
            await api('/api/sources', {
              method: 'POST',
              body: JSON.stringify({ id: it.sourceId, subjectId: it.subjectId, kind, title: job.title, text: kind === 'text' ? text : undefined, files }),
            });
            break;
          } catch (e) {
            // 그사이 다른 자료가 먼저 자리를 차지했다: 조금 기다렸다 다시
            if (e instanceof ApiError && e.code === 'too_many_running' && attempt < 240) {
              update(it.key, { status: 'slot' });
              await sleep(6000);
              update(it.key, { status: 'starting' });
              continue;
            }
            if (e instanceof ApiError && e.code === 'rate_limited' && attempt < 20) {
              await sleep(15000);
              continue;
            }
            throw e;
          }
        }
        update(it.key, { status: 'done' });
        window.dispatchEvent(new CustomEvent(SOURCES_CHANGED, { detail: { id: it.sourceId } }));
        refreshMe().catch(() => {});
        setTimeout(() => remove(it.key), 2600);
      } catch (e) {
        update(it.key, { status: 'error', error: (e as Error).message || '넣지 못했어요.' });
      }
    },
    [update, remove, waitForSlot, refreshMe],
  );

  const running = useRef(false);
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'waiting');
        if (!next) break;
        await runItem(next);
      }
    } finally {
      running.current = false;
    }
  }, [runItem]);

  const enqueue = useCallback(
    (jobs: Job[], subjectId: string) => {
      if (!jobs.length) return;
      const added: Item[] = jobs.map((job) => ({ key: newId(), sourceId: newId(), job, subjectId, status: 'waiting', done: 0, total: 0 }));
      commit([...itemsRef.current, ...added]);
      writeLast(meRef.current.userId, subjectId);
      pump();
    },
    [commit, pump],
  );

  const retry = useCallback(
    (key: string) => {
      // 같은 자료 번호로는 다시 올릴 수 없어서 새 번호로
      update(key, { status: 'waiting', sourceId: newId(), error: undefined, done: 0 });
      pump();
    },
    [update, pump],
  );

  /** 파일 → 할 일 (PDF 하나씩, 사진 묶음, 글 파일) */
  const filesToJobs = useCallback(
    (files: File[], titleForFiles = ''): Job[] => {
      const g = groupFiles(files, meRef.current.plan);
      for (const r of g.rejected) toast(`${r.name}: ${r.reason}`, 'bad');
      return [
        ...g.pdfs.map((file): Job => ({ kind: 'pdf', file, title: titleForFiles || titleFromName(file.name) })),
        ...g.imageGroups.map((group): Job => ({ kind: 'image', files: group, title: titleForFiles })),
        ...g.textFiles.map((file): Job => ({ kind: 'textfile', file, title: titleForFiles || titleFromName(file.name) })),
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
  const [attachments, setAttachments] = useState<File[]>([]);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const openComposer = useCallback(
    (subjectId?: string) => {
      if (!enabled) return;
      // 닫히는 중에 다시 열면 닫기를 취소한다
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      setComposerSubject(subjectId || resolveSubject());
      setClosing(false);
      setOpen(true);
      loadSubjects();
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
    const jobs: Job[] = [];
    if (textAsSource !== null) {
      const c = checkText(textAsSource, meRef.current.plan);
      if (!c.ok) {
        toast(c.reason, 'bad');
        return;
      }
      jobs.push({ kind: 'text', text: c.text, title: '' });
    }
    jobs.push(...filesToJobs(attachments, titleForFiles));
    if (!jobs.length) return;
    enqueue(jobs, subjectId);
    setText('');
    setAttachments([]);
    closeComposer();
  }, [composerSubject, text, attachments, filesToJobs, enqueue, closeComposer, toast]);

  // ---------------------------------------------------------- 끌어다 놓기, 붙여 넣기
  const [dragging, setDragging] = useState(false);
  const [dropSubjectName, setDropSubjectName] = useState('');
  const dragDepth = useRef(0);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      if (dragDepth.current === 1) {
        const id = openRef.current ? '' : resolveSubject();
        setDropSubjectName(subjectsRef.current.find((s) => s.id === id)?.name ?? '');
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
      // 입력창이 열려 있으면 그 안에 붙이고, 아니면 바로 정리
      if (openRef.current) setAttachments((a) => [...a, ...files]);
      else addFiles(files);
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length && openRef.current) {
        e.preventDefault();
        setAttachments((a) => [...a, ...files]);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return;
      if (files.length) {
        e.preventDefault();
        addFiles(files);
        return;
      }
      // 글을 붙여 넣으면 입력창을 열어 그 글을 넣어 둔다 (엔터를 누르면 정리)
      const pasted = e.clipboardData?.getData('text/plain') ?? '';
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

  // + 버튼이 없는 화면(복습·설정 등)에 파일을 놓으면 브라우저가 파일을 열어 버리지 않게 막는다
  useEffect(() => {
    if (enabled) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      toast('자료함이나 홈 화면에 끌어다 놓아 주세요.');
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [enabled, toast]);

  const setContextSubject = useCallback((id: string | null) => {
    contextSubject.current = id;
  }, []);

  const ctx = useMemo<Ctx>(() => ({ openComposer, addFiles, setContextSubject, enabled }), [openComposer, addFiles, setContextSubject, enabled]);

  return (
    <QuickAddCtx.Provider value={ctx}>
      {children}
      {enabled ? (
        <>
          <button
            ref={fabRef}
            type="button"
            className={cx(
              'kok-fab fixed bottom-[calc(80px+env(safe-area-inset-bottom))] right-4 grid h-[58px] w-[58px] place-items-center rounded-full bg-fab text-fab-ink md:bottom-8 md:right-8',
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
          <Tray items={items} subjects={subjects ?? []} onRetry={retry} onRemove={remove} />
          {open ? (
            <Composer
              me={me}
              closing={closing}
              subjects={subjects ?? []}
              subjectId={composerSubject}
              onSubject={(id) => {
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
              onAttach={(fs) => setAttachments((a) => [...a, ...fs])}
              onDetach={(i) => setAttachments((a) => a.filter((_, j) => j !== i))}
              onSubmit={submitComposer}
              onClose={closeComposer}
            />
          ) : null}
          {dragging ? <DropOverlay subjectName={dropSubjectName} intoComposer={open} /> : null}
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
  onClose,
}: {
  me: MeResponse;
  closing: boolean;
  subjects: SubjectRow[];
  subjectId: string;
  onSubject: (id: string) => void;
  onSubjectsChanged: () => Promise<void>;
  text: string;
  onText: (t: string) => void;
  attachments: File[];
  onAttach: (files: File[]) => void;
  onDetach: (i: number) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

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
  const trimmed = text.trim();
  const { textAsSource } = splitComposer(text, attachments.length);
  const textReady = textAsSource !== null && trimmed.length >= MIN_TEXT_CHARS;
  const canSend = !!subjectId && me.aiEnabled && (attachments.length > 0 || textReady);
  const model = clientModel(me, me.settings.models.organize);
  const est = textReady ? estimateEnergy({ kind: 'text', chars: trimmed.length }, model, me.usdPerEnergy) : 0;
  const left = me.energy.unlimited ? null : Math.floor(me.energy.remaining ?? 0);

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
          if (canSend) onSubmit();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="relative">
            <button
              type="button"
              className="press inline-flex max-w-[220px] items-center gap-2 rounded-full bg-surface-2 py-1.5 pl-3 pr-2.5 text-sm font-semibold"
              aria-haspopup="listbox"
              aria-expanded={picking}
              onClick={() => setPicking((p) => !p)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(subject?.color) }} aria-hidden="true" />
              <span className="truncate">{subject?.name ?? '과목 고르기'}</span>
              <span className="text-muted" aria-hidden="true">
                ▾
              </span>
            </button>
            {picking ? (
              <div
                className="kok-pop absolute left-0 top-10 z-10 grid max-h-72 w-60 origin-top-left gap-0.5 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-[0_12px_32px_var(--shadow-strong)] ring-1 ring-line sm:bottom-10 sm:top-auto sm:origin-bottom-left"
                role="listbox"
                aria-label="과목"
              >
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={s.id === subjectId}
                    className={cx('flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[15px] hover:bg-surface-2', s.id === subjectId && 'font-bold')}
                    onClick={() => {
                      onSubject(s.id);
                      setPicking(false);
                      area.current?.focus();
                    }}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {s.id === subjectId ? <Icon d={ICONS.check} size={16} className="text-accent" /> : null}
                  </button>
                ))}
                <div className="mt-1 flex gap-1.5 border-t border-line px-1 pt-2">
                  <input
                    aria-label="새 과목 이름"
                    className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-1.5 text-sm focus:outline-none"
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
          <span className="text-xs font-semibold text-muted">
            {[est ? `⚡ 약 ${est}` : '', left !== null ? `남음 ${left}` : ''].filter(Boolean).join(' · ')}
          </span>
        </div>

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
              else if (!attachments.length && trimmed) toast(`${MIN_TEXT_CHARS}자 이상 적어 주세요. (지금 ${trimmed.length}자)`);
            }
          }}
          aria-label="공부한 내용"
        />

        {attachments.length ? (
          <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5" aria-label="붙인 파일">
            {attachments.map((f, i) => (
              <AttachmentChip key={`${f.name}-${i}`} file={f} onRemove={() => onDetach(i)} />
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf,.pdf,image/*,.txt,.md"
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
            onClick={() => fileInput.current?.click()}
          >
            <Icon d={ICONS.clip} size={21} />
          </button>
          <button
            type="button"
            className="press grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="사진 찍기"
            onClick={() => cameraInput.current?.click()}
          >
            <Icon d={ICONS.camera} size={21} />
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
        {!me.aiEnabled ? <p className="text-xs font-semibold text-bad">지금은 AI 기능을 잠깐 쉬고 있어요.</p> : null}
        {trimmed && !attachments.length && trimmed.length < MIN_TEXT_CHARS ? (
          <p className="-mt-1 px-1 text-xs text-muted">
            {MIN_TEXT_CHARS}자 이상 적으면 정리할 수 있어요 ({trimmed.length}/{MIN_TEXT_CHARS})
          </p>
        ) : null}
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
              kind === 'pdf' ? 'bg-bad-soft text-bad' : kind === 'text' ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted',
            )}
          >
            <Icon d={kind === 'pdf' ? ICONS.file : ICONS.pen} size={20} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold">{file.name}</span>
            <span className="block text-[11px] text-muted">
              {kind === 'pdf' ? 'PDF' : kind === 'text' ? '글 파일' : '파일'} · {Math.max(1, Math.round(file.size / 1024))}KB
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
function DropOverlay({ subjectName, intoComposer }: { subjectName: string; intoComposer: boolean }) {
  return (
    <div className="kok-drop pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-[color-mix(in_srgb,var(--bg)_72%,transparent)] p-6 backdrop-blur-[6px]">
      <div className="kok-drop-card relative grid w-full max-w-md justify-items-center gap-3 rounded-[32px] bg-surface px-8 py-12 text-center shadow-2xl">
        <svg className="pointer-events-none absolute inset-3 h-[calc(100%-24px)] w-[calc(100%-24px)] overflow-visible" aria-hidden="true">
          <rect className="kok-dash" x="0" y="0" width="100%" height="100%" rx="22" fill="none" stroke="var(--fab)" strokeWidth="2.5" strokeDasharray="10 14" />
        </svg>
        <div className="kok-float grid h-16 w-16 place-items-center rounded-full bg-fab text-fab-ink shadow-lg">
          <Icon d={ICONS.upload} size={30} strokeWidth={2.2} />
        </div>
        <p className="font-display text-xl">{intoComposer ? '여기에 놓으면 입력창에 붙여요' : '여기에 놓으면 콕이 정리해요'}</p>
        <p className="text-sm text-muted">
          PDF · 사진 · 글 파일
          {!intoComposer && subjectName ? (
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
              <span className={cx('line-clamp-2 text-xs', it.status === 'error' ? 'text-bad' : it.status === 'done' ? 'text-ok' : 'text-muted')}>
                {it.status !== 'error' && subjectName(it.subjectId) ? `${subjectName(it.subjectId)} · ` : ''}
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
