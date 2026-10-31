'use client';
// 자료 공유 화면 조각: 글 한 줄, 갤러리 카드, 분류 칩, 찾기 칸, 받기 알약, 좋아요 단추, 파일 종류 표시, 닉네임 정하기
import Link from 'next/link';
import type { FormEvent, ReactNode } from 'react';
import type { useAskText } from '@/components/Confirm';
import { ICONS, Icon, cx, useToast } from '@/components/ui';
import { sb } from '@/lib/data';
import {
  CATEGORY_LABEL,
  GALLERY_CATEGORIES,
  SHARE_KIND_LABEL,
  SHARE_TEXT,
  countText,
  timeAgo,
  type GalleryCategory,
  type GalleryView,
  type PostSummary,
  type ShareKind,
} from '@/lib/share';
import type { MeResponse } from '@/lib/types';

/** 파일 종류 작은 표시 ('PDF', '한글' …). raised: 회색 칸 위에 놓일 때 (카드 색 바탕) */
export function KindTag({ kind, raised = false }: { kind: ShareKind; raised?: boolean }) {
  return (
    <span className={cx('inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-bold text-muted', raised ? 'bg-surface' : 'bg-surface-2')}>
      {SHARE_KIND_LABEL[kind]}
    </span>
  );
}

/** 파일 종류 아이콘 */
export function kindIcon(kind: ShareKind): string {
  return kind === 'pdf' ? ICONS.pdf : kind === 'image' ? ICONS.image : ICONS.file;
}

/** 글 목록 한 줄: 제목·내용 앞부분·자료 표시·글쓴이·시간·좋아요·댓글·받기 */
export function PostRow({ post, showGallery = false }: { post: PostSummary; showGallery?: boolean }) {
  const material = post.hasFiles || post.hasNote;
  const kinds = [...new Set(post.fileKinds)].slice(0, 3);
  return (
    <li>
      <Link href={`/share/p/${post.id}`} className="kok-card kok-card-hover press grid gap-1.5 p-4">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 font-semibold leading-snug">
            {post.hidden ? (
              <span className="mr-1.5 inline-flex rounded-full bg-warn-soft px-2 py-0.5 align-[2px] text-[11px] font-bold text-warn">가려짐</span>
            ) : null}
            <span className="line-clamp-2">{post.title}</span>
          </p>
          {material ? (
            <span
              className="flex shrink-0 items-center gap-1"
              aria-label={`자료: ${[...(post.hasNote ? ['KOK 노트'] : []), ...kinds.map((k) => SHARE_KIND_LABEL[k])].join(', ')}`}
            >
              {post.hasNote ? (
                <span className="inline-flex h-5 items-center rounded-md bg-accent-soft px-1.5 text-[11px] font-bold text-accent">노트</span>
              ) : null}
              {kinds.map((k) => (
                <KindTag key={k} kind={k} />
              ))}
            </span>
          ) : null}
        </div>
        {post.excerpt ? <p className="line-clamp-1 text-sm text-muted">{post.excerpt}</p> : null}
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
          {showGallery && post.galleryName ? <span className="font-semibold text-ink/80">{post.galleryName}</span> : null}
          <span>{post.authorName}</span>
          <span>{timeAgo(post.createdAt)}</span>
          <Stat icon={ICONS.heart} n={post.likes} label="좋아요" />
          <Stat icon={ICONS.comment} n={post.comments} label="댓글" />
          {material ? <Stat icon={ICONS.download} n={post.downloads} label="받기" /> : null}
        </p>
      </Link>
    </li>
  );
}

function Stat({ icon, n, label }: { icon: string; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums" aria-label={`${label} ${n}`}>
      <Icon d={icon} size={13} strokeWidth={2.1} />
      {countText(n)}
    </span>
  );
}

/** 글 목록 (비었으면 안내) */
export function PostList({ posts, showGallery, empty }: { posts: PostSummary[]; showGallery?: boolean; empty?: ReactNode }) {
  if (!posts.length) return <>{empty ?? null}</>;
  return (
    <ul className="grid gap-2.5">
      {posts.map((p) => (
        <PostRow key={p.id} post={p} showGallery={showGallery} />
      ))}
    </ul>
  );
}

