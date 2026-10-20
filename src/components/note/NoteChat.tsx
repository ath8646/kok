'use client';
// 노트 채팅: 노트 화면 오른쪽 아래의 채팅 버튼을 누르면 '자료 넣기' 창처럼 이 화면 안에서 열린다.
// 노트 내용(과 일반 지식)으로 답하고, 답마다 에너지를 쓴다. 대화는 노트마다 저장된다.
// 사진·파일을 붙이거나 사진을 찍어 물어볼 수 있다: 문제를 보내면 단계로 풀어 주고(Pro 는 그림으로), 푼 문제는 이 노트 문제로 넣을 수 있다.
// 붙인 파일은 Pro 만 기록에 보관하고, 아니면 이름만 남는다.
// AI 가 문제·노트에 넣자고 하면 미리보기를 보여 주고, 학생이 [넣기]를 눌러야 들어간다.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RichText } from '@/components/RichText';
import { useMe } from '@/components/AppShell';
import { ApiError, Button, Energy, EnergyEstimate, ICONS, Icon, Menu, api, cx, useToast } from '@/components/ui';
import {
  ChatDropHint,
  ChatInput,
  ImageViewer,
  PickStrip,
  SentFiles,
  SolutionCard,
  ThinkingRow,
  TierPicker,
  useChatAttach,
  useKeyboardInset,
  type SentFile,
} from '@/components/chat/ChatKit';
import { THINK_OUT, estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { picksTokens, prepareChatFiles, releasePicks, type ChatPick } from '@/lib/chat-files';
import { FILE_ONLY_CONTENT, type ChatMessage, type ChatProposal, type ChatQuestion } from '@/lib/chat';
import type { ModelTier } from '@/lib/settings';

const CHAT_ICON = 'M4 5.5h16v10H9l-5 4zM8 9.5h8M8 12.5h5';
const SUGGESTIONS = ['핵심만 3줄로 정리해 줘', '제일 헷갈리기 쉬운 부분을 쉽게 설명해 줘', '시험에 나올 만한 걸 알려 줘'];
/** 창을 열 때 보여 주는 대화 수 (가장 최근 것부터) */
const CHAT_SHOWN = 200;
const BASE_COLS = 'id, role, content, model, energy, proposal, created_at';

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
  const [viewer, setViewer] = useState<SentFile | null>(null);
  /** 보관한 사진·PDF 의 한 번짜리 주소 (경로 → 주소) */
  // 보관한 파일의 보기 주소 (한 시간 짜리라 끝나기 전에 다시 받는다)
  const [urls, setUrls] = useState<Map<string, { url: string; exp: number }>>(() => new Map());
  const tried = useRef(new Set<string>());
  /** 이번에 보낸 말의 사진 미리보기 (말 번호 → 파일): 보관하지 않는 사진도 창을 닫기 전까지는 보인다 */
  const [local, setLocal] = useState<Map<string, SentFile[]>>(new Map());
  const localPicks = useRef<ChatPick[]>([]);
  const fab = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempSeq = useRef(0);
  const router = useRouter();
  const attach = useChatAttach(open, toast);
  const kb = useKeyboardInset(open);
  const filesOn = !!me?.features.chatFiles;

  const load = useCallback(async () => {
    // 가장 최근 200개 (오래된 것부터 보이게 뒤집는다)
    const { data, error } = await sb()
      .from('chat_messages')
      .select(filesOn ? `${BASE_COLS}, attachments, solution` : BASE_COLS)
      .eq('note_id', noteId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CHAT_SHOWN);
    if (error) {
      setMessages([]);
      return;
    }
    const rows = ((data ?? []) as unknown as ChatMessage[]).reverse();
    // 가장 오래된 쪽이 잘렸으면 질문 없이 남은 답부터 시작하지 않게 한다
    if (rows.length >= CHAT_SHOWN) while (rows[0]?.role === 'assistant') rows.shift();
    setMessages(rows);
  }, [noteId, filesOn]);

  // 보관한 파일(Pro)의 주소를 한 번에 받는다 (내 폴더만 읽을 수 있다). 받지 못한 파일(지운 파일 등)은
  // 창을 다시 열 때까지 다시 묻지 않는다 (계속 묻지 않게). 다시 열면 끝난 주소도 새로 받는다
  useEffect(() => {
    if (!open) {
      tried.current.clear();
      return;
    }
    if (!messages) return;
    const now = Date.now();
    const paths = [
      ...new Set(
        messages
          .flatMap((m) => (m.attachments ?? []).map((a) => a.path))
          .filter((p): p is string => !!p && !tried.current.has(p) && (urls.get(p)?.exp ?? 0) < now),
      ),
    ];
    if (!paths.length) return;
    const asked = tried.current;
    for (const p of paths) asked.add(p);
    let alive = true;
    let done = false;
    sb()
      .storage.from('sources')
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        done = true;
        if (!alive) return;
        const got = (data ?? []).flatMap((d) => (d.path && d.signedUrl ? [{ path: d.path, url: d.signedUrl }] : []));
        if (!got.length) return;
        const exp = Date.now() + 55 * 60_000;
        setUrls((cur) => {
          const next = new Map(cur);
          for (const d of got) next.set(d.path, { url: d.url, exp });
          return next;
        });
      })
      .catch(() => {
        done = true;
        for (const p of paths) asked.delete(p);
      });
    return () => {
      alive = false;
      // 받기 전에 다시 그리게 되면 다음 번에 이어서 받는다
      if (!done) for (const p of paths) asked.delete(p);
    };
  }, [open, messages, urls]);

  // 창이 없어질 때 이번에 보낸 사진의 미리보기 주소를 돌려준다
  useEffect(() => () => releasePicks(localPicks.current), []);

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

  // 창을 열 때만 입력칸으로 (사진 보기를 열고 닫을 때 뒤의 입력칸이 키보드를 띄우지 않게)
  useEffect(() => {
    if (open) area.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !viewer) hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide, viewer]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // 새 말이 오면 맨 아래로
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open]);

  const history = useMemo(() => (messages ?? []).slice(-12).reduce((a, m) => a + Math.min(1500, m.content.length), 0), [messages]);
  if (!me) return null;
  const tiers: ModelTier[] = me.isAdmin ? ['fast', 'careful', 'admin'] : ['fast', 'careful'];
  const locked = (t: ModelTier) => t !== 'fast' && !me.canCareful && !me.isAdmin;
  const model = clientModel(me, tier);
  const est = estimateSmallTask(
    model,
    me.usdPerEnergy,
    Math.ceil(1500 + (Math.min(noteChars, 16_000) + history + text.length) * 0.9 + picksTokens(attach.picks)),
    attach.picks.length ? THINK_OUT.chatSolve : THINK_OUT.chat,
  );
  const left = me.energy.unlimited ? null : Math.floor(me.energy.remaining ?? 0);
  const allowQuestions = me.settings.chat.allowQuestions;
  const canSend = !sending && (!!text.trim() || attach.picks.length > 0);

  const pickTier = (t: ModelTier) => {
    if (locked(t)) {
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
    if (sending || (!message && !attach.picks.length)) return;
    if (!me.aiEnabled) {
      toast('지금은 AI 기능을 잠깐 쉬고 있어요.', 'bad');
      return;
    }
    if (left !== null && est > left) {
      toast(`에너지가 부족해요. 필요: 약 ${est}, 남음: ${left}.`, 'bad');
      return;
    }
    const picks = attach.take();
    localPicks.current.push(...picks);
    const files: SentFile[] = picks.map((p) => ({ kind: p.kind, name: p.file.name, url: p.preview }));
    setSending(true);
    const temp: ChatMessage = {
      id: `temp-${++tempSeq.current}`,
      role: 'user',
      content: message || FILE_ONLY_CONTENT,
      model: null,
      energy: 0,
      proposal: null,
      created_at: '',
    };
    setMessages((m) => [...(m ?? []), temp]);
    if (files.length) setLocal((cur) => new Map(cur).set(temp.id, files));
    setText('');
    try {
      const attachments = await prepareChatFiles(picks);
      const r = await api<{ messages: ChatMessage[] }>(`/api/notes/${noteId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message, tier, attachments }),
      });
      const userRow = r.messages.find((x) => x.role === 'user');
      if (files.length && userRow) setLocal((cur) => new Map(cur).set(userRow.id, files));
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== temp.id), ...r.messages]);
      refresh();
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== temp.id));
      setText((cur) => cur || message);
      attach.restore(picks);
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

  /** AI 가 풀어 준 문제를 이 노트의 문제로 넣는다 (그림 풀이도 같이) */
  const saveProblem = async (msg: ChatMessage) => {
    setApplying(msg.id);
    try {
      await api(`/api/notes/${noteId}/chat/apply`, { method: 'POST', body: JSON.stringify({ messageId: msg.id, action: 'save_problem' }) });
      setMessages((m) => (m ?? []).map((x) => (x.id === msg.id && x.solution ? { ...x, solution: { ...x.solution, saved: true } } : x)));
      toast('이 노트 문제로 넣었어요. 오늘부터 복습에 나와요.', 'ok');
      onApplied();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'done') load();
      toast((e as Error).message, 'bad');
    } finally {
      setApplying(null);
    }
  };

  const clear = async () => {
    if (!confirm(`이 노트의 대화를 모두 지울까요?${filesOn && me.keepChatFiles ? ' 대화에 붙인 사진·파일도 같이 지워져요.' : ''}`)) return;
    try {
      // 보관한 파일은 학생이 지울 수 없어서 서버가 지운다 (파일 칸이 없는 예전 DB 는 기록만 지운다)
      if (filesOn) await api(`/api/notes/${noteId}/chat`, { method: 'DELETE' });
      else {
        const { error } = await sb().from('chat_messages').delete().eq('note_id', noteId);
        if (error) throw error;
      }
      setMessages([]);
      setLocal(new Map());
    } catch {
      toast('지우지 못했어요.', 'bad');
    }
  };

  /** 보낸 말의 파일: 이번에 보낸 것은 미리보기, 보관한 것은 받은 주소, 아니면 이름만 */
  const filesOf = (m: ChatMessage): SentFile[] => {
    const mine = local.get(m.id);
    if (mine) return mine;
    return (m.attachments ?? []).map((a) => ({ kind: a.kind, name: a.name, url: a.path ? (urls.get(a.path)?.url ?? null) : null }));
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
          {/* 폰: 위에서 내려오고, 아래쪽 채팅 버튼(닫기)을 가리지 않는 높이까지만 커진다 */}
          <div
            data-closing={closing}
            style={kb ? { top: kb.top + 8, maxHeight: kb.height - 16 } : undefined}
            className="kok-composer kok-card absolute inset-x-3 top-[calc(12px+env(safe-area-inset-top))] flex max-h-[calc(100dvh-162px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col rounded-[28px] shadow-[0_24px_60px_var(--shadow-strong)] sm:inset-x-auto sm:bottom-[104px] sm:right-8 sm:top-auto sm:max-h-[min(680px,calc(100dvh-136px))] sm:w-[460px]"
          >
            {attach.dragging ? <ChatDropHint /> : null}
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
                  <p className="text-sm text-muted">
                    이 노트에 대해 무엇이든 물어보세요. 노트를 바탕으로 답하고, 노트 밖 설명을 보태면 따로 알려 줘요. 모르는 문제는 사진을 찍어 보내면 단계별로
                    풀어 줘요.
                  </p>
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
                  {messages.map((m) => {
                    const files = m.role === 'user' ? filesOf(m) : [];
                    const showText = !(files.length && m.content === FILE_ONLY_CONTENT);
                    return (
                      <li key={m.id} className={cx('kok-rise grid gap-1.5', m.role === 'user' ? 'justify-items-end' : 'justify-items-start')}>
                        {files.length ? <SentFiles files={files} onOpenImage={setViewer} /> : null}
                        {showText ? (
                          <div
                            className={cx(
                              'max-w-[88%] rounded-[20px] px-3.5 py-2.5 text-[15px] leading-relaxed',
                              m.role === 'user' ? 'rounded-br-md bg-accent text-accent-ink' : 'rounded-bl-md bg-surface-2 text-ink',
                            )}
                          >
                            <RichText text={m.content} />
                          </div>
                        ) : null}
                        {m.role === 'assistant' && m.solution ? (
                          <SolutionCard
                            solution={m.solution}
                            actions={
                              m.solution.question ? (
                                m.solution.saved ? (
                                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ok">
                                    <Icon d={ICONS.check} size={16} strokeWidth={2.6} />이 노트 문제로 넣었어요
                                  </span>
                                ) : (
                                  <Button size="sm" variant="ink" busy={applying === m.id} onClick={() => saveProblem(m)}>
                                    이 노트 문제로 넣기
                                  </Button>
                                )
                              ) : null
                            }
                          />
                        ) : null}
                        {m.role === 'assistant' ? (
                          <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted">
                            {m.proposal?.outside ? (
                              <span className="rounded-full bg-warn-soft px-2 py-0.5 font-semibold text-warn">노트 밖 설명 포함</span>
                            ) : null}
                            {m.energy ? <Energy n={Math.round(Number(m.energy) * 10) / 10} /> : null}
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
                    );
                  })}
                  {sending ? (
                    <ThinkingRow
                      label={
                        local.size && messages.at(-1)?.id.startsWith('temp-') && local.has(messages.at(-1)!.id)
                          ? '사진·파일을 읽고 푸는 중'
                          : '노트를 보고 답하는 중'
                      }
                    />
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
                <TierPicker tiers={tiers} tier={tier} locked={locked} onPick={pickTier} />
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
                  <EnergyEstimate est={est} left={left} />
                </span>
              </div>
              <PickStrip picks={attach.picks} onRemove={attach.remove} />
              <ChatInput
                text={text}
                onText={setText}
                onFiles={attach.add}
                onSend={() => send()}
                canSend={canSend}
                sending={sending}
                placeholder={attach.picks.length ? '덧붙일 말 (없어도 돼요)' : '노트에 대해 물어보세요'}
                areaRef={area}
              />
              {attach.picks.length && !me.keepChatFiles ? (
                <p className="px-1 text-[11px] text-muted">사진·파일은 답을 만드는 데만 쓰고, 기록에는 이름만 남아요 (보관은 Pro).</p>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
      {viewer?.url ? <ImageViewer src={viewer.url} alt={viewer.name} onClose={() => setViewer(null)} /> : null}
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
          <span className={cx('inline-flex items-center gap-1 text-sm font-semibold', proposal.status === 'applied' ? 'text-ok' : 'text-muted')}>
            {proposal.status === 'applied' ? (
              <>
                <Icon d={ICONS.check} size={16} strokeWidth={2.6} />
                넣었어요
              </>
            ) : (
              '넣지 않았어요'
            )}
          </span>
        )}
      </div>
    </div>
  );
}
