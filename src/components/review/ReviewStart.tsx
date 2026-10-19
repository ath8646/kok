'use client';
// 복습 시작 화면: 언제 공부한 문제(기간) · 과목 · 얼마나(5·15·30분)를 고르면 핵심 문제부터 골라 준다.
// 시간은 문제 수만 정한다 (지나도 멈추지 않는다). 계산은 src/lib/review-plan.ts (시험 있음).
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Button, ICONS, Icon, cx, radioKeys } from '@/components/ui';
import { subjectVar } from '@/lib/colors';
import type { PlanData } from '@/lib/data';
import {
  PERIOD_LABEL,
  PICK_KIND_LABEL,
  REVIEW_MINUTES,
  REVIEW_PERIODS,
  periodCounts,
  periodPool,
  pickKinds,
  pickToday,
  plansForTimes,
  type PickKind,
  type ReviewMinutes,
  type ReviewPeriod,
  type TimedPlan,
} from '@/lib/review-plan';

type PlanCardRow = PlanData['cards'][number];

/** 고른 것: 기간, 과목(null = 모든 과목), 시간 */
export type StartChoice = { period: ReviewPeriod; subjectId: string | null; minutes: ReviewMinutes };
/** 시작할 때 넘기는 것: 고른 문제와 예상 시간, 기간의 문제를 다 넣었는지, 시간을 직접 골랐는지 */
export type StartPick = TimedPlan<PlanCardRow> & { timed: boolean };

const KIND_ORDER: PickKind[] = ['wrong', 'key', 'due', 'new', 'again'];
// 점 색: 틀렸던 문제 빨강, 중요한 개념 금색, 복습할 차례 파랑, 처음 초록, 다시 보기 회색 (테마의 가지 색을 따른다)
const KIND_DOT: Record<PickKind, string> = { wrong: 'bg-bad', key: 'bg-[var(--b8)]', due: 'bg-[var(--b1)]', new: 'bg-ok', again: 'bg-muted' };

const minutesText = (sec: number) => `약 ${Math.max(1, Math.round(sec / 60))}분`;

