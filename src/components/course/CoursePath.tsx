'use client';
// 단계별 학습의 길: 단계(unit)마다 머리 카드 → 레슨 칸들이 지그재그로 → 단계 복습(과녁) → 맨 끝 총정리.
// 끝낸 칸 다음 하나만 '지금 할 것'(시작 말풍선), 그 뒤는 회색(아직 차례가 아님). 끝낸 칸은 별 1~3개 (별 3개는 금빛), 언제든 다시 할 수 있다.
// 칸을 누르면 바로 시작하지 않고 칸 아래에 레슨 정보 말풍선(듀오링고처럼): 이름·목표·카드와 문제 수·걸리는 시간, 시작·다시 하기,
// 아직 차례가 아닌 칸은 '앞 칸 N개를 건너뛰어요' + 건너뛰고 시작 / 앞 레슨부터. 바깥을 누르거나 Esc 면 닫히고 초점은 그 칸으로.
// 단계 머리의 책 단추 = 그 단계 핵심 정리 (CoursePanel 의 시트).
// 길이 길면(courseSections: 4단계부터) 섹션으로 나눈다: 섹션 1(1~2단계) → 섹션 2(3~4단계) … 한 번에 한 섹션만 펼치고(지금 할 칸이 든 섹션),
// 다른 섹션은 머리 카드(섹션 번호·단계 이름·진도)만. 머리를 누르면 그 섹션을 펼친다 (지금 할 칸이 다음 섹션으로 넘어가면 그 섹션이 펼쳐진다).
// 칸은 72px(엄지가 닿는 큰 단추), 색은 테마 포인트 색. 움직임은 transform·opacity 만 (globals.css '단계별 학습')
import { useEffect, useRef, useState } from 'react';
import {
  COURSE_LIMITS,
  lessonMinutes,
  recapChecks,
  skippedBefore,
  type CourseNode,
  type CoursePlan,
  type CourseProgress,
  type CourseSection,
} from '@/lib/course';
import { confirmOpen } from '../Confirm';
import { Button, ICONS, Icon, cx } from '../ui';
import { prefersReducedMotion } from '../useReducedMotion';

/** 지그재그 자리 (칸마다 가로로 얼마나 옮기는지, 단위 px) */
const ZIGZAG = [0, 1, 2, 1, 0, -1, -2, -1];
const STEP_PX = 44;

type Ctx = {
  plan: CoursePlan;
  nodes: CourseNode[];
  progress: CourseProgress;
  /** 말풍선이 열린 칸 */
  picked: string | null;
  pick: (id: string | null) => void;
  /** 칸의 말풍선을 연다 (접힌 섹션의 칸이면 그 섹션을 펼친다: '앞 레슨부터') */
  reveal: (id: string) => void;
  onStart: (node: CourseNode) => void;
  onGuide: (unit: number) => void;
};

/** 처음 펼칠 섹션: 지금 할 칸이 든 섹션 (다 끝냈으면 마지막 섹션) */
function nowSection(sections: CourseSection[]): number {
  return (sections.find((x) => x.state === 'current') ?? sections.find((x) => x.state !== 'done') ?? sections[sections.length - 1]).index;
}

