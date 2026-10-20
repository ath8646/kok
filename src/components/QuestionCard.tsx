'use client';
// 복습 문제 한 개: 풀기 → 채점 → 해설 → 평가 고르기.
// 채점 움직임(globals.css '채점'): 맞으면 고른 칸이 살짝 부풀고 체크가 톡, 틀리면 고른 칸이 작게 흔들리고 조금 뒤 정답 칸에 체크.
// 다음 문제는 살짝 떠오르며 나타난다 (첫 문제는 제자리에)
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Rating } from '@/lib/grading';
import { readQuestionFigure } from '@/lib/source-figures';
import { useMe } from './AppShell';
import { QuestionFigure, StepsDisclosure, useSolution } from './figure/SolutionView';
import { SourceFigureView } from './figure/SourceFigureView';
import { RichText } from './RichText';
import { Button, Chip, ICONS, Icon, cx, inputClass, Spinner } from './ui';
import { pageLabel } from './NoteView';

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

const TYPE_LABEL = { mcq: '객관식', ox: 'OX', cloze: '빈칸', short: '단답' } as const;
const RATING_LABEL: Record<Rating, string> = { 1: '다시', 2: '어려움', 3: '알맞음', 4: '쉬움' };

export function answerText(q: ReviewQuestion): string {
  if (q.type === 'mcq') return q.choices?.[Number(q.answer)] ?? '';
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

function Prompt({ q }: { q: ReviewQuestion }) {
  if (q.type !== 'cloze') return <RichText text={q.prompt} />;
  const parts = q.prompt.split(/(_{2,}|\(\s*\)|\[\s*\])/);
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

export function QuestionCard({
  q,
  sourceKind,
  subjectName,
  onSubmit,
  autoRate,
  onNext,
  onAppeal,
  onShowVisual,
  onReport,
  index,
  total,
}: {
  q: ReviewQuestion;
  sourceKind?: string;
  subjectName?: string;
  onSubmit: (given: number | boolean | string | null, ms: number) => Promise<GradeOutcome>;
  autoRate: (correct: boolean, ms: number) => Rating;
  onNext: (r: { rating: Rating; correct: boolean; given: string; ms: number }) => void;
  onAppeal?: (given: string) => Promise<void>;
  onShowVisual?: () => void;
  onReport?: () => void;
  index?: number;
  total?: number;
}) {
  // 문제마다 새로 만들어진다 (부모가 key 로 문제 id 를 준다)
  const started = useRef(0);
  const [text, setText] = useState('');
  const [given, setGiven] = useState<number | boolean | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<GradeOutcome | null>(null);
  const [ms, setMs] = useState(0);
  const [rating, setRating] = useState<Rating>(3);
  const [appealed, setAppealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultTitle = useRef<HTMLParagraphElement>(null);
  const solution = useSolution(q);
  // 자료 그림 문제: 문제 위에 그림을 (제목·설명은 채점 뒤에)
  const sourceFig = useMemo(() => readQuestionFigure(q.source_figure), [q.source_figure]);
  const { me } = useMe();
  const graded = !!outcome;

  useEffect(() => {
    started.current = Date.now();
    if (q.type === 'cloze' || q.type === 'short') {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [q.id, q.type]);

  const submit = async (value: number | boolean | string | null) => {
    if (busy || outcome) return;
    const spent = Date.now() - started.current;
    setGiven(value);
    setMs(spent);
    setBusy(true);
    try {
      const res = await onSubmit(value, spent);
      setOutcome(res);
      setRating(res.correct && res.partial ? 2 : autoRate(res.correct, spent));
    } finally {
      setBusy(false);
    }
  };

  // 채점 결과가 화면 아래에 가려져 있으면 결과 제목이 보이게 부드럽게 내린다 (글로 답했으면 자판이 닫히는 것을 조금 기다린다)
  useEffect(() => {
    if (!graded) return;
    const t = setTimeout(() => {
      const r = resultTitle.current?.getBoundingClientRect();
      if (!r || r.bottom <= window.innerHeight - 16) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollBy({ top: r.top - window.innerHeight * 0.4, behavior: reduce ? 'auto' : 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [graded]);

  const givenText =
    given === null ? '(모르겠어요)' : q.type === 'mcq' ? (q.choices?.[Number(given)] ?? '') : q.type === 'ox' ? (given ? 'O' : 'X') : String(given);

  // 키보드: 객관식 1~4, OX 는 O/X, 채점 뒤 Enter 는 다음
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // 단계별 풀이·자료 그림 안의 버튼·화살표 키는 그쪽이 쓴다 (Enter 로 다음 단계를 누르다가 다음 문제로 넘어가지 않게).
      // 창(시트)이 열려 있으면 뒤의 문제에 답하지 않는다 (크게 보기 같은 창은 화면 맨 위에 따로 뜬다)
      if (target?.closest?.('[data-own-keys], [role="dialog"]')) return;
      if (outcome) {
        if (e.key === 'Enter') {
          e.preventDefault();
          onNext({ rating, correct: outcome.correct, given: givenText, ms });
        } else if (['1', '2', '3', '4'].includes(e.key)) {
          setRating(Number(e.key) as Rating);
        }
        return;
      }
      if (q.type === 'mcq' && /^[1-6]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (q.choices && i < q.choices.length) submit(i);
      } else if (q.type === 'ox') {
        if (e.key.toLowerCase() === 'o') submit(true);
        if (e.key.toLowerCase() === 'x') submit(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const resultTitleText = outcome ? (outcome.correct ? (outcome.partial ? '거의 맞았어요!' : '맞았어요!') : '아쉬워요') : '';

  return (
    // 다음 문제는 살짝 떠오르며 나타난다 (부모가 문제마다 key 를 바꿔 새로 만든다)
    <div className={cx('grid gap-4', (index ?? 0) > 0 && 'kok-q-in')}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {typeof index === 'number' && total ? (
          <span className="font-semibold text-ink">
            {index + 1} / {total}
          </span>
        ) : null}
        <Chip>{TYPE_LABEL[q.type]}</Chip>
        {subjectName ? <Chip tone="accent">{subjectName}</Chip> : null}
        {q.created_by === 'ai' ? <Chip>AI</Chip> : <Chip tone="ok">내가 만듦</Chip>}
      </div>

      <div className="kok-card rounded-[28px] p-5">
        <p className="text-[19px] font-semibold leading-relaxed">
          <Prompt q={q} />
        </p>
        <QuestionFigure solution={solution} className="mt-4" />
        {sourceFig ? <SourceFigureView fig={sourceFig} variant="question" originalFirst={!!me?.settings.visual.originalFirst} className="mt-4" /> : null}

        {/* 풀기 */}
        {q.type === 'mcq' && q.choices ? (
          <div className="mt-4 grid gap-2">
            {q.choices.map((c, i) => {
              const picked = given === i;
              const right = !!outcome && Number(q.answer) === i;
              const wrong = !!outcome && picked && !right;
              const mark: MarkState = right ? (picked ? 'right' : 'reveal') : wrong ? 'wrong' : 'none';
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!!outcome || busy}
                  onClick={() => submit(i)}
                  className={cx(
                    'flex items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[16px] transition-[color,background-color,border-color,opacity] duration-200',
                    right ? 'border-ok bg-ok-soft' : wrong ? 'border-bad bg-bad-soft' : 'border-line bg-surface hover:border-accent',
                    outcome && !right && !wrong ? 'opacity-60' : '',
                    mark === 'right' && 'kok-boop',
                    mark === 'wrong' && 'kok-shake',
                  )}
                >
                  {mark === 'none' ? (
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-xs font-bold">{i + 1}</span>
                  ) : (
                    <>
                      <ResultMark state={mark} className="mt-0.5" />
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

        {q.type === 'ox' ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[true, false].map((v) => {
              const picked = given === v;
              const right = !!outcome && Boolean(q.answer) === v;
              const wrong = !!outcome && picked && !right;
              const mark: MarkState = right ? (picked ? 'right' : 'reveal') : wrong ? 'wrong' : 'none';
              return (
                <button
                  key={String(v)}
                  type="button"
                  disabled={!!outcome || busy}
                  onClick={() => submit(v)}
                  aria-label={v ? 'O 맞다' : 'X 틀리다'}
                  className={cx(
                    'relative rounded-2xl border-2 py-6 font-display text-4xl transition-[color,background-color,border-color,opacity] duration-200',
                    right ? 'border-ok bg-ok-soft text-ok' : wrong ? 'border-bad bg-bad-soft text-bad' : 'border-line bg-surface hover:border-accent',
                    outcome && !right && !wrong ? 'opacity-60' : '',
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

        {q.type === 'cloze' || q.type === 'short' ? (
          <form
            // '모르겠어요'는 틀린 답을 낸 것이 아니라서 흔들지 않는다
            className={cx('mt-4 flex gap-2', outcome && !outcome.correct && given !== null && 'kok-shake')}
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
                  outcome && given !== null && (outcome.correct ? 'border-ok! bg-ok-soft! pr-12' : 'border-bad! bg-bad-soft! pr-12'),
                )}
                value={outcome ? String(given ?? '') : text}
                disabled={!!outcome || busy}
                maxLength={200}
                placeholder="답을 적어 주세요"
                autoComplete="off"
                autoCapitalize="off"
                onChange={(e) => setText(e.target.value)}
              />
              {outcome && given !== null ? <ResultMark state={outcome.correct ? 'right' : 'wrong'} className="absolute right-3 top-1/2 -mt-3" /> : null}
            </div>
            {!outcome ? (
              <Button type="submit" busy={busy} disabled={!text.trim()}>
                확인
              </Button>
            ) : null}
          </form>
        ) : null}

        {!outcome && !busy ? (
          <button type="button" onClick={() => submit(null)} className="mt-3 text-sm font-semibold text-muted underline-offset-4 hover:underline">
            모르겠어요
          </button>
        ) : null}
        {busy && !outcome ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Spinner /> 채점하는 중…
          </p>
        ) : null}
      </div>

      {/* 채점 결과 */}
      {outcome ? (
        <div
          className={cx('kok-result-in grid gap-3 rounded-3xl border-2 p-5', outcome.correct ? 'border-ok bg-ok-soft' : 'border-bad bg-bad-soft')}
          role="status"
        >
          <p ref={resultTitle} className={cx('flex items-center gap-2.5 font-display text-2xl', outcome.correct ? 'text-ok' : 'text-bad')}>
            <ResultMark key={outcome.correct ? 'ok' : 'bad'} state={outcome.correct ? 'reveal' : 'wrong'} size="lg" />
            <span key={resultTitleText} className="kok-swap">
              {resultTitleText}
            </span>
          </p>
          {!outcome.correct || q.type === 'short' || q.type === 'cloze' ? (
            <p className="text-[15px]">
              <b>정답</b> <RichText text={answerText(q)} />
              {q.type !== 'mcq' && q.type !== 'ox' ? <span className="text-muted"> · 내 답 {givenText}</span> : null}
            </p>
          ) : null}
          {outcome.feedback ? (
            <p className="text-sm">
              <Chip>AI 채점</Chip> {outcome.feedback}
            </p>
          ) : null}
          {q.explanation ? (
            <p className="text-[15px] leading-relaxed">
              <RichText text={q.explanation} />
            </p>
          ) : null}
          {/* 자료 그림 문제: 풀고 나면 그림이 무엇인지 알려 준다 */}
          {sourceFig && (sourceFig.title || sourceFig.caption) ? (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm leading-relaxed">
              <b>자료 그림</b> {sourceFig.title}
              {sourceFig.caption ? <span className="text-muted"> · {sourceFig.caption}</span> : null}
            </p>
          ) : null}
          {/* 그림으로 보는 단계별 풀이 (Pro): 틀렸으면 펼쳐 둔다 */}
          {solution?.steps.length ? (
            <div data-own-keys>
              <StepsDisclosure solution={solution} defaultOpen={!outcome.correct} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {q.pages.length && sourceKind && sourceKind !== 'text' ? (
              <span className="text-xs text-muted">
                출처{' '}
                {q.pages
                  .slice(0, 4)
                  .map((p) => pageLabel(sourceKind, p))
                  .join(', ')}
              </span>
            ) : null}
            {onShowVisual ? (
              <Button size="sm" variant="secondary" onClick={onShowVisual}>
                그림으로 보기
              </Button>
            ) : null}
            {!outcome.correct && onAppeal && (q.type === 'short' || q.type === 'cloze') && given !== null && !appealed ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await onAppeal(String(given));
                  setAppealed(true);
                  setOutcome({ ...outcome, correct: true, feedback: '내 답을 정답으로 넣었어요.' });
                  setRating(3);
                }}
              >
                내 답도 맞아요
              </Button>
            ) : null}
            {onReport ? (
              <button type="button" onClick={onReport} className="ml-auto text-sm font-semibold text-muted underline-offset-4 hover:underline">
                이상해요
              </button>
            ) : null}
          </div>

          <div className="grid gap-2 border-t border-black/10 pt-3 dark:border-white/10">
            <p className="text-xs text-muted">다음 복습 날짜를 정하는 평가예요. 자동으로 골랐고, 바꿔도 돼요.</p>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="평가">
              {([1, 2, 3, 4] as Rating[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={rating === r}
                  onClick={() => setRating(r)}
                  className={cx(
                    'rounded-xl border-2 py-2 text-sm font-semibold',
                    rating === r ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink',
                  )}
                >
                  {RATING_LABEL[r]}
                </button>
              ))}
            </div>
            <Button size="lg" variant="ink" onClick={() => onNext({ rating, correct: outcome.correct, given: givenText, ms })}>
              다음
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
