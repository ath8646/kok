'use client';
// 단계별 풀이: 한 단계씩 넘기며 보고, 그림은 단계마다 선이 더해지고 지금 단계의 부분이 형광펜으로 칠해진다.
// 다음·이전 버튼, 좌우 화살표 키, 옆으로 밀기. '모든 단계'를 누르면 한 번에 펼쳐 본다.
// 단계 이름('식 세우기: …', 과목마다 다르다)은 번호 옆에 굵게 따로 보인다 (lib/step-title.ts)
import { useMemo, useRef, useState } from 'react';
import type { Figure, Step } from '@/lib/figure/spec';
import { visibleAt } from '@/lib/figure/spec';
import { stepParts } from '@/lib/step-title';
import { RichText } from '@/components/RichText';
import { ICONS, Icon, cx } from '@/components/ui';
import { FigureView } from './FigureView';

export function StepPlayer({
  figure,
  steps,
  compact = false,
  className,
}: {
  figure: Figure | null;
  steps: Step[];
  /** 채팅처럼 좁은 곳 */
  compact?: boolean;
  className?: string;
}) {
  const [k, setK] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [all, setAll] = useState(false);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const n = steps.length;
  const step = steps[Math.min(k, n - 1)];
  const parts = useMemo(() => steps.map((s) => stepParts(s.text)), [steps]);
  const cur = parts[Math.min(k, n - 1)];

  const visible = useMemo(() => (figure ? visibleAt(figure, steps, all ? n - 1 : k) : undefined), [figure, steps, k, all, n]);
  const focus = useMemo(() => (all || !step ? new Set<string>() : new Set([...step.focus, ...step.add])), [step, all]);
  // 앞으로 넘길 때만 새 요소가 살짝 나타난다 (뒤로 갈 때는 바로)
  const fresh = useMemo(() => (all || dir < 0 || !step ? new Set<string>() : new Set(step.add)), [step, dir, all]);

  if (!n) return null;
  const go = (to: number) => {
    const t = Math.max(0, Math.min(n - 1, to));
    if (t === k) return;
    setDir(t > k ? 1 : -1);
    setK(t);
  };

  return (
    <section
      className={cx('kok-steps grid gap-3 rounded-[24px] bg-surface ring-1 ring-line', compact ? 'p-3' : 'p-4', className)}
      aria-label="단계별 풀이"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (all) return;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          go(k + 1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          go(k - 1);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <Icon d={ICONS.sparkle} size={15} strokeWidth={2} />
        </span>
        <p className="flex-1 text-[15px] font-bold">단계별 풀이</p>
        <button
          type="button"
          className="press rounded-full px-2.5 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink"
          aria-pressed={all}
          onClick={() => setAll((a) => !a)}
        >
          {all ? '한 단계씩' : '모든 단계'}
        </button>
      </div>

      {!all ? (
        <div className="flex gap-1" role="group" aria-label="단계">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-current={i === k ? 'step' : undefined}
              aria-label={`${i + 1}단계`}
              title={parts[i]?.title ?? undefined}
              className="group h-5 flex-1 py-2"
              onClick={() => go(i)}
            >
              <span className={cx('block h-1 rounded-full transition-colors duration-200', i <= k ? 'bg-accent' : 'bg-surface-2 group-hover:bg-line')} />
            </button>
          ))}
        </div>
      ) : null}

      {figure ? (
        <div
          className="kok-fig-panel overflow-hidden rounded-[18px] bg-surface-2/60 px-2 py-3"
          onPointerDown={(e) => {
            if (all) return;
            swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s || s.id !== e.pointerId) return;
            const dx = e.clientX - s.x;
            const dy = e.clientY - s.y;
            if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? k + 1 : k - 1);
          }}
          style={{ touchAction: 'pan-y' }}
        >
          <FigureView figure={figure} visible={visible} focus={focus} fresh={fresh} className="mx-auto max-w-[460px]" />
        </div>
      ) : null}

      {all ? (
        <ol className="grid gap-2.5">
          {parts.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-ink">{i + 1}</span>
              <div className="min-w-0 flex-1 text-[15px] leading-relaxed">
                {p.title ? <p className="kok-step-title text-[13px] font-bold text-accent">{p.title}</p> : null}
                <RichText text={p.body} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="grid gap-1" aria-live="polite">
          <p className="text-xs font-bold tracking-wide text-accent">
            {k + 1}단계{cur?.title ? <span className="kok-step-title"> · {cur.title}</span> : null} <span className="font-semibold text-muted">/ {n}</span>
          </p>
          <div key={k} className={cx('min-h-[3.2em] text-[16px] leading-relaxed', dir > 0 ? 'kok-step-next' : 'kok-step-prev')}>
            <RichText text={cur?.body ?? step.text} />
          </div>
        </div>
      )}

      {!all ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="press inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35"
            onClick={() => go(k - 1)}
            disabled={k === 0}
          >
            <Icon d={ICONS.back} size={17} />
            이전
          </button>
          <span className="flex-1" />
          {k < n - 1 ? (
            <button
              type="button"
              className="press inline-flex h-10 items-center gap-1 rounded-full bg-accent pl-4 pr-3 text-sm font-bold text-accent-ink"
              onClick={() => go(k + 1)}
            >
              다음 단계
              <Icon d="M9 5l7 7-7 7" size={17} strokeWidth={2.2} />
            </button>
          ) : (
            <button
              type="button"
              className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-bold text-ink"
              onClick={() => go(0)}
            >
              <Icon d={ICONS.retry} size={16} />
              처음부터
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
