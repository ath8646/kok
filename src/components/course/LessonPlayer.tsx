'use client';
// 레슨 플레이어 (듀오링고식): 전체 화면 창에서 "카드 한 장 → 그 카드 문제"를 차례로 (문제의 after, 예전 레슨은 카드를 다 본 뒤 문제).
// 문제는 답을 고르고(바꿀 수 있다) '확인'으로 채점 → 아래에서 초록·빨강 띠(정답·해설)가 올라오고 '계속'.
// 틀린 문제('모르겠어요' 포함)는 레슨 끝에 다시 (CHECK_RETRIES 번까지, 보기는 다시 섞는다). 진행 막대는 맞힌(또는 끝난) 만큼만 찬다.
// 3·5·10개 연속으로 맞히면 칩이 뜨고 막대가 빛난다. 소리·진동은 위 띠의 스피커 단추로 (처음엔 꺼 둔다: lesson-sound.ts).
// 끝 화면: 별(처음 답 기준), 정확도·걸린 시간·최고 연속, 틀린 문제와 정답, '다음' 단추. 끝 화면이 뜰 때 결과를 저장한다(onFinish).
// 문제 종류: 객관식·OX·빈칸(낱말 칩 또는 적기)·단답·짝 맞추기(짝마다 바로 채점)·순서 맞추기. 채점 움직임은 복습과 같다(globals.css '채점').
// 키보드: 1~6·O·X 로 고르기, Enter 로 확인·계속·다음, Esc 로 그만두기(무언가 했으면 한 번 묻는다)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { autoGrade, type GradableQuestion } from '@/lib/grading';
import {
  CHECK_RETRIES,
  checkAnswerText,
  lessonSteps,
  orderCorrect,
  shuffled,
  starsFor,
  type CourseCard,
  type CourseCheck,
  type LessonResult,
  type Stars as StarCount,
} from '@/lib/course';
import { lessonStepSnapshot } from '@/lib/report';
import { questionFigure, type SourceFigure } from '@/lib/source-figures';
import { RichText } from '../RichText';
import { ReportSheet, type ReportWhat } from '../ReportSheet';
import { confirmOpen, useConfirm } from '../Confirm';
import { SourceFigureView } from '../figure/SourceFigureView';
import { Button, ICONS, Icon, buttonClass, cx, inputClass } from '../ui';
import { useLessonSound } from './lesson-sound';

/** 레슨의 문제 하나: 어느 레슨의 몇 번째 문제인지(key, 틀린 문제 모으기)와 신고 번호(target, 없으면 플레이어의 것) */
export type PlayerCheck = { key: string; check: CourseCheck; target?: string };
export type PlayerMode = 'lesson' | 'recap' | 'final' | 'mistakes';

type Step = { kind: 'card'; index: number } | { kind: 'check'; index: number; attempt: number };
/** 고른 답: 객관식은 보기 번호(처음 차례), OX 는 참·거짓, 빈칸·단답은 글, 순서 맞추기는 놓은 칸 번호들 */
type Given = number | boolean | string | number[] | null;
type Graded = { ok: boolean; given: Given; wrongPairs?: number; retry: boolean };
type Done = LessonResult & { secs: number; best: number; missed: PlayerCheck[] };

const CARD_KIND: Record<CourseCard['kind'], { label: string; icon: string }> = {
  concept: { label: '개념', icon: ICONS.bulb },
  example: { label: '예시', icon: ICONS.sparkle },
  compare: { label: '비교', icon: ICONS.merge },
  tip: { label: '팁', icon: ICONS.star },
};
const PRAISE = ['맞았어요!', '좋아요!', '정확해요!', '훌륭해요!', '바로 그거예요!'];
const MODE_TEXT: Record<PlayerMode, { done: string; quit: string }> = {
  lesson: { done: '레슨 끝!', quit: '레슨 그만두기' },
  recap: { done: '단계 복습 끝!', quit: '복습 그만두기' },
  final: { done: '총정리 끝!', quit: '총정리 그만두기' },
  mistakes: { done: '틀린 문제 복습 끝!', quit: '복습 그만두기' },
};
/** 연속 정답 칩이 뜨는 수 (그 뒤로는 5개마다) */
const COMBO_AT = [3, 5, 10];
const BLANK = /(_{2,}|\(\s*\)|\[\s*\])/;

