'use client';
// 레슨 플레이어: 전체 화면 창에서 카드를 한 장씩 넘기고(다음), 이어서 확인 문제를 풀고(바로 채점·해설), 끝에 별 1~3개.
// 아래에 큰 단추 하나(다음·확인·계속·완료)만 둬서 엄지로 끝까지 할 수 있다. 채점 움직임은 복습(QuestionCard)과 같은 모양
import { useEffect, useRef, useState } from 'react';
import { autoGrade } from '@/lib/grading';
import { starsFor, type CourseCard, type CourseCheck, type Stars as StarCount } from '@/lib/course';
import { lessonStepSnapshot } from '@/lib/report';
import { RichText } from '../RichText';
import { ReportSheet, type ReportWhat } from '../ReportSheet';
import { Button, ICONS, Icon, cx, inputClass } from '../ui';

type Step = { kind: 'card'; card: CourseCard } | { kind: 'check'; check: CourseCheck };

const CARD_KIND: Record<CourseCard['kind'], { label: string; icon: string }> = {
  concept: { label: '개념', icon: ICONS.bulb },
  example: { label: '예시', icon: ICONS.sparkle },
  compare: { label: '비교', icon: ICONS.merge },
  tip: { label: '팁', icon: ICONS.star },
};

export function LessonPlayer({
  title,
  subtitle,
  goal,
  cards,
  checks,
  reportTarget,
  onClose,
  onFinish,
}: {
  title: string;
  /** 작은 글: 단계 이름 등 */
  subtitle?: string;
  /** 레슨의 목표 한 줄 (첫 화면) */
  goal?: string;
  cards: CourseCard[];
  checks: CourseCheck[];
  /** '이상해요' 신고에 남길 번호 ('노트번호:l-단계-레슨'·'노트번호:r-단계'·'노트번호:final'). 없으면 신고 단추도 없다 */
  reportTarget?: string;
  onClose: () => void;
  /** 끝까지 했을 때: 별 수와 맞힌 수 */
  onFinish: (r: { stars: StarCount; correct: number; total: number }) => void;
}) {
  const steps: Step[] = [...cards.map((card) => ({ kind: 'card', card }) as Step), ...checks.map((check) => ({ kind: 'check', check }) as Step)];
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [finished, setFinished] = useState(false);
  const [report, setReport] = useState<ReportWhat | null>(null);
  const reportOpen = useRef(false);
  useEffect(() => {
    reportOpen.current = !!report;
  }, [report]);
  const panel = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const total = checks.length;

  // 열 때 창에 초점, Esc 는 닫기, Enter 는 다음 (글을 치는 중이 아닐 때)
  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        // 신고 창이 떠 있으면 그것만 닫는다 (이 창이 Esc 를 먼저 받아서 시트는 받지 못한다)
        if (reportOpen.current) setReport(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const next = () => {
    setAnswered(null);
    if (index + 1 >= steps.length) {
      setFinished(true);
      return;
    }
    setIndex(index + 1);
    panel.current?.scrollTo({ top: 0 });
  };
  const stars = starsFor(correct, total);
  const progress = finished ? 1 : steps.length ? index / steps.length : 1;

  return (
    <div className="kok-player fixed inset-0 z-[70] flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={title}>
      {/* 위: 닫기 + 진행 막대 */}
      <div className="flex items-center gap-3 px-3 pb-2 pt-[calc(10px+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="레슨 닫기"
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
        >
          <Icon d={ICONS.close} size={24} />
        </button>
        <div
          className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="레슨 진행"
        >
          <div className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="w-11 shrink-0 text-right text-xs font-semibold tabular-nums text-muted" aria-hidden="true">
          {finished ? steps.length : index + 1}/{steps.length}
        </span>
        {reportTarget ? (
          <button
            type="button"
            onClick={() =>
              setReport({ kind: 'course', target: reportTarget, snapshot: finished ? undefined : lessonStepSnapshot(step ?? null, index) || undefined })
            }
            aria-label="이상해요 (신고)"
            title="이상해요"
            className="press -ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Icon d={ICONS.flag} size={20} />
          </button>
        ) : null}
      </div>

      <div ref={panel} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 outline-none md:px-0">
        <div className="mx-auto w-full max-w-lg">
          {subtitle ? <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">{subtitle}</p> : null}
          <h2 className="mt-0.5 font-display text-[22px] leading-snug">{title}</h2>
          {goal && index === 0 && !finished ? <p className="mt-1 text-sm text-muted">{goal}</p> : null}

          {finished ? (
            <Result stars={stars} correct={correct} total={total} />
          ) : step?.kind === 'card' ? (
            <LessonCard key={index} card={step.card} index={index} />
          ) : step?.kind === 'check' ? (
            <CheckCard
              key={index}
              check={step.check}
              onGraded={(ok) => {
                setAnswered(ok);
                if (ok) setCorrect((c) => c + 1);
              }}
            />
          ) : null}
        </div>
      </div>

      {/* 신고 창: 이 창 안에 둬야 창(z 70) 위에 뜬다 */}
      <ReportSheet what={report} onClose={() => setReport(null)} />

      {/* 아래: 큰 단추 하나 (채점 뒤에는 맞았는지에 따라 색이 바뀐다) */}
      <div
        className={cx(
          'border-t px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 transition-colors duration-200',
          answered === null ? 'border-line bg-surface' : answered ? 'border-ok/30 bg-ok-soft' : 'border-bad/30 bg-bad-soft',
        )}
      >
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          {answered !== null ? (
            <p className={cx('min-w-0 flex-1 font-display text-lg', answered ? 'text-ok' : 'text-bad')} role="status">
              {answered ? '맞았어요!' : '아쉬워요'}
            </p>
          ) : null}
          {finished ? (
            <Button size="lg" className="w-full" onClick={() => onFinish({ stars, correct, total })}>
              완료
            </Button>
          ) : step?.kind === 'check' ? (
            answered !== null ? (
              <button
                type="button"
                onClick={next}
                className={cx(
                  'press min-w-[140px] rounded-full px-6 py-3.5 text-base font-semibold text-white hover:brightness-110',
                  answered ? 'bg-ok' : 'bg-bad',
                )}
              >
                계속
              </button>
            ) : (
              <p className="w-full text-center text-sm text-muted">답을 고르면 바로 채점해요</p>
            )
          ) : (
            <Button size="lg" className="w-full" onClick={next}>
              {index + 1 >= steps.length ? '끝내기' : '다음'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LessonCard({ card, index }: { card: CourseCard; index: number }) {
  const k = CARD_KIND[card.kind];
  return (
    <div className={cx('mt-4 grid gap-3', index > 0 && 'kok-step-next')}>
      <div className="kok-card rounded-[28px] p-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
          <Icon d={k.icon} size={14} strokeWidth={2.4} />
          {k.label}
        </span>
        {card.heading ? <h3 className="mt-3 font-display text-[21px] leading-snug">{card.heading}</h3> : null}
        <p className="mt-2 text-[17px] leading-relaxed">
          <RichText text={card.text} />
        </p>
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

function ClozePrompt({ text }: { text: string }) {
  const parts = text.split(/(_{2,}|\(\s*\)|\[\s*\])/);
  return (
    <>
      {parts.map((p, i) =>
        /^(_{2,}|\(\s*\)|\[\s*\])$/.test(p) ? (
          <span key={i} className="mx-1 inline-block min-w-16 border-b-[3px] border-accent align-baseline">
            &nbsp;
          </span>
        ) : (
          <RichText key={i} text={p} />
        ),
      )}
    </>
  );
}

/** 확인 문제 하나: 고르면(적으면) 바로 채점하고 해설을 보인다 */
function CheckCard({ check, onGraded }: { check: CourseCheck; onGraded: (correct: boolean) => void }) {
  const [given, setGiven] = useState<number | boolean | string | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (check.type === 'cloze' || check.type === 'short') {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [check.type]);
  const submit = (v: number | boolean | string | null) => {
    if (result !== null) return;
    const ok = v === null ? false : autoGrade(check, v).correct;
    setGiven(v);
    setResult(ok);
    onGraded(ok);
  };
  const answerText =
    check.type === 'mcq'
      ? (check.choices?.[Number(check.answer)] ?? '')
      : check.type === 'ox'
        ? check.answer
          ? 'O (맞다)'
          : 'X (틀리다)'
        : String(check.answer);
  return (
    <div className="kok-step-next mt-4 grid gap-3">
      <div className="kok-card rounded-[28px] p-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold text-muted">확인 문제</span>
        <p className="mt-3 text-[19px] font-semibold leading-relaxed">
          {check.type === 'cloze' ? <ClozePrompt text={check.prompt} /> : <RichText text={check.prompt} />}
        </p>

        {check.type === 'mcq' && check.choices ? (
          <div className="mt-4 grid gap-2">
            {check.choices.map((c, i) => {
              const picked = given === i;
              const right = result !== null && Number(check.answer) === i;
              const wrong = result !== null && picked && !right;
              const mark: MarkState = right ? (picked ? 'right' : 'reveal') : wrong ? 'wrong' : 'none';
              return (
                <button
                  key={i}
                  type="button"
                  disabled={result !== null}
                  onClick={() => submit(i)}
                  className={cx(
                    'flex min-h-[52px] items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[16px] transition-[color,background-color,border-color,opacity] duration-200',
                    right ? 'border-ok bg-ok-soft' : wrong ? 'border-bad bg-bad-soft' : 'border-line bg-surface hover:border-accent',
                    result !== null && !right && !wrong ? 'opacity-60' : '',
                    mark === 'right' && 'kok-boop',
                    mark === 'wrong' && 'kok-shake',
                  )}
                >
                  {mark === 'none' ? (
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-xs font-bold">{i + 1}</span>
                  ) : (
                    <>
                      <Mark state={mark} className="mt-0.5" />
                      <span className="sr-only">{mark === 'wrong' ? '내가 고른 답: ' : '정답: '}</span>
                    </>
                  )}
                  <span className="min-w-0">
                    <RichText text={c} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {check.type === 'ox' ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[true, false].map((v) => {
              const picked = given === v;
              const right = result !== null && Boolean(check.answer) === v;
              const wrong = result !== null && picked && !right;
              const mark: MarkState = right ? (picked ? 'right' : 'reveal') : wrong ? 'wrong' : 'none';
              return (
                <button
                  key={String(v)}
                  type="button"
                  disabled={result !== null}
                  onClick={() => submit(v)}
                  aria-label={v ? 'O 맞다' : 'X 틀리다'}
                  className={cx(
                    'relative rounded-2xl border-2 py-6 font-display text-4xl transition-[color,background-color,border-color,opacity] duration-200',
                    right ? 'border-ok bg-ok-soft text-ok' : wrong ? 'border-bad bg-bad-soft text-bad' : 'border-line bg-surface hover:border-accent',
                    result !== null && !right && !wrong ? 'opacity-60' : '',
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
        ) : null}

        {check.type === 'cloze' || check.type === 'short' ? (
          <form
            className={cx('mt-4 flex gap-2', result === false && given !== null && 'kok-shake')}
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) submit(text.trim());
            }}
          >
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                aria-label="답"
                className={cx(
                  inputClass,
                  'transition-[border-color,background-color] duration-200',
                  result !== null && given !== null && (result ? 'border-ok! bg-ok-soft! pr-12' : 'border-bad! bg-bad-soft! pr-12'),
                )}
                value={result !== null ? String(given ?? '') : text}
                disabled={result !== null}
                maxLength={200}
                placeholder="답을 적어 주세요"
                autoComplete="off"
                autoCapitalize="off"
                onChange={(e) => setText(e.target.value)}
              />
              {result !== null && given !== null ? <Mark state={result ? 'right' : 'wrong'} className="absolute right-3 top-1/2 -mt-3" /> : null}
            </div>
            {result === null ? (
              <Button type="submit" disabled={!text.trim()}>
                확인
              </Button>
            ) : null}
          </form>
        ) : null}

        {result === null ? (
          <button type="button" onClick={() => submit(null)} className="mt-3 text-sm font-semibold text-muted underline-offset-4 hover:underline">
            모르겠어요
          </button>
        ) : null}
      </div>

      {result !== null ? (
        <div className={cx('kok-result-in grid gap-2 rounded-3xl border-2 p-5', result ? 'border-ok bg-ok-soft' : 'border-bad bg-bad-soft')} role="status">
          {!result ? (
            <p className="text-[15px]">
              <span className="font-semibold">정답: </span>
              <RichText text={answerText} />
            </p>
          ) : null}
          {check.explanation ? (
            <p className="text-[15px] leading-relaxed text-ink">
              <RichText text={check.explanation} />
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 끝 화면: 별 세 개가 톡톡 켜지고, 맞힌 수와 한 줄 응원 */
function Result({ stars, correct, total }: { stars: StarCount; correct: number; total: number }) {
  const cheer = stars === 3 ? '완벽해요! 다 맞혔어요.' : stars === 2 ? '잘했어요! 조금만 더 다듬어 봐요.' : '끝까지 했어요! 다시 한 번 보면 더 쉬워져요.';
  return (
    <div className="kok-rise mt-8 grid justify-items-center gap-4 text-center">
      <div className="flex items-end gap-2" role="img" aria-label={`별 ${stars}개`}>
        {[0, 1, 2].map((i) => (
          <svg
            key={i}
            viewBox="0 0 24 24"
            width={i === 1 ? 72 : 56}
            height={i === 1 ? 72 : 56}
            aria-hidden="true"
            className={cx('kok-star-in', i < stars ? 'text-hl drop-shadow-[0_6px_14px_rgba(255,214,10,0.45)]' : 'text-surface-3')}
            style={{ ['--i' as string]: i }}
          >
            <path d={ICONS.star} fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
          </svg>
        ))}
      </div>
      <h3 className="font-display text-[26px]">레슨 끝!</h3>
      {total ? (
        <p className="text-[15px] text-muted">
          확인 문제 {total}개 중 <b className="text-ink">{correct}개</b>를 맞혔어요
        </p>
      ) : null}
      <p className="text-[15px]">{cheer}</p>
    </div>
  );
}
