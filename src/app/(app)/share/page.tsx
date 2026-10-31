'use client';
// 자료 공유 첫 화면: 찾기, 즐겨찾는 갤러리, 분류별 갤러리(+ 만들기), 인기 자료, 새 글.
// 찾는 말이 있으면(?q=) 글과 갤러리 찾기 결과를 보인다. 다시 들어오면 기억해 둔 화면(share:hub)을 먼저 그리고 뒤에서 새로 읽는다
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { ApiError, Button, ICONS, Icon, LargeHeader, LinkButton, api, cx } from '@/components/ui';
import { GallerySheet } from '@/components/share/ShareSheets';
import {
  CategoryChips,
  DownloadsPill,
  EmptyHint,
  GalleryCard,
  NotReady,
  PostList,
  PostSkeleton,
  SearchBox,
  ShareSection,
  WriteFab,
} from '@/components/share/ShareUi';
import { josa } from '@/lib/josa';
import { readView, viewStamp, writeView } from '@/lib/view-cache';
import type { GalleryCategory, GalleryView, PostSummary } from '@/lib/share';

type Hub = {
  favorites: GalleryView[];
  popular: GalleryView[];
  recent: PostSummary[];
  hot: PostSummary[];
  downloads: { left: number | null; daily: number | null };
};

const HUB_KEY = 'share:hub';

export default function SharePage() {
  return (
    <Suspense fallback={null}>
      <ShareHub />
    </Suspense>
  );
}

function ShareHub() {
  const { me } = useMe();
  const owner = me?.userId;
  const router = useRouter();
  const params = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const [typed, setTyped] = useState(q);
  const [hub, setHub] = useState<Hub | null>(() => readView<Hub>(HUB_KEY, owner) ?? null);
  const [notReady, setNotReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cat, setCat] = useState<GalleryCategory | 'all'>('all');
  const [catList, setCatList] = useState<GalleryView[] | null>(null);
  const [making, setMaking] = useState(false);
  const [tick, setTick] = useState(0);

  // 주소의 찾는 말이 바뀌면 칸도 (뒤로 가기)
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) {
    setSeenQ(q);
    setTyped(q);
  }

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const stamp = viewStamp(HUB_KEY);
    api<Hub>('/api/share/hub')
      .then((h) => {
        if (!alive) return;
        setHub(h);
        setFailed(false);
        writeView(HUB_KEY, owner, h, { stamp });
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.code === 'not_ready') setNotReady(true);
        else setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [owner, tick]);

  // 분류를 고르면 그 분류의 갤러리 (전체는 첫 화면의 인기 갤러리)
  useEffect(() => {
    if (cat === 'all') return;
    let alive = true;
    api<{ galleries: GalleryView[] }>(`/api/share/galleries?category=${cat}`)
      .then((r) => alive && setCatList(r.galleries))
      .catch(() => alive && setCatList([]));
    return () => {
      alive = false;
    };
  }, [cat]);

  if (!me) return null;
  const search = (v: string) => router.replace(v ? `/share?q=${encodeURIComponent(v)}` : '/share');
  const galleries = cat === 'all' ? (hub?.popular ?? null) : catList;

  return (
    <div className="grid gap-3 pb-6">
      <LargeHeader
        title="자료 공유"
        subtitle="갤러리에서 자료를 나누고 찾아요"
        actions={
          <>
            {hub ? <DownloadsPill left={hub.downloads.left} daily={hub.downloads.daily} /> : null}
            <Link
              href="/share/me"
              className="press grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-surface-2"
              aria-label="내 활동"
              title="내 활동"
            >
              <Icon d={ICONS.users} size={21} />
            </Link>
          </>
        }
      />
      {notReady ? (
        <NotReady />
      ) : (
        <>
          <SearchBox value={typed} onChange={setTyped} onSubmit={search} placeholder="자료·글 제목, 갤러리 이름으로 찾기" label="자료 공유에서 찾기" />
          {q ? (
            <SearchResults key={q} q={q} />
          ) : (
            <>
              {hub?.favorites.length ? (
                <ShareSection title="즐겨찾는 갤러리">
                  <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
                    {hub.favorites.map((g) => (
                      <GalleryCard key={g.id} g={g} compact />
                    ))}
                  </div>
                </ShareSection>
              ) : null}

              <ShareSection
                title="갤러리"
                action={
                  <Button size="sm" variant="secondary" onClick={() => setMaking(true)}>
                    <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
                    만들기
                  </Button>
                }
              >
                <CategoryChips
                  value={cat}
                  onChange={(c) => {
                    setCat(c);
                    setCatList(null);
                  }}
                />
                {galleries === null ? (
                  <div className="kok-skel grid grid-cols-2 gap-2.5 md:grid-cols-3" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="kok-card kok-shimmer h-[92px]" />
                    ))}
                  </div>
                ) : galleries.length ? (
                  <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                    {galleries.map((g) => (
                      <GalleryCard key={g.id} g={g} tile />
                    ))}
                  </div>
                ) : (
                  <EmptyHint
                    title="이 분류에는 아직 갤러리가 없어요"
                    body="처음으로 만들어 보세요. 누구나 만들 수 있어요."
                    action={
                      <Button size="sm" onClick={() => setMaking(true)}>
                        갤러리 만들기
                      </Button>
                    }
                  />
                )}
              </ShareSection>

              {hub?.hot.length ? (
                <ShareSection title="인기 자료">
                  <PostList posts={hub.hot} showGallery />
                </ShareSection>
              ) : null}

              <ShareSection title="새 글">
                {hub ? (
                  <PostList posts={hub.recent} showGallery empty={<EmptyHint title="아직 글이 없어요" body="갤러리에 들어가 첫 자료를 올려 보세요." />} />
                ) : failed ? (
                  <EmptyHint
                    title="불러오지 못했어요"
                    body="인터넷 연결을 확인하고 다시 해 주세요."
                    action={
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setFailed(false);
                          setTick((t) => t + 1);
                        }}
                      >
                        다시 불러오기
                      </Button>
                    }
                  />
                ) : (
                  <PostSkeleton />
                )}
              </ShareSection>
            </>
          )}
          <WriteFab href="/share/write" />
        </>
      )}
      <GallerySheet open={making} onClose={() => setMaking(false)} onSaved={(g) => router.push(`/share/g/${g.id}`)} />
    </div>
  );
}

