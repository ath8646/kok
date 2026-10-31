'use client';
// 단계별 학습의 길: 단계(unit)마다 머리 카드 → 레슨 칸들이 지그재그로 → 단계 복습(트로피) → 맨 끝 총정리.
// 끝낸 칸 다음 하나만 '지금 할 것'(시작 말풍선), 그 뒤는 회색(아직 차례가 아님: 눌러서 건너뛸 수 있다, 한 번 묻는다). 끝낸 칸은 별 1~3개 (언제든 다시 할 수 있다).
// 길이 길면(courseSections: 4단계부터) 섹션으로 나눈다: 섹션 1(1~2단계) → 섹션 2(3~4단계) … 한 번에 한 섹션만 펼치고(지금 할 칸이 든 섹션),
// 다른 섹션은 머리 카드(섹션 번호·단계 이름·진도)만. 머리를 누르면 그 섹션을 펼친다 (지금 할 칸이 다음 섹션으로 넘어가면 그 섹션이 펼쳐진다).
// 칸은 72px(엄지가 닿는 큰 단추), 색은 테마 포인트 색. 움직임은 transform·opacity 만 (globals.css '단계별 학습')
import { useState } from 'react';
import { type CourseNode, type CoursePlan, type CourseSection } from '@/lib/course';
import { ICONS, Icon, cx } from '../ui';

/** 지그재그 자리 (칸마다 가로로 얼마나 옮기는지, 단위 px) */
const ZIGZAG = [0, 1, 2, 1, 0, -1, -2, -1];
const STEP_PX = 44;

type Open = (node: CourseNode) => void;

export function CoursePath({
  plan,
  nodes,
  sections,
  onOpen,
  onLocked,
}: {
  plan: CoursePlan;
  nodes: CourseNode[];
  /** 길이 길면 섹션 (courseSections). null 이면 한 줄로 */
  sections: CourseSection[] | null;
  onOpen: Open;
  /** 아직 차례가 아닌 칸을 눌렀을 때 (건너뛸지 묻는다) */
  onLocked: Open;
}) {
  if (!sections) {
    return (
      <div className="grid gap-6">
        <Units plan={plan} nodes={nodes} units={plan.units.map((_, ui) => ui)} onOpen={onOpen} onLocked={onLocked} />
      </div>
    );
  }
  return <Sections plan={plan} sections={sections} onOpen={onOpen} onLocked={onLocked} />;
}

