'use client';
// 홈 (오늘): AI에게 물어보기, 오늘 복습, 5분 KOK, 이번 주 공부한 날, 남은 에너지, 시험 D-day, 정리 중인 자료, 최근 노트
// 다시 들어오면 기억해 둔 화면(src/lib/home-data.ts · view-cache.ts)을 바로 보여 주고 뒤에서 새로 읽는다.
// 처음 읽는 동안에는 글 없이 회색 자리만 둔다: 임시 글('오늘'·'비어 있어요')이 잠깐 보였다가 바뀌지 않게.
// 회색 자리는 조금 늦게 나타나서(.kok-skel) 금방 읽히면 보이지 않는다
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { EnergyPill, useMe } from '@/components/AppShell';
import { HomeAsk } from '@/components/chat/HomeChat';
import { ProcessingList, useActiveSources } from '@/components/ProcessingList';
import { SOURCES_CHANGED, useQuickAdd } from '@/components/QuickAdd';
import { Button, DONE, Energy, ICONS, Icon, LargeHeader, LinkButton, ProgressRing, SectionTitle, Sheet, Swap, cx, useToast } from '@/components/ui';
import { deleteSession, reviewedAfter } from '@/lib/data';
import { homeViewKey, loadHome, type HomeData } from '@/lib/home-data';
import { continuePlan, pickToday, streakInfo } from '@/lib/review-plan';
import { resumePlan } from '@/lib/review-session';
import { daysUntil, kstDateString } from '@/lib/time';
import { subjectVar } from '@/lib/colors';
import { dueLabel } from '@/lib/srs';
import { previewText } from '@/lib/richtext';
import { energyPeriodLabel } from '@/lib/plans';
import { readView, viewStamp, writeView } from '@/lib/view-cache';
import type { MeResponse } from '@/lib/types';

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

/** 오늘의 KOK 카드에 보일 것: 전체·끝낸·남은 수, 저장한 세션이 있는지(started), 다 풀고도 더 풀 문제가 있는지(more) */
type TodayView = { total: number; done: number; remaining: number; started: boolean; more: boolean };

/** 에너지 카드 아래 한 줄: 어떤 플랜의 에너지인지, 언제 채워지는지 */
function energyFoot(me: MeResponse): string {
  if (me.energy.unlimited) return '관리자';
  const p = me.planInfo;
  if (p.kind === 'custom') {
    const until = p.until ? new Date(p.until).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }) : null;
    return until ? `${p.name} · ${until}까지` : p.name;
  }
  if (p.kind === 'pro') return 'Pro';
  return `하루 ${me.energy.limit}씩 채워져요`;
}

/** 이번 주(월~일) 공부한 날 */
function weekDots(days: string[]) {
  const set = new Set(days);
  const now = new Date();
  const today = kstDateString(now);
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return WEEK.map((label, i) => {
    const d = new Date(t + (i - dow) * 86_400_000).toISOString().slice(0, 10);
    return { label, studied: set.has(d), today: d === today, future: i > dow };
  });
}

/** 글 한 줄 자리의 회색 줄 (읽는 동안, 조금 늦게 나타난다). className: 줄의 너비 */
function Bone({ className }: { className: string }) {
  return (
    <span className="kok-skel inline-block h-[1em] align-[-0.1em]" aria-hidden="true">
      <span className={cx('kok-bone mt-[0.25em] h-[0.55em]', className)} />
    </span>
  );
}

