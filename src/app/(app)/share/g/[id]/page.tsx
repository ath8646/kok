'use client';
// 갤러리: 소개, 즐겨찾기, 새 글·인기 차례와 자료·글 거르기, 갤러리 안에서 찾기, 글 목록(더 보기), 글쓰기.
// 만든 사람·운영자는 갤러리를 고치거나 지울 수 있다 (만든 사람은 다른 사람의 글이 없을 때만 지운다)
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { useConfirm } from '@/components/Confirm';
import { ApiError, Button, ICONS, Icon, LargeHeader, Menu, Segmented, api, cx, useToast, DONE, type MenuItem } from '@/components/ui';
import { GallerySheet, ShareReportSheet } from '@/components/share/ShareSheets';
import { EmptyHint, NotReady, PostList, PostSkeleton, SearchBox, WriteFab } from '@/components/share/ShareUi';
import { josa } from '@/lib/josa';
import { readView, viewStamp, writeView } from '@/lib/view-cache';
import { CATEGORY_LABEL, countText, type GalleryView, type PostSummary } from '@/lib/share';

type Sort = 'new' | 'hot';
type Kind = 'all' | 'material' | 'text';
type View = { gallery: GalleryView; manage: boolean; posts: PostSummary[]; more: boolean };

export default function GalleryPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const owner = me?.userId;
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const [sort, setSort] = useState<Sort>('new');
  const [kind, setKind] = useState<Kind>('all');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const key = `share:g:${id}:${sort}:${kind}:${q}`;
  const [view, setView] = useState<View | null>(() => readView<View>(key, owner) ?? null);
  /** 지금 거르기의 글 목록을 읽었는지 (거르기를 바꾸면 갤러리 머리는 두고 목록 자리만 회색 줄) */
  const [listed, setListed] = useState(() => !!view);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [favBusy, setFavBusy] = useState(false);

  // 거르기가 바뀌면 그 기억부터 (없으면 회색 줄)
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    const cached = readView<View>(key, owner);
    if (cached) setView(cached);
    setListed(!!cached);
  }

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const stamp = viewStamp(key);
    const params = new URLSearchParams({ gallery: id, sort, ...(kind !== 'all' ? { kind } : {}), ...(q ? { q } : {}) });
    Promise.all([
      api<{ gallery: GalleryView; manage: boolean }>(`/api/share/galleries/${id}`),
      api<{ posts: PostSummary[]; more: boolean }>(`/api/share/posts?${params}`),
    ])
      .then(([g, p]) => {
        if (!alive) return;
        const v = { gallery: g.gallery, manage: g.manage, posts: p.posts, more: p.more };
        setView(v);
        setListed(true);
        setError(null);
        writeView(key, owner, v, { stamp });
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.code === 'not_ready') setNotReady(true);
        else setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [owner, id, sort, kind, q, key]);

  if (!me) return null;
  if (notReady) return <NotReady />;
  const g = view?.gallery;

  const loadMore = async () => {
    if (!view) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ gallery: id, sort, offset: String(view.posts.length), ...(kind !== 'all' ? { kind } : {}), ...(q ? { q } : {}) });
      const r = await api<{ posts: PostSummary[]; more: boolean }>(`/api/share/posts?${params}`);
      setView({ ...view, posts: [...view.posts, ...r.posts.filter((p) => !view.posts.some((x) => x.id === p.id))], more: r.more });
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleFav = async () => {
    if (!view || favBusy) return;
    const on = !view.gallery.fav;
    setFavBusy(true);
    setView({ ...view, gallery: { ...view.gallery, fav: on } });
    try {
      await api(`/api/share/galleries/${id}/fav`, { method: 'POST', body: JSON.stringify({ on }) });
      toast(on ? '즐겨찾기에 넣었어요.' : '즐겨찾기에서 뺐어요.', 'ok', DONE);
    } catch (e) {
      setView((v) => (v ? { ...v, gallery: { ...v.gallery, fav: !on } } : v));
      toast((e as Error).message, 'bad');
    } finally {
      setFavBusy(false);
    }
  };

  const remove = async () => {
    if (!g) return;
    const ok = await ask({
      title: '갤러리 지우기',
      body: `${josa(`'${g.name}'`, '을')} 지울까요?`,
      note: me.isAdmin ? '이 갤러리의 글·파일·댓글이 모두 지워져요. 되돌릴 수 없어요.' : '내 글과 파일도 같이 지워져요. 되돌릴 수 없어요.',
      ok: '지우기',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/share/galleries/${id}`, { method: 'DELETE' });
      toast('갤러리를 지웠어요.', 'ok', DONE);
      router.replace('/share');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const menu: MenuItem[] = [
    ...(view?.manage ? [{ label: '갤러리 고치기', icon: ICONS.pen, onSelect: () => setEditing(true) }] : []),
    ...(view?.manage ? [{ label: '갤러리 지우기', icon: ICONS.trash, onSelect: remove, danger: true }] : []),
    ...(g && !g.mine ? [{ label: '갤러리 신고', icon: ICONS.flag, onSelect: () => setReporting(true) }] : []),
  ];

  return (
    <div className="grid gap-3 pb-6">
      <LargeHeader
        title={g?.name ?? (error ? '갤러리' : '')}
        compactTitle={g?.name ?? '갤러리'}
        subtitle={
          g ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{CATEGORY_LABEL[g.category]}</span>
              <span aria-hidden="true">·</span>
              <span>글 {countText(g.posts)}</span>
              <span aria-hidden="true">·</span>
              <span>{g.official ? '운영자 갤러리' : g.mine ? '내가 만든 갤러리' : '누구나 쓰는 갤러리'}</span>
            </span>
          ) : null
        }
        back={{ href: '/share', label: '자료 공유로' }}
        actions={
          g ? (
            <>
              <button
                type="button"
                aria-pressed={g.fav}
                aria-label={g.fav ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기'}
                title={g.fav ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기'}
                onClick={toggleFav}
                className="press grid h-10 w-10 place-items-center rounded-full hover:bg-surface-2"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className={cx('h-[22px] w-[22px]', g.fav ? 'text-warn' : 'text-ink')}
                  fill={g.fav ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth={1.9}
                  strokeLinejoin="round"
                >
                  <path d={ICONS.star} />
                </svg>
              </button>
              {menu.length ? <Menu label="갤러리 메뉴" items={menu} /> : null}
            </>
          ) : null
        }
      />
      {error && !view ? (
        <EmptyHint title="갤러리를 열 수 없어요" body={error} action={<Button onClick={() => router.push('/share')}>자료 공유로</Button>} />
      ) : (
        <>
          {g?.description ? <p className="kok-card px-4 py-3 text-[15px] leading-relaxed">{g.description}</p> : null}
          <SearchBox
            value={typed}
            onChange={setTyped}
            onSubmit={setQ}
            placeholder={g ? `${g.name}에서 찾기` : '이 갤러리에서 찾기'}
            label="이 갤러리에서 찾기"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<Sort>
              label="글 차례"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'new', label: '새 글' },
                { value: 'hot', label: '인기' },
              ]}
            />
            <Segmented<Kind>
              label="글 종류"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: '전체' },
                { value: 'material', label: '자료' },
                { value: 'text', label: '글' },
              ]}
            />
          </div>
          {view && listed && view.posts.length ? (
            <PostList posts={view.posts} />
          ) : view && listed ? (
            <EmptyHint
              title={q ? `${josa(`'${q}'`, '이')} 들어간 글이 없어요` : kind === 'material' ? '아직 자료가 없어요' : '아직 글이 없어요'}
              body={q ? '다른 말로 찾아보세요.' : '첫 글을 써 보세요. 파일이나 내 KOK 노트를 붙일 수 있어요.'}
              action={
                q ? null : (
                  <Button size="sm" onClick={() => router.push(`/share/write?g=${id}`)}>
                    <Icon d={ICONS.pen} size={16} />
                    글쓰기
                  </Button>
                )
              }
            />
          ) : (
            <PostSkeleton />
          )}
          {view?.more && listed ? (
            <Button variant="secondary" className="justify-self-center" busy={loadingMore} onClick={loadMore}>
              더 보기
            </Button>
          ) : null}
          <WriteFab href={`/share/write?g=${id}`} />
        </>
      )}
      <GallerySheet
        open={editing}
        onClose={() => setEditing(false)}
        edit={g ?? null}
        onSaved={(next) => setView((v) => (v ? { ...v, gallery: { ...next, fav: v.gallery.fav } } : v))}
      />
      <ShareReportSheet what={reporting && g ? { kind: 'gallery', id: g.id } : null} onClose={() => setReporting(false)} />
    </div>
  );
}
