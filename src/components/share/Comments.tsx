'use client';
// 글의 댓글: 댓글과 답글(한 단계), 좋아요, 고치기·지우기(쓴 사람, 갤러리 만든 사람·운영자는 지우기), 신고·차단, 익명으로 쓰기.
// 글쓴이가 쓴 댓글은 '글쓴이' 표시, 익명 댓글은 서버가 정한 이름('익명1'·'익명(글쓴이)')
import { useRef, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { confirmOpen, useAskText, useConfirm } from '@/components/Confirm';
import { Button, ICONS, Icon, Menu, Toggle, api, cx, inputClass, useToast, DONE, type MenuItem } from '@/components/ui';
import { ShareReportSheet } from './ShareSheets';
import { LikeButton, ensureNickname } from './ShareUi';
import { SHARE_TEXT, timeAgo, type CommentView } from '@/lib/share';

export function Comments({
  postId,
  thread,
  canWrite,
  onChanged,
}: {
  postId: string;
  thread: CommentView[];
  /** 댓글을 쓸 수 있는지 (가린 글·정지된 계정은 아니다) */
  canWrite: boolean;
  /** 댓글이 바뀌면 글을 다시 읽는다 */
  onChanged: () => Promise<void>;
}) {
  const { me, refresh } = useMe();
  const toast = useToast();
  const ask = useConfirm();
  const askText = useAskText();
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  /** 그 자리에서 고치는 댓글 */
  const [editing, setEditing] = useState<string | null>(null);
  /** 누른 좋아요 (서버에서 다시 읽은 댓글이 오면 그 값을 쓴다) */
  const [likes, setLikes] = useState<Record<string, { liked: boolean; n: number }>>({});
  const [seenThread, setSeenThread] = useState(thread);
  if (seenThread !== thread) {
    setSeenThread(thread);
    setLikes({});
  }
  const box = useRef<HTMLTextAreaElement>(null);
  if (!me) return null;

  const top = thread.filter((c) => !c.parentId);
  const repliesOf = (id: string) => thread.filter((c) => c.parentId === id);

  const like = async (c: CommentView) => {
    const cur = likes[c.id] ?? { liked: c.liked, n: c.likes };
    const next = { liked: !cur.liked, n: cur.n + (cur.liked ? -1 : 1) };
    setLikes((m) => ({ ...m, [c.id]: next }));
    try {
      const r = await api<{ likes: number }>(`/api/share/comments/${c.id}/like`, { method: 'POST', body: JSON.stringify({ on: next.liked }) });
      setLikes((m) => ({ ...m, [c.id]: { liked: next.liked, n: r.likes } }));
    } catch (e) {
      setLikes((m) => ({ ...m, [c.id]: cur }));
      toast((e as Error).message, 'bad');
    }
  };

  const saveEdit = async (c: CommentView, text: string): Promise<boolean> => {
    const body = text.trim();
    if (!body) {
      toast('댓글을 적어 주세요.', 'bad');
      return false;
    }
    if (body === c.body) return true;
    try {
      await api(`/api/share/comments/${c.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
      toast('댓글을 고쳤어요.', 'ok', DONE);
      await onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return false;
    }
  };

  const remove = async (c: CommentView) => {
    const ok = await ask({
      title: '댓글 지우기',
      body: '이 댓글을 지울까요?',
      note: c.mine ? undefined : me.isAdmin ? '운영자로 지워요.' : '내가 만든 갤러리의 댓글이라 지울 수 있어요.',
      ok: '지우기',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/share/comments/${c.id}`, { method: 'DELETE' });
      toast('댓글을 지웠어요.', 'ok', DONE);
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const block = async (c: CommentView) => {
    const ok = await ask({
      title: '차단하기',
      body: `${c.authorName}님을 차단할까요?`,
      note: '이 사람이 쓴 글과 댓글이 내 화면에서 보이지 않아요. 내 활동에서 언제든 풀 수 있어요.',
      ok: '차단',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('/api/share/blocks', { method: 'POST', body: JSON.stringify({ comment: c.id }) });
      toast('차단했어요.', 'ok', DONE);
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const one = (c: CommentView, reply: boolean) => {
    const l = likes[c.id] ?? { liked: c.liked, n: c.likes };
    const items: MenuItem[] = c.deleted
      ? []
      : [
          ...(c.mine || me.isAdmin ? [{ label: '고치기', icon: ICONS.pen, onSelect: () => setEditing(c.id) }] : []),
          ...(c.canDelete ? [{ label: '지우기', icon: ICONS.trash, onSelect: () => remove(c), danger: true }] : []),
          ...(!c.mine ? [{ label: '신고', icon: ICONS.flag, onSelect: () => setReporting(c.id) }] : []),
          ...(!c.mine ? [{ label: '차단', icon: ICONS.block, onSelect: () => block(c), danger: true }] : []),
        ];
    return (
      <li key={c.id} className={cx('grid gap-1.5', reply ? 'rounded-2xl bg-surface-2 px-3.5 py-3' : 'py-3')}>
        {c.deleted ? (
          <p className="text-sm text-muted">{c.blocked ? '차단한 사람의 댓글이에요.' : '지운 댓글이에요.'}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-sm font-semibold">{c.authorName}</span>
              {c.byPostAuthor && !/글쓴이/.test(c.authorName) ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">글쓴이</span>
              ) : null}
              <span className="text-xs text-muted">
                {timeAgo(c.createdAt)}
                {c.edited ? ' · 고침' : ''}
              </span>
              {c.hidden && c.body ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn">가려짐</span> : null}
              {items.length ? (
                <span className="ml-auto">
                  <Menu label="댓글 메뉴" items={items} small />
                </span>
              ) : null}
            </div>
            {editing === c.id ? (
              <EditBox
                initial={c.body}
                onCancel={() => setEditing(null)}
                onSave={async (text) => {
                  if (await saveEdit(c, text)) setEditing(null);
                }}
              />
            ) : c.hidden && !c.body ? (
              <p className="text-sm text-muted">신고가 쌓여 가려진 댓글이에요.</p>
            ) : (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{c.body}</p>
            )}
            <div className={cx('flex items-center gap-1.5', editing === c.id && 'hidden')}>
              <LikeButton small liked={l.liked} count={l.n} onToggle={() => like(c)} />
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => {
                    setReplyTo(c);
                    requestAnimationFrame(() => box.current?.focus());
                  }}
                  className="press inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <Icon d={ICONS.reply} size={14} strokeWidth={2.2} />
                  답글
                </button>
              ) : null}
            </div>
          </>
        )}
      </li>
    );
  };

  return (
    <section className="kok-card grid gap-1 p-4" aria-label="댓글">
      <h2 className="font-display text-lg">댓글 {thread.filter((c) => !c.deleted).length}</h2>
      {top.length ? (
        <ul className="divide-y divide-line">
          {top.map((c) => (
            <li key={c.id} className="list-none">
              <ul className="grid">{one(c, false)}</ul>
              {repliesOf(c.id).length ? <ul className="mb-3 ml-5 grid gap-2">{repliesOf(c.id).map((r) => one(r, true))}</ul> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-sm text-muted">아직 댓글이 없어요. 고마운 마음이나 궁금한 것을 남겨 보세요.</p>
      )}
      {canWrite ? (
        <CommentBox
          postId={postId}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          boxRef={box}
          onSent={async () => {
            setReplyTo(null);
            await onChanged();
          }}
          ensureName={() => ensureNickname(me, askText, refresh, toast)}
        />
      ) : null}
      <ShareReportSheet what={reporting ? { kind: 'comment', id: reporting } : null} onClose={() => setReporting(null)} />
    </section>
  );
}

function CommentBox({
  postId,
  replyTo,
  onCancelReply,
  boxRef,
  onSent,
  ensureName,
}: {
  postId: string;
  replyTo: CommentView | null;
  onCancelReply: () => void;
  boxRef: React.RefObject<HTMLTextAreaElement | null>;
  onSent: () => Promise<void>;
  ensureName: () => Promise<boolean>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    if (!anonymous && !(await ensureName())) return;
    setBusy(true);
    try {
      await api(`/api/share/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body, parentId: replyTo?.id ?? null, anonymous }) });
      setText('');
      toast(replyTo ? '답글을 달았어요.' : '댓글을 달았어요.', 'ok', DONE);
      await onSent();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-2 grid gap-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {replyTo ? (
        <p className="flex items-center gap-2 text-sm">
          <Icon d={ICONS.reply} size={15} className="text-muted" />
          <span className="min-w-0 truncate">
            <b>{replyTo.authorName}</b>님에게 답글
          </span>
          <button type="button" onClick={onCancelReply} className="press ml-auto rounded-full px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2">
            그만두기
          </button>
        </p>
      ) : null}
      <textarea
        ref={boxRef}
        aria-label={replyTo ? '답글' : '댓글'}
        className={cx(inputClass, 'min-h-[76px]')}
        value={text}
        maxLength={SHARE_TEXT.comment}
        placeholder={replyTo ? '답글을 적어 주세요' : '댓글을 적어 주세요'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // 컴퓨터: ⌘·Ctrl+엔터로 보내기 (한글 조합 중에는 보내지 않는다)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Toggle id={`anon-${postId}`} label="익명으로" checked={anonymous} onChange={setAnonymous} />
        </div>
        <Button type="submit" busy={busy} disabled={!text.trim()}>
          {replyTo ? '답글 달기' : '댓글 달기'}
        </Button>
      </div>
    </form>
  );
}

/** 댓글 그 자리에서 고치기 (여러 줄, ⌘·Ctrl+엔터 = 저장, Esc = 그만두기) */
function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <textarea
        aria-label="댓글 고치기"
        autoFocus
        className={cx(inputClass, 'min-h-[76px]')}
        value={text}
        maxLength={SHARE_TEXT.comment}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !confirmOpen()) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          그만두기
        </Button>
        <Button size="sm" onClick={save} busy={busy} disabled={!text.trim()}>
          저장
        </Button>
      </div>
    </div>
  );
}
