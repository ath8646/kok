'use client';
// 노트 채팅: 노트 화면의 주황 버튼을 누르면 '자료 넣기' 창처럼 이 화면 안에서 열린다.
// 노트 내용(과 일반 지식)으로 답하고, 답마다 에너지를 쓴다. 대화는 노트마다 저장된다.
// AI 가 문제·노트에 넣자고 하면 미리보기를 보여 주고, 학생이 [넣기]를 눌러야 들어간다.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RichText } from '@/components/RichText';
import { useMe } from '@/components/AppShell';
import { ApiError, Button, ICONS, Icon, Menu, Spinner, api, cx, useToast } from '@/components/ui';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { isSubmitKey } from '@/lib/quick-add';
import type { ChatMessage, ChatProposal, ChatQuestion } from '@/lib/chat';
import type { ModelTier } from '@/lib/settings';

const CHAT_ICON = 'M4 5.5h16v10H9l-5 4zM8 9.5h8M8 12.5h5';
const TIER_LABEL: Record<ModelTier, string> = { fast: '빠름', careful: '꼼꼼', admin: '최고' };
const SUGGESTIONS = ['핵심만 3줄로 정리해 줘', '제일 헷갈리기 쉬운 부분을 쉽게 설명해 줘', '시험에 나올 만한 걸 알려 줘'];

function answerText(q: ChatQuestion): string {
  if (q.type === 'mcq') return q.choices?.[Number(q.answer)] ?? '';
  if (q.type === 'ox') return q.answer ? 'O' : 'X';
  return String(q.answer ?? '');
}

const TYPE_LABEL: Record<ChatQuestion['type'], string> = { mcq: '객관식', ox: 'OX', cloze: '빈칸', short: '단답' };

