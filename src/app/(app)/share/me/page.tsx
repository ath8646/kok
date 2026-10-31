'use client';
// 자료 공유 내 활동: 내 글(가려진 글도), 받은 자료(최근 받은 차례), 내가 만든 갤러리, 차단 목록(풀기). 탭은 주소(?tab=)에 적는다
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { useConfirm } from '@/components/Confirm';
import { GallerySheet } from '@/components/share/ShareSheets';
import { DownloadsPill, EmptyHint, GalleryCard, NotReady, PostList, PostSkeleton } from '@/components/share/ShareUi';
import { ApiError, Button, ICONS, Icon, LargeHeader, Segmented, api, useToast, DONE } from '@/components/ui';
import { readView, viewStamp, writeView } from '@/lib/view-cache';
import { timeAgo, type GalleryView, type PostSummary } from '@/lib/share';

type Tab = 'posts' | 'received' | 'galleries' | 'blocks';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'posts', label: '내 글' },
  { value: 'received', label: '받은 자료' },
  { value: 'galleries', label: '내 갤러리' },
  { value: 'blocks', label: '차단' },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.value === v);

type Activity = { received: PostSummary[]; galleries: GalleryView[]; galleryLimit: number | null; downloads: { left: number | null; daily: number | null } };
type Block = { id: string; label: string; at: string };

export default function ShareMePage() {
  return (
    <Suspense fallback={null}>
      <ShareMe />
    </Suspense>
  );
}

