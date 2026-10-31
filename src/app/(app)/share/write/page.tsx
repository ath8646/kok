'use client';
// 자료 공유 글쓰기·고치기 (?g=갤러리, ?edit=글): 갤러리 고르기, 제목·내용, 파일 붙이기(요금제마다 개수·크기), 내 KOK 노트 붙이기, 익명으로 쓰기(새 글만).
// 올리기: 파일 → 올리기 자리(/api/share/uploads) → 저장소 → 글(/api/share/posts). 고치기는 뺀 파일·더한 파일·노트만 보낸다(PATCH).
// 새 글은 쓰는 동안 이 기기에 적어 두었다가(파일 빼고) 다시 열면 이어서 쓴다
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type DragEvent } from 'react';
import { useMe } from '@/components/AppShell';
import { useAskText, useConfirm } from '@/components/Confirm';
import { GalleryPickSheet, GallerySheet, NotePickerSheet, type PickedNote } from '@/components/share/ShareSheets';
import { EmptyHint, KindTag, NotReady, ensureNickname, kindIcon } from '@/components/share/ShareUi';
import { toPicks, uploadPicks, type Pick, type Uploaded } from '@/components/share/upload';
import { ApiError, Button, Field, ICONS, Icon, LargeHeader, Toggle, api, cx, inputClass, useToast, DONE } from '@/components/ui';
import { fetchSubjects, sb } from '@/lib/data';
import { josa } from '@/lib/josa';
import {
  CATEGORY_LABEL,
  SHARE_ACCEPT,
  SHARE_KINDS_TEXT,
  SHARE_TEXT,
  fileSizeText,
  type FileView,
  type GalleryView,
  type NotePreview,
  type PostDetail,
} from '@/lib/share';

const MB = 1024 * 1024;
const DRAFT_KEY = (uid: string) => `kok:share-draft:v1:${uid}`;
type Draft = { galleryId: string | null; title: string; body: string; anonymous: boolean };

