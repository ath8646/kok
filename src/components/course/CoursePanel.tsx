'use client';
// 노트의 '레슨' 탭: 단계별 학습 (레슨 혜택: 처음에는 Max). 없으면 수준을 골라 만들고, 있으면 길(CoursePath)을 보여 레슨을 하나씩 연다(LessonPlayer). 뒤 칸은 한 번 묻고 건너뛸 수 있다.
// 진도는 note_courses.progress 에 브라우저가 바로 저장한다 (RLS: 내 것, progress 칸만). 혜택이 없으면 어떻게 되는지 미리보기만.
// 이미 만든 레슨은 혜택이 없어져도(요금제가 바뀌어도) 그대로 이어서 한다 (새로 만들기·다시 만들기만 막는다)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@/lib/types';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { josa } from '@/lib/josa';
import { perkNeed, perkTierName } from '@/lib/plans';
import {
  COURSE_LEVELS,
  COURSE_LEVEL_INFO,
  courseCost,
  courseStaged,
  courseNodes,
  courseSections,
  courseStats,
  sectionOfUnit,
  finalChecks,
  lessonKey,
  readCoursePlan,
  readProgress,
  recapChecks,
  type CourseLevel,
  type CourseNode,
  type CoursePlan,
  type CourseProgress,
} from '@/lib/course';
import { Button, Chip, EmptyState, Energy, ICONS, Icon, Menu, Sheet, api, cx, radioKeys, useToast, DONE, type MenuItem } from '../ui';
import { CoursePath, Stars } from './CoursePath';
import { LessonPlayer } from './LessonPlayer';
import { AiMark } from '../ReportSheet';

type CourseRow = { id: string; level: CourseLevel; plan: CoursePlan; progress: CourseProgress; updatedAt: string };

/** 처음 고르는 수준: 마지막에 고른 것을 기기에 기억한다 */
const LEVEL_KEY = 'kok.course.level';
function initialLevel(): CourseLevel {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    if (v && (COURSE_LEVELS as readonly string[]).includes(v)) return v as CourseLevel;
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return 'middle';
}

