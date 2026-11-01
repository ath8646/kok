'use client';
// 복습 문제 한 개 (실제 시험지처럼 + 듀오링고처럼 바로 확인): 발문·자료 상자·<보기>(과목마다 모양, exam/ExamText) →
// 답을 고르고(바꿀 수 있다) 아래 '확인' → 화면 아래에 붙은 채점 띠(정답이에요·오답이에요, 정답·해설, '계속').
// 쉬움·어려움 같은 평가는 없다: 맞음·틀림과 걸린 시간으로 다음 복습 날짜를 정한다 (autoRate).
// 해설이 길어도 띠 안에서만 넘기고 '계속'은 늘 보인다 (화면을 내려 찾지 않게). 문제 신고는 위의 깃발과 채점 띠에서.
// 채점 움직임(globals.css '채점'): 맞으면 고른 칸이 살짝 부풀고 체크가 톡, 틀리면 고른 칸이 작게 흔들리고 조금 뒤 정답 칸에 체크.
// 화면이 바뀐 직후(새 문제·채점)에는 아래 단추를 잠깐(COOL_MS) 막는다: 두 번 누른 손가락이 다음 단추를 누르지 않게 (레슨과 같다)
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Rating } from '@/lib/grading';
import { choiceMark, questionFormat, type ExamStyle } from '@/lib/exam-layout';
import { readQuestionFigure } from '@/lib/source-figures';
import { useMe } from './AppShell';
import { ExamPrompt, ExplainText } from './exam/ExamText';
import { QuestionFigure, StepsDisclosure, useSolution } from './figure/SolutionView';
import { SourceFigureView } from './figure/SourceFigureView';
import { RichText } from './RichText';
import { Button, Chip, ICONS, Icon, Spinner, cx, inputClass } from './ui';
import { pageName } from '@/lib/page-labels';

export type ReviewQuestion = {
  id: string;
  type: 'mcq' | 'ox' | 'cloze' | 'short';
  prompt: string;
  choices: string[] | null;
  answer: number | boolean | string;
  accepted: string[];
  explanation: string;
  pages: number[];
  key_point_id: string | null;
  note_id: string | null;
  subject_id: string;
  created_by: 'ai' | 'user';
  /** 그림 풀이 (Pro): 문제 그림과 단계 풀이 (없으면 undefined·null) */
  figure?: unknown;
  steps?: unknown;
  /** 자료 그림 문제: 문제 위에 보여 줄 자료 그림 (readQuestionFigure 로 읽는다) */
  source_figure?: unknown;
};

export type GradeOutcome = {
  correct: boolean;
  partial?: boolean;
  feedback?: string;
  missing?: string[];
  aiUsed?: boolean;
};

/** 화면이 바뀐 뒤 아래 단추를 막는 시간 (ms) */
const COOL_MS = 350;

/** 정답을 한 줄 글로 (객관식은 ③ 보기 글) */
export function answerText(q: Pick<ReviewQuestion, 'type' | 'choices' | 'answer'>): string {
  if (q.type === 'mcq') return `${choiceMark(Number(q.answer))} ${q.choices?.[Number(q.answer)] ?? ''}`;
  if (q.type === 'ox') return q.answer ? 'O (맞다)' : 'X (틀리다)';
  return String(q.answer ?? '');
}

/** 채점 뒤 보기 칸의 표시: right 내가 맞힌 정답, reveal 틀렸을 때 알려 주는 정답, wrong 내가 고른 틀린 답 */
type MarkState = 'none' | 'right' | 'reveal' | 'wrong';