/**
 * 갤러리 카드. compact: 가로로 넘기는 줄(즐겨찾기)의 좁은 카드, tile: 두 칸 격자(폰)의 작은 카드,
 * 아무것도 없으면 찾기 결과·내 갤러리의 넓은 카드
 */
export function GalleryCard({ g, compact = false, tile = false }: { g: GalleryView; compact?: boolean; tile?: boolean }) {
  return (
    <Link
      href={`/share/g/${g.id}`}
      className={cx(
        'kok-card kok-card-hover press grid content-between',
        compact ? 'w-[190px] shrink-0 gap-2 p-4' : tile ? 'min-w-0 gap-1.5 p-3.5' : 'gap-2 p-4',
      )}
      aria-label={`${g.name}, 글 ${g.posts}개`}
    >
      <div className="grid gap-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cx('kok-well grid shrink-0 place-items-center rounded-xl bg-accent-soft text-accent', tile ? 'h-7 w-7' : 'h-8 w-8')}
            aria-hidden="true"
          >
            <Icon d={g.official ? ICONS.crown : ICONS.users} size={tile ? 15 : 17} />
          </span>
          <p className={cx('min-w-0 flex-1 truncate font-bold', tile && 'text-[15px]')}>{g.name}</p>
          {g.fav ? <Icon d={ICONS.star} size={14} className="shrink-0 text-warn" /> : null}
        </div>
        {g.description ? (
          <p className={cx('text-muted', tile ? 'line-clamp-1 text-[13px]' : compact ? 'line-clamp-1 text-sm' : 'line-clamp-2 text-sm')}>{g.description}</p>
        ) : null}
      </div>
      <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
        {tile ? null : <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold">{CATEGORY_LABEL[g.category]}</span>}
        <span className="shrink-0 tabular-nums">글 {countText(g.posts)}</span>
        {g.lastPostAt ? <span className="truncate">{timeAgo(g.lastPostAt)}</span> : null}
        {g.mine ? <span className="shrink-0 font-semibold text-accent">내 갤러리</span> : null}
      </p>
    </Link>
  );
}

/** 갤러리 분류 칩 (전체 + 일곱 분류) */
export function CategoryChips({ value, onChange }: { value: GalleryCategory | 'all'; onChange: (v: GalleryCategory | 'all') => void }) {
  const items: Array<GalleryCategory | 'all'> = ['all', ...GALLERY_CATEGORIES];
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="radiogroup" aria-label="갤러리 분류">
      {items.map((c) => {
        const on = c === value;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(c)}
            className={cx(
              'kok-chip press inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors duration-200',
              on ? 'kok-chip-on' : 'kok-chip-off bg-surface text-ink shadow-[0_1px_2px_var(--shadow)] hover:bg-surface-2',
            )}
          >
            {c === 'all' ? '전체' : CATEGORY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

/** 찾기 칸 (엔터 = 찾기) */
export function SearchBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  label = '찾기',
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder: string;
  label?: string;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(value.trim());
  };
  return (
    <form role="search" onSubmit={submit} className="relative">
      <Icon d={ICONS.search} size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search"
        enterKeyHint="search"
        aria-label={label}
        // 브라우저의 지우기 단추(×)는 숨기고 앱의 지우기 단추만 (둘이 겹쳐 보이지 않게)
        className="kok-input h-12 w-full rounded-2xl bg-surface pl-10 pr-10 text-[15px] shadow-[0_1px_2px_var(--shadow)] outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
        value={value}
        maxLength={80}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          aria-label="찾는 말 지우기"
          className="press absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2"
          onClick={() => {
            onChange('');
            onSubmit('');
          }}
        >
          <Icon d={ICONS.close} size={16} />
        </button>
      ) : null}
    </form>
  );
}

/** 오늘 자료 받기 남은 수 ('오늘 받기 1/2', 제한이 없으면 숨김) */
export function DownloadsPill({ left, daily }: { left: number | null; daily: number | null }) {
  if (daily === null || left === null) return null;
  const out = left <= 0;
  return (
    <Link
      href="/plan"
      className={cx(
        'press inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-bold',
        out ? 'bg-warn-soft text-warn' : 'bg-surface text-ink shadow-[0_1px_2px_var(--shadow)]',
      )}
      aria-label={`오늘 받을 수 있는 자료 ${left}개 남음 (하루 ${daily}개)`}
    >
      <Icon d={ICONS.download} size={15} strokeWidth={2.2} />
      <span>
        받기{' '}
        <span className="tabular-nums">
          {left}/{daily}
        </span>
      </span>
    </Link>
  );
}

/** 좋아요 단추 (하트 + 수) */
export function LikeButton({
  liked,
  count,
  onToggle,
  small = false,
  busy = false,
}: {
  liked: boolean;
  count: number;
  onToggle: () => void;
  small?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={`좋아요 ${count}`}
      disabled={busy}
      onClick={onToggle}
      className={cx(
        'press inline-flex items-center gap-1 rounded-full font-semibold tabular-nums transition-colors duration-200',
        small ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm',
        liked ? 'bg-bad-soft text-bad' : 'bg-surface-2 text-muted hover:text-ink',
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={small ? 'h-[15px] w-[15px]' : 'h-[18px] w-[18px]'}
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      >
        <path d={ICONS.heart} />
      </svg>
      {countText(count)}
    </button>
  );
}

/**
 * 자료 공유에 쓸 닉네임이 없으면 먼저 정한다 (설정의 닉네임과 같다). 정했으면 true.
 * 익명으로 쓰면 묻지 않는다
 */
export async function ensureNickname(
  me: MeResponse,
  askText: ReturnType<typeof useAskText>,
  refresh: () => Promise<void>,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  if ((me.nickname ?? '').trim()) return true;
  const name = await askText({
    title: '닉네임 정하기',
    body: '자료 공유의 글과 댓글에 이 이름이 보여요. 설정에서 언제든 바꿀 수 있어요. 진짜 이름이나 학교는 적지 않는 게 좋아요.',
    label: '닉네임',
    ok: '정하기',
    cancel: '그만두기',
    check: (v) => {
      const t = v.trim();
      if (t.length < 2) return '2자 이상 적어 주세요.';
      if (t.length > SHARE_TEXT.nickname) return `${SHARE_TEXT.nickname}자까지 적을 수 있어요.`;
      return null;
    },
  });
  if (name === null) return false;
  const { error } = await sb().from('profiles').update({ nickname: name.trim() }).eq('id', me.userId);
  if (error) {
    toast('닉네임을 저장하지 못했어요. 다시 해 주세요.', 'bad');
    return false;
  }
  await refresh();
  return true;
}

/** 묶음 제목 (화면 바탕 위 글자는 본문·흐린 글자만: 테마의 화면 빛) */
export function ShareSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <div className="mt-4 flex items-center justify-between gap-3 px-1">
        <h2 className="kok-section-title font-display text-lg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 아무것도 없을 때의 작은 안내 */
export function EmptyHint({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="kok-card grid justify-items-center gap-1.5 px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** 읽는 동안의 회색 줄 (글 목록 자리) */
export function PostSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="kok-skel grid gap-2.5" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="kok-card kok-shimmer grid gap-2 p-4">
          <span className="kok-bone h-3.5 w-[70%]" />
          <span className="kok-bone h-2.5 w-[90%]" />
          <span className="kok-bone h-2 w-[40%]" />
        </li>
      ))}
    </ul>
  );
}

/** 글쓰기 떠 있는 단추 (자료 공유 화면의 + 버튼 자리: 자료 넣기 + 버튼과 같은 모양·자리) */
export function WriteFab({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="글쓰기"
      className="kok-fab press fixed bottom-[calc(80px+var(--tab-float)*10px+env(safe-area-inset-bottom))] right-4 z-40 grid h-[58px] w-[58px] place-items-center rounded-full bg-fab text-fab-ink md:bottom-8 md:right-8"
    >
      <Icon d={ICONS.pen} size={25} strokeWidth={2.2} />
    </Link>
  );
}

/** 자료 공유가 아직 준비되지 않았을 때 (schema.sql 을 다시 실행하기 전) */
export function NotReady() {
  return <EmptyHint title="자료 공유는 곧 열려요" body="운영자가 준비를 마치면 여기서 갤러리와 자료를 볼 수 있어요." />;
}