/** 단계들의 길 (단계 머리 카드 + 지그재그 칸), 총정리가 든 칸 목록이면 맨 끝에 총정리 */
function Units({ plan, nodes, units, onOpen, onLocked }: { plan: CoursePlan; nodes: CourseNode[]; units: number[]; onOpen: Open; onLocked: Open }) {
  const final = nodes.find((n) => n.kind === 'final');
  let seq = 0;
  return (
    <>
      {units.map((ui) => {
        const u = plan.units[ui];
        const list = nodes.filter((n) => (n.kind === 'lesson' || n.kind === 'recap') && n.unit === ui);
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
    </>
  );
}

/**
 * 섹션으로 나눈 길: 펼친 섹션 하나만 칸을 보인다. 처음에는 지금 할 칸이 든 섹션(다 끝냈으면 마지막 섹션).
 * 학생이 고른 섹션은 지금 할 칸의 섹션이 바뀔 때까지 기억한다 (레슨을 끝내 다음 섹션으로 넘어가면 그 섹션이 펼쳐진다)
 */
function Sections({ plan, sections, onOpen, onLocked }: { plan: CoursePlan; sections: CourseSection[]; onOpen: Open; onLocked: Open }) {
  const now = (sections.find((x) => x.state === 'current') ?? sections.find((x) => x.state !== 'done') ?? sections[sections.length - 1]).index;
  // 고른 섹션 (-1 = 모두 접음). at: 고를 때의 '지금 섹션' (그것이 바뀌면 고른 것을 잊는다)
  const [pick, setPick] = useState<{ index: number; at: number } | null>(null);
  const open = pick && pick.at === now ? pick.index : now;
  const toggle = (index: number, el: HTMLElement) => {
    setPick({ index: open === index ? -1 : index, at: now });
    // 위 섹션이 접히면 누른 머리가 위로 올라가 화면 밖으로 나갈 수 있다: 누른 머리가 보이게
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
  };
  return (
    <div className="grid gap-4">
      {sections.map((sec) => {
        const isOpen = open === sec.index;
        const first = sec.units[0];
        const last = sec.units[sec.units.length - 1];
        const range = first === last ? `${first + 1}단계` : `${first + 1}~${last + 1}단계`;
        const titles = sec.units.map((ui) => plan.units[ui]?.title).filter(Boolean);
        const panel = `course-section-${sec.index}`;
        const complete = sec.state === 'done';
        const here = sec.state === 'current';
        return (
          <section key={sec.index} aria-label={`섹션 ${sec.index + 1}`} className="grid gap-5">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={isOpen ? panel : undefined}
              aria-label={`섹션 ${sec.index + 1} · ${range}${here ? ' · 지금 하는 섹션' : complete ? ' · 모두 끝냄' : ''} · ${titles.join(', ')} · ${sec.total}칸 가운데 ${sec.done}칸 끝냄`}
              onClick={(e) => toggle(sec.index, e.currentTarget)}
              className="kok-card kok-card-hover press flex w-full scroll-mt-28 items-center gap-3 rounded-[24px] p-4 text-left"
            >
              <span
                className={cx(
                  'grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-display text-[20px] tabular-nums',
                  complete ? 'bg-ok-soft text-ok' : here ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted',
                )}
                aria-hidden="true"
              >
                {complete ? <Icon d={ICONS.check} size={22} strokeWidth={3} /> : sec.index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-muted">
                  섹션 {sec.index + 1} · {range}
                  {here ? <span className="text-accent"> · 지금 하는 섹션</span> : null}
                </span>
                <span className="mt-0.5 line-clamp-2 font-bold leading-snug">{titles.join(' · ')}</span>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                  <span
                    className={cx('block h-full origin-left rounded-full', complete ? 'bg-ok' : 'bg-accent')}
                    style={{ transform: `scaleX(${sec.total ? sec.done / sec.total : 0})` }}
                  />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-bold tabular-nums">
                  {sec.done}/{sec.total}
                </span>
                <Icon d={ICONS.chevronDown} size={18} className={cx('ml-auto mt-1 text-muted transition-transform duration-200', isOpen && 'rotate-180')} />
              </span>
            </button>
            {isOpen ? (
              <div id={panel} className="kok-unfold grid gap-6">
                <Units plan={plan} nodes={sec.nodes} units={sec.units} onOpen={onOpen} onLocked={onLocked} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function UnitHeader({
  index,
  title,
  summary,
  done,
  total,
  active,
}: {
  index: number;
  title: string;
  summary: string;
  done: number;
  total: number;
  active: boolean;
}) {
  const complete = total > 0 && done === total;
  return (
    <div className={cx('flex items-center gap-3 rounded-[22px] px-5 py-4', active || complete ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink')}>
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
function PathNode({ node, onOpen, onLocked }: { node: CourseNode; onOpen: (n: CourseNode) => void; onLocked: (n: CourseNode) => void }) {
  const locked = node.state === 'locked';
  const current = node.state === 'current';
  const big = node.kind !== 'lesson';
  const icon = node.kind === 'final' ? ICONS.trophy : node.kind === 'recap' ? ICONS.target : node.state === 'done' ? ICONS.check : ICONS.star;
  const label = node.kind === 'final' ? '총정리' : node.title;
  const stateText = node.state === 'done' ? `끝냄 · 별 ${node.stars}개` : current ? '지금 할 것' : '아직 차례가 아니에요 · 눌러서 건너뛰기';
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
        onClick={() => (locked ? onLocked(node) : onOpen(node))}
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