export function LessonPlayer({
  title,
  subtitle,
  goal,
  cards,
  checks,
  figures,
  mode = 'lesson',
  reportTarget,
  next,
  onClose,
  onFinish,
}: {
  title: string;
  /** 작은 글: 단계 이름 등 */
  subtitle?: string;
  /** 레슨의 목표 한 줄 (첫 화면) */
  goal?: string;
  cards: CourseCard[];
  checks: PlayerCheck[];
  /** 노트의 자료 그림 (카드의 figure_id) */
  figures?: readonly SourceFigure[];
  mode?: PlayerMode;
  /** '이상해요' 신고에 남길 번호 ('노트번호:l-단계-레슨'·'노트번호:r-단계'·'노트번호:final'). 없고 문제에도 없으면 신고 단추도 없다 */
  reportTarget?: string;
  /** 끝 화면의 '다음' 단추 (다음에 할 칸이 있을 때) */
  next?: { label: string; onStart: () => void } | null;
  onClose: () => void;
  /** 끝까지 했을 때 (끝 화면이 뜰 때 한 번): 별·맞힌 수·처음에 맞힌/틀린 문제 */
  onFinish: (r: LessonResult) => void;
}) {
  const [queue, setQueue] = useState<Step[]>(() =>
    lessonSteps(
      cards.length,
      checks.map((c) => c.check),
    ).map((s) => (s.kind === 'card' ? s : { ...s, attempt: 0 })),
  );
  const [pos, setPos] = useState(0);
  const [answer, setAnswer] = useState<Given>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [cleared, setCleared] = useState(0);
  const [streak, setStreak] = useState(0);
  const [combo, setCombo] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [report, setReport] = useState<ReportWhat | null>(null);
  /** 맞힌 수 (칭찬 말을 돌려 가며) */
  const [okCount, setOkCount] = useState(0);
  /** 문제마다 처음 답이 맞았는지 (별·틀린 문제) */
  const firsts = useRef(new Map<string, boolean>());
  const best = useRef(0);
  const started = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const sound = useLessonSound();
  const ask = useConfirm();

  const step = queue[pos];
  const pc = step?.kind === 'check' ? checks[step.index] : null;
  const total = cards.length + checks.length;
  const progress = done ? 1 : total ? Math.min(1, cleared / total) : 1;
  const text = MODE_TEXT[mode];

  useEffect(() => {
    started.current = Date.now();
    panel.current?.focus();
  }, []);

  // 연속 정답 칩은 잠깐만
  useEffect(() => {
    if (combo === null) return;
    const t = setTimeout(() => setCombo(null), 1800);
    return () => clearTimeout(t);
  }, [combo]);

  // 채점하면 '계속'에, 끝 화면이면 끝 단추에 초점 (Enter 로 이어 간다)
  useEffect(() => {
    if (graded || done) action.current?.focus();
  }, [graded, done]);

  const finish = () => {
    const rightFirst = [...firsts.current].filter(([, ok]) => ok).map(([k]) => k);
    const wrongFirst = [...firsts.current].filter(([, ok]) => !ok).map(([k]) => k);
    const result: LessonResult = { stars: starsFor(rightFirst.length, checks.length), correct: rightFirst.length, total: checks.length, rightFirst, wrongFirst };
    setDone({
      ...result,
      secs: Math.max(1, Math.round((Date.now() - started.current) / 1000)),
      best: best.current,
      missed: checks.filter((c) => wrongFirst.includes(c.key)),
    });
    sound.done();
    onFinish(result);
  };

  const proceed = () => {
    setGraded(null);
    setAnswer(null);
    setHint(false);
    if (pos + 1 >= queue.length) finish();
    else setPos(pos + 1);
    panel.current?.scrollTo({ top: 0 });
    panel.current?.focus({ preventScroll: true });
  };

  const nextCard = () => {
    setCleared((n) => n + 1);
    proceed();
  };

  /** 채점: 처음 답을 적어 두고, 맞으면 막대가 차고 연속 정답이 늘고, 틀리면 레슨 끝에 다시 (CHECK_RETRIES 번까지) */
  const grade = (given: Given, wrongPairs?: number) => {
    if (!pc || graded || step?.kind !== 'check') return;
    const c = pc.check;
    let ok: boolean;
    if (c.type === 'match') ok = given !== null && (wrongPairs ?? 0) === 0;
    else if (c.type === 'order') ok = Array.isArray(given) && orderCorrect(c, given.map((i) => c.choices?.[i] ?? ''));
    else ok = given !== null && !Array.isArray(given) && autoGrade(c as GradableQuestion, given).correct;
    // 짝을 다 맞춘 짝 맞추기는 다시 내지 않는다 (끝까지 맞춘 것이 곧 다시 푼 것)
    const retry = !ok && step.attempt < CHECK_RETRIES && !(c.type === 'match' && given !== null);
    if (step.attempt === 0) firsts.current.set(pc.key, ok);
    setGraded({ ok, given, wrongPairs, retry });
    if (ok) {
      setCleared((n) => n + 1);
      setOkCount((n) => n + 1);
      const s = streak + 1;
      setStreak(s);
      best.current = Math.max(best.current, s);
      if (COMBO_AT.includes(s) || (s > 10 && s % 5 === 0)) {
        setCombo(s);
        sound.combo();
      } else sound.ok();
    } else {
      setStreak(0);
      sound.bad();
      if (retry) setQueue((q) => [...q, { kind: 'check', index: step.index, attempt: step.attempt + 1 }]);
      else setCleared((n) => n + 1);
    }
  };

  const ready =
    !!pc &&
    !graded &&
    (pc.check.type === 'mcq' || pc.check.type === 'ox'
      ? answer !== null
      : pc.check.type === 'order'
        ? Array.isArray(answer) && answer.length === (pc.check.choices?.length ?? 0)
        : pc.check.type === 'match'
          ? false
          : typeof answer === 'string' && !!answer.trim());

  /** 아래 큰 단추가 하는 일 (Enter 도 같다) */
  const primary = (): void => {
    if (done) {
      if (next) next.onStart();
      else onClose();
    } else if (!step) finish();
    else if (step.kind === 'card') nextCard();
    else if (graded) proceed();
    else if (ready) grade(typeof answer === 'string' ? answer.trim() : answer);
  };

  const requestClose = useCallback(async () => {
    if (done || (pos === 0 && !graded)) {
      onClose();
      return;
    }
    const ok = await ask({ title: text.quit, body: '지금 그만두면 여기까지 한 것은 저장되지 않아요.', ok: '그만두기', cancel: '계속 하기', danger: true });
    if (ok) onClose();
  }, [ask, done, graded, onClose, pos, text.quit]);

  // 키보드: 최신 상태로 (한 번만 묶고 ref 로 부른다)
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const onEscRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onEscRef.current = (e) => {
      if (e.key !== 'Escape' || confirmOpen()) return;
      // 이 창이 Esc 를 먼저 받는다 (아래 화면의 창이 같이 닫히지 않게). 안의 시트(신고·크게 보기)가 떠 있으면 그것만 닫는다
      e.stopPropagation();
      const inner = root.current ? [...root.current.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1) : undefined;
      if (inner) inner.querySelector<HTMLButtonElement>('button[aria-label="닫기"]')?.click();
      else void requestClose();
    };
    onKeyRef.current = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || confirmOpen()) return;
      if (root.current?.querySelector('[role="dialog"]')) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest('input, textarea, [contenteditable="true"]');
      // 그림 안의 단추·칸은 저마다 키를 받는다
      if (t?.closest('[data-own-keys]')) return;
      if (e.key === 'Enter') {
        // 단추·글 칸에서 누른 Enter 는 그 칸이 받는다
        if (typing || t?.closest('button, a')) return;
        e.preventDefault();
        primary();
        return;
      }
      if (typing || graded || done || !pc) return;
      const c = pc.check;
      if (c.type === 'ox') {
        const k = e.key.toLowerCase();
        if (k === 'o' || k === '1') setAnswer(true);
        else if (k === 'x' || k === '2') setAnswer(false);
        return;
      }
      if ((c.type === 'mcq' || c.type === 'cloze') && c.choices?.length && /^[1-9]$/.test(e.key)) {
        const order = shuffled(c.choices.length, `${pc.key}:${step?.kind === 'check' ? step.attempt : 0}`);
        const i = order[Number(e.key) - 1];
        if (i === undefined) return;
        setAnswer(c.type === 'mcq' ? i : c.choices[i]);
      }
    };
  });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => onEscRef.current(e);
    const key = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('keydown', key);
    };
  }, []);

  const target = pc?.target ?? reportTarget;
  const seed = pc && step?.kind === 'check' ? `${pc.key}:${step.attempt}` : '';

  return (
    <div ref={root} className="kok-player fixed inset-0 z-[70] flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={title}>
      {/* 위: 닫기 + 진행 막대 + 소리 + 신고 */}
      <div className="relative flex items-center gap-2 px-3 pb-2 pt-[calc(10px+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => void requestClose()}
          aria-label="레슨 닫기"
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
        >
          <Icon d={ICONS.close} size={24} />
        </button>
        <div
          className="kok-lesson-bar h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="레슨 진행"
        >
          <div
            className={cx('kok-lesson-fill h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out', streak >= 3 && !done && 'is-hot')}
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (!sound.on) sound.preview();
            sound.toggle();
          }}
          aria-pressed={sound.on}
          aria-label={sound.on ? '소리·진동 끄기' : '소리·진동 켜기'}
          title={sound.on ? '소리·진동 끄기' : '소리·진동 켜기'}
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <Icon d={sound.on ? ICONS.volume : ICONS.volumeOff} size={20} />
        </button>
        {target ? (
          <button
            type="button"
            onClick={() =>
              setReport({
                kind: 'course',
                target,
                snapshot: done || !step ? undefined : lessonStepSnapshot(step.kind === 'card' ? { kind: 'card', card: cards[step.index] } : { kind: 'check', check: checks[step.index].check }, pos) || undefined,
              })
            }
            aria-label="이상해요 (신고)"
            title="이상해요"
            className="press -ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Icon d={ICONS.flag} size={20} />
          </button>
        ) : null}
        {/* 연속 정답: 진행 막대 위에 잠깐 (움직이는 칸과 자리 잡는 칸을 나눈다: 둘 다 transform 이라) */}
        {combo !== null && !done ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] z-10 flex items-center justify-center">
            <span
              key={combo}
              role="status"
              className="kok-combo inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent px-3 py-1 text-sm font-bold text-accent-ink shadow-[0_6px_18px_var(--shadow-strong)]"
            >
              <Icon d={ICONS.bolt} size={15} strokeWidth={2.4} />
              {combo}개 연속 정답!
            </span>
          </div>
        ) : null}
      </div>

      <div ref={panel} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 outline-none md:px-0">
        <div className="mx-auto w-full max-w-lg">
          {subtitle ? <p className="mt-1 text-xs font-bold text-muted">{subtitle}</p> : null}
          <h2 className="mt-0.5 font-display text-[22px] leading-snug">{title}</h2>
          {goal && pos === 0 && !done ? <p className="mt-1 text-sm text-muted">{goal}</p> : null}

          {done ? (
            <Result done={done} mode={mode} title={text.done} />
          ) : step?.kind === 'card' ? (
            <LessonCard key={`c${pos}`} card={cards[step.index]} first={pos === 0} figures={figures} />
          ) : pc && step?.kind === 'check' ? (
            <CheckView
              key={`q${pos}`}
              check={pc.check}
              seed={seed}
              retry={step.attempt > 0}
              answer={answer}
              onAnswer={setAnswer}
              graded={graded}
              hint={hint}
              onHint={() => setHint(true)}
              onSubmit={() => ready && grade(typeof answer === 'string' ? answer.trim() : answer)}
              onMatched={(wrongs) => grade([], wrongs)}
            />
          ) : (
            <p className="mt-6 text-[15px] text-muted">여기에는 풀 문제가 없어요. 끝내기를 누르면 다음 칸이 열려요.</p>
          )}
        </div>
      </div>

      {/* 신고 창: 이 창 안에 둬야 창(z 70) 위에 뜬다 */}
      <ReportSheet what={report} onClose={() => setReport(null)} />

      {/* 아래: 채점 띠 또는 큰 단추 */}
      {graded && pc ? (
        <Feedback check={pc.check} graded={graded} praise={PRAISE[Math.max(0, okCount - 1) % PRAISE.length]} onContinue={proceed} actionRef={action} />
      ) : (
        <div className="border-t border-line bg-surface px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex w-full max-w-lg items-center gap-3">
            {done ? (
              next ? (
                <>
                  <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
                    완료
                  </Button>
                  <button ref={action} type="button" className={buttonClass('primary', 'lg', 'min-w-0 flex-[2]')} onClick={next.onStart}>
                    <span className="truncate">{next.label}</span>
                    <Icon d={ICONS.chevronRight} size={18} strokeWidth={2.4} />
                  </button>
                </>
              ) : (
                <button ref={action} type="button" className={buttonClass('primary', 'lg', 'w-full')} onClick={onClose}>
                  완료
                </button>
              )
            ) : !step ? (
              <Button size="lg" className="w-full" onClick={finish}>
                끝내기
              </Button>
            ) : step.kind === 'card' ? (
              <Button size="lg" className="w-full" onClick={nextCard}>
                {pos + 1 >= queue.length ? '끝내기' : '다음'}
              </Button>
            ) : pc ? (
              <>
                <Button variant="ghost" size="lg" className="shrink-0 text-muted" onClick={() => grade(null)}>
                  모르겠어요
                </Button>
                {pc.check.type === 'match' ? (
                  <p className="min-w-0 flex-1 text-right text-sm text-muted">짝을 모두 맞춰 보세요</p>
                ) : pc.check.type === 'short' || (pc.check.type === 'cloze' && !pc.check.choices) ? (
                  <p className="min-w-0 flex-1 text-right text-sm text-muted">답을 적고 확인을 눌러요</p>
                ) : (
                  <Button size="lg" className="flex-1" disabled={!ready} onClick={primary}>
                    확인
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- 카드
function LessonCard({ card, first, figures }: { card: CourseCard; first: boolean; figures?: readonly SourceFigure[] }) {
  const k = CARD_KIND[card.kind];
  const fig = card.figure_id ? figures?.find((f) => f.id === card.figure_id) : undefined;
  return (
    <div className={cx('mt-4 grid gap-3', !first && 'kok-step-next')}>
      <div className="kok-card rounded-[28px] p-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
          <Icon d={k.icon} size={14} strokeWidth={2.4} />
          {k.label}
        </span>
        {card.heading ? <h3 className="mt-3 font-display text-[21px] leading-snug">{card.heading}</h3> : null}
        <p className="mt-2 text-[17px] leading-relaxed">
          <RichText text={card.text} />
        </p>
        {fig ? <SourceFigureView fig={questionFigure(fig)} className="mt-4" /> : null}
      </div>
      {card.tip ? (
        <div className="flex items-start gap-2.5 rounded-2xl bg-hl/25 px-4 py-3 text-[15px] leading-relaxed">
          <Icon d={ICONS.bulb} size={18} className="mt-0.5 shrink-0 text-warn" />
          <span>
            <RichText text={card.tip} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- 문제
type MarkState = 'none' | 'right' | 'reveal' | 'wrong';

function Mark({ state, className }: { state: Exclude<MarkState, 'none'>; className?: string }) {
  const ok = state !== 'wrong';
  return (
    <span
      className={cx(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full text-surface',
        ok ? 'kok-check-in bg-ok' : 'bg-bad',
        state === 'reveal' && 'is-late',
        className,
      )}
      aria-hidden="true"
    >
      <Icon d={ok ? ICONS.check : ICONS.close} size={ok ? 14 : 12} strokeWidth={3} />
    </span>
  );
}

/** 빈칸이 든 문장: blank 로 빈칸 자리를 그린다 (낱말 고르기는 누를 수 있는 칸) */
function ClozePrompt({ text, blank }: { text: string; blank: () => ReactNode }) {
  const parts = text.split(BLANK);
  // 빈칸이 둘 이상이면 첫 칸만 답 자리 (나머지는 그냥 밑줄)
  const answerAt = parts.findIndex((p) => BLANK.test(p));
  return (
    <>
      {parts.map((p, i) =>
        !BLANK.test(p) ? (
          <RichText key={i} text={p} />
        ) : i === answerAt ? (
          <span key={i}>{blank()}</span>
        ) : (
          <span key={i} className="mx-1 inline-block min-w-12 border-b-[3px] border-line align-baseline">
            &nbsp;
          </span>
        ),
      )}
    </>
  );
}

function CheckView({
  check,
  seed,
  retry,
  answer,
  onAnswer,
  graded,
  hint,
  onHint,
  onSubmit,
  onMatched,
}: {
  check: CourseCheck;
  /** 보기를 섞는 씨앗 (문제 번호 + 몇 번째 풀이: 다시 나오면 다르게 섞인다) */
  seed: string;
  retry: boolean;
  answer: Given;
  onAnswer: (v: Given) => void;
  graded: Graded | null;
  hint: boolean;
  onHint: () => void;
  onSubmit: () => void;
  onMatched: (wrongs: number) => void;
}) {
  const typed = check.type === 'short' || (check.type === 'cloze' && !check.choices);
  const bank = check.type === 'cloze' && !!check.choices;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!typed) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [typed]);
  const instruction =
    check.type === 'match' ? '왼쪽과 오른쪽에서 짝을 하나씩 눌러요' : check.type === 'order' ? '차례대로 눌러서 위 줄에 놓아요' : bank ? '알맞은 낱말을 골라요' : '';

  return (
    <div className="kok-step-next mt-4 grid gap-3">
      <div className="kok-card rounded-[28px] p-5">
        <span
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold',
            retry ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted',
          )}
        >
          {retry ? <Icon d={ICONS.retry} size={13} strokeWidth={2.4} /> : null}
          {retry ? '다시 풀어 봐요' : '확인 문제'}
        </span>
        <p className="mt-3 text-[19px] font-semibold leading-relaxed">
          {check.type === 'cloze' ? (
            <ClozePrompt
              text={check.prompt}
              blank={() =>
                bank ? (
                  <BankBlank value={typeof answer === 'string' ? answer : null} graded={graded} onClear={() => onAnswer(null)} />
                ) : (
                  <span className="mx-1 inline-block min-w-16 border-b-[3px] border-accent align-baseline">&nbsp;</span>
                )
              }
            />
          ) : (
            <RichText text={check.prompt} />
          )}
        </p>
        {instruction ? <p className="mt-1.5 text-sm text-muted">{instruction}</p> : null}

        {check.type === 'mcq' && check.choices ? (
          <Choices check={check} seed={seed} answer={typeof answer === 'number' ? answer : null} onAnswer={onAnswer} graded={graded} />
        ) : null}
        {check.type === 'ox' ? <OxChoices check={check} answer={typeof answer === 'boolean' ? answer : null} onAnswer={onAnswer} graded={graded} /> : null}
        {bank ? <WordBank check={check} seed={seed} answer={typeof answer === 'string' ? answer : null} onAnswer={onAnswer} graded={graded} /> : null}
        {typed ? (
          <form
            className={cx('mt-4 flex gap-2', graded && !graded.ok && graded.given !== null && 'kok-shake')}
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                aria-label="답"
                className={cx(
                  inputClass,
                  'transition-[border-color,background-color] duration-200',
                  graded && graded.given !== null && (graded.ok ? 'border-ok! bg-ok-soft! pr-12' : 'border-bad! bg-bad-soft! pr-12'),
                )}
                value={typeof answer === 'string' ? answer : ''}
                disabled={!!graded}
                maxLength={200}
                placeholder="답을 적어 주세요"
                autoComplete="off"
                autoCapitalize="off"
                enterKeyHint="done"
                onChange={(e) => onAnswer(e.target.value)}
              />
              {graded && graded.given !== null ? <Mark state={graded.ok ? 'right' : 'wrong'} className="absolute right-3 top-1/2 -mt-3" /> : null}
            </div>
            {!graded ? (
              <Button type="submit" disabled={typeof answer !== 'string' || !answer.trim()}>
                확인
              </Button>
            ) : null}
          </form>
        ) : null}
        {check.type === 'order' ? (
          <OrderBoard check={check} seed={seed} answer={Array.isArray(answer) ? answer : []} onAnswer={onAnswer} graded={graded} />
        ) : null}
        {check.type === 'match' ? <MatchBoard check={check} seed={seed} disabled={!!graded} onDone={onMatched} /> : null}

        {check.hint && !graded ? (
          hint ? (
            <p className="kok-result-in mt-4 flex items-start gap-2 rounded-2xl bg-hl/25 px-3.5 py-2.5 text-[15px] leading-relaxed">
              <Icon d={ICONS.bulb} size={18} className="mt-0.5 shrink-0 text-warn" />
              <span>
                <RichText text={check.hint} />
              </span>
            </p>
          ) : (
            <button type="button" onClick={onHint} className="press mt-3 inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-sm font-semibold text-muted hover:text-ink">
              <Icon d={ICONS.bulb} size={16} />
              힌트 보기
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

function markOf(right: boolean, picked: boolean, graded: Graded | null): MarkState {
  if (!graded) return 'none';
  if (right) return picked ? 'right' : 'reveal';
  return picked ? 'wrong' : 'none';
}

function Choices({ check, seed, answer, onAnswer, graded }: { check: CourseCheck; seed: string; answer: number | null; onAnswer: (v: number) => void; graded: Graded | null }) {
  const choices = check.choices ?? [];
  const order = useMemo(() => shuffled(choices.length, seed), [choices.length, seed]);
  return (
    <div className="mt-4 grid gap-2" role="group" aria-label="보기">
      {order.map((i, d) => {
        const picked = (graded ? graded.given : answer) === i;
        const right = Number(check.answer) === i;
        const mark = markOf(right, picked, graded);
        return (
          <button
            key={i}
            type="button"
            disabled={!!graded}
            aria-pressed={!graded ? picked : undefined}
            onClick={() => onAnswer(i)}
            className={cx(
              'press flex min-h-[52px] items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[16px] transition-[color,background-color,border-color,opacity] duration-200',
              graded
                ? right
                  ? 'border-ok bg-ok-soft'
                  : picked
                    ? 'border-bad bg-bad-soft'
                    : 'border-line bg-surface opacity-60'
                : picked
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-surface hover:border-accent/60',
              mark === 'right' && 'kok-boop',
              mark === 'wrong' && 'kok-shake',
            )}
          >
            {mark === 'none' ? (
              <span
                className={cx(
                  'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold',
                  picked ? 'border-accent bg-accent text-accent-ink' : 'border-line',
                )}
              >
                {d + 1}
              </span>
            ) : (
              <>
                <Mark state={mark} className="mt-0.5" />
                <span className="sr-only">{mark === 'wrong' ? '내가 고른 답: ' : '정답: '}</span>
              </>
            )}
            <span className="min-w-0">
              <RichText text={choices[i]} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OxChoices({ check, answer, onAnswer, graded }: { check: CourseCheck; answer: boolean | null; onAnswer: (v: boolean) => void; graded: Graded | null }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      {[true, false].map((v) => {
        const picked = (graded ? graded.given : answer) === v;
        const right = Boolean(check.answer) === v;
        const mark = markOf(right, picked, graded);
        return (
          <button
            key={String(v)}
            type="button"
            disabled={!!graded}
            aria-pressed={!graded ? picked : undefined}
            onClick={() => onAnswer(v)}
            aria-label={v ? 'O 맞다' : 'X 틀리다'}
            className={cx(
              'press relative rounded-2xl border-2 py-6 font-display text-4xl transition-[color,background-color,border-color,opacity] duration-200',
              graded
                ? right
                  ? 'border-ok bg-ok-soft text-ok'
                  : picked
                    ? 'border-bad bg-bad-soft text-bad'
                    : 'border-line bg-surface opacity-60'
                : picked
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-surface hover:border-accent/60',
              mark === 'right' && 'kok-boop',
              mark === 'wrong' && 'kok-shake',
            )}
          >
            {v ? 'O' : 'X'}
            {mark === 'right' || mark === 'reveal' ? <Mark state={mark} className="absolute right-2.5 top-2.5" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 낱말 고르기 빈칸의 빈칸 자리: 고른 낱말이 들어가고, 누르면 빠진다 */
function BankBlank({ value, graded, onClear }: { value: string | null; graded: Graded | null; onClear: () => void }) {
  const tone = graded ? (graded.ok ? 'border-ok bg-ok-soft text-ok' : 'border-bad bg-bad-soft text-bad') : value ? 'border-accent bg-accent-soft text-accent' : 'border-accent';
  return value ? (
    <button
      type="button"
      disabled={!!graded}
      onClick={onClear}
      aria-label={`빈칸: ${value} (눌러서 빼기)`}
      className={cx('press mx-1 inline-flex min-w-16 items-center justify-center rounded-xl border-2 px-2.5 py-0.5 align-baseline text-[17px] font-semibold', tone)}
    >
      {value}
    </button>
  ) : (
    <span className={cx('mx-1 inline-block min-w-16 border-b-[3px] align-baseline', tone)} aria-label="빈칸">
      &nbsp;
    </span>
  );
}

function WordBank({ check, seed, answer, onAnswer, graded }: { check: CourseCheck; seed: string; answer: string | null; onAnswer: (v: string) => void; graded: Graded | null }) {
  const words = check.choices ?? [];
  const order = useMemo(() => shuffled(words.length, seed), [words.length, seed]);
  return (
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="고를 낱말">
      {order.map((i, d) => {
        const used = answer === words[i];
        return (
          <button
            key={i}
            type="button"
            disabled={!!graded || used}
            onClick={() => onAnswer(words[i])}
            aria-label={`${d + 1}. ${words[i]}`}
            className={cx(
              'press min-h-11 rounded-xl border-2 px-3.5 py-2 text-[16px] font-semibold transition-[background-color,border-color,opacity] duration-200',
              used ? 'border-dashed border-line bg-surface-2 text-transparent' : 'border-line bg-surface hover:border-accent/60',
              graded && !used && 'opacity-60',
            )}
          >
            <RichText text={words[i]} />
          </button>
        );
      })}
    </div>
  );
}

/** 순서 맞추기: 아래 칸을 차례대로 누르면 위 줄에 놓이고, 위 줄의 칸을 누르면 빠진다 */
function OrderBoard({ check, seed, answer, onAnswer, graded }: { check: CourseCheck; seed: string; answer: number[]; onAnswer: (v: number[]) => void; graded: Graded | null }) {
  const items = check.choices ?? [];
  const order = useMemo(() => shuffled(items.length, seed, true), [items.length, seed]);
  const placed = graded && Array.isArray(graded.given) ? graded.given : answer;
  return (
    <div className="mt-4 grid gap-3">
      <ol className="grid min-h-[60px] gap-2 rounded-2xl border-2 border-dashed border-line p-2" aria-label="놓은 차례">
        {placed.length ? (
          placed.map((i, at) => {
            const tone = graded ? (i === at ? 'border-ok bg-ok-soft' : 'border-bad bg-bad-soft') : 'border-accent bg-accent-soft';
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!!graded}
                  onClick={() => onAnswer(placed.filter((x) => x !== i))}
                  aria-label={`${at + 1}번째: ${items[i]} (눌러서 빼기)`}
                  className={cx('press flex w-full items-start gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left text-[15px] font-semibold', tone)}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface text-xs font-bold tabular-nums">{at + 1}</span>
                  <span className="min-w-0">
                    <RichText text={items[i]} />
                  </span>
                </button>
              </li>
            );
          })
        ) : (
          <li className="grid min-h-10 place-items-center text-sm text-muted">아래에서 첫 번째부터 눌러요</li>
        )}
      </ol>
      {!graded ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="놓을 칸">
          {order.map((i) => {
            const used = answer.includes(i);
            return (
              <button
                key={i}
                type="button"
                disabled={used}
                onClick={() => onAnswer([...answer, i])}
                className={cx(
                  'press min-h-11 rounded-xl border-2 px-3.5 py-2 text-left text-[15px] font-semibold transition-[background-color,border-color] duration-200',
                  used ? 'border-dashed border-line bg-surface-2 text-transparent' : 'border-line bg-surface hover:border-accent/60',
                )}
              >
                <RichText text={items[i]} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 짝 맞추기: 왼쪽 하나·오른쪽 하나를 누르면 바로 채점 (맞으면 흐려지고, 틀리면 흔들린다). 다 맞추면 onDone(틀린 수) */
function MatchBoard({ check, seed, disabled, onDone }: { check: CourseCheck; seed: string; disabled: boolean; onDone: (wrongs: number) => void }) {
  const pairs = check.pairs ?? [];
  const lefts = useMemo(() => shuffled(pairs.length, `${seed}:l`), [pairs.length, seed]);
  const rights = useMemo(() => shuffled(pairs.length, `${seed}:r`, true), [pairs.length, seed]);
  const [sel, setSel] = useState<{ side: 'l' | 'r'; i: number } | null>(null);
  const [matched, setMatched] = useState<number[]>([]);
  const [miss, setMiss] = useState<{ l: number; r: number; n: number } | null>(null);
  const wrongs = useRef(0);
  useEffect(() => {
    if (!miss) return;
    const t = setTimeout(() => setMiss(null), 450);
    return () => clearTimeout(t);
  }, [miss]);
  const pick = (side: 'l' | 'r', i: number) => {
    if (disabled || matched.includes(i)) return;
    if (!sel || sel.side === side) {
      setSel(sel && sel.side === side && sel.i === i ? null : { side, i });
      return;
    }
    const l = side === 'l' ? i : sel.i;
    const r = side === 'r' ? i : sel.i;
    setSel(null);
    if (l === r) {
      const m = [...matched, l];
      setMatched(m);
      if (m.length === pairs.length) onDone(wrongs.current);
    } else {
      wrongs.current++;
      setMiss({ l, r, n: (miss?.n ?? 0) + 1 });
    }
  };
  const tile = (side: 'l' | 'r', i: number) => {
    const text = side === 'l' ? pairs[i].left : pairs[i].right;
    const done = matched.includes(i);
    const on = sel?.side === side && sel.i === i;
    const bad = miss && (side === 'l' ? miss.l : miss.r) === i;
    return (
      <button
        key={`${side}${i}${bad ? `-${miss?.n}` : ''}`}
        type="button"
        disabled={disabled || done}
        aria-pressed={on}
        onClick={() => pick(side, i)}
        className={cx(
          'press flex min-h-[56px] w-full items-center justify-center rounded-2xl border-2 px-3 py-2.5 text-center text-[15px] font-semibold leading-snug transition-[background-color,border-color,opacity] duration-200',
          done ? 'border-ok/40 bg-ok-soft text-ok opacity-60' : bad ? 'kok-shake border-bad bg-bad-soft' : on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent/60',
        )}
      >
        <span className="min-w-0">
          <RichText text={text} />
        </span>
      </button>
    );
  };
  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5">
      <div className="grid content-start gap-2.5" role="group" aria-label="왼쪽">
        {lefts.map((i) => tile('l', i))}
      </div>
      <div className="grid content-start gap-2.5" role="group" aria-label="오른쪽">
        {rights.map((i) => tile('r', i))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- 채점 띠 (아래에서 올라온다)
function Feedback({
  check,
  graded,
  praise,
  onContinue,
  actionRef,
}: {
  check: CourseCheck;
  graded: Graded;
  praise: string;
  onContinue: () => void;
  actionRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ok = graded.ok;
  const matchMiss = check.type === 'match' && graded.given !== null && !ok;
  const title = ok ? praise : matchMiss ? '짝을 다 맞췄어요' : '아쉬워요';
  const answer = checkAnswerText(check);
  return (
    <div
      className={cx(
        'border-t px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-4 transition-colors duration-200',
        ok ? 'border-ok/30 bg-ok-soft' : matchMiss ? 'border-warn/30 bg-warn-soft' : 'border-bad/30 bg-bad-soft',
      )}
    >
      <div className="mx-auto grid w-full max-w-lg gap-3">
        <div className="kok-result-in flex max-h-[38vh] items-start gap-3 overflow-y-auto" role="status">
          <span
            className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full text-white', ok ? 'bg-ok' : matchMiss ? 'bg-warn' : 'bg-bad')}
            aria-hidden="true"
          >
            <Icon d={ok || matchMiss ? ICONS.check : ICONS.close} size={20} strokeWidth={3} />
          </span>
          <div className="grid min-w-0 flex-1 gap-1.5">
            <p className={cx('font-display text-xl', ok ? 'text-ok' : matchMiss ? 'text-warn' : 'text-bad')}>{title}</p>
            {matchMiss ? <p className="text-[15px]">짝을 {graded.wrongPairs}번 잘못 골랐어요. 다음엔 한 번에 맞혀 봐요.</p> : null}
            {!ok && !matchMiss ? (
              <p className="text-[15px]">
                <span className="font-semibold">정답: </span>
                <RichText text={answer} />
              </p>
            ) : null}
            {check.explanation ? (
              <p className="text-[15px] leading-relaxed text-ink">
                <RichText text={check.explanation} />
              </p>
            ) : null}
            {!ok && graded.retry ? <p className="text-sm font-semibold text-muted">이 문제는 레슨 끝에 한 번 더 나와요.</p> : null}
          </div>
        </div>
        <button
          ref={actionRef}
          type="button"
          onClick={onContinue}
          className={cx(
            'press w-full rounded-full px-6 py-3.5 text-base font-semibold text-white hover:brightness-110 sm:ml-auto sm:w-auto sm:min-w-[180px]',
            ok ? 'bg-ok' : matchMiss ? 'bg-warn' : 'bg-bad',
          )}
        >
          계속
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- 끝 화면
function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m ? `${m}분 ${String(s).padStart(2, '0')}초` : `${s}초`;
}

/** 끝 화면: 별 세 개가 톡톡 켜지고, 정확도·시간·최고 연속, 틀린 문제와 정답 */
function Result({ done, mode, title }: { done: Done; mode: PlayerMode; title: string }) {
  const stars: StarCount = done.stars;
  const accuracy = done.total ? Math.round((done.correct / done.total) * 100) : 100;
  const showStars = mode !== 'mistakes';
  const [open, setOpen] = useState(true);
  const cheer =
    mode === 'mistakes'
      ? done.correct
        ? `틀린 문제 ${done.correct}개를 바로 맞혀서 목록에서 뺐어요.`
        : '아직 헷갈리는 문제들이에요. 해설을 한 번 더 읽어 봐요.'
      : stars === 3
        ? '완벽해요! 처음부터 다 맞혔어요.'
        : stars === 2
          ? '잘했어요! 틀린 문제만 한 번 더 보면 돼요.'
          : '끝까지 했어요! 다시 한 번 보면 더 쉬워져요.';
  return (
    <div className="kok-rise mt-6 grid justify-items-center gap-4 text-center">
      {showStars ? (
        <div className="flex items-end gap-2" role="img" aria-label={`별 ${stars}개`}>
          {[0, 1, 2].map((i) => (
            <svg
              key={i}
              viewBox="0 0 24 24"
              width={i === 1 ? 72 : 56}
              height={i === 1 ? 72 : 56}
              aria-hidden="true"
              className={cx('kok-star-in', i < stars ? 'text-hl drop-shadow-[0_6px_14px_rgba(255,214,10,0.45)]' : 'text-muted/45')}
              style={{ ['--i' as string]: i }}
            >
              {/* 못 받은 별은 테두리만 (회색 바탕 위에서도 빈 별로 보이게) */}
              <path
                d={ICONS.star}
                fill={i < stars ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={i < stars ? 1.2 : 1.6}
                strokeLinejoin="round"
              />
            </svg>
          ))}
        </div>
      ) : null}
      <h3 className="font-display text-[26px]">{title}</h3>
      <p className="text-[15px]">{cheer}</p>
      <dl className="grid w-full grid-cols-3 gap-2">
        {(
          [
            ['정확도', done.total ? `${accuracy}%` : '-'],
            ['걸린 시간', formatTime(done.secs)],
            ['최고 연속', `${done.best}개`],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="kok-card grid gap-0.5 rounded-2xl px-2 py-3">
            <dt className="text-xs font-semibold text-muted">{k}</dt>
            <dd className="font-display text-[20px] tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {done.total ? (
        <p className="text-sm text-muted">
          확인 문제 {done.total}개 중 <b className="text-ink">{done.correct}개</b>를 처음에 맞혔어요
        </p>
      ) : null}
      {done.missed.length ? (
        <section className="kok-card grid w-full gap-2 rounded-[22px] p-4 text-left" aria-label="틀린 문제">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
            <span className="min-w-0 flex-1 font-bold">틀린 문제 {done.missed.length}개</span>
            <Icon d={ICONS.chevronDown} size={18} className={cx('text-muted transition-transform duration-200', open && 'rotate-180')} />
          </button>
          {open ? (
            <ul className="grid gap-2.5">
              {done.missed.map((m) => (
                <li key={m.key} className="grid gap-1 border-t border-line pt-2.5 text-[15px]">
                  <span className="line-clamp-3 leading-relaxed">
                    <RichText text={m.check.prompt} />
                  </span>
                  <span className="text-sm">
                    <span className="font-semibold text-ok">정답 </span>
                    <RichText text={checkAnswerText(m.check)} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {mode !== 'mistakes' ? <p className="text-xs text-muted">{"틀린 문제는 '틀린 문제 복습'과 단계 복습에서 먼저 나와요."}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