/** 노트에게 물어보기 버튼 + 채팅 창 */
export function NoteChat({
  noteId,
  noteTitle,
  noteChars,
  keyPointTitle,
  onApplied,
}: {
  noteId: string;
  noteTitle: string;
  /** 보낼 노트의 대략적인 길이 (예상 에너지) */
  noteChars: number;
  /** 개념 번호 → 이름 (노트에 넣을 곳 보여 주기) */
  keyPointTitle: (id: string) => string | null;
  /** 문제·노트에 넣었을 때 (노트를 새로 읽는다) */
  onApplied: () => void;
}) {
  const { me, refresh } = useMe();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [tier, setTier] = useState<ModelTier>(() => me?.settings.models.chat ?? 'fast');
  const fab = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempSeq = useRef(0);
  const router = useRouter();
  // 폰에서 키보드가 열리면 보이는 화면(visualViewport)에 맞춰 창을 줄인다 (아래 입력칸이 키보드에 가리지 않게)
  const [kb, setKb] = useState<{ height: number; top: number } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb()
      .from('chat_messages')
      .select('id, role, content, model, energy, proposal, created_at')
      .eq('note_id', noteId)
      .order('created_at')
      .limit(200);
    if (error) {
      setMessages([]);
      return;
    }
    setMessages((data ?? []) as ChatMessage[]);
  }, [noteId]);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
    if (messages === null) load();
  };
  const hide = useCallback(() => {
    setClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
      fab.current?.focus({ preventScroll: true });
    }, 140);
  }, []);

  useEffect(() => {
    if (!open) return;
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    const v = typeof window === 'undefined' ? null : window.visualViewport;
    if (!open || !v) return;
    const onResize = () => {
      const covered = window.innerHeight - v.height;
      setKb(covered > 120 && window.innerWidth < 640 ? { height: v.height, top: v.offsetTop } : null);
    };
    v.addEventListener('resize', onResize);
    v.addEventListener('scroll', onResize);
    return () => {
      v.removeEventListener('resize', onResize);
      v.removeEventListener('scroll', onResize);
    };
  }, [open]);

  // 새 말이 오면 맨 아래로
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open]);

  // 입력칸 높이를 글에 맞춘다
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text, open]);

  const history = useMemo(() => (messages ?? []).slice(-12).reduce((a, m) => a + Math.min(1500, m.content.length), 0), [messages]);
  if (!me) return null;
  const tiers: ModelTier[] = me.isAdmin ? ['fast', 'careful', 'admin'] : ['fast', 'careful'];
  const model = clientModel(me, tier);
  const est = estimateSmallTask(model, me.usdPerEnergy, Math.ceil(1500 + (Math.min(noteChars, 16_000) + history + text.length) * 0.9), 700);
  const left = me.energy.unlimited ? null : Math.floor(me.energy.remaining ?? 0);
  const allowQuestions = me.settings.chat.allowQuestions;

  const pickTier = (t: ModelTier) => {
    if (t !== 'fast' && !me.canCareful && !me.isAdmin) {
      toast('꼼꼼 모델은 Pro에서 쓸 수 있어요.');
      return;
    }
    setTier(t);
    // 마지막에 고른 모델을 기억한다
    const settings = { ...me.settings, models: { ...me.settings.models, chat: t } };
    sb()
      .from('profiles')
      .update({ settings })
      .eq('id', me.userId)
      .then(({ error }) => {
        if (!error) refresh();
      });
  };

  const send = async (raw?: string) => {
    const message = (raw ?? text).trim();
    if (!message || sending) return;
    if (!me.aiEnabled) {
      toast('지금은 AI 기능을 잠깐 쉬고 있어요.', 'bad');
      return;
    }
    if (left !== null && est > left) {
      toast(`에너지가 부족해요. 필요: 약 ${est}, 남음: ${left}.`, 'bad');
      return;
    }
    setSending(true);
    const temp: ChatMessage = {
      id: `temp-${++tempSeq.current}`,
      role: 'user',
      content: message,
      model: null,
      energy: 0,
      proposal: null,
      created_at: '',
    };
    setMessages((m) => [...(m ?? []), temp]);
    setText('');
    try {
      const r = await api<{ messages: ChatMessage[] }>(`/api/notes/${noteId}/chat`, { method: 'POST', body: JSON.stringify({ message, tier }) });
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== temp.id), ...r.messages]);
      refresh();
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== temp.id));
      setText((cur) => cur || message);
      toast((e as Error).message, 'bad');
    } finally {
      setSending(false);
      area.current?.focus();
    }
  };

  const decide = async (msg: ChatMessage, action: 'apply' | 'cancel') => {
    setApplying(msg.id);
    try {
      const r = await api<{ status: 'applied' | 'cancelled'; added: number }>(`/api/notes/${noteId}/chat/apply`, {
        method: 'POST',
        body: JSON.stringify({ messageId: msg.id, action }),
      });
      setMessages((m) =>
        (m ?? []).map((x) => (x.id === msg.id && x.proposal && x.proposal.kind !== 'none' ? { ...x, proposal: { ...x.proposal, status: r.status } } : x)),
      );
      if (r.status === 'applied') {
        toast(msg.proposal?.kind === 'questions' ? `문제 ${r.added}개를 넣었어요.` : '노트에 넣었어요.', 'ok');
        onApplied();
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'done') load();
      toast((e as Error).message, 'bad');
    } finally {
      setApplying(null);
    }
  };

  const clear = async () => {
    if (!confirm('이 노트의 대화를 모두 지울까요?')) return;
    const { error } = await sb().from('chat_messages').delete().eq('note_id', noteId);
    if (error) toast('지우지 못했어요.', 'bad');
    else setMessages([]);
  };

  return (
    <>
      <button
        ref={fab}
        type="button"
        className={cx(
          'kok-fab fixed bottom-[calc(80px+env(safe-area-inset-bottom))] right-4 grid h-[58px] w-[58px] place-items-center rounded-full bg-fab text-fab-ink md:bottom-8 md:right-8',
          open ? 'z-[56]' : 'z-40',
        )}
        aria-label={open ? '채팅 닫기' : '노트에게 물어보기'}
        aria-expanded={open && !closing}
        onClick={() => (open ? hide() : show())}
      >
        <span className="grid place-items-center">
          <Icon d={open && !closing ? ICONS.close : CHAT_ICON} size={open && !closing ? 24 : 26} strokeWidth={2.2} />
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="노트에게 물어보기">
          <button type="button" aria-label="닫기" className="kok-scrim absolute inset-0 cursor-default" onClick={hide} />
          {/* 폰: 위에서 내려오고, 아래쪽 주황 버튼(닫기)을 가리지 않는 높이까지만 커진다 */}
          <div
            data-closing={closing}
            style={kb ? { top: kb.top + 8, maxHeight: kb.height - 16 } : undefined}
            className="kok-composer kok-card absolute inset-x-3 top-[calc(12px+env(safe-area-inset-top))] flex max-h-[calc(100dvh-162px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col rounded-[28px] shadow-[0_24px_60px_var(--shadow-strong)] sm:inset-x-auto sm:bottom-[104px] sm:right-8 sm:top-auto sm:max-h-[min(680px,calc(100dvh-136px))] sm:w-[460px]"
          >
            <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
                <Icon d={CHAT_ICON} size={19} strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[17px] leading-tight">노트에게 물어보기</p>
                <p className="truncate text-xs text-muted">{noteTitle}</p>
              </div>
              <Menu
                label="채팅 메뉴"
                small
                items={[
                  { label: '대화 모두 지우기', icon: ICONS.trash, danger: true, onSelect: clear },
                  { label: '채팅 설정', icon: ICONS.edit, onSelect: () => router.push('/settings#chat') },
                ]}
              />
              <button
                type="button"
                onClick={hide}
                className="press grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-2"
                aria-label="닫기"
              >
                <Icon d={ICONS.close} size={18} />
              </button>
            </div>

            <div ref={list} className="min-h-[120px] flex-1 overflow-y-auto px-4 py-2" role="log" aria-live="polite" aria-label="대화">
              {messages === null ? (
                <div className="grid gap-2 py-2">
                  <div className="kok-shimmer h-10 w-2/3 rounded-2xl" />
                  <div className="kok-shimmer ml-auto h-10 w-1/2 rounded-2xl" />
                </div>
              ) : messages.length === 0 ? (
                <div className="grid gap-3 py-3">
                  <p className="text-sm text-muted">이 노트에 대해 무엇이든 물어보세요. 노트를 바탕으로 답하고, 노트 밖 설명을 보태면 따로 알려 줘요.</p>
                  <div className="flex flex-wrap gap-2">
                    {[...SUGGESTIONS, ...(allowQuestions ? ['이 노트로 문제 3개 만들어 줘'] : [])].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="press rounded-full bg-surface-2 px-3 py-1.5 text-left text-sm font-semibold hover:bg-surface-3"
                        onClick={() => send(s)}
                        disabled={sending}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ul className="grid gap-3 pb-1">
                  {messages.map((m) => (
                    <li key={m.id} className={cx('kok-rise grid gap-1.5', m.role === 'user' ? 'justify-items-end' : 'justify-items-start')}>
                      <div
                        className={cx(
                          'max-w-[88%] rounded-[20px] px-3.5 py-2.5 text-[15px] leading-relaxed',
                          m.role === 'user' ? 'rounded-br-md bg-accent text-accent-ink' : 'rounded-bl-md bg-surface-2 text-ink',
                        )}
                      >
                        <RichText text={m.content} />
                      </div>
                      {m.role === 'assistant' ? (
                        <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted">
                          {m.proposal?.outside ? (
                            <span className="rounded-full bg-warn-soft px-2 py-0.5 font-semibold text-warn">노트 밖 설명 포함</span>
                          ) : null}
                          {m.energy ? <span>⚡ {Math.round(Number(m.energy) * 10) / 10}</span> : null}
                        </div>
                      ) : null}
                      {m.proposal && m.proposal.kind !== 'none' ? (
                        <ProposalCard
                          proposal={m.proposal}
                          busy={applying === m.id}
                          keyPointTitle={keyPointTitle}
                          onApply={() => decide(m, 'apply')}
                          onCancel={() => decide(m, 'cancel')}
                        />
                      ) : null}
                    </li>
                  ))}
                  {sending ? (
                    <li className="flex items-center gap-2 px-1 text-sm text-muted" aria-label="답을 만드는 중">
                      <span className="inline-flex gap-1" aria-hidden="true">
                        <span className="kok-dot h-1.5 w-1.5 rounded-full bg-muted" />
                        <span className="kok-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:120ms]" />
                        <span className="kok-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:240ms]" />
                      </span>
                      노트를 보고 답하는 중
                    </li>
                  ) : null}
                </ul>
              )}
            </div>

            <form
              className="grid gap-2 border-t border-line px-3 pb-3 pt-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="inline-flex gap-0.5 rounded-full bg-surface-2 p-0.5" role="radiogroup" aria-label="AI 모델">
                  {tiers.map((t) => {
                    const locked = t !== 'fast' && !me.canCareful && !me.isAdmin;
                    return (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={tier === t}
                        onClick={() => pickTier(t)}
                        className={cx(
                          'press rounded-full px-2.5 py-1 text-xs font-bold transition-colors',
                          tier === t ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
                          locked && 'opacity-60',
                        )}
                      >
                        {TIER_LABEL[t]}
                        {locked ? ' · Pro' : ''}
                      </button>
                    );
                  })}
                </div>
                <span className="text-xs font-semibold text-muted">{[`⚡ 약 ${est}`, left !== null ? `남음 ${left}` : ''].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  ref={area}
                  rows={1}
                  enterKeyHint="send"
                  className="max-h-[140px] min-h-[44px] w-full resize-none rounded-[22px] bg-surface-2 px-4 py-2.5 text-[16px] leading-snug text-ink placeholder:text-muted/80 focus:outline-none"
                  placeholder="노트에 대해 물어보세요"
                  value={text}
                  maxLength={2000}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (isSubmitKey(e.nativeEvent)) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  aria-label="물어볼 내용"
                />
                <button
                  type="submit"
                  className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-35"
                  disabled={!text.trim() || sending}
                  aria-label="보내기"
                >
                  {sending ? <Spinner className="h-4 w-4" /> : <Icon d={ICONS.send} size={19} strokeWidth={2.2} />}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProposalCard({
  proposal,
  busy,
  keyPointTitle,
  onApply,
  onCancel,
}: {
  proposal: Exclude<ChatProposal, { kind: 'none' }>;
  busy: boolean;
  keyPointTitle: (id: string) => string | null;
  onApply: () => void;
  onCancel: () => void;
}) {
  const pending = proposal.status === 'pending';
  return (
    <div className="w-full max-w-[88%] rounded-[20px] border border-line bg-surface p-3">
      {proposal.kind === 'questions' ? (
        <>
          <p className="text-xs font-bold text-accent">이 문제 {proposal.questions.length}개를 노트에 넣을까요?</p>
          <ol className="mt-2 grid gap-2">
            {proposal.questions.map((q, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <span className="mr-1 text-xs font-bold text-muted">{TYPE_LABEL[q.type]}</span>
                <RichText text={q.prompt} />
                {q.type === 'mcq' && q.choices ? (
                  <ul className="mt-1 grid gap-0.5 text-[13px] text-muted">
                    {q.choices.map((c, j) => (
                      <li key={j} className={cx(j === Number(q.answer) && 'font-semibold text-ok')}>
                        {j + 1}. <RichText text={c} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 text-[13px] font-semibold text-ok">
                    정답: <RichText text={answerText(q)} />
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <p className="text-xs font-bold text-accent">
            {proposal.addition.key_point_id && keyPointTitle(proposal.addition.key_point_id)
              ? `'${keyPointTitle(proposal.addition.key_point_id)}' 개념에 넣을까요?`
              : `새 개념 '${proposal.addition.title || '추가한 내용'}'으로 넣을까요?`}
          </p>
          <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <RichText text={proposal.addition.text} />
          </p>
        </>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        {pending ? (
          <>
            <Button size="sm" busy={busy} onClick={onApply}>
              넣기
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
              취소
            </Button>
          </>
        ) : (
          <span className={cx('text-sm font-semibold', proposal.status === 'applied' ? 'text-ok' : 'text-muted')}>
            {proposal.status === 'applied' ? '넣었어요 ✓' : '넣지 않았어요'}
          </span>
        )}
      </div>
    </div>
  );
}
