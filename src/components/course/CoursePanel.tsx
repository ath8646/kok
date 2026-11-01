'use client';
// 노트의 '레슨' 탭: 단계별 학습 (레슨 혜택: 처음에는 Max). 없으면 수준을 골라 만들고, 있으면 길(CoursePath)을 보여 레슨을 하나씩 연다(LessonPlayer).
// 길의 칸을 누르면 말풍선에서 시작(차례가 아닌 칸은 건너뛰고 시작), 단계 머리의 책 단추는 그 단계 핵심 정리(카드·용어를 한 시트에).
// 처음에 틀린 문제는 진도에 모아(progress.mistakes) 머리의 '틀린 문제 복습'과 단계 복습·총정리에서 먼저 낸다.
// 끝 화면의 '다음'은 길로 돌아가지 않고 다음 칸을 바로 연다. 끝 화면이 뜰 때 진도를 저장한다(더 높은 별만 남긴다).
// 진도는 note_courses.progress 에 브라우저가 바로 저장한다 (RLS: 내 것, progress 칸만, 저장은 한 줄로 세운다). 혜택이 없으면 미리보기만.
// 이미 만든 레슨은 혜택이 없어져도(요금제가 바뀌어도) 그대로 이어서 한다 (새로 만들기·다시 만들기만 막는다)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@/lib/types';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { josa } from '@/lib/josa';
import { perkNeed, perkTierName } from '@/lib/plans';
import { prefersReducedMotion } from '../useReducedMotion';
import type { SourceFigure } from '@/lib/source-figures';
import {
  COURSE_LEVELS,
  COURSE_LEVEL_INFO,
  applyResult,
  courseCost,
  courseStaged,
  courseNodes,
  courseSections,
  courseStats,
  sectionOfUnit,
  finalChecks,
  mistakeChecks,
  mistakeCount,
  readCoursePlan,
  readProgress,
  recapChecks,
  unitTerms,
  checkKey,
  type CourseLevel,
  type CourseNode,
  type CoursePlan,
  type CourseProgress,
  type KeyedCheck,
  type LessonResult,
  type ResultNode,
} from '@/lib/course';
import { RichText } from '../RichText';
import { Button, Chip, EmptyState, Energy, ICONS, Icon, Menu, Sheet, api, cx, radioKeys, useToast, DONE, type MenuItem } from '../ui';
import { CoursePath, Stars } from './CoursePath';
import { LessonPlayer, type PlayerCheck, type PlayerMode } from './LessonPlayer';
import { AiMark } from '../ReportSheet';

type CourseRow = { id: string; level: CourseLevel; plan: CoursePlan; progress: CourseProgress; updatedAt: string };

