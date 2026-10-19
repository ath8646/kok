'use client';
// 문제에 붙은 그림 풀이 보여 주기: 문제와 같이 보는 그림(QuestionFigure), 눌러 펼치는 단계별 풀이(StepsDisclosure)
import { useId, useMemo, useState } from 'react';
import { hasBaseFigure, visibleAt } from '@/lib/figure/spec';
import { solutionOf, type Solution } from '@/lib/figure/solution';
import { ICONS, Icon, cx } from '@/components/ui';
import { FigureView } from './FigureView';
import { StepPlayer } from './StepPlayer';

/** DB 에서 읽은 문제(figure, steps 칸) → 풀이 (없으면 null). 문제가 바뀔 때만 다시 계산한다 */
export function useSolution(q: { figure?: unknown; steps?: unknown } | null | undefined): Solution | null {
  const figure = q?.figure;
  const steps = q?.steps;
  return useMemo(() => (figure || steps ? solutionOf({ figure, steps }) : null), [figure, steps]);
}

/** 문제와 같이 보는 그림 (답을 알려 주는 요소는 풀이 단계에서만 나타난다). 그릴 것이 없으면 아무것도 안 그린다 */
export function QuestionFigure({ solution, className }: { solution: Solution | null; className?: string }) {
  const base = useMemo(() => (solution?.figure ? visibleAt(solution.figure, solution.steps, -1) : null), [solution]);
  if (!solution?.figure || !base || !hasBaseFigure(solution.figure, solution.steps)) return null;
  return (
    <div className={cx('kok-fig-panel overflow-hidden rounded-[20px] bg-surface-2/60 px-2 py-3', className)}>
      <FigureView figure={solution.figure} visible={base} className="mx-auto max-w-[440px]" title="문제 그림" />
    </div>
  );
}

/** 단계별 풀이를 펼쳐 보는 버튼 + 풀이 (틀렸을 때는 처음부터 펼쳐 둔다) */
export function StepsDisclosure({
  solution,
  defaultOpen = false,
  compact = false,
  className,
}: {
  solution: Solution | null;
  defaultOpen?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  if (!solution?.steps.length) return null;
  const n = solution.steps.length;
  return (
    <div className={cx('grid gap-2', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="press inline-flex h-10 w-fit items-center gap-2 rounded-full bg-surface pl-3 pr-3.5 text-sm font-bold text-ink ring-1 ring-line hover:ring-accent"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <Icon d={ICONS.sparkle} size={13} strokeWidth={2.2} />
        </span>
        {solution.figure ? '그림으로 보는 단계별 풀이' : '단계별 풀이'}
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{n}단계</span>
        <Icon d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={15} strokeWidth={2.2} className="text-muted" />
      </button>
      {open ? (
        <div id={panelId} className="kok-step-next">
          <StepPlayer figure={solution.figure} steps={solution.steps} compact={compact} />
        </div>
      ) : null}
    </div>
  );
}
