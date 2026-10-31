'use client';
// 자료 공유 글 하나: 내용, 파일(미리보기 → 받기 → 열기·내려받기·KOK으로 정리), 붙인 KOK 노트(내 자료함에 넣기), 좋아요, 댓글.
// 받기는 하루에 받을 수 있는 글 수가 요금제마다 있다 (한 번 받은 글은 언제든 다시 연다, 내 글·운영자는 세지 않는다).
// 쓴 사람·운영자는 고치기, 쓴 사람·갤러리 만든 사람·운영자는 지우기. 다시 들어오면 기억해 둔 화면(share:p:<id>)부터 그린다
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { useConfirm } from '@/components/Confirm';
import { PdfViewer } from '@/components/PdfViewer';
import { AiMark } from '@/components/ReportSheet';
import { SubjectPickSheet } from '@/components/SubjectPick';
import { ImageViewer } from '@/components/chat/ChatKit';
import { Comments } from '@/components/share/Comments';
import { DownloadLimitSheet, ImportSheet, ShareReportSheet } from '@/components/share/ShareSheets';
import { EmptyHint, KindTag, LikeButton, NotReady, kindIcon } from '@/components/share/ShareUi';
import { fileAsFile, fileUrl } from '@/components/share/upload';
import { ApiError, Button, ICONS, Icon, LargeHeader, Menu, Sheet, Spinner, api, cx, useToast, DONE, type MenuItem } from '@/components/ui';
import { fetchSubjects } from '@/lib/data';
import { handOffFiles } from '@/lib/events';
import { josa } from '@/lib/josa';
import { previewText } from '@/lib/richtext';
import { pickerOrder } from '@/lib/subject-order';
import { readView, viewStamp, writeView } from '@/lib/view-cache';
import { countText, fileSizeText, organizable, timeAgo, type FileView, type PostDetail } from '@/lib/share';
import type { SubjectRow } from '@/lib/types';

/** 이 탭에서 이미 연 글 (다시 읽을 때는 연 수를 세지 않는다) */
const viewed = new Set<string>();
/** 앱 안에서 바로 여는 파일 (나머지는 내려받기) */
const viewable = (f: FileView) => f.kind === 'pdf' || f.kind === 'image' || f.kind === 'txt';
/** 글 파일을 앱 안에서 보일 때의 끝 (글자) */
const TEXT_SHOW_MAX = 200_000;

