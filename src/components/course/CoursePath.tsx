'use client';
// 단계별 학습의 길: 단계(unit)마다 머리 카드 → 레슨 칸들이 지그재그로 → 단계 복습(트로피) → 맨 끝 총정리.
// 끝낸 칸 다음 하나만 '지금 할 것'(시작 말풍선), 그 뒤는 잠긴다. 끝낸 칸은 별 1~3개 (언제든 다시 할 수 있다).
// 칸은 72px(엄지가 닿는 큰 단추), 색은 테마 포인트 색. 움직임은 transform·opacity 만 (globals.css '단계별 학습')
import { type CourseNode, type CoursePlan } from '@/lib/course';
import { ICONS, Icon, cx } from '../ui';

/** 지그재그 자리 (칸마다 가로로 얼마나 옮기는지, 단위 px) */
const ZIGZAG = [0, 1, 2, 1, 0, -1, -2, -1];
const STEP_PX = 44;

export function CoursePath({
  plan,
  nodes,
  onOpen,
  onLocked,
}: {
  plan: CoursePlan;
  nodes: CourseNode[];
  onOpen: (node: CourseNode) => void;
  /** 잠긴 칸을 눌렀을 때 (앞 레슨을 먼저 하라고 알려 준다) */
  onLocked: () => void;
}) {
  // 단계마다 칸을 묶는다 (총정리는 마지막 묶음 뒤에)
  const byUnit = plan.units.map((_, ui) => nodes.filter((n) => (n.kind === 'lesson' || n.kind === 'recap') && n.unit === ui));
  const final = nodes.find((n) => n.kind === 'final');
  let seq = 0;
  return (
    <div className="grid gap-6">
      {plan.units.map((u, ui) => {
        const list = byUnit[ui];
        const done = list.filter((n) => n.state === 'done').length;
        const active = list.some((n) => n.state === 'current');
        return (
          <section key={ui} aria-label={`${ui + 1}단계 ${u.title}`} className="grid gap-5">
            <UnitHeader index={ui} title={u.title} summary={u.summary} done={done} total={list.length} active={active} />
            <ol className="grid justify-items-center gap-5 py-1">
              {list.map((n) => {
                const offset = ZIGZAG[seq % ZIGZAG.length] * STEP_PX;
                seq++;
                return (
                  <li key={n.id} className="grid justify-items-center" style={{ transform: `translateX(${offset}px)` }}>
                    <PathNode node={n} onOpen={onOpen} onLocked={onLocked} />
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {final ? (
        <section aria-label="총정리" className="grid justify-items-center gap-3 pb-4 pt-1">
          <PathNode node={final} onOpen={onOpen} onLocked={onLocked} />
        </section>
      ) : null}
    </div>
  );
}

function UnitHeader({ index, title, summary, done, total, active }: { index: number; title: string; summary: string; done: number; total: number; active: boolean }) {
  const complete = total > 0 && done === total;
  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-[22px] px-5 py-4',
        active || complete ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cx('text-xs font-bold uppercase tracking-wide', active || complete ? 'opacity-80' : 'text-muted')}>{index + 1}단계</p>
        <h3 className="mt-0.5 truncate font-display text-[19px] leading-snug">{title}</h3>
        {summary ? <p className={cx('mt-1 line-clamp-2 text-[13px] leading-snug', active || complete ? 'opacity-85' : 'text-muted')}>{summary}</p> : null}
      </div>
      <div
        className={cx(
          'grid h-11 min-w-11 shrink-0 place-items-center rounded-full px-2 text-sm font-bold tabular-nums',
          active || complete ? 'bg-white/20' : 'bg-surface text-muted',
        )}
        aria-label={`레슨 ${done}개 끝냄, 모두 ${total}개`}
      >
        {complete ? <Icon d={ICONS.check} size={20} strokeWidth={3} /> : `${done}/${total}`}
      </div>
    </div>
  );
}

/** 길 위의 칸 하나: 동그란 큰 단추 + (끝냈으면) 별 + 이름. 지금 할 것에는 '시작' 말풍선 */
function PathNode({ node, onOpen, onLocked }: { node: CourseNode; onOpen: (n: CourseNode) => void; onLocked: () => void }) {
  const locked = node.state === 'locked';
  const current = node.state === 'current';
  const big = node.kind !== 'lesson';
  const icon = node.kind === 'final' ? ICONS.trophy : node.kind === 'recap' ? ICONS.target : node.state === 'done' ? ICONS.check : locked ? ICONS.lock : ICONS.star;
  const label = node.kind === 'final' ? '총정리' : node.title;
  const stateText = node.state === 'done' ? `끝냄 · 별 ${node.stars}개` : current ? '지금 할 것' : '잠김 · 앞 레슨을 먼저 끝내요';
  return (
    // 지금 할 칸은 위에 말풍선 자리를 둔다 (앞 칸의 이름과 겹치지 않게)
    <div className={cx('relative grid justify-items-center gap-2', current && 'mt-12')}>
      {current ? (
        <span
          className="kok-bubble absolute -top-11 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-bold text-accent shadow-[0_6px_18px_var(--shadow-strong)]"
          aria-hidden="true"
        >
          {node.stars ? '다시' : '시작'}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={`${label}, ${stateText}`}
        aria-disabled={locked || undefined}
        onClick={() => (locked ? onLocked() : onOpen(node))}
        className={cx(
          'kok-path-node grid place-items-center rounded-full',
          big ? 'h-[84px] w-[84px]' : 'h-[72px] w-[72px]',
          locked ? 'is-locked bg-surface-3 text-muted' : 'bg-accent text-accent-ink',
          current && 'is-current',
          node.state === 'done' && 'is-done',
        )}
      >
        <Icon d={icon} size={big ? 34 : 30} strokeWidth={2.4} />
      </button>
      {node.state === 'done' ? <Stars n={node.stars} /> : null}
      <p className={cx('max-w-[132px] text-center text-xs font-semibold leading-snug', locked ? 'text-muted' : 'text-ink')}>{label}</p>
    </div>
  );
}

/** 별 세 개 중 n 개 채움 */
export function Stars({ n, size = 14, className }: { n: number; size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)} aria-label={`별 ${n}개`} role="img">
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={i < n ? 'text-hl' : 'text-surface-3'}>
          <path d={ICONS.star} fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}