export function CoursePanel({
  me,
  noteId,
  noteTitle,
  noteChars,
  keyPoints,
  canCreate,
}: {
  me: MeResponse;
  noteId: string;
  noteTitle: string;
  /** 노트 글 길이 (예상 에너지) */
  noteChars: number;
  /** 노트의 개념 수 (레슨 수·예상 에너지) */
  keyPoints: number;
  /** 지금 만들 수 있는지 (지난 버전을 볼 때·자료를 더하는 중에는 아니다) */
  canCreate: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const pro = me.canCourse;
  const tierName = perkTierName(me.perkTiers, 'course');
  const [course, setCourse] = useState<CourseRow | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [level, setLevel] = useState<CourseLevel>(initialLevel);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<CourseNode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** 아직 차례가 아닌 칸을 눌렀다: 건너뛸지 묻는다 */
  const [skipTo, setSkipTo] = useState<CourseNode | null>(null);
  const [remaking, setRemaking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    sb()
      .from('note_courses')
      .select('id, level, plan, progress, updated_at')
      .eq('note_id', noteId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setFailed(true);
          setCourse(null);
          return;
        }
        const plan = data ? readCoursePlan(data.plan) : null;
        setFailed(false);
        setCourse(
          data && plan
            ? { id: data.id, level: data.level as CourseLevel, plan, progress: readProgress(data.progress), updatedAt: String(data.updated_at) }
            : null,
        );
      });
    return () => {
      alive = false;
    };
  }, [noteId, tick]);

  const nodes = useMemo(() => (course ? courseNodes(course.plan, course.progress) : []), [course]);
  // 길이 길면 섹션으로 (섹션 1 → 1~2단계, 섹션 2 → …)
  const sections = useMemo(() => (course ? courseSections(course.plan, nodes) : null), [course, nodes]);
  const stats = useMemo(() => (course ? courseStats(course.plan, course.progress) : null), [course]);
  const current = nodes.find((n) => n.state === 'current') ?? null;

  const create = async (lv: CourseLevel) => {
    if (creating) return;
    setCreating(true);
    try {
      localStorage.setItem(LEVEL_KEY, lv);
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
    try {
      await api(`/api/notes/${noteId}/course`, { method: 'POST', body: JSON.stringify({ level: lv }) });
      setRemaking(false);
      setTick((t) => t + 1);
      toast('단계별 학습을 만들었어요. 첫 레슨부터 시작해 봐요!', 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setCreating(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/notes/${noteId}/course`, { method: 'DELETE' });
      setConfirmDelete(false);
      setCourse(null);
      toast('단계별 학습을 지웠어요.', 'plain', DONE);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setDeleting(false);
    }
  };

  /** 레슨을 끝냈다: 화면은 바로, 저장은 progress 칸만 (더 높은 별만 남긴다) */
  const finish = useCallback(
    async (node: CourseNode, stars: number) => {
      if (!course) return;
      const at = new Date().toISOString();
      const p: CourseProgress = {
        lessons: { ...course.progress.lessons },
        recaps: { ...course.progress.recaps },
        ...(course.progress.final ? { final: course.progress.final } : {}),
      };
      const keep = (old: { stars: number } | undefined) => ({ stars: Math.max(old?.stars ?? 0, stars), at });
      if (node.kind === 'lesson') p.lessons[lessonKey(node.unit, node.lesson)] = keep(p.lessons[lessonKey(node.unit, node.lesson)]);
      else if (node.kind === 'recap') p.recaps[String(node.unit)] = keep(p.recaps[String(node.unit)]);
      else p.final = keep(p.final);
      setCourse({ ...course, progress: p });
      setOpen(null);
      const { error } = await sb().from('note_courses').update({ progress: p }).eq('id', course.id);
      if (error) toast('진도를 저장하지 못했어요. 인터넷을 확인해 주세요.', 'bad');
    },
    [course, toast],
  );

  if (course === undefined) {
    return (
      <div className="kok-skel grid gap-3" aria-busy="true">
        <span className="sr-only">학습을 불러오는 중이에요</span>
        <div className="kok-card kok-shimmer h-28 rounded-[24px]" aria-hidden="true" />
        <div className="grid justify-items-center gap-5 py-2" aria-hidden="true">
          <span className="kok-bone h-[72px] w-[72px] rounded-full" />
          <span className="kok-bone h-[72px] w-[72px] translate-x-11 rounded-full" />
          <span className="kok-bone h-[72px] w-[72px] translate-x-[88px] rounded-full" />
        </div>
      </div>
    );
  }
  if (failed) {
    return (
      <EmptyState
        icon={<Icon d={ICONS.retry} size={34} strokeWidth={2.2} />}
        title="학습을 불러오지 못했어요"
        body="인터넷 연결을 확인하고 다시 불러와 주세요."
        action={<Button onClick={() => setTick((t) => t + 1)}>다시 불러오기</Button>}
      />
    );
  }

  if (!pro && !course) return <LockedPreview tier={tierName} onPlan={() => router.push('/plan')} />;

  if (!course || (pro && remaking)) {
    return (
      <CreateCourse
        me={me}
        noteTitle={noteTitle}
        noteChars={noteChars}
        keyPoints={keyPoints}
        level={level}
        onLevel={setLevel}
        creating={creating}
        onCreate={() => create(level)}
        disabled={!canCreate}
        remake={remaking ? { current: course?.level ?? null, onCancel: () => setRemaking(false) } : undefined}
      />
    );
  }

  const menu: MenuItem[] = [
    {
      label: '수준 바꿔 다시 만들기',
      icon: ICONS.retry,
      onSelect: () => (pro ? setRemaking(true) : toast(perkNeed(me.perkTiers, 'course', '레슨 다시 만들기'))),
    },
    { label: '지우기', icon: ICONS.trash, onSelect: () => setConfirmDelete(true), danger: true },
  ];
  const seed = `${course.id}:${course.updatedAt}`;
  /** 레슨 창 위 글의 섹션 ('섹션 2 · '), 나누지 않은 길이면 없음 */
  const sectionLabel = (unit: number) => {
    const k = sectionOfUnit(sections, unit);
    return k === null ? '' : `섹션 ${k + 1} · `;
  };
  const lessonOf = (n: CourseNode) => (n.kind === 'lesson' ? course.plan.units[n.unit]?.lessons[n.lesson] : undefined);

  return (
    <div className="grid gap-5">
      {/* 머리: 이름·소개·수준·진도, 이어서 하기 */}
      <section className="kok-card grid gap-3 rounded-[24px] p-5" aria-label="학습 진도">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="accent">{COURSE_LEVEL_INFO[course.level].name} 수준</Chip>
              {stats && stats.done === stats.total ? <Chip tone="ok">모두 끝냄</Chip> : null}
              {/* 생성형 AI 결과물 표시 (인공지능기본법). 이상한 곳은 레슨 위 깃발로 신고 */}
              <AiMark label="AI가 만든 레슨" />
            </div>
            <h2 className="mt-2 font-display text-[22px] leading-snug">{course.plan.title || noteTitle}</h2>
            {course.plan.intro ? <p className="mt-1 text-sm leading-relaxed text-muted">{course.plan.intro}</p> : null}
          </div>
          <Menu label="학습 메뉴" items={menu} />
        </div>
        {stats ? (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-muted">
              <span>
                {stats.done} / {stats.total} 끝냄
              </span>
              <span>
                레슨 {stats.lessons}개 · 확인 문제 {stats.checks}개
              </span>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={stats.total}
              aria-valuenow={stats.done}
              aria-label="학습 진도"
            >
              <div
                className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${stats.total ? stats.done / stats.total : 0})` }}
              />
            </div>
          </div>
        ) : null}
        {current ? (
          <Button size="lg" className="w-full" onClick={() => setOpen(current)}>
            {stats?.done ? '이어서 하기' : '첫 레슨 시작'} · {current.kind === 'final' ? '총정리' : current.title}
          </Button>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ok">
            <Icon d={ICONS.trophy} size={18} /> 모든 레슨을 끝냈어요! 아무 칸이나 눌러 다시 할 수 있어요.
          </p>
        )}
      </section>

      <CoursePath plan={course.plan} nodes={nodes} sections={sections} onOpen={setOpen} onLocked={setSkipTo} />

      {open ? (
        open.kind === 'lesson' ? (
          <LessonPlayer
            key={open.id}
            title={open.title}
            subtitle={`${sectionLabel(open.unit)}${open.unit + 1}단계 · ${course.plan.units[open.unit]?.title ?? ''}`}
            goal={lessonOf(open)?.goal}
            cards={lessonOf(open)?.cards ?? []}
            checks={lessonOf(open)?.checks ?? []}
            reportTarget={`${noteId}:${open.id}`}
            onClose={() => setOpen(null)}
            onFinish={(r) => finish(open, r.stars)}
          />
        ) : (
          <LessonPlayer
            key={open.id}
            title={open.kind === 'final' ? '총정리' : open.title}
            subtitle={open.kind === 'final' ? '모든 단계에서 뽑은 문제' : `${sectionLabel(open.unit)}${open.unit + 1}단계에서 뽑은 문제`}
            cards={[]}
            checks={open.kind === 'final' ? finalChecks(course.plan, seed) : recapChecks(course.plan, open.unit, seed)}
            reportTarget={`${noteId}:${open.id}`}
            onClose={() => setOpen(null)}
            onFinish={(r) => finish(open, r.stars)}
          />
        )
      ) : null}

      {/* 건너뛰기: 앞 레슨을 안 하고 뒤 칸을 열 수 있다 (한 번 묻는다) */}
      <Sheet
        open={!!skipTo}
        onClose={() => setSkipTo(null)}
        title="앞 레슨을 건너뛸까요?"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setSkipTo(null)}>
              앞 레슨부터
            </Button>
            <Button
              size="lg"
              onClick={() => {
                const n = skipTo;
                setSkipTo(null);
                if (n) setOpen(n);
              }}
            >
              건너뛰고 시작
            </Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed">
          <b>{skipTo ? (skipTo.kind === 'final' ? '총정리' : skipTo.title) : ''}</b>
          {skipTo?.kind === 'lesson'
            ? '은 앞 레슨 다음에 하도록 되어 있어요. 앞 레슨 위에 쌓이는 내용이라 차례대로 하면 더 쉬워요.'
            : '은 앞 레슨들을 끝낸 뒤에 푸는 문제예요. 지금 바로 풀어 볼 수도 있어요.'}
        </p>
      </Sheet>

      <Sheet
        open={confirmDelete}
        onClose={() => !deleting && setConfirmDelete(false)}
        title="단계별 학습 지우기"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              그대로 두기
            </Button>
            <Button variant="danger" size="lg" busy={deleting} onClick={remove}>
              지우기
            </Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed">이 노트의 단계별 학습과 진도를 지울까요? 노트·문제는 그대로 있어요.</p>
      </Sheet>
    </div>
  );
}