/** 레슨 창 하나 (칸 하나 또는 '틀린 문제 복습'): 열 때 문제를 정해 두고(진도가 바뀌어도 그대로), 끝내면 node 로 진도에 적는다 */
type Session = {
  id: string;
  node: ResultNode;
  mode: PlayerMode;
  title: string;
  subtitle?: string;
  goal?: string;
  cards: CoursePlan['units'][number]['lessons'][number]['cards'];
  checks: PlayerCheck[];
  target?: string;
};

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
  terms = [],
  figures = [],
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
  /** 노트의 용어 (단계 핵심 정리) */
  terms?: ReadonlyArray<{ term: string; meaning: string }>;
  /** 노트의 자료 그림 (카드에 붙은 그림) */
  figures?: readonly SourceFigure[];
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
  const [session, setSession] = useState<Session | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [remaking, setRemaking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** 지금 레슨 창을 끝냈는지 (닫으면 지금 할 칸으로 내려간다) */
  const [ended, setEnded] = useState(false);
  /** 진도 저장을 한 줄로 (빨리 끝낸 두 레슨의 저장이 엇갈려 앞 것이 덮지 않게) */
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  /**
   * DB 에 있는 것으로 아는 진도와 그 행의 updated_at: 저장은 읽은 그대로일 때만 (다른 화면이 레슨을 다시 만들었거나
   * 진도를 저장했으면 덮지 않는다. 같은 레슨이면 그 진도에 이 결과를 더해 다시 저장)
   */
  const known = useRef<{ progress: CourseProgress; stamp: string } | null>(null);

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
        const progress = readProgress(data?.progress);
        known.current = data && plan ? { progress, stamp: String(data.updated_at) } : null;
        setFailed(false);
        setCourse(data && plan ? { id: data.id, level: data.level as CourseLevel, plan, progress, updatedAt: String(data.updated_at) } : null);
      });
    return () => {
      alive = false;
    };
  }, [noteId, tick]);

  const nodes = useMemo(() => (course ? courseNodes(course.plan, course.progress) : []), [course]);
  // 길이 길면 섹션으로 (섹션 1 → 1~2단계, 섹션 2 → …)
  const sections = useMemo(() => (course ? courseSections(course.plan, nodes) : null), [course, nodes]);
  const stats = useMemo(() => (course ? courseStats(course.plan, course.progress) : null), [course]);
  const mistakes = useMemo(() => (course ? mistakeCount(course.plan, course.progress) : 0), [course]);
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

  /** 끝낸 결과: 화면은 바로, 저장은 progress 칸만 (더 높은 별만 남기고, 틀린 문제를 모은다) */
  const finish = useCallback(
    (s: Session, r: LessonResult) => {
      if (!course) return;
      setEnded(true);
      const at = new Date().toISOString();
      setCourse({ ...course, progress: applyResult(course.progress, s.node, r, at) });
      const { id, plan } = course;
      /** DB 의 진도에 이 결과를 더해 저장 (읽은 updated_at 그대로일 때만) */
      const save = async (tries: number): Promise<void> => {
        const base = known.current;
        if (!base) return;
        const progress = applyResult(base.progress, s.node, r, at);
        const { data, error } = await sb().from('note_courses').update({ progress }).eq('id', id).eq('updated_at', base.stamp).select('updated_at');
        if (error) {
          toast('진도를 저장하지 못했어요. 인터넷을 확인해 주세요.', 'bad');
          return;
        }
        if (data?.length) {
          known.current = { progress, stamp: String(data[0].updated_at) };
          if (tries) setCourse((c) => (c && c.id === id ? { ...c, progress } : c));
          return;
        }
        // 그사이 다른 화면이 진도를 저장했거나 레슨을 다시 만들었다(또는 지웠다): 지금 것을 읽는다
        const { data: row } = await sb().from('note_courses').select('plan, progress, updated_at').eq('id', id).maybeSingle();
        const fresh = row ? readCoursePlan(row.plan) : null;
        if (row && fresh && tries < 2 && JSON.stringify(fresh) === JSON.stringify(plan)) {
          // 같은 레슨: 다른 화면의 진도에 이 결과를 더해 다시
          known.current = { progress: readProgress(row.progress), stamp: String(row.updated_at) };
          return save(tries + 1);
        }
        toast('다른 화면에서 레슨이 바뀌어서 새로 읽었어요.');
        setTick((t) => t + 1);
      };
      saving.current = saving.current.then(() => save(0));
    },
    [course, toast],
  );

  /** 칸 하나를 레슨 창으로: 레슨은 카드·문제, 단계 복습·총정리는 그때의 틀린 문제를 먼저 넣어 뽑는다 */
  const startNode = useCallback(
    (node: CourseNode) => {
      if (!course) return;
      const plan = course.plan;
      const label = (unit: number) => {
        const k = sectionOfUnit(sections, unit);
        return k === null ? '' : `섹션 ${k + 1} · `;
      };
      const asPlayer = (list: KeyedCheck[]): PlayerCheck[] => list.map((k) => ({ key: k.key, check: k.check, target: `${noteId}:l-${k.unit}-${k.lesson}` }));
      // 열 때마다 새 창 (복습 문제도 열 때마다 새로 뽑는다: 틀린 문제를 먼저 넣고 나머지는 고루)
      const id = `${node.id}:${Date.now()}`;
      const seed = `${course.id}:${id}`;
      setEnded(false);
      if (node.kind === 'lesson') {
        const l = plan.units[node.unit]?.lessons[node.lesson];
        if (!l) return;
        setSession({
          id,
          node: { kind: 'lesson', unit: node.unit, lesson: node.lesson },
          mode: 'lesson',
          title: node.title,
          subtitle: `${label(node.unit)}${node.unit + 1}단계 · ${plan.units[node.unit]?.title ?? ''}`,
          goal: l.goal,
          cards: l.cards,
          checks: l.checks.map((check, i) => ({ key: checkKey(node.unit, node.lesson, i), check })),
          target: `${noteId}:${node.id}`,
        });
      } else if (node.kind === 'recap') {
        setSession({
          id,
          node: { kind: 'recap', unit: node.unit },
          mode: 'recap',
          title: node.title,
          subtitle: `${label(node.unit)}${node.unit + 1}단계에서 뽑은 문제`,
          cards: [],
          checks: asPlayer(recapChecks(plan, node.unit, seed, course.progress.mistakes)),
          target: `${noteId}:${node.id}`,
        });
      } else {
        setSession({
          id,
          node: { kind: 'final' },
          mode: 'final',
          title: '총정리',
          subtitle: '모든 단계에서 뽑은 문제',
          cards: [],
          checks: asPlayer(finalChecks(plan, seed, course.progress.mistakes)),
          target: `${noteId}:final`,
        });
      }
    },
    [course, noteId, sections],
  );

  const startMistakes = () => {
    if (!course) return;
    setEnded(false);
    const list = mistakeChecks(course.plan, course.progress);
    setSession({
      id: `mistakes:${Date.now()}`,
      node: { kind: 'mistakes' },
      mode: 'mistakes',
      title: '틀린 문제 복습',
      subtitle: `틀린 문제 ${mistakes}개 가운데 최근 ${list.length}개`,
      cards: [],
      checks: list.map((k) => ({ key: k.key, check: k.check, target: `${noteId}:l-${k.unit}-${k.lesson}` })),
    });
  };

  const closeSession = () => {
    setSession(null);
    if (!ended) return;
    setEnded(false);
    // 끝내고 닫으면 지금 할 칸이 보이게
    requestAnimationFrame(() =>
      document.querySelector('[data-node-current="true"]')?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }),
    );
  };

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
  // 끝 화면의 '다음': 지금 할 칸 (복습 칸도 이름대로). '틀린 문제 복습' 뒤에는 없다
  const nextOf = (s: Session) =>
    s.mode === 'mistakes' || !current
      ? null
      : {
          label: current.kind === 'lesson' ? '다음 레슨' : current.kind === 'recap' ? '단계 복습 시작' : '총정리 시작',
          onStart: () => startNode(current),
        };
  const guideUnit = guide === null ? null : course.plan.units[guide];

  return (
    <div className="grid gap-5">
      {/* 머리: 이름·소개·수준·진도, 이어서 하기, 틀린 문제 복습 */}
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
          <Button size="lg" className="w-full" onClick={() => startNode(current)}>
            {stats?.done ? '이어서 하기' : '첫 레슨 시작'} · {current.kind === 'final' ? '총정리' : current.title}
          </Button>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ok">
            <Icon d={ICONS.trophy} size={18} /> 모든 레슨을 끝냈어요! 아무 칸이나 눌러 다시 할 수 있어요.
          </p>
        )}
        {mistakes ? (
          <Button variant="secondary" className="w-full" onClick={startMistakes}>
            <Icon d={ICONS.retry} size={16} strokeWidth={2.4} />
            틀린 문제 복습 · {mistakes}개
          </Button>
        ) : null}
      </section>

      <CoursePath plan={course.plan} nodes={nodes} sections={sections} progress={course.progress} onStart={startNode} onGuide={setGuide} />

      {session ? (
        <LessonPlayer
          key={session.id}
          shuffleKey={session.id}
          title={session.title}
          subtitle={session.subtitle}
          goal={session.goal}
          cards={session.cards}
          checks={session.checks}
          figures={figures}
          mode={session.mode}
          reportTarget={session.target}
          next={nextOf(session)}
          onClose={closeSession}
          onFinish={(r) => finish(session, r)}
        />
      ) : null}

      {/* 단계 핵심 정리: 그 단계 레슨의 목표·카드와 카드에 나온 노트 용어 (AI 없이 저장된 레슨으로) */}
      <Sheet open={!!guideUnit} onClose={() => setGuide(null)} title={guide === null ? '' : `${guide + 1}단계 핵심 정리`}>
        {guideUnit ? <Guide unit={guideUnit} terms={unitTerms(guideUnit, terms)} progress={course.progress} unitIndex={guide ?? 0} /> : null}
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