/** 찾기 결과: 갤러리(이름·소개)와 글(제목·내용, 낱말이 모두 든 것) */
function SearchResults({ q }: { q: string }) {
  const [galleries, setGalleries] = useState<GalleryView[] | null>(null);
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    let alive = true;
    const enc = encodeURIComponent(q);
    Promise.all([api<{ galleries: GalleryView[] }>(`/api/share/galleries?q=${enc}`), api<{ posts: PostSummary[]; more: boolean }>(`/api/share/posts?q=${enc}`)])
      .then(([g, p]) => {
        if (!alive) return;
        setGalleries(g.galleries);
        setPosts(p.posts);
        setMore(p.more);
      })
      .catch(() => {
        if (!alive) return;
        setGalleries([]);
        setPosts([]);
      });
    return () => {
      alive = false;
    };
  }, [q]);
  const loadMore = async () => {
    if (!posts) return;
    setLoadingMore(true);
    try {
      const r = await api<{ posts: PostSummary[]; more: boolean }>(`/api/share/posts?q=${encodeURIComponent(q)}&offset=${posts.length}`);
      setPosts([...posts, ...r.posts.filter((p) => !posts.some((x) => x.id === p.id))]);
      setMore(r.more);
    } finally {
      setLoadingMore(false);
    }
  };
  if (posts === null || galleries === null) return <PostSkeleton />;
  return (
    <div className="grid gap-1" aria-live="polite">
      {galleries.length ? (
        <ShareSection title={`갤러리 ${galleries.length}`}>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {galleries.slice(0, 6).map((g) => (
              <GalleryCard key={g.id} g={g} />
            ))}
          </div>
        </ShareSection>
      ) : null}
      <ShareSection title={posts.length ? `글 ${posts.length}${more ? '+' : ''}` : '글'}>
        <PostList
          posts={posts}
          showGallery
          empty={<EmptyHint title={`${josa(`'${q}'`, '이')} 들어간 글이 없어요`} body="다른 말로 찾아보거나 갤러리에 직접 들어가 보세요." />}
        />
        {more ? (
          <Button variant="secondary" className={cx('justify-self-center')} busy={loadingMore} onClick={loadMore}>
            더 보기
          </Button>
        ) : null}
      </ShareSection>
      <LinkButton href="/share" variant="ghost" size="sm" className="justify-self-center">
        자료 공유 처음으로
      </LinkButton>
    </div>
  );
}