type LoadError = { code: string; message: string };

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const owner = me?.userId;
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const key = `share:p:${id}`;
  const [post, setPost] = useState<PostDetail | null>(() => readView<PostDetail>(key, owner) ?? null);
  const [error, setError] = useState<LoadError | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [importing, setImporting] = useState(false);
  /** KOK으로 정리할 파일 (과목 고르기 창) */
  const [organizing, setOrganizing] = useState<FileView[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [pdf, setPdf] = useState<{ file: FileView; url: string } | null>(null);
  const [image, setImage] = useState<{ file: FileView; url: string } | null>(null);
  const [text, setText] = useState<{ file: FileView; body: string | null } | null>(null);
  /** 파일을 여는 중 (그 줄에 도는 표시) */
  const [opening, setOpening] = useState<string | null>(null);

  // 다른 글로 옮겨 가면 그 글의 기억부터
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setPost(readView<PostDetail>(key, owner) ?? null);
    setError(null);
  }

  /** 글 읽기 (이 탭에서 처음 여는 글만 연 수를 센다) */
  const fetchPost = useCallback(() => {
    const again = viewed.has(id);
    viewed.add(id);
    return api<{ post: PostDetail }>(`/api/share/posts/${id}${again ? '?seen=1' : ''}`).then((r) => r.post);
  }, [id]);
  const failed = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.code === 'not_ready') setNotReady(true);
    else setError({ code: e instanceof ApiError ? e.code : 'unknown', message: (e as Error).message });
  }, []);

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const stamp = viewStamp(key);
    fetchPost()
      .then((next) => {
        if (!alive) return;
        setPost(next);
        setError(null);
        writeView(key, owner, next, { stamp });
      })
      .catch((e) => alive && failed(e));
    return () => {
      alive = false;
    };
  }, [owner, key, fetchPost, failed]);

  /** 댓글을 달거나 지운 뒤 다시 읽기 */
  const reload = useCallback(async () => {
    if (!owner) return;
    const stamp = viewStamp(key);
    try {
      const next = await fetchPost();
      setPost(next);
      writeView(key, owner, next, { stamp });
    } catch (e) {
      failed(e);
    }
  }, [owner, key, fetchPost, failed]);

  // KOK으로 정리할 과목 목록 (창을 열 때)
  useEffect(() => {
    if (!organizing) return;
    let alive = true;
    fetchSubjects()
      .then((s) => alive && setSubjects(pickerOrder(s, null)))
      .catch(() => alive && toast('과목을 불러오지 못했어요.', 'bad'));
    return () => {
      alive = false;
    };
  }, [organizing, toast]);

  if (!me) return null;
  if (notReady) return <NotReady />;

  if (!post) {
    if (error) {
      const blocked = error.code === 'blocked';
      return (
        <div className="grid gap-3">
          <LargeHeader size="compact" back={{ href: '/share', label: '자료 공유로' }} title={blocked ? '차단한 사람의 글' : '글을 열 수 없어요'} />
          <EmptyHint
            title={error.code === 'hidden' ? '가려진 글이에요' : blocked ? '차단한 사람의 글이에요' : '지워졌거나 없는 글이에요'}
            body={error.message}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {blocked ? (
                  <Button variant="secondary" onClick={() => router.push('/share/me?tab=blocks')}>
                    차단 목록
                  </Button>
                ) : null}
                <Button onClick={() => router.push('/share')}>자료 공유로</Button>
              </div>
            }
          />
        </div>
      );
    }
    return <PostLoading />;
  }

  const p = post;
  const back = { href: `/share/g/${p.galleryId}`, label: `${p.galleryName || '갤러리'}로` };
  const material = p.files.length > 0 || !!p.note;
  const organizableFiles = p.files.filter((f) => organizable(f.kind));

  // ---------------------------------------------------------- 받기
  const unlock = async (): Promise<boolean> => {
    if (p.unlocked) return true;
    if (p.downloadsDaily !== null && (p.downloadsLeft ?? 0) <= 0) {
      setLimitOpen(true);
      return false;
    }
    setUnlocking(true);
    try {
      const r = await api<{ left: number | null; daily: number | null }>(`/api/share/posts/${id}/unlock`, { method: 'POST' });
      setPost((cur) => (cur ? { ...cur, unlocked: true, downloads: cur.downloads + 1, downloadsLeft: r.left, downloadsDaily: r.daily } : cur));
      toast(r.daily === null ? '자료를 받았어요.' : `자료를 받았어요. 오늘 ${r.left ?? 0}개 더 받을 수 있어요.`, 'ok', DONE);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'download_limit') {
        setPost((cur) => (cur ? { ...cur, downloadsLeft: 0 } : cur));
        setLimitOpen(true);
      } else toast((e as Error).message, 'bad');
      return false;
    } finally {
      setUnlocking(false);
    }
  };

  // ---------------------------------------------------------- 파일
  const download = async (f: FileView) => {
    try {
      const r = await fileUrl(f.id, true);
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const open = async (f: FileView) => {
    if (!viewable(f)) return download(f);
    if (opening) return;
    setOpening(f.id);
    try {
      if (f.kind === 'txt') {
        setText({ file: f, body: null });
        const r = await fileUrl(f.id, false);
        const res = await fetch(r.url);
        if (!res.ok) throw new Error('파일을 열지 못했어요. 다시 해 주세요.');
        const bytes = new Uint8Array(await res.arrayBuffer());
        setText({ file: f, body: decodeText(bytes).slice(0, TEXT_SHOW_MAX) });
        return;
      }
      const r = await fileUrl(f.id, false);
      if (f.kind === 'pdf') setPdf({ file: f, url: r.url });
      else setImage({ file: f, url: r.url });
    } catch (e) {
      setText(null);
      toast((e as Error).message, 'bad');
    } finally {
      setOpening(null);
    }
  };

  /** 고른 과목에 자료 넣기로 넘긴다 (자료함에서 정리가 시작된다) */
  const organizeInto = async (files: FileView[], subject: SubjectRow): Promise<boolean> => {
    try {
      const got = await Promise.all(files.map((f) => fileAsFile(f.id)));
      handOffFiles(got, subject.id);
      router.push(`/library/${subject.id}`);
      return true;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return false;
    }
  };

  // ---------------------------------------------------------- 좋아요·메뉴
  const like = async () => {
    if (likeBusy) return;
    const on = !p.liked;
    setLikeBusy(true);
    setPost((cur) => (cur ? { ...cur, liked: on, likes: Math.max(0, cur.likes + (on ? 1 : -1)) } : cur));
    try {
      const r = await api<{ likes: number }>(`/api/share/posts/${id}/like`, { method: 'POST', body: JSON.stringify({ on }) });
      setPost((cur) => (cur ? { ...cur, liked: on, likes: r.likes } : cur));
    } catch (e) {
      setPost((cur) => (cur ? { ...cur, liked: !on, likes: Math.max(0, cur.likes + (on ? -1 : 1)) } : cur));
      toast((e as Error).message, 'bad');
    } finally {
      setLikeBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/p/${id}`);
      toast('링크를 복사했어요.', 'ok', DONE);
    } catch {
      toast('링크를 복사하지 못했어요.', 'bad');
    }
  };

  const remove = async () => {
    const byManager = !p.mine;
    const ok = await ask({
      title: '글 지우기',
      body: `${josa(`'${p.title}'`, '을')} 지울까요?`,
      note: byManager
        ? me.isAdmin
          ? '운영자로 지워요. 파일·노트·댓글이 모두 지워져요.'
          : '내가 만든 갤러리의 글이라 지울 수 있어요. 파일·노트·댓글이 모두 지워져요.'
        : '붙인 파일과 노트, 댓글이 모두 지워져요. 되돌릴 수 없어요.',
      ok: '지우기',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/share/posts/${id}`, { method: 'DELETE' });
      toast('글을 지웠어요.', 'ok', DONE);
      router.replace(`/share/g/${p.galleryId}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const block = async () => {
    const ok = await ask({
      title: '글쓴이 차단',
      body: p.anonymous ? '이 글을 쓴 사람을 차단할까요?' : `${p.authorName}님을 차단할까요?`,
      note: '이 사람이 쓴 글과 댓글이 내 화면에서 보이지 않아요. 내 활동의 차단 목록에서 언제든 풀 수 있어요.',
      ok: '차단',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('/api/share/blocks', { method: 'POST', body: JSON.stringify({ post: id }) });
      toast('차단했어요.', 'ok', DONE);
      router.replace(`/share/g/${p.galleryId}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const setHidden = async (hidden: boolean) => {
    try {
      await api(`/api/share/posts/${id}/hide`, { method: 'POST', body: JSON.stringify({ hidden }) });
      setPost((cur) => (cur ? { ...cur, hidden } : cur));
      toast(hidden ? '글을 가렸어요.' : '글을 다시 보이게 했어요.', 'ok', DONE);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const menu: MenuItem[] = [
    { label: '링크 복사', icon: ICONS.link, onSelect: copyLink },
    ...(p.canEdit ? [{ label: '고치기', icon: ICONS.pen, onSelect: () => router.push(`/share/write?edit=${id}`) }] : []),
    ...(me.isAdmin ? [{ label: p.hidden ? '다시 보이기' : '가리기 (운영자)', icon: ICONS.eye, onSelect: () => setHidden(!p.hidden) }] : []),
    ...(!p.mine ? [{ label: '신고', icon: ICONS.flag, onSelect: () => setReporting(true) }] : []),
    ...(!p.mine ? [{ label: '글쓴이 차단', icon: ICONS.block, onSelect: block, danger: true }] : []),
    ...(p.canDelete ? [{ label: '지우기', icon: ICONS.trash, onSelect: remove, danger: true }] : []),
  ];

  const fileMenu = (f: FileView): MenuItem[] => [
    ...(viewable(f) ? [{ label: '열기', icon: ICONS.eye, onSelect: () => open(f) }] : []),
    { label: '내려받기', icon: ICONS.download, onSelect: () => download(f) },
    ...(organizable(f.kind) ? [{ label: 'KOK으로 정리', icon: ICONS.sparkle, onSelect: () => setOrganizing([f]) }] : []),
  ];

  return (
    <div className="grid gap-3 pb-6">
      <LargeHeader
        size="compact"
        back={back}
        title={p.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Link href={`/share/g/${p.galleryId}`} className="font-semibold text-ink hover:underline">
              {p.galleryName}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{p.authorName}</span>
            {p.mine ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-ink">내 글</span> : null}
            <span aria-hidden="true">·</span>
            <span>{timeAgo(p.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>조회 {countText(p.views)}</span>
            {p.edited ? <span>· 고침</span> : null}
          </span>
        }
        actions={<Menu label="글 메뉴" items={menu} />}
      />

      {p.hidden ? (
        <div className="kok-card flex flex-wrap items-center gap-3 border-l-4 border-warn px-4 py-3" role="status">
          <Icon d={ICONS.eye} size={20} className="shrink-0 text-warn" />
          <p className="min-w-0 flex-1 text-sm">
            {me.isAdmin
              ? '가려진 글이에요. 쓴 사람과 운영자만 볼 수 있어요.'
              : '신고가 쌓여 가려진 글이에요. 운영자가 확인할 때까지 나와 운영자만 볼 수 있어요.'}
          </p>
          {me.isAdmin ? (
            <Button size="sm" variant="secondary" onClick={() => setHidden(false)}>
              다시 보이기
            </Button>
          ) : null}
        </div>
      ) : null}

      {p.realAuthor !== undefined && p.anonymous ? (
        <p className="kok-card px-4 py-3 text-sm text-muted">
          <b className="text-ink">운영자에게만 보여요</b> · 실제 글쓴이:{' '}
          {p.realAuthor ? `${p.realAuthor.nickname ?? '닉네임 없음'}${p.realAuthor.email ? ` (${p.realAuthor.email})` : ''}` : '알 수 없음(탈퇴)'}
        </p>
      ) : null}

      <article className="kok-card grid gap-4 p-4 md:p-5">
        {p.body ? (
          <p className="whitespace-pre-wrap break-words text-[16px] leading-[1.75]">{p.body}</p>
        ) : (
          <p className="text-[15px] text-muted">{material ? '내용 없이 자료만 올린 글이에요.' : '내용이 없는 글이에요.'}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <LikeButton liked={p.liked} count={p.likes} onToggle={like} busy={likeBusy} />
          {material ? (
            <span className="inline-flex items-center gap-1 text-sm text-muted tabular-nums">
              <Icon d={ICONS.download} size={15} strokeWidth={2.1} />
              받은 사람 {countText(p.downloads)}
            </span>
          ) : null}
        </div>
      </article>

      {material ? (
        <section className="kok-card grid gap-3 p-4 md:p-5" aria-labelledby="post-material">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="post-material" className="font-display text-lg">
              자료
              <span className="ml-1.5 text-sm font-semibold text-muted">
                {[p.files.length ? `파일 ${p.files.length}개` : '', p.note ? 'KOK 노트' : ''].filter(Boolean).join(' · ')}
              </span>
            </h2>
            {p.unlocked && organizableFiles.length > 1 ? (
              <Button size="sm" variant="secondary" onClick={() => setOrganizing(organizableFiles)}>
                <Icon d={ICONS.sparkle} size={15} />
                모두 KOK으로 정리
              </Button>
            ) : null}
          </div>

          {!p.unlocked ? (
            <div className="grid gap-3 rounded-2xl bg-accent-soft p-4">
              <div className="grid gap-1">
                <p className="font-semibold">자료를 받으면 열고 내려받을 수 있어요</p>
                <p className="text-sm text-ink/80">
                  {p.downloadsDaily === null
                    ? '받은 자료는 언제든 다시 열 수 있어요.'
                    : (p.downloadsLeft ?? 0) > 0
                      ? `오늘 ${p.downloadsLeft}개 더 받을 수 있어요 (하루 ${p.downloadsDaily}개). 받은 자료는 언제든 다시 열 수 있어요.`
                      : `오늘 받을 수 있는 자료 ${p.downloadsDaily}개를 다 받았어요. 내일 다시 받을 수 있어요.`}
                </p>
              </div>
              <Button size="lg" className="w-full" busy={unlocking} onClick={() => void unlock()}>
                <Icon d={ICONS.download} size={18} strokeWidth={2.2} />
                {p.downloadsDaily !== null && (p.downloadsLeft ?? 0) <= 0 ? '더 받는 방법 보기' : '자료 받기'}
              </Button>
            </div>
          ) : null}

          {p.files.length ? (
            <ul className="grid gap-2" aria-label="파일">
              {p.files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-2.5">
                  <FileThumb f={f} onOpen={p.unlocked ? () => void open(f) : undefined} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-all text-[15px] font-semibold leading-snug">{f.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <KindTag kind={f.kind} raised />
                      <span className="tabular-nums">{fileSizeText(f.size)}</span>
                      {f.pages ? <span className="tabular-nums">· {f.pages}쪽</span> : null}
                    </p>
                  </div>
                  {p.unlocked ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button size="sm" variant="ghost" className="px-3" busy={opening === f.id} onClick={() => void (viewable(f) ? open(f) : download(f))}>
                        {viewable(f) ? '열기' : '받기'}
                      </Button>
                      <Menu label={`${f.name} 메뉴`} items={fileMenu(f)} />
                    </div>
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center text-muted" aria-label="받으면 열 수 있어요" title="받으면 열 수 있어요">
                      <Icon d={ICONS.lock} size={18} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {p.note ? (
            <div className="grid gap-2.5 rounded-2xl border border-line p-4">
              <div className="flex items-start gap-3">
                <span className="kok-well grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
                  <Icon d={ICONS.mindmap} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-bold leading-snug">{p.note.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>KOK 노트</span>
                    {p.note.subject ? <span>· {p.note.subject}</span> : null}
                    <AiMark label="AI 정리" />
                  </p>
                </div>
              </div>
              {p.note.summary ? <p className="line-clamp-4 text-sm leading-relaxed">{previewText(p.note.summary)}</p> : null}
              {p.note.keyPoints.length ? (
                <ul className="flex flex-wrap gap-1.5" aria-label="개념">
                  {p.note.keyPoints.map((k, i) => (
                    <li key={i} className="max-w-full truncate rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold">
                      {previewText(k)}
                    </li>
                  ))}
                  {p.note.keyPointCount > p.note.keyPoints.length ? (
                    <li className="rounded-full px-1.5 py-1 text-xs text-muted">외 {p.note.keyPointCount - p.note.keyPoints.length}개</li>
                  ) : null}
                </ul>
              ) : null}
              <p className="text-xs text-muted">
                {[
                  `개념 ${p.note.keyPointCount}`,
                  p.note.questions ? `문제 ${p.note.questions}` : '',
                  p.note.terms ? `용어 ${p.note.terms}` : '',
                  p.note.formulas ? `공식 ${p.note.formulas}` : '',
                  p.note.figures ? `자료 그림 ${p.note.figures}` : '',
                  p.note.hasMindmap ? '마인드맵' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {p.mine ? (
                // 내 노트는 이미 내 자료함에 있다
                <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-center text-xs text-muted">
                  내 노트를 담았어요. 받은 사람은 정리·마인드맵·문제를 에너지 없이 자기 자료함에 넣을 수 있어요.
                </p>
              ) : (
                <>
                  <Button
                    variant={p.unlocked ? 'primary' : 'secondary'}
                    disabled={!p.unlocked}
                    onClick={() => setImporting(true)}
                    aria-describedby={p.unlocked ? undefined : 'note-locked'}
                  >
                    <Icon d={ICONS.folder} size={17} />내 자료함에 넣기
                  </Button>
                  {!p.unlocked ? (
                    <p id="note-locked" className="text-center text-xs text-muted">
                      자료를 받으면 넣을 수 있어요. 에너지는 쓰지 않아요.
                    </p>
                  ) : (
                    <p className="text-center text-xs text-muted">정리·마인드맵·문제가 그대로 들어오고 에너지는 쓰지 않아요.</p>
                  )}
                </>
              )}
            </div>
          ) : null}

          <p className="text-xs text-muted">
            올린 사람이 권리를 가진 자료만 나눌 수 있어요. 남의 저작물을 허락 없이 올린 것 같으면 메뉴의 &lsquo;신고&rsquo;로 알려 주세요.
          </p>
        </section>
      ) : null}

      <Comments postId={id} thread={p.thread} canWrite onChanged={reload} />

      <DownloadLimitSheet open={limitOpen} onClose={() => setLimitOpen(false)} daily={p.downloadsDaily} />
      <ShareReportSheet what={reporting ? { kind: 'post', id } : null} onClose={() => setReporting(false)} />
      {p.note ? <ImportSheet open={importing} onClose={() => setImporting(false)} postId={id} title={p.note.title} defaultSubject={p.note.subject} /> : null}
      <SubjectPickSheet
        open={!!organizing}
        onClose={() => setOrganizing(null)}
        title="KOK으로 정리"
        intro={
          <p className="text-sm text-muted">
            {organizing && organizing.length > 1 ? `파일 ${organizing.length}개를` : '이 파일을'} 고른 과목에 넣고 AI가 정리해요. 자료를 넣을 때처럼 에너지를
            써요.
          </p>
        }
        subjects={subjects}
        allowNew
        actionLabel={(name) => (name ? `'${name}'에 정리하기` : '과목을 골라 주세요')}
        onConfirm={(s) => organizeInto(organizing ?? [], s)}
      />
      {pdf ? <PdfViewer url={pdf.url} title={pdf.file.name} onClose={() => setPdf(null)} onDownload={() => void download(pdf.file)} /> : null}
      {image ? <ImageViewer src={image.url} alt={image.file.name} onClose={() => setImage(null)} /> : null}
      <Sheet open={!!text} onClose={() => setText(null)} title={text?.file.name ?? ''}>
        {text?.body === null ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted">
            <Spinner /> 여는 중…
          </p>
        ) : (
          <pre className="whitespace-pre-wrap break-words pb-2 font-sans text-[15px] leading-relaxed">{text?.body}</pre>
        )}
      </Sheet>
    </div>
  );
}

/** 파일 작은 그림 (미리보기가 있으면 그것, 없으면 종류 아이콘). 받았으면 눌러서 연다 */
function FileThumb({ f, onOpen }: { f: FileView; onOpen?: () => void }) {
  const inner = f.previewUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={f.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <Icon d={kindIcon(f.kind)} size={24} className="text-muted" />
  );
  const cls = 'grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface';
  if (!onOpen) return <span className={cls}>{inner}</span>;
  return (
    <button type="button" onClick={onOpen} className={cx(cls, 'press')} aria-label={`${f.name} ${viewable(f) ? '열기' : '내려받기'}`}>
      {inner}
    </button>
  );
}

/** 읽는 동안: 제목·글·자료 자리만 회색으로 */
function PostLoading() {
  return (
    <div className="kok-skel grid gap-3" aria-hidden="true">
      <div className="grid gap-2 px-1 pb-4 pt-16">
        <span className="kok-bone h-6 w-[70%]" />
        <span className="kok-bone h-3 w-[45%]" />
      </div>
      <div className="kok-card kok-shimmer grid gap-2.5 p-5">
        <span className="kok-bone h-3 w-[92%]" />
        <span className="kok-bone h-3 w-[86%]" />
        <span className="kok-bone h-3 w-[60%]" />
      </div>
      <div className="kok-card kok-shimmer h-40" />
    </div>
  );
}

/** 글 파일 읽기: UTF-8 (BOM 포함), 아니면 한국어 옛 인코딩(EUC-KR/CP949) */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}