export function ReviewStart({
  plan,
  cards,
  periods,
  choice,
  onChoice,
  pace,
  review,
  starting,
  onStart,
}: {
  plan: PlanData;
  /** 이 복습 방법의 문제 (오답·약점 개념은 그 문제만) */
  cards: PlanCardRow[];
  /** 기간·과목을 고르는지 (오늘·과목 복습) */
  periods: boolean;
  choice: StartChoice;
  onChoice: (c: StartChoice) => void;
  /** 내 빠르기 (1 = 보통) */
  pace: number;
  review: { dailyMax: number; interleave: boolean };
  starting: boolean;
  onStart: (pick: StartPick) => void;
}) {
  const opts = { dailyMax: review.dailyMax, doneToday: plan.doneToday, interleave: review.interleave };
  const view = useMemo(() => {
    const now = new Date();
    const o = { ...opts, now };
    // 과목 칩: 이 복습 방법에 문제가 있는 과목만
    const subjects = periods ? plan.subjects.filter((s) => cards.some((c) => c.subject_id === s.id)) : [];
    const subjectId = choice.subjectId && subjects.some((s) => s.id === choice.subjectId) ? choice.subjectId : null;
    const inSubject = subjectId ? cards.filter((c) => c.subject_id === subjectId) : cards;
    const counts = periods ? periodCounts(inSubject, plan.planSubjects, o) : null;
    const poolOf = (list: PlanCardRow[]) => (periods ? periodPool(list, plan.planSubjects, choice.period, o) : list);
    const pool = poolOf(inSubject);
    const subjectCounts = new Map(subjects.map((s) => [s.id, poolOf(cards.filter((c) => c.subject_id === s.id)).length]));
    const allCount = periods ? poolOf(cards).length : cards.length;
    const plans = plansForTimes(pool, plan.planSubjects, REVIEW_MINUTES, { now, pace, interleave: review.interleave });
    // 다 들어가는 문제가 5분보다 적으면 시간을 고를 것이 없다
    const timed = pool.length > 0 && !plans[0].all;
    const chosen = timed ? plans[REVIEW_MINUTES.indexOf(choice.minutes)] : plans[0];
    // 복습할 차례가 비었을 때: 하루 최대 수를 채워서인지
    const dueWaiting =
      periods && choice.period === 'due' && !pool.length ? pickToday(inSubject, plan.planSubjects, { ...o, dailyMax: 100_000, doneToday: 0 }).length : 0;
    return {
      subjects,
      subjectId,
      counts,
      pool,
      subjectCounts,
      allCount,
      plans,
      timed,
      chosen,
      kinds: pickKinds(chosen.cards, plan.planSubjects, now),
      dueWaiting,
    };
    // opts 는 아래 값으로 정해진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, cards, periods, choice, pace, review.dailyMax, review.interleave]);

  const set = (patch: Partial<StartChoice>) => onChoice({ ...choice, ...patch });
  const { counts, pool, plans, timed, chosen, kinds } = view;
  const kindList = KIND_ORDER.filter((k) => kinds[k] > 0);

  return (
    <section className="kok-card grid gap-5 p-5" aria-label="복습 고르기">
      {periods && counts ? (
        <Group label="언제 공부한 문제를 풀까요?" id="rv-period">
          <div role="radiogroup" aria-labelledby="rv-period" className="flex flex-wrap gap-2">
            {REVIEW_PERIODS.map((p, i) => (
              <ChoiceChip
                key={p}
                on={choice.period === p}
                onPick={() => set({ period: p })}
                onKeyDown={(e) => radioKeys(e, i, REVIEW_PERIODS.length, (n) => set({ period: REVIEW_PERIODS[n] }))}
                count={counts[p]}
              >
                {PERIOD_LABEL[p]}
              </ChoiceChip>
            ))}
          </div>
        </Group>
      ) : null}

      {view.subjects.length > 1 ? (
        <Group label="과목" id="rv-subject" style={{ ['--i' as string]: 1 }}>
          {/* 과목이 많으면 옆으로 민다 */}
          <div role="radiogroup" aria-labelledby="rv-subject" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5">
            {[null, ...view.subjects].map((s, i, all) => {
              const id = s?.id ?? null;
              return (
                <ChoiceChip
                  key={id ?? 'all'}
                  on={view.subjectId === id}
                  onPick={() => set({ subjectId: id })}
                  onKeyDown={(e) => radioKeys(e, i, all.length, (n) => set({ subjectId: all[n]?.id ?? null }))}
                  count={id ? (view.subjectCounts.get(id) ?? 0) : view.allCount}
                  dot={s ? subjectVar(s.color) : undefined}
                >
                  {s ? s.name : '모든 과목'}
                </ChoiceChip>
              );
            })}
          </div>
        </Group>
      ) : null}

      {!pool.length ? (
        <NothingHere
          due={periods && choice.period === 'due'}
          capped={view.dueWaiting > 0}
          dailyMax={review.dailyMax}
          subject={!!view.subjectId}
          style={{ ['--i' as string]: 2 }}
        />
      ) : (
        <>
          <Group label="얼마나 풀까요?" id="rv-time" style={{ ['--i' as string]: 2 }}>
            {timed ? (
              <div role="radiogroup" aria-labelledby="rv-time" className="grid grid-cols-3 gap-2">
                {REVIEW_MINUTES.map((m, i) => {
                  const p = plans[i];
                  const on = choice.minutes === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on ? 0 : -1}
                      onClick={() => set({ minutes: m })}
                      onKeyDown={(e) => radioKeys(e, i, REVIEW_MINUTES.length, (n) => set({ minutes: REVIEW_MINUTES[n] }))}
                      className={cx(
                        'press grid min-w-0 content-start gap-1.5 rounded-2xl px-3.5 py-3 text-left ring-inset',
                        on ? 'bg-accent-soft text-accent ring-2 ring-accent' : 'bg-surface-2 text-ink hover:bg-surface-3',
                      )}
                    >
                      <span className="font-display text-[22px] leading-none tabular-nums">
                        {m}
                        <span className="ml-0.5 text-sm">분</span>
                      </span>
                      <span className={cx('truncate text-[13px] font-semibold', on ? 'text-accent' : 'text-muted')}>
                        {p.all ? `전부 ${p.cards.length}문제` : m === REVIEW_MINUTES[0] ? `핵심 ${p.cards.length}문제` : `${p.cards.length}문제`}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-[15px] font-semibold">
                <Icon d={ICONS.clock} size={18} className="shrink-0 text-muted" />
                전부 {chosen.cards.length}문제 · {minutesText(chosen.seconds)}이면 다 풀어요
              </p>
            )}
            {/* 어떤 문제를 골랐는지: 틀렸던 문제·중요한 개념이 먼저 들어간다 */}
            <ul className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-[13px] text-muted" aria-label="고른 문제">
              {kindList.map((k) => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <span className={cx('h-1.5 w-1.5 rounded-full', KIND_DOT[k])} aria-hidden="true" />
                  {PICK_KIND_LABEL[k]} <span className="font-semibold tabular-nums text-ink">{kinds[k]}</span>
                </li>
              ))}
              {timed && chosen.all && chosen.seconds < choice.minutes * 60 - 60 ? <li>· {minutesText(chosen.seconds)}이면 다 풀어요</li> : null}
            </ul>
          </Group>
          <div className="kok-fill grid gap-2" style={{ ['--i' as string]: 3 }}>
            <Button size="lg" className="w-full" busy={starting} onClick={() => onStart({ ...chosen, timed })}>
              {chosen.cards.length}문제 시작
            </Button>
            <p className="text-balance text-center text-xs text-muted">시간이 지나도 고른 문제는 끝까지 풀 수 있어요.</p>
          </div>
        </>
      )}
    </section>
  );
}

function Group({ label, id, style, children }: { label: string; id: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className="kok-fill grid gap-2.5" style={style}>
      <p id={id} className="text-sm font-bold">
        {label}
      </p>
      {children}
    </div>
  );
}

/** 고르기 칩 (기간·과목): 고른 칩은 진하게, 옆에 문제 수 */
function ChoiceChip({
  on,
  onPick,
  onKeyDown,
  count,
  dot,
  children,
}: {
  on: boolean;
  onPick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  count: number;
  dot?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      tabIndex={on ? 0 : -1}
      onClick={onPick}
      onKeyDown={onKeyDown}
      className={cx(
        'press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold',
        on ? 'bg-ink text-surface' : 'bg-surface-2 text-ink hover:bg-surface-3',
      )}
    >
      {dot ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" /> : null}
      <span className="max-w-[8rem] truncate">{children}</span>
      <span className={cx('tabular-nums', on ? 'opacity-70' : count ? 'text-muted' : 'text-muted/60')}>{count}</span>
    </button>
  );
}

/** 고른 기간·과목에 풀 문제가 없을 때 (시간 고르기와 시작 버튼 자리) */
function NothingHere({ due, capped, dailyMax, subject, style }: { due: boolean; capped: boolean; dailyMax: number; subject: boolean; style?: CSSProperties }) {
  const title = due ? (capped ? '오늘 정한 만큼 다 풀었어요' : '오늘 복습은 끝났어요') : '이 기간에 넣은 문제가 없어요';
  const body = due
    ? capped
      ? `하루 최대 ${dailyMax}문제를 채웠어요. 더 풀고 싶으면 위에서 기간을 골라 보세요.`
      : '잊어버리기 직전이 되면 다시 나와요. 위에서 기간을 고르면 미리 풀어 볼 수 있어요.'
    : subject
      ? '다른 기간이나 과목을 골라 보세요.'
      : '다른 기간을 골라 보세요.';
  return (
    <div className="kok-fill grid justify-items-center gap-1 rounded-2xl bg-surface-2/70 px-5 py-7 text-center" style={style}>
      <span className={cx('mb-2 grid h-12 w-12 place-items-center rounded-full', due ? 'bg-ok-soft text-ok' : 'bg-surface text-muted')} aria-hidden="true">
        <Icon d={due ? ICONS.check : ICONS.clock} size={24} strokeWidth={due ? 2.4 : 1.9} />
      </span>
      <p className="font-display text-lg">{title}</p>
      <p className="max-w-xs text-sm text-muted">{body}</p>
    </div>
  );
}

/** 시작 화면을 읽는 동안: 실제 카드와 같은 모양 (기간 칩, 시간 카드 셋, 고른 문제 한 줄, 시작 버튼, 안내 한 줄) */
export function StartSkeleton({ periods }: { periods: boolean }) {
  return (
    <div className="kok-card kok-skel kok-shimmer grid gap-5 p-5" aria-busy="true">
      <span className="sr-only">복습을 불러오는 중이에요</span>
      {periods ? (
        <div className="grid gap-2.5" aria-hidden="true">
          <span className="flex h-5 items-center">
            <span className="kok-bone h-3 w-44" />
          </span>
          <div className="flex flex-wrap gap-2">
            {[104, 60, 62, 64, 70, 76].map((w, i) => (
              <span key={i} className="kok-bone h-9" style={{ width: w }} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2.5" aria-hidden="true">
        <span className="flex h-5 items-center">
          <span className="kok-bone h-3 w-28" />
        </span>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="kok-bone h-[72px] rounded-2xl!" />
          ))}
        </div>
        <span className="flex h-5 items-center">
          <span className="kok-bone h-2.5 w-52 max-w-full" />
        </span>
      </div>
      <div className="grid gap-2" aria-hidden="true">
        <span className="kok-bone h-[52px] w-full" />
        <span className="flex h-4 items-center justify-center">
          <span className="kok-bone h-2.5 w-52 max-w-full" />
        </span>
      </div>
    </div>
  );
}