function readDraft(uid: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(uid));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.title !== 'string' || typeof d.body !== 'string' || (!d.title.trim() && !d.body.trim())) return null;
    return { galleryId: typeof d.galleryId === 'string' ? d.galleryId : null, title: d.title, body: d.body, anonymous: !!d.anonymous };
  } catch {
    return null;
  }
}
function saveDraft(uid: string, d: Draft | null) {
  try {
    if (!d || (!d.title.trim() && !d.body.trim())) localStorage.removeItem(DRAFT_KEY(uid));
    else localStorage.setItem(DRAFT_KEY(uid), JSON.stringify(d));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

export default function WritePage() {
  return (
    <Suspense fallback={null}>
      <WriteRoute />
    </Suspense>
  );
}

function WriteRoute() {
  const params = useSearchParams();
  const edit = params.get('edit');
  const g = params.get('g');
  const note = params.get('note');
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  // 다른 글을 고치러 오면 처음부터
  return <Write key={edit ?? 'new'} editId={uuid(edit)} galleryParam={uuid(g)} noteParam={uuid(note)} />;
}

function Write({ editId, galleryParam, noteParam }: { editId: string | null; galleryParam: string | null; noteParam: string | null }) {
  const { me, refresh } = useMe();
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const askText = useAskText();
  const uid = me?.userId ?? '';
  const [postId] = useState(() => editId ?? crypto.randomUUID());
  // 새 글: 이 기기에 적어 둔 쓰던 글 (파일 빼고)
  const [draft] = useState(() => (!editId && uid ? readDraft(uid) : null));
  const [gallery, setGallery] = useState<GalleryView | null>(null);
  const [title, setTitle] = useState(draft?.title ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [anonymous, setAnonymous] = useState(draft?.anonymous ?? false);
  const [picks, setPicks] = useState<Pick[]>([]);
  /** 고치기: 지금 붙은 파일과 뺄 파일 */
  const [existing, setExisting] = useState<FileView[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  /** 고치기: 지금 붙은 노트 (undefined = 새 글) */
  const [oldNote, setOldNote] = useState<NotePreview | null>(null);
  const [note, setNote] = useState<PickedNote | null>(null);
  /** 고치기에서 노트를 뗐는지 */
  const [noteRemoved, setNoteRemoved] = useState(false);
  const [mine, setMine] = useState(true);
  const [loaded, setLoaded] = useState(!editId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  // 글은 갤러리 안에서 쓴다: 갤러리에서 들어오면(?g=) 그 갤러리 그대로, 갤러리 없이 열리면 먼저 고른다 (고르지 않고 닫으면 나간다)
  const [picking, setPicking] = useState(() => !editId && !galleryParam && !draft?.galleryId);
  /** 처음에 갤러리를 고르는 중 (닫으면 글쓰기를 나간다) */
  const [mustPick, setMustPick] = useState(() => !editId && !galleryParam && !draft?.galleryId);
  /** 고르는 창에서 갤러리를 골랐거나 '새 갤러리 만들기'로 가는 중 (창이 닫혀도 나가지 않는다: 닫기는 고르기 바로 뒤에 불려서 상태가 아직 옛것이다) */
  const pickDone = useRef(false);
  /** 새 갤러리를 만들었다 (만들기 창이 닫혀도 다시 고르기로 가지 않는다) */
  const madeRef = useRef(false);
  const [making, setMaking] = useState(false);
  const [notePicking, setNotePicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [restored, setRestored] = useState(!!draft);
  const fileInput = useRef<HTMLInputElement>(null);
  /** 이미 올린 파일 (올리다 멈춰 다시 누르면 올린 것은 건너뛴다) */
  const uploadedRef = useRef(new Map<string, Uploaded>());
  /** 다 올리고 나가는 중 (떠나기 확인을 하지 않는다) */
  const doneRef = useRef(false);

  // 처음: 고치기면 글을, 새 글이면 고른 갤러리(?g=)와 쓰던 글
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    if (editId) {
      api<{ post: PostDetail }>(`/api/share/posts/${editId}?seen=1`)
        .then(({ post }) => {
          if (!alive) return;
          if (!post.canEdit) {
            setLoadError('내가 쓴 글만 고칠 수 있어요.');
            return;
          }
          setGallery(post.gallery);
          setTitle(post.title);
          setBody(post.body);
          setAnonymous(post.anonymous);
          setExisting(post.files);
          setOldNote(post.note);
          setMine(post.mine);
          setLoaded(true);
        })
        .catch((e) => {
          if (!alive) return;
          if (e instanceof ApiError && e.code === 'not_ready') setNotReady(true);
          else setLoadError((e as Error).message);
        });
      return () => {
        alive = false;
      };
    }
    const galleryId = galleryParam ?? draft?.galleryId ?? null;
    if (galleryId) {
      api<{ gallery: GalleryView }>(`/api/share/galleries/${galleryId}`)
        .then((r) => alive && setGallery(r.gallery))
        .catch((e) => {
          if (!alive) return;
          if (e instanceof ApiError && e.code === 'not_ready') setNotReady(true);
        });
    }
    return () => {
      alive = false;
    };
  }, [uid, editId, galleryParam, draft]);

  // 노트 화면의 '자료 공유에 올리기'(?note=): 그 노트를 붙인 채로 시작한다 (정리가 끝난 내 노트만)
  useEffect(() => {
    if (!uid || editId || !noteParam) return;
    let alive = true;
    Promise.all([sb().from('sources').select('id, title, subject_id, status').eq('id', noteParam).maybeSingle(), fetchSubjects()])
      .then(([{ data }, subjects]) => {
        if (!alive || !data || data.status !== 'ready') return;
        const subject = subjects.find((x) => x.id === data.subject_id)?.name ?? '';
        setNote((cur) => cur ?? { sourceId: String(data.id), title: String(data.title || '이름 없는 노트'), subject });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uid, editId, noteParam]);

  // 새 글: 쓰는 동안 이 기기에 적어 둔다 (파일은 빼고)
  useEffect(() => {
    if (!uid || editId || doneRef.current) return;
    const t = setTimeout(() => saveDraft(uid, { galleryId: gallery?.id ?? null, title, body, anonymous }), 400);
    return () => clearTimeout(t);
  }, [uid, editId, gallery, title, body, anonymous]);

  const kept = existing.filter((f) => !removed.has(f.id));
  const fileCount = kept.length + picks.length;
  const filesMax = me?.share.files ?? 0;
  const fileMb = me?.share.fileMb ?? 0;
  const dirty = editId ? false : !!(title.trim() || body.trim() || picks.length || note);

  // 파일을 붙였거나 새 글을 쓰는 중이면 창을 닫을 때 한 번 묻는다 (쓴 글은 이 기기에 남지만 파일은 남지 않는다)
  useEffect(() => {
    if (!picks.length && !(editId && loaded)) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (doneRef.current) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [picks.length, editId, loaded]);

  if (!me) return null;
  if (notReady) return <NotReady />;
  if (loadError) {
    return (
      <div className="grid gap-3">
        <LargeHeader size="compact" back={{ href: '/share', label: '자료 공유로' }} title="글을 고칠 수 없어요" />
        <EmptyHint title="글을 열 수 없어요" body={loadError} action={<Button onClick={() => router.push('/share')}>자료 공유로</Button>} />
      </div>
    );
  }

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    const { picks: ok, refused } = toPicks(files);
    if (refused.length) toast(`${josa(`'${refused[0]}'`, '은')} 올릴 수 없는 파일이에요. ${SHARE_KINDS_TEXT}만 올릴 수 있어요.`, 'bad');
    const big = ok.filter((p) => p.file.size > fileMb * MB);
    if (big.length) toast(`${josa(`'${big[0].file.name}'`, '이')} 너무 커요. 파일 한 개는 ${fileMb}MB까지예요.`, 'bad');
    const fresh = ok.filter((p) => p.file.size <= fileMb * MB && p.file.size > 0);
    const room = Math.max(0, filesMax - fileCount);
    if (fresh.length > room) toast(`글 하나에 파일은 ${filesMax}개까지 붙일 수 있어요.`, 'bad');
    if (room > 0) setPicks((cur) => [...cur, ...fresh.slice(0, room)]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!mine || busy) return;
    addFiles([...e.dataTransfer.files]);
  };

  const submit = async () => {
    if (busy) return;
    const t = title.replace(/\s+/g, ' ').trim();
    if (!gallery) {
      toast('글을 올릴 갤러리를 골라 주세요.', 'bad');
      setPicking(true);
      return;
    }
    if (!t) {
      toast('제목을 적어 주세요.', 'bad');
      document.getElementById('post-title')?.focus();
      return;
    }
    if (!editId && !anonymous && !(await ensureNickname(me, askText, refresh, toast))) return;
    setBusy(true);
    try {
      // 파일 올리기 (이미 올린 것은 건너뛴다)
      const todo = picks.filter((p) => !uploadedRef.current.has(p.key));
      if (todo.length) {
        const done = await uploadPicks(postId, todo, (d, total) => setStep(`파일 올리는 중 ${d}/${total}`));
        todo.forEach((p, i) => uploadedRef.current.set(p.key, done[i]));
      }
      const files = picks.map((p) => uploadedRef.current.get(p.key)).filter((u): u is Uploaded => !!u);
      setStep(editId ? '저장하는 중…' : '올리는 중…');
      if (editId) {
        const patch: Record<string, unknown> = { title: t, body };
        if (removed.size) patch.removeFiles = [...removed];
        if (files.length) patch.addFiles = files;
        if (note) patch.note = note.sourceId;
        else if (noteRemoved) patch.note = null;
        await api(`/api/share/posts/${editId}`, { method: 'PATCH', body: JSON.stringify(patch) });
        doneRef.current = true;
        toast('글을 고쳤어요.', 'ok', DONE);
        router.replace(`/share/p/${editId}`);
      } else {
        await api('/api/share/posts', {
          method: 'POST',
          body: JSON.stringify({ id: postId, galleryId: gallery.id, title: t, body, anonymous, files, noteSourceId: note?.sourceId ?? null }),
        });
        doneRef.current = true;
        saveDraft(uid, null);
        toast('글을 올렸어요.', 'ok', DONE);
        router.replace(`/share/p/${postId}`);
      }
    } catch (e) {
      // 글은 만들어졌는데 답을 못 받았으면 (다시 눌렀을 때) 그 글로 간다
      if (e instanceof ApiError && e.code === 'duplicate' && !editId) {
        doneRef.current = true;
        saveDraft(uid, null);
        router.replace(`/share/p/${postId}`);
        return;
      }
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const leave = async () => {
    if (
      dirty &&
      !(await ask({
        title: '쓰던 글',
        body: '글쓰기를 그만둘까요?',
        note: picks.length
          ? '붙인 파일은 남지 않아요. 쓴 글은 이 기기에 남아 다음에 이어서 쓸 수 있어요.'
          : '쓴 글은 이 기기에 남아 다음에 이어서 쓸 수 있어요.',
        ok: '그만두기',
        cancel: '계속 쓰기',
      }))
    )
      return;
    doneRef.current = true;
    router.push(editId ? `/share/p/${editId}` : gallery ? `/share/g/${gallery.id}` : '/share');
  };

  const startOver = async () => {
    const ok = await ask({ title: '새로 쓰기', body: '쓰던 글을 지우고 새로 쓸까요?', ok: '지우고 새로 쓰기', danger: true });
    if (!ok) return;
    setTitle('');
    setBody('');
    setAnonymous(false);
    setRestored(false);
    saveDraft(uid, null);
  };

  const submitLabel = editId ? '저장' : '올리기';
  const noteShown = note ? { title: note.title, subject: note.subject } : oldNote && !noteRemoved ? { title: oldNote.title, subject: oldNote.subject } : null;

  return (
    <div className="grid gap-3 pb-8">
      <LargeHeader
        size="compact"
        title={editId ? '글 고치기' : '글쓰기'}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => void leave()} disabled={busy}>
              그만두기
            </Button>
            <Button size="sm" onClick={() => void submit()} busy={busy} disabled={!loaded}>
              {submitLabel}
            </Button>
          </>
        }
      />

      {!loaded ? (
        <div className="kok-skel grid gap-3" aria-hidden="true">
          <div className="kok-card kok-shimmer h-16" />
          <div className="kok-card kok-shimmer h-64" />
        </div>
      ) : (
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {restored && !editId ? (
            <div className="kok-card flex items-center gap-3 px-4 py-3" role="status">
              <p className="min-w-0 flex-1 text-sm">쓰던 글을 불러왔어요.</p>
              <Button size="sm" variant="ghost" onClick={() => void startOver()}>
                새로 쓰기
              </Button>
            </div>
          ) : null}

          {/* 갤러리 */}
          <div className="kok-card flex items-center gap-3 p-3.5">
            <span className="kok-well grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
              <Icon d={gallery?.official ? ICONS.crown : ICONS.users} size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">올릴 갤러리</p>
              <p className="truncate font-semibold">{gallery ? gallery.name : '갤러리를 골라 주세요'}</p>
              {gallery ? <p className="text-xs text-muted">{CATEGORY_LABEL[gallery.category]}</p> : null}
            </div>
            {/* 갤러리 안에서 쓰는 글은 갤러리를 바꾸지 않는다 */}
            {!editId && !galleryParam ? (
              <Button size="sm" variant={gallery ? 'secondary' : 'primary'} onClick={() => setPicking(true)}>
                {gallery ? '바꾸기' : '고르기'}
              </Button>
            ) : null}
          </div>

          {/* 제목·내용 */}
          <div className="kok-card grid gap-3 p-4">
            <Field label="제목" htmlFor="post-title" hint={`${title.length}/${SHARE_TEXT.title}`}>
              <input
                id="post-title"
                className={inputClass}
                value={title}
                maxLength={SHARE_TEXT.title}
                placeholder="예: 중2 과학 1단원 정리 노트"
                onChange={(e) => setTitle(e.target.value)}
                enterKeyHint="next"
              />
            </Field>
            <Field label="내용" htmlFor="post-body" hint={`${body.length.toLocaleString('ko-KR')}/${SHARE_TEXT.body.toLocaleString('ko-KR')}`}>
              <textarea
                id="post-body"
                className={cx(inputClass, 'min-h-[180px] resize-y leading-relaxed')}
                value={body}
                maxLength={SHARE_TEXT.body}
                placeholder="어떤 자료인지, 어떻게 쓰면 좋은지 적어 주세요. 궁금한 것을 물어봐도 좋아요."
                onChange={(e) => setBody(e.target.value)}
                onPaste={(e) => {
                  // 사진·파일을 붙여 넣으면 파일로 붙인다
                  const files = [...e.clipboardData.files];
                  if (files.length && mine) {
                    e.preventDefault();
                    addFiles(files);
                  }
                }}
              />
            </Field>
            {!editId ? (
              <Toggle
                id="post-anon"
                label="익명으로 쓰기"
                hint="닉네임 대신 '익명'으로 보여요. 규칙을 어긴 글은 운영자가 쓴 사람을 확인해요."
                checked={anonymous}
                onChange={setAnonymous}
              />
            ) : anonymous ? (
              <p className="text-sm text-muted">익명으로 쓴 글이에요.</p>
            ) : null}
          </div>

          {/* 파일 */}
          <section
            className={cx('kok-card grid gap-3 p-4 transition-shadow', dragging && 'ring-2 ring-accent')}
            aria-labelledby="post-files"
            onDragOver={(e) => {
              if (!mine || ![...e.dataTransfer.types].includes('Files')) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={onDrop}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="post-files" className="font-semibold">
                파일{' '}
                <span className="text-sm font-normal text-muted tabular-nums">
                  {fileCount}/{filesMax}
                </span>
              </h2>
              {mine ? (
                <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy || fileCount >= filesMax}>
                  <Icon d={ICONS.clip} size={16} />
                  파일 붙이기
                </Button>
              ) : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={SHARE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            {kept.length || picks.length ? (
              <ul className="grid gap-2" aria-label="붙인 파일">
                {kept.map((f) => (
                  <FileLine
                    key={f.id}
                    name={f.name}
                    meta={`${fileSizeText(f.size)}${f.pages ? ` · ${f.pages}쪽` : ''}`}
                    kindEl={<KindTag kind={f.kind} raised />}
                    thumb={f.previewUrl ? <ThumbImg src={f.previewUrl} /> : <Icon d={kindIcon(f.kind)} size={22} className="text-muted" />}
                    onRemove={busy ? undefined : () => setRemoved((cur) => new Set([...cur, f.id]))}
                  />
                ))}
                {picks.map((p) => (
                  <FileLine
                    key={p.key}
                    name={p.file.name}
                    meta={`${fileSizeText(p.file.size)} · 새 파일`}
                    kindEl={<KindTag kind={p.kind} raised />}
                    thumb={p.kind === 'image' ? <PickImg file={p.file} /> : <Icon d={kindIcon(p.kind)} size={22} className="text-muted" />}
                    onRemove={busy ? undefined : () => setPicks((cur) => cur.filter((x) => x.key !== p.key))}
                  />
                ))}
              </ul>
            ) : mine ? (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="press grid justify-items-center gap-1 rounded-2xl border-2 border-dashed border-line px-4 py-6 text-center hover:bg-surface-2"
              >
                <Icon d={ICONS.upload} size={24} className="text-muted" />
                <span className="text-sm font-semibold">눌러서 고르거나 여기에 끌어다 놓기</span>
                <span className="text-xs text-muted">
                  {SHARE_KINDS_TEXT} · 파일 한 개 {fileMb}MB까지
                </span>
              </button>
            ) : (
              <p className="text-sm text-muted">붙인 파일이 없어요.</p>
            )}
            {editId && removed.size ? (
              <p className="flex items-center gap-2 text-xs text-muted">
                파일 {removed.size}개를 빼요.
                <button type="button" className="press font-semibold text-ink underline underline-offset-2" onClick={() => setRemoved(new Set())}>
                  되돌리기
                </button>
              </p>
            ) : null}
          </section>

          {/* KOK 노트 */}
          {mine ? (
            <section className="kok-card grid gap-3 p-4" aria-labelledby="post-note">
              <div className="flex items-center justify-between gap-2">
                <h2 id="post-note" className="font-semibold">
                  KOK 노트
                </h2>
                {!noteShown ? (
                  <Button size="sm" variant="secondary" onClick={() => setNotePicking(true)} disabled={busy}>
                    <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />내 노트 붙이기
                  </Button>
                ) : null}
              </div>
              {noteShown ? (
                <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                  <span className="kok-well grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
                    <Icon d={ICONS.mindmap} size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{noteShown.title}</p>
                    <p className="truncate text-xs text-muted">
                      {noteShown.subject ? `${noteShown.subject} · ` : ''}
                      {note ? '정리·마인드맵·문제가 담겨요' : '지금 붙어 있는 노트'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setNotePicking(true)} disabled={busy}>
                    바꾸기
                  </Button>
                  <button
                    type="button"
                    aria-label="노트 떼기"
                    title="노트 떼기"
                    disabled={busy}
                    className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-3 disabled:opacity-45"
                    onClick={() => {
                      setNote(null);
                      if (oldNote) setNoteRemoved(true);
                    }}
                  >
                    <Icon d={ICONS.close} size={17} />
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  내 노트를 붙이면 받은 사람이 정리·마인드맵·문제를 에너지 없이 자기 자료함에 넣을 수 있어요. 내 별표·메모는 담기지 않아요.
                </p>
              )}
            </section>
          ) : null}

          <div className="kok-card grid gap-1.5 px-4 py-3.5 text-[13px] leading-relaxed text-muted">
            <p className="font-semibold text-ink">올리기 전에 확인해 주세요</p>
            <p>· 내가 만든 자료나 나눠도 되는 자료만 올려요. 교재·문제집을 찍거나 스캔한 것, 학원·학교 자료를 허락 없이 올리면 안 돼요.</p>
            <p>· 이름·학교·연락처 같은 개인정보는 적지 않아요.</p>
            <p>· 신고가 쌓이면 글이 가려지고, 규칙을 어기면 글이 지워지거나 글을 쓸 수 없게 될 수 있어요.</p>
          </div>

          <Button type="submit" size="lg" className="w-full" busy={busy} disabled={!loaded}>
            {step ?? (editId ? '저장하기' : '글 올리기')}
          </Button>
        </form>
      )}

      <GalleryPickSheet
        open={picking}
        onClose={() => {
          setPicking(false);
          // 갤러리 없이 연 글쓰기에서 고르지 않고 닫으면 나간다 (새 갤러리 만들기로 가는 중이면 그대로)
          if (pickDone.current) {
            pickDone.current = false;
            return;
          }
          if (mustPick && !gallery) {
            doneRef.current = true;
            if (window.history.length > 1) router.back();
            else router.replace('/share');
          }
        }}
        onPick={(g) => {
          pickDone.current = true;
          setMustPick(false);
          setGallery(g);
        }}
        onMake={() => {
          pickDone.current = true;
          setMaking(true);
        }}
      />
      <GallerySheet
        open={making}
        onClose={() => {
          setMaking(false);
          if (madeRef.current) {
            madeRef.current = false;
            return;
          }
          // 만들지 않고 닫았으면 다시 고르기로
          if (mustPick && !gallery) setPicking(true);
        }}
        onSaved={(g) => {
          madeRef.current = true;
          setMustPick(false);
          setGallery(g);
        }}
      />
      <NotePickerSheet
        open={notePicking}
        onClose={() => setNotePicking(false)}
        onPick={(n) => {
          setNote(n);
          setNoteRemoved(false);
        }}
      />
    </div>
  );
}

function FileLine({
  name,
  meta,
  kindEl,
  thumb,
  onRemove,
}: {
  name: string;
  meta: string;
  kindEl: React.ReactNode;
  thumb: React.ReactNode;
  onRemove?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface-2 p-2.5">
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface">{thumb}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          {kindEl}
          <span className="tabular-nums">{meta}</span>
        </p>
      </div>
      {onRemove ? (
        <button
          type="button"
          aria-label={`${name} 빼기`}
          title="빼기"
          onClick={onRemove}
          className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-3"
        >
          <Icon d={ICONS.close} size={17} />
        </button>
      ) : null}
    </li>
  );
}

function ThumbImg({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-full w-full object-cover" />;
}

/** 고른 사진의 작은 그림 (그림을 다 불러온 뒤 주소를 돌려준다) */
function PickImg({ file }: { file: File }) {
  const [url] = useState(() => URL.createObjectURL(file));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-full w-full object-cover" onLoad={() => URL.revokeObjectURL(url)} onError={() => URL.revokeObjectURL(url)} />
  );
}