/** 동그란 표시: 정답은 체크(톡 나타남, 틀렸을 때는 흔들림 뒤에), 내가 고른 틀린 답은 엑스 */
function ResultMark({ state, className, size = 'sm' }: { state: Exclude<MarkState, 'none'>; className?: string; size?: 'sm' | 'lg' }) {
  const ok = state !== 'wrong';
  return (
    <span
      className={cx(
        'grid shrink-0 place-items-center rounded-full text-surface',
        size === 'lg' ? 'h-8 w-8' : 'h-6 w-6',
        ok ? 'kok-check-in bg-ok' : 'bg-bad',
        state === 'reveal' && 'is-late',
        className,
      )}
      aria-hidden="true"
    >
      <Icon d={ok ? ICONS.check : ICONS.close} size={(size === 'lg' ? 18 : 14) - (ok ? 0 : 2)} strokeWidth={3} />
    </span>
  );
}

/** 누른 숫자 1~9 (한글 입력기가 켜져 있어도: 자판 자리 e.code 먼저) */
function keyDigit(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code) ?? /^([1-9])$/.exec(e.key);
  return m ? Number(m[1]) : null;
}

export function QuestionCard({
  q,
  sourceKind,
  subjectName,
  style = 'general',
  onSubmit,
  autoRate,
  onNext,
  onAppeal,
  onShowVisual,
  onReport,
  index,
  progress,
}: {
  q: ReviewQuestion;
  sourceKind?: string;
  subjectName?: string;
  /** 과목마다 시험지 모양 (examStyle) */
  style?: ExamStyle;
  onSubmit: (given: number | boolean | string | null, ms: number) => Promise<GradeOutcome>;
  /** 맞음·틀림과 걸린 시간으로 다음 복습 날짜의 평가 (학생이 고르지 않는다) */
  autoRate: (correct: boolean, ms: number) => Rating;
  onNext: (r: { rating: Rating; correct: boolean; given: string; ms: number }) => void;
  onAppeal?: (given: string) => Promise<void>;
  onShowVisual?: () => void;
  onReport?: () => void;
  /** 세션에서 몇 번째로 나온 문제인지 (0부터: 첫 문제만 떠오르는 움직임 없이) */
  index?: number;
  /** 위에 보일 번호: n / 문제 수. again 은 틀려서 한 번 더 나온 문제 (번호 대신 '한 번 더') */
  progress?: { n: number; of: number; again: boolean };
}) {
  // 문제마다 새로 만들어진다 (부모가 key 로 문제 id 를 준다)
  const started = useRef(0);
  const [text, setText] = useState('');
  /** 고른 답 (확인 전: 바꿀 수 있다) */
  const [pick, setPick] = useState<number | boolean | null>(null);
  /** 낸 답 (확인 뒤) */
  const [given, setGiven] = useState<number | boolean | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<GradeOutcome | null>(null);
  const [ms, setMs] = useState(0);
  const [appealed, setAppealed] = useState(false);
  /** 아래 단추를 잠깐 막는 중 (새 문제가 뜬 직후·채점 직후) */
  const [cooling, setCooling] = useState(true);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState(96);
  const solution = useSolution(q);
  // 자료 그림 문제: 문제 위에 그림을 (제목·설명은 채점 뒤에)
  const sourceFig = useMemo(() => readQuestionFigure(q.source_figure), [q.source_figure]);
  const { me } = useMe();
  const format = questionFormat(q);
  const typed = q.type === 'cloze' || q.type === 'short';
  const graded = !!outcome;

  useEffect(() => {
    started.current = Date.now();
    if (typed) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [q.id, typed]);

  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setCooling(false), COOL_MS);
    return () => clearTimeout(t);
  }, [cooling]);

  // 아래 띠의 높이만큼 문제 아래를 비운다 (띠에 가려 끝까지 못 보는 일이 없게)
  useLayoutEffect(() => {
    const el = dock.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDockH(el.offsetHeight));
    ro.observe(el);
    setDockH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // 채점하면 '계속'에 초점 (Enter 로 넘어간다)
  useEffect(() => {
    if (graded) action.current?.focus({ preventScroll: true });
  }, [graded]);

  const ready = !busy && !graded && (typed ? !!text.trim() : pick !== null);

  const submit = async (value: number | boolean | string | null) => {
    if (busy || outcome) return;
    const spent = Date.now() - started.current;
    setGiven(value);
    setMs(spent);
    setBusy(true);
    try {
      const res = await onSubmit(value, spent);
      setOutcome(res);
      setCooling(true);
    } finally {
      setBusy(false);
    }
  };
  const confirm = () => {
    if (!ready) return;
    void submit(typed ? text.trim() : pick);
  };
  const givenText =
    given === null ? '(모르겠어요)' : q.type === 'mcq' ? (q.choices?.[Number(given)] ?? '') : q.type === 'ox' ? (given ? 'O' : 'X') : String(given);
  const next = () => {
    if (!outcome) return;
    const rating: Rating = outcome.correct && outcome.partial && !appealed ? 2 : autoRate(outcome.correct, ms);
    onNext({ rating, correct: outcome.correct, given: givenText, ms });
  };

  // 키보드: 객관식 1~6·OX 는 O/X 로 고르기, Enter 로 확인·계속 (누르고 있는 Enter 는 한 번)
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (e) => {
      if (e.defaultPrevented || e.altKey || ((e.ctrlKey || e.metaKey) && e.key !== 'Enter')) return;
      const target = e.target as HTMLElement | null;
      // 단계별 풀이·자료 그림 안의 단추·화살표 키와 열린 창(시트) 안의 키는 그쪽이 쓴다
      if (target?.closest?.('[data-own-keys], [role="dialog"]')) return;
      const typing = !!target?.closest?.('input, textarea, [contenteditable="true"]');
      if (e.key === 'Enter') {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        // 서술형 답안 칸: Enter 는 줄바꿈, Ctrl·⌘+Enter 로 확인
        if (typing) {
          if (target?.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            confirm();
          }
          return;
        }
        // 단추에서 누른 Enter 는 그 단추가 받는다. 다만 고른 보기(data-confirm)에서는 확인
        const btn = target?.closest?.('button, a');
        if (btn && !(btn.hasAttribute('data-confirm') && ready)) return;
        e.preventDefault();
        if (graded) next();
        else confirm();
        return;
      }
      if (typing || graded || busy) return;
      const d = keyDigit(e);
      if (q.type === 'mcq' && d && q.choices && d <= q.choices.length) setPick(d - 1);
      else if (q.type === 'ox') {
        const k = e.key.toLowerCase();
        if (e.code === 'KeyO' || k === 'o' || d === 1) setPick(true);
        else if (e.code === 'KeyX' || k === 'x' || d === 2) setPick(false);
      }
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const verdict = !outcome
    ? ''
    : outcome.correct
      ? outcome.partial && !appealed
        ? '거의 맞았어요'
        : '정답이에요'
      : given === null
        ? '정답을 확인해 봐요'
        : '오답이에요';
  const pageText = q.pages.length && sourceKind && sourceKind !== 'text' ? q.pages.slice(0, 4).map((p) => pageName(sourceKind, p)).join(', ') : '';

  return (
    // 다음 문제는 살짝 떠오르며 나타난다 (부모가 문제마다 key 를 바꿔 새로 만든다)
    <div className={cx('grid gap-3', (index ?? 0) > 0 && 'kok-q-in')}>
      {/* 위: 진행 막대·번호·문제 신고 */}
      <div className="flex items-center gap-3">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${progress ? Math.min(1, (progress.n - (graded || progress.again ? 0 : 1)) / Math.max(1, progress.of)) : 0})` }}
          />
        </div>
        {progress?.again ? (
          // 틀려서 한 번 더 나온 문제: 문제 수는 그대로 (5문제면 5문제)
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold">
            <Icon d={ICONS.retry} size={15} strokeWidth={2.4} />한 번 더
          </span>
        ) : progress ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {progress.n} / {progress.of}
          </span>
        ) : null}
        {onReport ? (
          <button
            type="button"
            onClick={onReport}
            aria-label="문제 신고"
            title="문제 신고"
            className="press -mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Icon d={ICONS.flag} size={18} />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {subjectName ? <Chip tone="accent">{subjectName}</Chip> : null}
        <Chip>{format.label}</Chip>
        {q.created_by === 'ai' ? <Chip>AI</Chip> : <Chip tone="ok">내가 만듦</Chip>}
      </div>

      {/* 문제지 */}
      <div className="kok-card rounded-[28px] p-5">
        <ExamPrompt
          text={q.prompt}
          style={style}
          size="lg"
          blank={q.type === 'cloze' ? () => <span className="mx-1 inline-block min-w-16 border-b-[3px] border-accent align-baseline">&nbsp;</span> : undefined}
        />
        <QuestionFigure solution={solution} className="mt-4" />
        {sourceFig ? <SourceFigureView fig={sourceFig} variant="question" originalFirst={!!me?.settings.visual.originalFirst} className="mt-4" /> : null}

        {q.type === 'mcq' && q.choices ? (
          <div className="mt-4 grid gap-2" role="group" aria-label="선택지">
            {q.choices.map((c, i) => {
              const chosen = (graded ? given : pick) === i;
              const right = graded && Number(q.answer) === i;
              const wrong = graded && chosen && !right;
              const mark: MarkState = right ? (chosen ? 'right' : 'reveal') : wrong ? 'wrong' : 'none';
              return (
                <button
                  key={i}
                  type="button"
                  disabled={graded || busy}
                  aria-pressed={!graded ? chosen : undefined}
                  data-confirm={!graded && chosen ? '' : undefined}
                  onClick={() => setPick(i)}
                  className={cx(
                    'press flex min-h-[52px] items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[16px] transition-[color,background-color,border-color,opacity] duration-200',
                    right
                      ? 'border-ok bg-ok-soft'
                      : wrong
                        ? 'border-bad bg-bad-soft'
                        : chosen
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-surface hover:border-accent/60',
                    graded && !right && !wrong ? 'opacity-60' : '',
                    mark === 'right' && 'kok-boop',
                    mark === 'wrong' && 'kok-shake',
                  )}
                >
                  {mark === 'none' ? (
                    <span className={cx('mt-px w-6 shrink-0 text-center text-[19px] leading-6', chosen ? 'font-bold text-accent' : 'text-muted')} aria-hidden="true">
                      {choiceMark(i)}
                    </span>
                  ) : (
                    <>
                      <ResultMark state={mark} className="mt-0.5" />
                      <span className="sr-only">{mark === 'wrong' ? '내가 고른 답: ' : '정답: '}</span>
                    </>
                  )}
                  <span className="min-w-0">
                    <span className="sr-only">{i + 1}번 </span>
                    <RichText text={c} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {q.type === 'ox' ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[true, false].map((v) => {
              const chosen = (graded ? given : pick) === v;
              const right = graded && Boolean(q.answer) === v;
              const wrong = graded && chosen && !right;
              const mark: MarkState = right ? (chosen ? 'right' : 'reveal') : wrong ? 'wrong' : 'none';
              return (
                <button
                  key={String(v)}
                  type="button"
                  disabled={graded || busy}
                  aria-pressed={!graded ? chosen : undefined}
                  data-confirm={!graded && chosen ? '' : undefined}
                  onClick={() => setPick(v)}
                  aria-label={v ? 'O 맞다' : 'X 틀리다'}
                  className={cx(
                    'press relative rounded-2xl border-2 py-6 font-display text-4xl transition-[color,background-color,border-color,opacity] duration-200',
                    right
                      ? 'border-ok bg-ok-soft text-ok'
                      : wrong
                        ? 'border-bad bg-bad-soft text-bad'
                        : chosen
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line bg-surface hover:border-accent/60',
                    graded && !right && !wrong ? 'opacity-60' : '',
                    mark === 'right' && 'kok-boop',
                    mark === 'wrong' && 'kok-shake',
                  )}
                >
                  {v ? 'O' : 'X'}
                  {mark === 'right' || mark === 'reveal' ? <ResultMark state={mark} className="absolute right-2.5 top-2.5" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {typed ? (
          <form
            // '모르겠어요'는 틀린 답을 낸 것이 아니라서 흔들지 않는다
            className={cx('relative mt-4', outcome && !outcome.correct && given !== null && 'kok-shake')}
            onSubmit={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {format.descriptive ? (
              <textarea
                ref={inputRef}
                aria-label="답"
                rows={4}
                className={cx(
                  inputClass,
                  'min-h-28 resize-y leading-relaxed transition-[border-color,background-color] duration-200',
                  outcome && given !== null && (outcome.correct ? 'border-ok! bg-ok-soft! pr-12' : 'border-bad! bg-bad-soft! pr-12'),
                )}
                value={outcome ? String(given ?? '') : text}
                disabled={graded || busy}
                maxLength={500}
                placeholder="답안을 적어 주세요 (Ctrl + Enter 로 확인)"
                onChange={(e) => setText(e.target.value)}
              />
            ) : (
              <input
                ref={inputRef}
                aria-label="답"
                className={cx(
                  inputClass,
                  'transition-[border-color,background-color] duration-200',
                  outcome && given !== null && (outcome.correct ? 'border-ok! bg-ok-soft! pr-12' : 'border-bad! bg-bad-soft! pr-12'),
                )}
                value={outcome ? String(given ?? '') : text}
                disabled={graded || busy}
                maxLength={200}
                placeholder="답을 적어 주세요"
                autoComplete="off"
                autoCapitalize="off"
                enterKeyHint="done"
                onChange={(e) => setText(e.target.value)}
              />
            )}
            {outcome && given !== null ? (
              <ResultMark state={outcome.correct ? 'right' : 'wrong'} className={cx('absolute right-3', format.descriptive ? 'top-3' : 'top-1/2 -mt-3')} />
            ) : null}
          </form>
        ) : null}
      </div>

      {/* 아래 띠에 가리지 않게 그만큼 비운다 */}
      <div aria-hidden="true" style={{ height: dockH }} />

      {/* 아래에 붙은 띠: 모르겠어요·확인 → 채점 띠 (정답·해설·계속) */}
      <div ref={dock} className={cx('fixed inset-x-0 bottom-0 z-40', cooling && 'pointer-events-none')}>
        {outcome ? (
          <Feedback
            q={q}
            outcome={outcome}
            verdict={verdict}
            given={given}
            givenText={givenText}
            style={style}
            typed={typed}
            descriptive={format.descriptive}
            pageText={pageText}
            sourceFig={sourceFig}
            solution={solution}
            actionRef={action}
            onNext={next}
            onReport={onReport}
            onShowVisual={onShowVisual}
            appeal={
              !outcome.correct && onAppeal && typed && given !== null && !appealed
                ? async () => {
                    await onAppeal(String(given));
                    setAppealed(true);
                    setOutcome({ ...outcome, correct: true, partial: false, feedback: '내 답을 정답으로 넣었어요.' });
                  }
                : undefined
            }
          />
        ) : (
          <div className="border-t border-line bg-surface px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
            <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
              <Button variant="ghost" size="lg" className="shrink-0 text-muted" disabled={busy} onClick={() => submit(null)}>
                모르겠어요
              </Button>
              <Button size="lg" className="flex-1" disabled={!ready} onClick={confirm}>
                {busy ? (
                  <>
                    <Spinner /> 채점하는 중
                  </>
                ) : (
                  '확인'
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 채점 띠: 판정은 위에, 정답·해설은 띠 안에서 넘기고, '계속'은 늘 아래에 보인다 */
function Feedback({
  q,
  outcome,
  verdict,
  given,
  givenText,
  style,
  typed,
  descriptive,
  pageText,
  sourceFig,
  solution,
  actionRef,
  onNext,
  onReport,
  onShowVisual,
  appeal,
}: {
  q: ReviewQuestion;
  outcome: GradeOutcome;
  verdict: string;
  given: number | boolean | string | null;
  givenText: string;
  style: ExamStyle;
  typed: boolean;
  descriptive: boolean;
  pageText: string;
  sourceFig: ReturnType<typeof readQuestionFigure>;
  solution: ReturnType<typeof useSolution>;
  actionRef: React.RefObject<HTMLButtonElement | null>;
  onNext: () => void;
  onReport?: () => void;
  onShowVisual?: () => void;
  appeal?: () => Promise<void>;
}) {
  const ok = outcome.correct;
  const body = useRef<HTMLDivElement>(null);
  /** 띠 안에 더 읽을 글이 아래에 있는지 (끝을 흐리게 해서 알린다) */
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const check = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, []);
  const showAnswer = !ok || typed;
  return (
    <div
      className={cx('kok-result-in border-t px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-4', ok ? 'border-ok/30 bg-ok-soft' : 'border-bad/30 bg-bad-soft')}
      role="status"
    >
      <div className="mx-auto grid w-full max-w-2xl gap-3">
        <p className={cx('flex items-center gap-2.5 font-display text-2xl', ok ? 'text-ok' : 'text-bad')}>
          <ResultMark key={ok ? 'ok' : 'bad'} state={ok ? 'reveal' : 'wrong'} size="lg" />
          <span key={verdict} className="kok-swap">
            {verdict}
          </span>
        </p>
        <div
          ref={body}
          tabIndex={more ? 0 : -1}
          aria-label="정답과 해설"
          className={cx('kok-feedback-body grid max-h-[min(52dvh,460px)] gap-2.5 overflow-y-auto overscroll-contain text-[15px] leading-relaxed', more && 'is-more')}
        >
          {showAnswer ? (
            <div className={descriptive ? 'grid gap-1' : undefined}>
              <b>정답</b> {descriptive ? <ExplainText text={answerText(q)} /> : <RichText text={answerText(q)} />}
              {typed && given !== null ? <p className="text-sm text-muted">내 답: {givenText}</p> : null}
            </div>
          ) : null}
          {outcome.feedback ? (
            <p className="text-sm">
              <Chip>AI 채점</Chip> {outcome.feedback}
            </p>
          ) : null}
          {q.explanation ? (
            <div className="grid gap-1">
              <b>{style === 'math' ? '풀이' : '해설'}</b>
              <ExplainText text={q.explanation} />
            </div>
          ) : null}
          {/* 자료 그림 문제: 풀고 나면 그림이 무엇인지 알려 준다 */}
          {sourceFig && (sourceFig.title || sourceFig.caption) ? (
            <p className="text-sm">
              <b>자료 그림</b> {sourceFig.title}
              {sourceFig.caption ? <span className="text-muted"> · {sourceFig.caption}</span> : null}
            </p>
          ) : null}
          {/* 그림으로 보는 단계별 풀이 (Pro): 틀렸으면 펼쳐 둔다 */}
          {solution?.steps.length ? (
            <div data-own-keys>
              <StepsDisclosure solution={solution} defaultOpen={!ok} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {pageText ? <span className="text-muted">출처 {pageText}</span> : null}
            {appeal ? (
              <button type="button" onClick={appeal} className="press font-semibold underline underline-offset-4">
                내 답도 맞아요
              </button>
            ) : null}
            {onShowVisual ? (
              <button type="button" onClick={onShowVisual} className="press font-semibold underline underline-offset-4">
                그림으로 보기
              </button>
            ) : null}
            {onReport ? (
              <button type="button" onClick={onReport} className="press ml-auto inline-flex items-center gap-1 font-semibold text-muted hover:text-ink">
                <Icon d={ICONS.flag} size={14} />
                문제 신고
              </button>
            ) : null}
          </div>
        </div>
        <button
          ref={actionRef}
          type="button"
          onClick={onNext}
          className={cx('press w-full rounded-full px-6 py-3.5 text-base font-semibold text-white hover:brightness-110', ok ? 'bg-ok' : 'bg-bad')}
        >
          계속
        </button>
      </div>
    </div>
  );
}
