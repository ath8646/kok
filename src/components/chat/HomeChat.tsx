'use client';
// 홈의 'AI에게 물어보기': 위쪽 물어보기 줄을 누르면 자료 넣기 창처럼 채팅 창이 뜬다.
// 아무 과목이나 묻고, 사진·파일로 문제를 보내면 단계로 풀어 준다 (Pro 는 그림으로 보는 단계).
// 대화는 저장하지 않는다: 홈에 있는 동안만 남고 홈을 떠나면 사라진다. 푼 문제는 과목·단원·노트를 골라 노트 문제로 넣을 수 있다.
import { perkNeed } from '@/lib/plans';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { useConfirm } from '@/components/Confirm';
import { AiMark, ReportButton, ReportSheet, type ReportWhat } from '@/components/ReportSheet';
import { RichText } from '@/components/RichText';
import { Energy, EnergyEstimate, ICONS, Icon, Menu, api, cx, useToast, DONE } from '@/components/ui';
import { THINK_OUT, estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { picksTokens, prepareChatFiles, releasePicks, type ChatPick } from '@/lib/chat-files';
import type { ChatSolution, ChatTurn, HomeChatReply } from '@/lib/chat';
import { chatSnapshot } from '@/lib/report';
import type { ModelTier } from '@/lib/settings';
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
} from './ChatKit';
import { SaveProblemSheet, type SavedPlace } from './SaveProblemSheet';

const SPARKLE = ICONS.sparkle;

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 보낸 사진·파일 (사진은 이 화면에서만 쓰는 미리보기 주소) */
  files?: SentFile[];
  picks?: ChatPick[];
  solution?: ChatSolution | null;
  energy?: number;
  /** 노트 문제로 넣은 곳 */
  saved?: SavedPlace | null;
};

const SUGGESTIONS: Array<{ label: string; text?: string; camera?: boolean }> = [
  { label: '사진으로 문제 풀기', camera: true },
  { label: '이차방정식 풀어 줘', text: '$x^2-5x+6=0$ 을 풀어 줘' },
  { label: '광합성 쉽게 설명해 줘', text: '광합성을 쉽게 설명해 줘' },
  { label: '영어 문장 해석해 줘', text: '"I wish I had studied harder." 해석하고 문법도 알려 줘' },
];

/** 대화 기록 한 줄 (AI 에 보낼 때): 붙인 파일은 이름만, 푼 문제는 읽은 문제를 덧붙인다 (서버 historyLine 과 같게) */
function turnOf(m: Msg): ChatTurn {
  const files = (m.files ?? []).map((f) => `[${f.kind === 'image' ? '사진' : f.kind === 'pdf' ? 'PDF' : '글 파일'}: ${f.name}]`).join(' ');
  const problem = m.solution?.problem ? `\n(풀이한 문제: ${m.solution.problem.slice(0, 600)})` : '';
  return { role: m.role, content: `${files ? `${files} ` : ''}${m.content}`.slice(0, 1500) + problem };
}