function ShareMe() {
  const { me } = useMe();
  const owner = me?.userId;
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'posts';
  const toast = useToast();
  const ask = useConfirm();
  const [activity, setActivity] = useState<Activity | null>(() => readView<Activity>('share:me', owner) ?? null);
  const [posts, setPosts] = useState<PostSummary[] | null>(() => readView<PostSummary[]>('share:me:posts', owner) ?? null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [making, setMaking] = useState(false);

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const s1 = viewStamp('share:me');
    const s2 = viewStamp('share:me:posts');
    const fail = (e: unknown) => {
      if (!alive) return;
      if (e instanceof ApiError && e.code === 'not_ready') setNotReady(true);
    };
    api<Activity>('/api/share/me')
      .then((a) => {
        if (!alive) return;
        setActivity(a);
        writeView('share:me', owner, a, { stamp: s1 });
      })
      .catch(fail);
    api<{ posts: PostSummary[]; more: boolean }>('/api/share/posts?mine=1')
      .then((r) => {
        if (!alive) return;
        setPosts(r.posts);
        setMore(r.more);
        writeView('share:me:posts', owner, r.posts, { stamp: s2 });
      })
      .catch(fail);
    return () => {
      alive = false;
    };
  }, [owner]);

  // 차단 목록은 그 탭을 열 때
  useEffect(() => {
    if (!owner || tab !== 'blocks') return;
    let alive = true;
    api<{ blocks: Block[] }>('/api/share/blocks')
      .then((r) => alive && setBlocks(r.blocks))
      .catch(() => alive && setBlocks([]));
    return () => {
      alive = false;
    };
  }, [owner, tab]);

  if (!me) return null;
  if (notReady) return <NotReady />;

  const setTab = (t: Tab) => router.replace(t === 'posts' ? '/share/me' : `/share/me?tab=${t}`, { scroll: false });

  const loadMore = async () => {
    if (!posts) return;
    setLoadingMore(true);
    try {
      const r = await api<{ posts: PostSummary[]; more: boolean }>(`/api/share/posts?mine=1&offset=${posts.length}`);
      setPosts([...posts, ...r.posts.filter((p) => !posts.some((x) => x.id === p.id))]);
      setMore(r.more);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoadingMore(false);
    }
  };

  const unblock = async (b: Block) => {
    const ok = await ask({ title: '차단 풀기', body: `${b.label}의 차단을 풀까요?`, note: '이 사람의 글과 댓글이 다시 보여요.', ok: '풀기' });
    if (!ok) return;
    try {
      await api('/api/share/blocks', { method: 'DELETE', body: JSON.stringify({ id: b.id }) });
      setBlocks((cur) => (cur ? cur.filter((x) => x.id !== b.id) : cur));
      toast('차단을 풀었어요.', 'ok', DONE);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const limitText =
    activity && activity.galleryLimit !== null ? `${activity.galleries.length}/${activity.galleryLimit}개` : activity ? `${activity.galleries.length}개` : '';

  return (
    <div className="grid gap-3 pb-6">
      <LargeHeader
        title="내 활동"
        subtitle={me.nickname ? `${me.nickname} · 자료 공유` : '자료 공유'}
        back={{ href: '/share', label: '자료 공유로' }}
        actions={activity ? <DownloadsPill left={activity.downloads.left} daily={activity.downloads.daily} /> : null}
      />
      {!me.nickname ? (
        <div className="kok-card flex flex-wrap items-center gap-3 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm">아직 닉네임이 없어요. 글이나 댓글을 쓸 때 정하거나 설정에서 정할 수 있어요.</p>
          <Button size="sm" variant="secondary" onClick={() => router.push('/settings')}>
            설정
          </Button>
        </div>
      ) : null}
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Segmented<Tab> label="내 활동" value={tab} onChange={setTab} options={TABS} />
      </div>

      {tab === 'posts' ? (
        posts === null ? (
          <PostSkeleton />
        ) : (
          <>
            <PostList
              posts={posts}
              showGallery
              empty={
                <EmptyHint
                  title="아직 쓴 글이 없어요"
                  body="갤러리에 내 자료나 KOK 노트를 나눠 보세요."
                  action={
                    <Button size="sm" onClick={() => router.push('/share/write')}>
                      <Icon d={ICONS.pen} size={16} />
                      글쓰기
                    </Button>
                  }
                />
              }
            />
            {more ? (
              <Button variant="secondary" className="justify-self-center" busy={loadingMore} onClick={loadMore}>
                더 보기
              </Button>
            ) : null}
          </>
        )
      ) : null}

      {tab === 'received' ? (
        activity === null ? (
          <PostSkeleton />
        ) : (
          <>
            <PostList
              posts={activity.received}
              showGallery
              empty={<EmptyHint title="아직 받은 자료가 없어요" body="갤러리에서 마음에 드는 자료를 받아 보세요. 받은 자료는 여기서 다시 열 수 있어요." />}
            />
            {activity.received.length ? <p className="px-1 text-xs text-muted">최근에 받은 40개까지 보여요. 지워진 글은 빠져요.</p> : null}
          </>
        )
      ) : null}

      {tab === 'galleries' ? (
        activity === null ? (
          <PostSkeleton rows={2} />
        ) : (
          <div className="grid gap-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="text-sm text-muted">만든 갤러리 {limitText}</p>
              {activity.galleryLimit === null || activity.galleries.length < activity.galleryLimit ? (
                <Button size="sm" variant="secondary" onClick={() => setMaking(true)}>
                  <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
                  만들기
                </Button>
              ) : null}
            </div>
            {activity.galleries.length ? (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {activity.galleries.map((g) => (
                  <GalleryCard key={g.id} g={g} />
                ))}
              </div>
            ) : (
              <EmptyHint
                title="만든 갤러리가 없어요"
                body="반·학교·자격증 공부 모임처럼 함께 자료를 나눌 곳을 만들어 보세요. 만든 사람은 그 갤러리의 글과 댓글을 지울 수 있어요."
              />
            )}
          </div>
        )
      ) : null}

      {tab === 'blocks' ? (
        blocks === null ? (
          <PostSkeleton rows={2} />
        ) : blocks.length ? (
          <ul className="grid gap-2" aria-label="차단한 사람">
            {blocks.map((b) => (
              <li key={b.id} className="kok-card flex items-center gap-3 px-4 py-3">
                <Icon d={ICONS.block} size={19} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{b.label}</p>
                  <p className="text-xs text-muted">{timeAgo(b.at)} 차단</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => void unblock(b)}>
                  풀기
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint title="차단한 사람이 없어요" body="글이나 댓글의 메뉴에서 차단하면 그 사람의 글과 댓글이 내 화면에서 보이지 않아요." />
        )
      ) : null}

      <GallerySheet open={making} onClose={() => setMaking(false)} onSaved={(g) => router.push(`/share/g/${g.id}`)} />
    </div>
  );
}