export default function HomePage() {
  const { me } = useMe();
  const owner = me?.userId;
  const quick = useQuickAdd();
  const active = useActiveSources(owner);
  const router = useRouter();
  const toast = useToast();
  // 기억해 둔 홈이 있으면 처음부터 그것으로 그린다 (뒤에서 새로 읽어 덮는다)
  const [first] = useState(() => readView<HomeData>(homeViewKey(), owner) ?? null);
  const [data, setData] = useState<HomeData | null>(first);
  /** 새로 읽은 것이 들어왔는지: 그 전에 기억해 둔 화면으로 그린 글은 번지지 않고 그대로 둔다 */
  const [fresh, setFresh] = useState(false);
  const [err, setErr] = useState(false);
  const [version, setVersion] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [clearing, setClearing] = useState(false);
  const sessionsOn = !!me?.features.sessions;

  useEffect(() => {
    let alive = true;
    const stamp = viewStamp();
    loadHome(sessionsOn)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setFresh(true);
        setErr(false);
        writeView(homeViewKey(), owner, d, { stamp });
      })
      .catch(() => {
        if (alive) setErr(true);
      });
    return () => {
      alive = false;
    };
  }, [active.doneCount, version, sessionsOn, owner]);

  const reloadActive = active.reload;
  useEffect(() => {
    const on = () => {
      setVersion((v) => v + 1);
      reloadActive();
    };
    window.addEventListener(SOURCES_CHANGED, on);
    return () => window.removeEventListener(SOURCES_CHANGED, on);
  }, [reloadActive]);

  if (!me) return null;
  const settings = me.settings.review;
  const plan = data?.plan ?? null;
  const days = data?.days ?? [];
  /** 저장한 오늘의 KOK (features.sessions 일 때만 읽는다) */
  const home = data?.home ?? null;
  // 다 읽었는지: 복습 정보(또는 못 읽었다는 것)와 정리 중인 자료 목록이 모두 와야 한 번에 그린다 (따로 나타나 서로 밀지 않게).
  // 기억해 둔 홈으로 열었으면 바로 그린다 (정리 중인 자료 목록은 대개 같이 기억해 두었고, 없으면 읽히는 대로 나타난다)
  const ready = (!!data || err) && (active.items !== null || !!first);
  // 기억해 둔 화면으로 처음 그린 글은 번지지 않는다 (새로 읽어 바뀐 글만 번진다)
  const still = !!first && !fresh;
  // 자료함에서 복습을 끈 노트의 문제는 오늘 복습·오답 수에 넣지 않는다
  const live = plan ? plan.cards.filter((c) => c.in_review) : [];
  const today = plan ? pickToday(live, plan.planSubjects, { dailyMax: settings.dailyMax, doneToday: plan.doneToday, interleave: settings.interleave }) : [];
  const streak = streakInfo(days);
  const week = weekDots(days);
  const nextDue = live.length ? live.map((c) => c.due).sort()[0] : null;
  // 보관한 과목(과목 서랍)은 목록에서만 뺀다: 시험 날·최근 노트에 안 보인다 (복습은 그대로)
  const archived = new Set((plan?.subjects ?? []).filter((s) => s.archived).map((s) => s.id));
  const exams = (plan?.subjects ?? [])
    .filter((s) => !s.archived && s.exam_date && daysUntil(s.exam_date) >= 0)
    .sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : 1));
  const recentShown = (data?.recent ?? []).filter((s) => !archived.has(s.subject_id));
  const wrongCount = live.filter((c) => c.in_wrong_note).length;
  const hasCards = !!plan?.cards.length;
  const doneToday = plan?.doneToday ?? 0;
  const subjectOf = new Map((plan?.subjects ?? []).map((s) => [s.id, s]));

  // 오늘의 KOK: 저장한 세션이 있으면 그 진행(다른 데서 푼 문제도 끝낸 것으로), 없으면 지금 시작하면 고를 N분 분량 (시작하면 같은 계산으로 같은 문제)
  let view: TodayView;
  if (plan && home) {
    const now = new Date();
    if (home.row) {
      const byId = new Map(plan.cards.map((c) => [c.question_id, c]));
      const res = resumePlan(home.row, today, {
        subjects: plan.planSubjects,
        interleave: settings.interleave,
        now,
        cardOf: (id) => byId.get(id),
        reviewedSince: reviewedAfter(home.reviewed, home.row.created_at),
      });
      const inPlan = new Set(res.plan);
      view = {
        total: res.done.length + res.remaining.length,
        done: res.done.length,
        remaining: res.remaining.length,
        started: true,
        more: today.some((c) => !inPlan.has(c.question_id)),
      };
    } else {
      const c = continuePlan(today, plan.planSubjects, settings.minutes, { now, pace: home.pace, interleave: settings.interleave });
      view = { total: c.cards.length, done: 0, remaining: c.cards.length, started: false, more: !c.all };
    }
  } else {
    view = { total: doneToday + today.length, done: doneToday, remaining: today.length, started: false, more: false };
  }
  /** 오늘의 KOK 을 처음부터: 저장한 세션을 지우면 새 계획을 고른다 (푼 문제의 복습 기록은 그대로) */
  const restartToday = async () => {
    setClearing(true);
    try {
      await deleteSession('home');
      setConfirmRestart(false);
      setData((d) => (d ? { ...d, home: null } : d));
      setVersion((v) => v + 1);
      toast('오늘의 KOK을 새로 골랐어요.', 'ok', DONE);
    } catch {
      toast('지우지 못했어요. 다시 해 주세요.', 'bad');
    } finally {
      setClearing(false);
    }
  };
  /** 다 풀고 조금 더: 저장한 세션을 지우고 새 계획으로 바로 시작 */
  const moreToday = async () => {
    setClearing(true);
    try {
      await deleteSession('home');
      router.push('/review?start=1');
    } catch {
      toast('시작하지 못했어요. 다시 해 주세요.', 'bad');
      setClearing(false);
    }
  };
  /** 처음 읽기를 못 했을 때 다시 읽기 (그동안은 다시 회색 자리) */
  const retry = () => {
    setErr(false);
    setVersion((v) => v + 1);
  };

  // 제목·부제: 다 읽기 전에는 글 대신 회색 줄 (못 읽었으면 '오늘'과 안내)
  const title = !ready ? null : !plan ? '오늘' : view.remaining ? `오늘 복습 ${view.remaining}문제` : hasCards ? '오늘 할 일 끝!' : '첫 자료를 넣어 보세요';
  const subtitleText = !ready
    ? null
    : !plan
      ? '복습 정보를 불러오지 못했어요'
      : view.remaining
        ? `${me.nickname ?? ''}님, 잊어버리기 직전인 문제가 기다려요`
        : hasCards
          ? nextDue
            ? dueLabel(nextDue) === '곧'
              ? '다음 복습이 곧 열려요'
              : `다음 복습은 ${dueLabel(nextDue)} 열려요`
            : '잘했어요!'
          : '자료를 넣으면 AI가 정리하고 문제를 만들어요';

  const recentLink = (
    // 화면 바탕 위 글자는 본문·흐린 글자만(화면 빛 위에서 읽히게, fx.ts): 포인트 글자는 연한 알약 안에
    <Link href="/library" className="press rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent hover:brightness-95">
      자료함 →
    </Link>
  );
  // 다 읽으면 제목·부제가 그 자리에 나타나고(새 글은 살짝 번진다), 읽는 동안에도 줄 높이를 지켜 아래가 튀지 않게 한다
  const titleNode =
    title === null ? (
      <span className="kok-skel inline-block h-[1.25em] align-top">
        <span className="sr-only">오늘</span>
        <span className="kok-bone mt-[0.3em] h-[0.65em] w-48 max-w-full" aria-hidden="true" />
      </span>
    ) : (
      <Swap key={title} still={still}>
        {title}
      </Swap>
    );
  const subtitle =
    subtitleText === null ? (
      <span className="kok-skel inline-block h-6 align-top" aria-hidden="true">
        <span className="kok-bone mt-[7px] h-2.5 w-52 max-w-full" />
      </span>
    ) : (
      <Swap key={subtitleText} still={still}>
        {subtitleText}
      </Swap>
    );
  /** 읽은 뒤에만 보이는 글 (읽는 동안에는 회색 줄, 못 읽었으면 비움) */
  const known = (node: ReactNode, bone: string) => (!ready ? <Bone className={bone} /> : plan ? node : null);

  return (
    <div className="grid gap-3">
      <LargeHeader
        title={titleNode}
        compactTitle={title ?? '오늘'}
        subtitle={subtitle}
        actions={
          <span className="md:hidden">
            <EnergyPill me={me} />
          </span>
        }
      />

      {/* AI에게 물어보기: 누르면 채팅 창 (대화는 홈을 떠나면 사라진다) */}
      <HomeAsk />

      {/* 5분 KOK */}
      {!ready ? (
        <TodaySkeleton />
      ) : !plan ? (
        <section className="kok-card kok-fill grid justify-items-center gap-3 px-5 py-8 text-center">
          <Icon d={ICONS.retry} size={30} strokeWidth={2.2} className="text-muted" />
          <p className="text-[15px] text-muted">인터넷 연결을 확인하고 다시 불러와 주세요.</p>
          <Button variant="secondary" onClick={retry}>
            다시 불러오기
          </Button>
        </section>
      ) : hasCards ? (
        // 자리 표시와 같은 크기의 카드는 그 자리에 두고, 안의 글만 번지며 나타난다. 화면의 핵심 카드라 테마 빛이 번진다(kok-hero)
        <section className="kok-card kok-hero grid gap-4 p-5">
          <div className="kok-fill flex items-center gap-4" style={{ ['--i' as string]: 0 }}>
            <ProgressRing value={view.total ? (view.done / view.total) * 100 : 100} size={76} stroke={7} label="오늘 복습 진행">
              {view.remaining ? (
                <span className="text-center leading-none">
                  <span className="block font-display text-[22px] tabular-nums">{view.done}</span>
                  <span className="text-[11px] font-semibold text-muted">/ {view.total}</span>
                </span>
              ) : (
                <Icon d={ICONS.check} size={30} strokeWidth={2.6} className="text-fab" />
              )}
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-muted">오늘의 KOK</p>
              <p className="font-display text-xl leading-snug">{view.remaining ? `${view.remaining}문제 남았어요` : '복습 완료'}</p>
              <p className="text-sm text-muted">
                {view.done ? `오늘 ${view.done}문제 풀었어요` : `하루 ${settings.minutes}분이면 충분해요`}
                {view.started && view.done > 0 && view.remaining > 0 ? (
                  <>
                    {' · '}
                    <button type="button" className="font-semibold underline" onClick={() => setConfirmRestart(true)}>
                      처음부터
                    </button>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          {view.remaining ? (
            // 고르는 화면 없이 바로 시작한다 (?start=1): 저장한 오늘 KOK 이 있으면 남은 문제로 이어서, 없으면 지난번 시간(기본 5분)만큼 골라서
            <LinkButton href="/review?start=1" size="lg" className="kok-fill kok-cta w-full">
              {view.done ? `이어서 하기 · ${view.remaining}문제` : `${settings.minutes}분 KOK 시작`}
            </LinkButton>
          ) : view.started && view.more ? (
            // 오늘의 KOK 을 다 풀었고 복습할 차례가 더 남았으면: 새로 골라 바로 시작
            <Button variant="secondary" className="kok-fill w-full" busy={clearing} onClick={moreToday}>
              조금 더 하기
            </Button>
          ) : (
            // 오늘 복습을 다 했으면: 오답 다시 보기, 오답이 없으면 지난 공부를 기간으로 골라 다시 풀기
            <LinkButton href={wrongCount ? '/review?mode=wrong' : '/review'} variant="secondary" className="kok-fill w-full">
              {wrongCount ? `오답 ${wrongCount}문제 다시 보기` : '지난 공부 다시 풀기'}
            </LinkButton>
          )}
        </section>
      ) : (
        <button
          type="button"
          onClick={() => quick.openComposer()}
          className="press kok-rise grid w-full justify-items-center gap-3 rounded-[28px] border-2 border-dashed border-line bg-surface/60 px-6 py-12 text-center hover:border-fab"
        >
          <span className="kok-float grid h-16 w-16 place-items-center rounded-full bg-fab text-fab-ink shadow-lg">
            <Icon d={ICONS.plus} size={30} strokeWidth={2.4} />
          </span>
          <span className="font-display text-xl">공부한 내용을 넣어 보세요</span>
          <span className="max-w-sm text-sm text-muted">여기를 눌러 적고 엔터를 누르거나, PDF·사진을 화면에 끌어다 놓으면 AI가 정리하고 문제를 만들어요.</span>
        </button>
      )}

      {/* 이번 주, 에너지 */}
      <div className="grid grid-cols-2 gap-3">
        <section className="kok-card kok-rise grid gap-2 p-4" style={{ ['--i' as string]: 1 }} aria-label="연속 공부">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-muted">연속 공부</span>
            <span className="font-display text-2xl tabular-nums">
              {ready ? (
                <Swap key="n" still={still}>
                  {plan ? streak.streak : '–'}
                  <span className="ml-0.5 text-sm text-muted">일</span>
                </Swap>
              ) : (
                <span className="kok-skel inline-block h-[1.25em] align-top" aria-hidden="true">
                  <span className="kok-bone mt-[0.35em] h-[0.6em] w-10" />
                </span>
              )}
            </span>
          </div>
          <ol className="flex justify-between" aria-label="이번 주 공부한 날">
            {week.map((d) => {
              // 읽기 전에는 공부한 날을 모른다: 모두 빈 칸으로 두고, 다 읽으면 그 자리에서 색이 번진다
              const studied = ready && d.studied;
              return (
                <li key={d.label} className="grid justify-items-center gap-1">
                  <span
                    className={cx(
                      'grid h-[18px] w-[18px] place-items-center rounded-full text-[11px] font-bold transition-[background-color,color,box-shadow] duration-200',
                      studied ? 'kok-dot-on bg-fab text-fab-ink' : d.future ? 'bg-surface-2 text-muted/60' : 'bg-surface-2 text-muted',
                      ready && d.today && !studied && 'ring-2 ring-fab ring-inset',
                    )}
                    aria-label={ready ? `${d.label}요일 ${studied ? '공부함' : d.future ? '' : '쉼'}` : `${d.label}요일`}
                  >
                    {studied ? <Icon d={ICONS.check} size={11} strokeWidth={3.2} /> : null}
                  </span>
                  <span className={cx('text-[11px]', d.today ? 'font-bold text-ink' : 'text-muted')}>{d.label}</span>
                </li>
              );
            })}
          </ol>
          <span className="text-xs text-muted">이번 주 쉬는 날 {known(`${streak.restUsedThisWeek}/2`, 'w-6')}</span>
        </section>
        <Link href="/settings#energy" className="kok-card kok-card-hover press kok-rise grid content-between gap-1 p-4" style={{ ['--i' as string]: 2 }}>
          <span className="text-sm font-semibold text-muted">{energyPeriodLabel(me.energy.period)} AI 에너지</span>
          <span className="font-display text-[28px] leading-tight tabular-nums">
            {me.energy.unlimited ? '∞' : <Energy n={Math.floor(me.energy.remaining ?? 0)} />}
          </span>
          {!me.energy.unlimited && me.energy.limit ? (
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <span
                className="kok-bar block h-full rounded-full bg-fab transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, ((me.energy.remaining ?? 0) / me.energy.limit) * 100))}%` }}
              />
            </span>
          ) : null}
          <span className="truncate text-xs text-muted">{energyFoot(me)}</span>
        </Link>
      </div>

      {ready && exams.length ? (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:-mx-6 md:px-6">
          {exams.map((s) => {
            const d = daysUntil(s.exam_date!);
            return (
              <Link
                key={s.id}
                href={`/library/${s.id}`}
                className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold shadow-[0_1px_2px_var(--shadow)]"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
                {s.name}
                <span className={cx('font-bold', d <= 3 ? 'text-bad' : 'text-accent')}>{d === 0 ? 'D-DAY' : `D-${d}`}</span>
                {d <= 3 ? <span className="text-xs text-muted">틀린 문제 먼저</span> : null}
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* 정리 중인 자료는 복습 정보와 함께 나타난다 (따로 먼저 나타나 아래 자리 표시를 밀어내지 않게) */}
      {ready ? <ProcessingList {...active} /> : null}

      {!ready ? (
        // 최근 노트를 읽는 동안: 같은 크기의 자리를 먼저 두어 아래 '바로 가기'가 밀려 내려가지 않게 한다 (최근 노트가 있는지 모르니 제목도 회색 줄)
        <div className="kok-skel grid gap-3" aria-hidden="true">
          <div className="mb-1 mt-5 flex h-7 items-center px-1">
            <span className="kok-bone h-3.5 w-20" />
          </div>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-hidden px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:px-0">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="kok-card kok-shimmer flex h-[150px] w-[150px] shrink-0 flex-col justify-between p-3.5 md:w-auto">
                <div className="grid gap-1.5 pt-0.5">
                  <span className="kok-bone h-2 w-[90%]" />
                  <span className="kok-bone h-2 w-[75%]" />
                  <span className="kok-bone h-2 w-[60%]" />
                </div>
                <div className="grid gap-1.5">
                  <span className="kok-bone h-3 w-[80%]" />
                  <span className="kok-bone h-2 w-[40%]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : recentShown.length ? (
        <>
          <SectionTitle action={recentLink}>최근 노트</SectionTitle>
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
            {recentShown.map((s, i) => {
              const subj = subjectOf.get(s.subject_id);
              const busy = s.status === 'queued' || s.status === 'processing';
              return (
                <Link
                  key={s.id}
                  href={`/notes/${s.id}`}
                  className="kok-card kok-detail-card kok-card-hover press flex h-[150px] w-[150px] shrink-0 snap-start flex-col overflow-hidden p-3.5 md:w-auto"
                  style={{ ['--i' as string]: i }}
                >
                  <p className={cx('kok-fill line-clamp-3 min-h-0 flex-1 text-xs leading-relaxed text-muted', busy && 'kok-shimmer rounded-lg')}>
                    {busy
                      ? '정리하는 중이에요…'
                      : s.status === 'error'
                        ? '멈췄어요. 눌러서 다시 해 보세요.'
                        : s.summary
                          ? previewText(s.summary)
                          : s.manual
                            ? '직접 만든 노트예요.'
                            : '정리 노트가 준비됐어요.'}
                  </p>
                  <p className="kok-fill line-clamp-2 text-sm font-bold leading-snug">{s.title || '제목 없는 자료'}</p>
                  <p className="kok-fill mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted">
                    {subj ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectVar(subj.color) }} aria-hidden="true" /> : null}
                    <span className="truncate">{subj?.name ?? ''}</span>
                  </p>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      <SectionTitle>바로 가기</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button type="button" onClick={() => quick.openComposer()} className="kok-card kok-card-hover press grid gap-2 p-4 text-left">
          <span className="kok-well grid h-10 w-10 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Icon d={ICONS.plus} size={22} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block font-bold">자료 넣기</span>
            <span className="text-sm text-muted">글 · PDF · 사진</span>
          </span>
        </button>
        <Link href="/wrong" className="kok-card kok-card-hover press grid gap-2 p-4">
          <span className="kok-well grid h-10 w-10 place-items-center rounded-2xl bg-bad-soft text-bad">
            <Icon d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1zM9.5 8.5l5 5M14.5 8.5l-5 5" size={21} />
          </span>
          <span>
            <span className="block font-bold">오답노트</span>
            <span className="block h-5 text-sm text-muted">{known(wrongCount ? `${wrongCount}문제` : '비어 있어요', 'w-12')}</span>
          </span>
        </Link>
        <Link href="/questions" className="kok-card kok-card-hover press hidden gap-2 p-4 sm:grid">
          <span className="kok-well grid h-10 w-10 place-items-center rounded-2xl bg-ok-soft text-ok">
            <Icon d={ICONS.grid} size={20} />
          </span>
          <span>
            <span className="block font-bold">문제 모아 보기</span>
            <span className="text-sm text-muted">과목·단원별</span>
          </span>
        </Link>
      </div>
      {err && plan ? <p className="text-sm text-bad">새 복습 정보를 불러오지 못했어요. 새로 고침해 주세요.</p> : null}

      {/* 오늘의 KOK 처음부터: 저장한 진행을 지우고 새로 고른다 (빛나는 카드 밖에 둔다: 카드가 isolation 이라 안에 두면 아래 메뉴 밑에 깔린다) */}
      <Sheet
        open={confirmRestart}
        onClose={() => !clearing && setConfirmRestart(false)}
        title="오늘의 KOK 처음부터"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirmRestart(false)} disabled={clearing}>
              그대로 두기
            </Button>
            <Button size="lg" busy={clearing} onClick={restartToday}>
              처음부터
            </Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed">
          오늘 푼 <b>{view.done}문제</b>의 복습 기록은 그대로 남아요. 오늘의 KOK만 새로 골라서 처음부터 시작해요.
        </p>
      </Sheet>
    </div>
  );
}

/** 오늘 복습 카드를 읽는 동안: 실제 카드와 같은 모양·크기 (고리, 글 세 줄, 큰 버튼) */
function TodaySkeleton() {
  return (
    <section className="kok-card kok-skel grid gap-4 p-5" aria-busy="true">
      <span className="sr-only">오늘 복습을 불러오는 중이에요</span>
      <div className="flex items-center gap-4" aria-hidden="true">
        <span className="kok-shimmer h-[76px] w-[76px] shrink-0 rounded-full border-[7px] border-surface-2" />
        <div className="grid flex-1 gap-2.5">
          <span className="kok-bone h-3 w-16" />
          <span className="kok-bone h-5 w-40 max-w-full" />
          <span className="kok-bone h-3 w-28" />
        </div>
      </div>
      <span className="kok-bone h-[52px] w-full" aria-hidden="true" />
    </section>
  );
}