export function CoursePath({
  plan,
  nodes,
  sections,
  progress,
  onStart,
  onGuide,
}: {
  plan: CoursePlan;
  nodes: CourseNode[];
  /** 길이 길면 섹션 (courseSections). null 이면 한 줄로 */
  sections: CourseSection[] | null;
  progress: CourseProgress;
  /** 말풍선의 시작·다시 하기·건너뛰고 시작 */
  onStart: (node: CourseNode) => void;
  /** 단계 머리의 핵심 정리 */
  onGuide: (unit: number) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // 섹션: 학생이 고른 섹션 (-1 = 모두 접음). at: 고를 때의 '지금 섹션' (그것이 바뀌면 고른 것을 잊는다)
  const [secPick, setSecPick] = useState<{ index: number; at: number } | null>(null);
  const now = sections ? nowSection(sections) : 0;
  const openSec = secPick && secPick.at === now ? secPick.index : now;
  const reveal = (id: string) => {
    const sec = sections?.find((s) => s.nodes.some((n) => n.id === id));
    if (sec && sec.index !== openSec) setSecPick({ index: sec.index, at: now });
    setPicked(id);
  };
  const ctx: Ctx = { plan, nodes, progress, picked, pick: setPicked, reveal, onStart, onGuide };
  if (!sections) {
    return (
      <div className="grid gap-6">
        <Units ctx={ctx} nodes={nodes} units={plan.units.map((_, ui) => ui)} />
      </div>
    );
  }
  return (
    <Sections
      ctx={ctx}
      sections={sections}
      open={openSec}
      onToggle={(index) => {
        setSecPick({ index: openSec === index ? -1 : index, at: now });
        setPicked(null);
      }}
    />
  );
}

/** 단계들의 길 (단계 머리 카드 + 지그재그 칸), 총정리가 든 칸 목록이면 맨 끝에 총정리 */
function Units({ ctx, nodes, units }: { ctx: Ctx; nodes: CourseNode[]; units: number[] }) {
  const final = nodes.find((n) => n.kind === 'final');
  let seq = 0;
  return (
    <>
      {units.map((ui) => {
        const u = ctx.plan.units[ui];
        const list = nodes.filter((n) => (n.kind === 'lesson' || n.kind === 'recap') && n.unit === ui);
        const done = list.filter((n) => n.state === 'done').length;
        const active = list.some((n) => n.state === 'current');
        return (
          <section key={ui} aria-label={`${ui + 1}단계 ${u.title}`} className="grid gap-5">
            <UnitHeader index={ui} title={u.title} summary={u.summary} done={done} total={list.length} active={active} onGuide={() => ctx.onGuide(ui)} />
            <ol className="grid justify-items-center gap-5 py-1">
              {list.map((n) => {
                const offset = ZIGZAG[seq % ZIGZAG.length] * STEP_PX;
                seq++;
                return (
                  // 말풍선이 열린 칸은 뒤 칸들(저마다 transform 이라 겹침 층이 따로)보다 위에
                  <li key={n.id} className="grid justify-items-center" style={{ transform: `translateX(${offset}px)`, zIndex: ctx.picked === n.id ? 20 : undefined }}>
                    <PathNode ctx={ctx} node={n} offset={offset} />
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {final ? (
        <section aria-label="총정리" className="relative grid justify-items-center gap-3 pb-4 pt-1" style={{ zIndex: ctx.picked === final.id ? 20 : undefined }}>
          <PathNode ctx={ctx} node={final} offset={0} />
        </section>
      ) : null}
    </>
  );
}

/**
 * 섹션으로 나눈 길: 펼친 섹션 하나만 칸을 보인다. 처음에는 지금 할 칸이 든 섹션(다 끝냈으면 마지막 섹션).
 * 학생이 고른 섹션은 지금 할 칸의 섹션이 바뀔 때까지 기억한다 (레슨을 끝내 다음 섹션으로 넘어가면 그 섹션이 펼쳐진다).
 * 고른 섹션은 CoursePath 가 들고 있다 (다른 섹션의 칸 말풍선에서 '앞 레슨부터'를 누르면 지금 할 칸의 섹션을 펼치게)
 */
function Sections({ ctx, sections, open, onToggle }: { ctx: Ctx; sections: CourseSection[]; open: number; onToggle: (index: number) => void }) {
  const toggle = (index: number, el: HTMLElement) => {
    onToggle(index);
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
        const titles = sec.units.map((ui) => ctx.plan.units[ui]?.title).filter(Boolean);
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
                <Units ctx={ctx} nodes={sec.nodes} units={sec.units} />
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
  onGuide,
}: {
  index: number;
  title: string;
  summary: string;
  done: number;
  total: number;
  active: boolean;
  onGuide: () => void;
}) {
  const complete = total > 0 && done === total;
  const on = active || complete;
  return (
    <div className={cx('flex items-center gap-3 rounded-[22px] px-5 py-4', on ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink')}>
      <div className="min-w-0 flex-1">
        <p className={cx('text-xs font-bold', on ? 'opacity-80' : 'text-muted')}>{index + 1}단계</p>
        <h3 className="mt-0.5 truncate font-display text-[19px] leading-snug">{title}</h3>
        {summary ? <p className={cx('mt-1 line-clamp-2 text-[13px] leading-snug', on ? 'opacity-85' : 'text-muted')}>{summary}</p> : null}
      </div>
      <button
        type="button"
        onClick={onGuide}
        aria-label={`${index + 1}단계 핵심 정리`}
        title="핵심 정리"
        className={cx('press grid h-11 w-11 shrink-0 place-items-center rounded-full', on ? 'bg-white/20 hover:bg-white/30' : 'bg-surface text-ink hover:bg-surface-3')}
      >
        <Icon d={ICONS.book} size={20} />
      </button>
      <div
        className={cx('grid h-11 min-w-11 shrink-0 place-items-center rounded-full px-2 text-sm font-bold tabular-nums', on ? 'bg-white/20' : 'bg-surface text-muted')}
        aria-label={`레슨 ${done}개 끝냄, 모두 ${total}개`}
      >
        {complete ? <Icon d={ICONS.check} size={20} strokeWidth={3} /> : `${done}/${total}`}
      </div>
    </div>
  );
}

/** 길 위의 칸 하나: 동그란 큰 단추 + (끝냈으면) 별 + 이름. 지금 할 것에는 '시작' 말풍선, 누르면 아래에 레슨 정보 말풍선 */
function PathNode({ ctx, node, offset }: { ctx: Ctx; node: CourseNode; offset: number }) {
  const locked = node.state === 'locked';
  const current = node.state === 'current';
  const perfect = node.state === 'done' && node.stars >= 3;
  const big = node.kind !== 'lesson';
  const open = ctx.picked === node.id;
  const icon = node.kind === 'final' ? ICONS.trophy : node.kind === 'recap' ? ICONS.target : node.state === 'done' ? ICONS.check : ICONS.star;
  const label = node.kind === 'final' ? '총정리' : node.title;
  const stateText = node.state === 'done' ? `끝냄 · 별 ${node.stars}개` : current ? '지금 할 것' : '아직 차례가 아니에요';
  const btn = useRef<HTMLButtonElement>(null);
  return (
    // 지금 할 칸은 위에 말풍선 자리를 둔다 (앞 칸의 이름과 겹치지 않게)
    <div className={cx('relative grid justify-items-center gap-2', current && 'mt-12')} data-node-current={current ? 'true' : undefined}>
      {current ? (
        <span
          className="kok-bubble absolute -top-11 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-bold text-accent shadow-[0_6px_18px_var(--shadow-strong)]"
          aria-hidden="true"
        >
          {node.stars ? '다시' : '시작'}
        </span>
      ) : null}
      <button
        ref={btn}
        type="button"
        aria-label={`${label}, ${stateText}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => ctx.pick(open ? null : node.id)}
        className={cx(
          'kok-path-node grid place-items-center rounded-full',
          big ? 'h-[84px] w-[84px]' : 'h-[72px] w-[72px]',
          locked ? 'is-locked bg-surface-3 text-muted' : perfect ? 'is-perfect bg-hl text-hl-ink' : 'bg-accent text-accent-ink',
          current && 'is-current',
          node.state === 'done' && 'is-done',
        )}
      >
        <Icon d={perfect && node.kind === 'lesson' ? ICONS.crown : icon} size={big ? 34 : 30} strokeWidth={2.4} />
      </button>
      {node.state === 'done' ? <Stars n={node.stars} /> : null}
      <p className={cx('max-w-[132px] text-center text-xs font-semibold leading-snug', locked ? 'text-muted' : 'text-ink')}>{label}</p>
      {open ? <NodePopover ctx={ctx} node={node} offset={offset} anchor={btn} /> : null}
    </div>
  );
}

/** 칸 아래 말풍선: 레슨 정보와 시작 단추 (길의 가운데 줄에 맞춰 두고, 꼬리는 칸을 가리킨다) */
function NodePopover({ ctx, node, offset, anchor }: { ctx: Ctx; node: CourseNode; offset: number; anchor: React.RefObject<HTMLButtonElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const label = node.kind === 'final' ? '총정리' : node.title;
  const skipped = node.state === 'locked' ? skippedBefore(ctx.nodes, node.id) : 0;
  const current = ctx.nodes.find((n) => n.state === 'current');

  useEffect(() => {
    // 첫 단추에 초점 (차례가 아닌 칸은 '앞 레슨부터': 실수로 건너뛰지 않게)
    box.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const anchorEl = anchor.current;
    requestAnimationFrame(() => {
      const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
      const a = anchorEl?.getBoundingClientRect();
      // 칸이 화면 밖이면(다른 섹션에서 '앞 레슨부터'로 연 칸) 칸을 가운데로,
      // 아니면 말풍선이 화면 아래에 걸릴 때만 보이게 (아래 메뉴에 가리지 않게)
      if (a && (a.top < 0 || a.bottom > window.innerHeight)) anchorEl?.scrollIntoView({ block: 'center', behavior });
      else box.current?.scrollIntoView({ block: 'nearest', behavior });
    });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchorEl?.contains(t)) return;
      ctx.pick(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || confirmOpen() || e.defaultPrevented) return;
      e.preventDefault();
      ctx.pick(null);
      anchorEl?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
    // 열 때 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let meta = '';
  let note = '';
  if (node.kind === 'lesson') {
    const l = ctx.plan.units[node.unit]?.lessons[node.lesson];
    if (l) meta = `카드 ${l.cards.length}장 · 문제 ${l.checks.length}개 · 약 ${lessonMinutes(l.cards.length, l.checks)}분`;
    note = l?.goal ?? '';
  } else if (node.kind === 'recap') {
    const picks = recapChecks(ctx.plan, node.unit, 'info', ctx.progress.mistakes);
    const missed = picks.filter((k) => ctx.progress.mistakes?.[k.key]).length;
    meta = `문제 ${picks.length}개`;
    note = missed ? `이 단계에서 틀렸던 문제 ${missed}개부터 나와요.` : '이 단계 레슨에서 고루 뽑은 문제예요.';
  } else {
    const all = ctx.plan.units.reduce((a, u) => a + u.lessons.reduce((b, l) => b + l.checks.length, 0), 0);
    meta = `문제 ${Math.min(COURSE_LIMITS.final, all)}개`;
    note = Object.keys(ctx.progress.mistakes ?? {}).length ? '모든 단계에서, 틀렸던 문제부터 나와요.' : '모든 단계에서 고루 뽑은 문제예요.';
  }

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`레슨 정보: ${label}`}
      className="kok-node-pop absolute left-1/2 top-full z-30 mt-3 w-[min(300px,calc(100vw-32px))] scroll-mb-28"
      style={{ ['--shift' as string]: `${-offset}px` }}
    >
      <div className="relative grid gap-3 rounded-[22px] border border-line bg-surface p-4 text-left shadow-[0_14px_36px_var(--shadow-strong)]">
        <span
          className="absolute -top-[7px] h-3.5 w-3.5 rotate-45 border-l border-t border-line bg-surface"
          style={{ left: `calc(50% + ${offset}px - 7px)` }}
          aria-hidden="true"
        />
        <div className="grid gap-1">
          <p className="font-display text-[17px] leading-snug">{label}</p>
          {note ? <p className="text-sm leading-relaxed text-muted">{note}</p> : null}
          {meta ? <p className="text-xs font-semibold text-muted">{meta}</p> : null}
          {node.state === 'done' ? <Stars n={node.stars} size={16} className="mt-0.5" /> : null}
        </div>
        {node.state === 'locked' ? (
          <>
            <p className="rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-relaxed">
              아직 차례가 아니에요. {skipped ? `앞 칸 ${skipped}개를 건너뛰어요.` : ''} 앞에서 배운 것 위에 쌓이는 내용이라 차례대로 하면 더 쉬워요.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => (current ? ctx.reveal(current.id) : ctx.pick(null))}>
                앞 레슨부터
              </Button>
              <Button
                onClick={() => {
                  ctx.pick(null);
                  ctx.onStart(node);
                }}
              >
                건너뛰고 시작
              </Button>
            </div>
          </>
        ) : (
          <Button
            className="w-full"
            onClick={() => {
              ctx.pick(null);
              ctx.onStart(node);
            }}
          >
            {node.state === 'done' ? '다시 하기' : '시작'}
          </Button>
        )}
      </div>
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