/** 홈 위쪽의 물어보기 줄 + 채팅 창 (대화는 이 컴포넌트가 들고 있다: 홈을 떠나면 사라진다) */
export function HomeAsk() {
  const { me, refresh } = useMe();
  const toast = useToast();
  const ask = useConfirm();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [tier, setTier] = useState<ModelTier>(() => me?.settings.models.chat ?? 'fast');
  const [saving, setSaving] = useState<Msg | null>(null);
  const [viewer, setViewer] = useState<SentFile | null>(null);
  const [report, setReport] = useState<ReportWhat | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const barCamera = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const attach = useChatAttach(open, toast);
  const kb = useKeyboardInset(open);
  // 대화에 쓴 사진 미리보기 주소: 홈을 떠날 때 돌려준다
  const allPicks = useRef<ChatPick[]>([]);
  useEffect(() => () => releasePicks(allPicks.current), []);

  // 신고할 답 (홈 채팅은 대화를 저장하지 않아서 화면이 바로 앞의 물음과 답을 보낸다)
  const snapshotOf = (m: Msg): string => {
    const at = messages.findIndex((x) => x.id === m.id);
    const asked = messages
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((x) => x.role === 'user');
    return chatSnapshot({ question: asked ? turnOf(asked).content : null, reply: m.content, solution: m.solution });
  };

  const show = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
      bar.current?.focus({ preventScroll: true });
    }, 140);
  }, []);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // 창을 열 때만 입력칸으로 (노트에 넣기 창·사진 보기를 열고 닫을 때 뒤의 입력칸이 키보드를 띄우지 않게)
  useEffect(() => {
    if (open) area.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 노트에 넣기 창·신고 창·사진 보기가 떠 있으면 그것만 닫는다
      if (e.key === 'Escape' && !saving && !viewer && !report) hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide, saving, viewer, report]);

  // 새 말이 오면 맨 아래로
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open]);

  const historyChars = useMemo(() => messages.slice(-12).reduce((a, m) => a + Math.min(1500, m.content.length), 0), [messages]);
  if (!me) return null;
  const tiers: ModelTier[] = me.isAdmin ? ['fast', 'careful', 'admin'] : ['fast', 'careful'];
  const locked = (t: ModelTier) => t !== 'fast' && !me.canCareful && !me.isAdmin;
  const model = clientModel(me, tier);
  const est = estimateSmallTask(model, me.usdPerEnergy, Math.ceil(1500 + (historyChars + text.length) * 0.9 + picksTokens(attach.picks)), THINK_OUT.chatSolve);
  const left = me.energy.unlimited ? null : Math.floor(me.energy.remaining ?? 0);
  const canSend = !sending && (!!text.trim() || attach.picks.length > 0);

  const pickTier = (t: ModelTier) => {
    if (locked(t)) {
      toast(perkNeed(me.perkTiers, 'careful'));
      return;
    }
    setTier(t);
    // 노트 채팅과 같은 설정으로 마지막에 고른 모델을 기억한다
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
    if (!me.aiEnabled) return toast('지금은 AI 기능을 잠깐 쉬고 있어요.', 'bad');
    if (left !== null && est > left) return toast(`에너지가 부족해요. 필요: 약 ${est}, 남음: ${left}.`, 'bad');
    const picks = attach.take();
    allPicks.current.push(...picks);
    setSending(true);
    const temp: Msg = {
      id: `u${++seq.current}`,
      role: 'user',
      content: message,
      picks,
      files: picks.map((p) => ({ kind: p.kind, name: p.file.name, url: p.preview })),
    };
    // 최근 대화만 보낸다 (서버도 최근 12개만 쓴다)
    const history = messages.slice(-12).map(turnOf);
    setMessages((m) => [...m, temp]);
    setText('');
    try {
      const attachments = await prepareChatFiles(picks);
      const r = await api<HomeChatReply>('/api/chat', { method: 'POST', body: JSON.stringify({ message, tier, history, attachments }) });
      setMessages((m) => [...m, { id: `a${++seq.current}`, role: 'assistant', content: r.reply, solution: r.solution, energy: r.energy }]);
      refresh();
    } catch (e) {
      // 보내지 못했으면 적은 글과 붙인 파일을 되돌린다
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setText((cur) => cur || message);
      attach.restore(picks);
      toast((e as Error).message, 'bad');
    } finally {
      setSending(false);
      area.current?.focus();
    }
  };

  const newChat = async () => {
    if (sending) return;
    if (
      messages.length &&
      !(await ask({ title: '새 대화', body: '지금 대화를 지우고 새로 시작할까요?', note: '이 대화는 저장되지 않아서 다시 볼 수 없어요.', ok: '새로 시작' }))
    )
      return;
    setMessages([]);
    attach.clear();
    releasePicks(allPicks.current);
    allPicks.current = [];
    area.current?.focus();
  };

  const openCamera = (from: 'bar' | 'panel') => {
    if (from === 'bar') barCamera.current?.click();
    else camera.current?.click();
  };

  const busyLabel = attach.picks.length || messages.at(-1)?.files?.length ? '사진·파일을 읽고 푸는 중' : '생각하는 중';

  return (
    <>
      {/* 홈 위쪽: 물어보기 줄 (누르면 채팅 창, 카메라는 바로 사진 찍기) */}
      <div className="kok-ask kok-rise flex h-[54px] items-center gap-1 rounded-full bg-surface pl-1.5 pr-1.5 shadow-[0_1px_2px_var(--shadow)] ring-1 ring-inset ring-line/70">
        <button
          ref={bar}
          type="button"
          onClick={show}
          className="press flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-full pl-1.5 pr-2 text-left"
          aria-haspopup="dialog"
          aria-label="AI에게 물어보기"
        >
          <span className="kok-ask-orb grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-white" aria-hidden="true">
            <Icon d={SPARKLE} size={19} strokeWidth={2.1} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink">AI에게 물어보기</span>
            <span className="block truncate text-xs text-muted">
              {messages.length ? `대화 ${Math.ceil(messages.length / 2)}개 · 이어서 물어보기` : '모든 과목 · 사진으로 문제 풀이'}
            </span>
          </span>
        </button>
        <input
          ref={barCamera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (!files.length) return;
            show();
            // 창이 열린 뒤 붙인다 (창이 열려 있어야 붙인 파일을 받는다)
            requestAnimationFrame(() => attach.add(files));
          }}
        />
        <button
          type="button"
          onClick={() => openCamera('bar')}
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink hover:bg-surface-3"
          aria-label="사진으로 문제 물어보기"
          title="사진으로 문제 물어보기"
        >
          <Icon d={ICONS.camera} size={21} />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="AI에게 물어보기">
          <button type="button" aria-label="닫기" className="kok-scrim absolute inset-0 cursor-default" onClick={hide} />
          <div
            data-closing={closing}
            style={kb ? { top: kb.top + 8, bottom: 'auto', height: kb.height - 16 } : undefined}
            className="kok-composer kok-composer-top kok-card absolute inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] top-[calc(12px+env(safe-area-inset-top))] flex flex-col rounded-[28px] shadow-[0_24px_60px_var(--shadow-strong)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[6vh] sm:h-[min(780px,88vh)] sm:w-[560px] sm:-translate-x-1/2"
          >
            {attach.dragging ? <ChatDropHint /> : null}
            <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
              <span className="kok-ask-orb grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" aria-hidden="true">
                <Icon d={SPARKLE} size={18} strokeWidth={2.1} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[17px] leading-tight">AI에게 물어보기</p>
                <p className="truncate text-xs text-muted">모든 과목 · 홈을 떠나면 대화가 사라져요</p>
              </div>
              <Menu
                label="채팅 메뉴"
                small
                items={[
                  { label: '새 대화', icon: ICONS.retry, onSelect: newChat },
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
              {messages.length === 0 && !sending ? (
                <div className="grid gap-4 py-3">
                  <div className="grid gap-1">
                    <p className="font-display text-xl leading-snug">무엇이든 물어보세요</p>
                    <p className="text-sm text-muted">
                      모르는 문제를 사진으로 찍어 보내면 단계별로 풀어 줘요{me.canFigures ? '. 그림이 도움이 되면 그림으로 보여 줘요' : ''}. 푼 문제는 노트에
                      넣어 복습할 수 있어요.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        className="press inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-left text-sm font-semibold hover:bg-surface-3"
                        onClick={() => (s.camera ? openCamera('panel') : send(s.text))}
                        disabled={sending}
                      >
                        {s.camera ? <Icon d={ICONS.camera} size={16} className="shrink-0" /> : null}
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ul className="grid gap-3 pb-1">
                  {messages.map((m) => (
                    <li key={m.id} className={cx('kok-rise grid gap-1.5', m.role === 'user' ? 'justify-items-end' : 'justify-items-start')}>
                      {m.files?.length ? <SentFiles files={m.files} onOpenImage={setViewer} /> : null}
                      {m.content ? (
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
                              m.saved ? (
                                <span className="inline-flex items-center gap-2 text-sm font-semibold text-ok">
                                  <Icon d={ICONS.check} size={16} strokeWidth={2.6} />
                                  &lsquo;{m.saved.noteTitle}&rsquo;에 넣었어요
                                  <Link href={`/notes/${m.saved.sourceId}?tab=questions`} className="text-accent underline-offset-2 hover:underline">
                                    노트 보기
                                  </Link>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-bold text-surface"
                                  onClick={() => setSaving(m)}
                                >
                                  <Icon d={ICONS.plus} size={17} strokeWidth={2.4} />
                                  노트에 넣기
                                </button>
                              )
                            ) : null
                          }
                        />
                      ) : null}
                      {m.role === 'assistant' ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 text-[11px] text-muted">
                          <AiMark label="AI 답" />
                          {m.energy ? <Energy n={Math.round(m.energy * 10) / 10} /> : null}
                          <ReportButton className="-ml-1" onClick={() => setReport({ kind: 'chat', snapshot: snapshotOf(m) })} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {sending ? <ThinkingRow label={busyLabel} /> : null}
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
                placeholder={attach.picks.length ? '덧붙일 말 (없어도 돼요)' : '무엇이든 물어보세요'}
                areaRef={area}
                cameraRef={camera}
                maxLength={4000}
              />
              {!me.aiEnabled ? <p className="px-1 text-xs font-semibold text-bad">지금은 AI 기능을 잠깐 쉬고 있어요.</p> : null}
            </form>
          </div>
        </div>
      ) : null}

      <SaveProblemSheet
        solution={saving?.solution ?? null}
        onClose={() => setSaving(null)}
        onSaved={(place) => {
          const id = saving?.id;
          setMessages((ms) => ms.map((x) => (x.id === id ? { ...x, saved: place } : x)));
          setSaving(null);
          toast(`'${place.noteTitle}'에 문제를 넣었어요.`, 'ok', DONE);
        }}
      />
      <ReportSheet what={report} onClose={() => setReport(null)} />
      {viewer?.url ? <ImageViewer src={viewer.url} alt={viewer.name} onClose={() => setViewer(null)} /> : null}
    </>
  );
}