/** 만들기 화면: 수준을 고르고 만든다 (만드는 데 1~2분) */
function CreateCourse({
  me,
  noteTitle,
  noteChars,
  keyPoints,
  level,
  onLevel,
  creating,
  onCreate,
  disabled,
  remake,
}: {
  me: MeResponse;
  noteTitle: string;
  noteChars: number;
  keyPoints: number;
  level: CourseLevel;
  onLevel: (l: CourseLevel) => void;
  creating: boolean;
  onCreate: () => void;
  disabled: boolean;
  /** 다시 만들기: 지금 수준과 취소 */
  remake?: { current: CourseLevel | null; onCancel: () => void };
}) {
  const model = clientModel(me, me.settings.models.organize);
  // 서버와 같은 계산 (큰 노트는 뼈대 + 단계마다 나눠 만든다: lib/course.ts courseCost)
  const cost = courseCost(keyPoints, noteChars);
  const est = estimateSmallTask(model, me.usdPerEnergy, cost.inputTokens, cost.outTokens);
  const idx = COURSE_LEVELS.indexOf(level);
  return (
    <div className="grid gap-4">
      <section className="kok-card grid gap-3 rounded-[24px] p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
            <Icon d={ICONS.target} size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[21px] leading-snug">{remake ? '수준을 바꿔 다시 만들기' : '단계별로 배워 봐요'}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {remake
                ? '새로 만들면 지금 학습과 진도는 사라지고 새 길이 생겨요.'
                : `'${noteTitle}' 노트를 AI가 작은 레슨으로 나눠요. 카드 몇 장을 읽고 확인 문제를 풀면 다음 레슨이 열려요.`}
            </p>
          </div>
        </div>

        <div role="radiogroup" aria-label="수준" className="grid gap-2">
          {COURSE_LEVELS.map((lv, i) => {
            const on = lv === level;
            const info = COURSE_LEVEL_INFO[lv];
            return (
              <button
                key={lv}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={i === idx ? 0 : -1}
                disabled={creating}
                onKeyDown={(e) => radioKeys(e, i, COURSE_LEVELS.length, (n) => onLevel(COURSE_LEVELS[n]))}
                onClick={() => onLevel(lv)}
                className={cx(
                  'press flex min-h-[56px] items-center gap-3 rounded-2xl border-2 px-4 py-2.5 text-left transition-colors',
                  on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent/60',
                )}
              >
                <span
                  className={cx(
                    'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
                    on ? 'border-accent bg-accent text-accent-ink' : 'border-line',
                  )}
                  aria-hidden="true"
                >
                  {on ? <Icon d={ICONS.check} size={12} strokeWidth={3.5} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">
                    {info.name}
                    {remake?.current === lv ? <span className="ml-1.5 text-xs font-semibold text-muted">지금</span> : null}
                  </span>
                  <span className="block text-xs text-muted">{info.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-2 pt-1">
          <Button size="lg" className="w-full" busy={creating} disabled={disabled} onClick={onCreate}>
            {creating ? 'AI가 학습 길을 만드는 중…' : remake ? `${COURSE_LEVEL_INFO[level].name} 수준으로 다시 만들기` : '단계별 학습 만들기'}
          </Button>
          <p className="text-center text-xs text-muted">
            {creating ? (
              `${courseStaged(keyPoints) ? '레슨이 많아서 단계마다 나눠 만들어요. 2~3분' : '1~2분'}쯤 걸려요. 이 화면을 떠나도 계속 만들어요.`
            ) : disabled ? (
              '지금 노트 버전에서, 자료를 더하는 중이 아닐 때 만들 수 있어요.'
            ) : (
              <>
                <Energy n={`약 ${Math.round(est * 10) / 10}`} /> · 노트의 정리·문제·원본 자료를 참고해요
              </>
            )}
          </p>
          {remake ? (
            <Button variant="ghost" onClick={remake.onCancel} disabled={creating}>
              그대로 두기
            </Button>
          ) : null}
        </div>
      </section>
      {!remake ? <SamplePath muted={false} /> : null}
    </div>
  );
}

/** 레슨 혜택이 없을 때: 혜택이 있는 요금제(tier)에서 어떻게 되는지 보여 준다 (예시 길 + 설명 + 요금제 보기) */
function LockedPreview({ tier, onPlan }: { tier: string; onPlan: () => void }) {
  return (
    <div className="grid gap-4">
      <section className="kok-card grid gap-3 rounded-[24px] p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
            <Icon d={ICONS.lock} size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[21px] leading-snug">{tier ? `단계별 학습은 ${tier}에서` : '단계별 학습은 지금 쉬고 있어요'}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {tier ? `${josa(tier, '으로')} 바꾸면 이 노트가 아래처럼 작은 레슨들의 길이 돼요.` : '다시 열리면 이 노트가 아래처럼 작은 레슨들의 길이 돼요.'}
            </p>
          </div>
        </div>
        <ul className="grid gap-2 text-[15px]">
          {[
            ['수준 고르기', '초등학생부터 전문까지 5가지 말투와 깊이'],
            ['카드로 배우기', '레슨마다 개념·예시·비교·팁 카드 3~6장'],
            ['바로 확인', '확인 문제 2~4개를 풀면 다음 레슨이 열려요'],
            ['별 모으기', '다 맞히면 별 3개, 단계 복습과 총정리까지'],
          ].map(([t, d]) => (
            <li key={t} className="flex items-start gap-2.5">
              <Icon d={ICONS.check} size={18} strokeWidth={2.6} className="mt-0.5 shrink-0 text-accent" />
              <span>
                <b>{t}</b> <span className="text-muted">· {d}</span>
              </span>
            </li>
          ))}
        </ul>
        <Button size="lg" className="w-full" onClick={onPlan}>
          {tier ? `${tier} 알아보기` : '요금제 보기'}
        </Button>
      </section>
      <SamplePath muted />
    </div>
  );
}

/** 예시 길 (만들기 전·무료 미리보기): 눌리지 않는 그림 */
function SamplePath({ muted }: { muted: boolean }) {
  const sample = [
    { title: '뜻 알기', state: 'done', stars: 3, x: 0 },
    { title: '왜 중요할까', state: 'done', stars: 2, x: 44 },
    { title: '헷갈리는 것', state: 'current', stars: 0, x: 88 },
    { title: '적용해 보기', state: 'locked', stars: 0, x: 44 },
  ] as const;
  return (
    <section aria-label="예시 길" className={cx('kok-card grid gap-4 rounded-[24px] p-5', muted && 'opacity-80')}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">이렇게 보여요</p>
      <div className="flex items-center gap-3 rounded-[20px] bg-accent px-4 py-3 text-accent-ink">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold opacity-80">1단계</p>
          <p className="truncate font-display text-[17px]">기본 개념</p>
        </div>
        <span className="rounded-full bg-white/20 px-2.5 py-1 text-sm font-bold tabular-nums">2/4</span>
      </div>
      <ul className="grid justify-items-center gap-4 py-1" aria-hidden="true">
        {sample.map((n) => (
          <li
            key={n.title}
            className={cx('relative grid justify-items-center gap-1.5', n.state === 'current' && 'mt-10')}
            style={{ transform: `translateX(${n.x}px)` }}
          >
            {n.state === 'current' ? (
              <span className="kok-bubble absolute -top-10 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-bold text-accent shadow-[0_6px_18px_var(--shadow-strong)]">
                시작
              </span>
            ) : null}
            <span
              className={cx(
                'kok-path-node grid h-16 w-16 place-items-center rounded-full',
                n.state === 'locked' ? 'is-locked bg-surface-3 text-muted' : 'bg-accent text-accent-ink',
                n.state === 'current' && 'is-current',
              )}
            >
              <Icon d={n.state === 'done' ? ICONS.check : ICONS.star} size={26} strokeWidth={2.4} />
            </span>
            {n.state === 'done' ? <Stars n={n.stars} size={12} /> : null}
            <span className={cx('text-xs font-semibold', n.state === 'locked' ? 'text-muted' : 'text-ink')}>{n.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