const CARD_LABEL = { concept: '개념', example: '예시', compare: '비교', tip: '팁' } as const;

/** 단계 핵심 정리 (듀오링고의 단원 가이드북처럼): 레슨마다 목표와 카드, 아래에 이 단계 용어 */
function Guide({
  unit,
  unitIndex,
  terms,
  progress,
}: {
  unit: CoursePlan['units'][number];
  unitIndex: number;
  terms: Array<{ term: string; meaning: string }>;
  progress: CourseProgress;
}) {
  return (
    <div className="grid gap-5 pb-2">
      {unit.summary ? <p className="text-[15px] leading-relaxed text-muted">{unit.summary}</p> : null}
      {unit.lessons.map((l, li) => {
        const stars = progress.lessons[`${unitIndex}-${li}`]?.stars ?? 0;
        return (
          <section key={li} className="grid gap-2.5" aria-label={l.title}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[18px] leading-snug">{l.title}</h3>
                {l.goal ? <p className="mt-0.5 text-sm text-muted">{l.goal}</p> : null}
              </div>
              {stars ? <Stars n={stars} size={14} className="mt-1 shrink-0" /> : null}
            </div>
            <ul className="grid gap-2">
              {l.cards.map((c, ci) => (
                <li key={ci} className="rounded-2xl bg-surface-2 px-4 py-3">
                  <p className="text-xs font-bold text-accent">
                    {CARD_LABEL[c.kind]}
                    {c.heading ? <span className="text-ink"> · {c.heading}</span> : null}
                  </p>
                  <p className="mt-1 text-[15px] leading-relaxed">
                    <RichText text={c.text} />
                  </p>
                  {c.tip ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed text-muted">
                      <Icon d={ICONS.bulb} size={15} className="mt-0.5 shrink-0 text-warn" />
                      <span>
                        <RichText text={c.tip} />
                      </span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {terms.length ? (
        <section className="grid gap-2" aria-label="이 단계 용어">
          <h3 className="font-display text-[18px]">이 단계 용어</h3>
          <dl className="grid gap-1.5">
            {terms.map((t) => (
              <div key={t.term} className="grid grid-cols-[minmax(0,2fr)_minmax(0,5fr)] gap-3 border-b border-line py-2 text-[15px] last:border-0">
                <dt className="font-semibold">
                  <RichText text={t.term} />
                </dt>
                <dd className="text-muted">
                  <RichText text={t.meaning} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/** 만들기 화면: 수준을 고르고 만든다 (만드는 데 1~3분) */
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
                : `'${noteTitle}' 노트를 AI가 작은 레슨으로 나눠요. 카드 한 장을 읽을 때마다 바로 문제를 풀고, 틀린 문제는 레슨 끝에 다시 풀어요.`}
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
            ['배우고 바로 풀기', '카드 한 장마다 바로 문제, 틀린 문제는 레슨 끝에 다시'],
            ['여러 가지 문제', '객관식·OX·빈칸에 짝 맞추기·순서 맞추기까지'],
            ['별 모으기', '다 맞히면 별 3개, 단계 복습·총정리·틀린 문제 복습까지'],
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
      <p className="text-xs font-bold text-muted">이렇게 보여요</p>
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
                n.state === 'locked' ? 'is-locked bg-surface-3 text-muted' : n.stars === 3 ? 'is-perfect bg-hl text-hl-ink' : 'bg-accent text-accent-ink',
                n.state === 'current' && 'is-current',
              )}
            >
              <Icon d={n.state === 'done' ? (n.stars === 3 ? ICONS.crown : ICONS.check) : ICONS.star} size={26} strokeWidth={2.4} />
            </span>
            {n.state === 'done' ? <Stars n={n.stars} size={12} /> : null}
            <span className={cx('text-xs font-semibold', n.state === 'locked' ? 'text-muted' : 'text-ink')}>{n.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
