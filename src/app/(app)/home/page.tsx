'use client';
// 홈 (오늘): AI에게 물어보기, 오늘 복습, 5분 KOK, 이번 주 공부한 날, 남은 에너지, 시험 D-day, 정리 중인 자료, 최근 노트
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EnergyPill, useMe } from '@/components/AppShell';
import { HomeAsk } from '@/components/chat/HomeChat';
import { ProcessingList, useActiveSources } from '@/components/ProcessingList';
import { SOURCES_CHANGED, useQuickAdd } from '@/components/QuickAdd';
import { Energy, ICONS, Icon, LargeHeader, LinkButton, ProgressRing, SectionTitle, cx } from '@/components/ui';
import { NOTE_PEEK, fetchPlanData, fetchSources, fetchStudyDays, peekText, sb, type NotePeek, type PlanData, type SourceRowWithUnit } from '@/lib/data';
import { pickToday, streakInfo } from '@/lib/review-plan';
import { daysUntil, kstDateString } from '@/lib/time';
import { subjectVar } from '@/lib/colors';
import { dueLabel } from '@/lib/srs';
import { previewText } from '@/lib/richtext';
import { energyPeriodLabel } from '@/lib/plans';
import type { MeResponse } from '@/lib/types';

/** manual: AI 없이 직접 만든 노트 */
type Recent = SourceRowWithUnit & { summary: string | null; manual?: boolean };

async function fetchRecent(): Promise<Recent[]> {
  const rows = await fetchSources({ limit: 8 });
  const ready = rows.filter((r) => r.status === 'ready').map((r) => r.id);
  const sums = new Map<string, NotePeek>();
  if (ready.length) {
    const { data } = await sb().from('notes').select(NOTE_PEEK).in('source_id', ready);
    for (const n of (data ?? []) as unknown as NotePeek[]) sums.set(n.source_id, n);
  }
  return rows.map((r) => {
    const n = sums.get(r.id);
    return { ...r, summary: n ? peekText(n) : null, manual: n?.manual === 'true' };
  });
}

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

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

export default function HomePage() {
  const { me } = useMe();
  const quick = useQuickAdd();
  const active = useActiveSources();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [err, setErr] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchPlanData(), fetchStudyDays(120).catch(() => []), fetchRecent().catch(() => [])])
      .then(([p, d, r]) => {
        if (!alive) return;
        setPlan(p);
        setDays(d);
        setRecent(r);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [active.doneCount, version]);

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
  // 자료함에서 복습을 끈 노트의 문제는 오늘 복습·오답 수에 넣지 않는다
  const live = plan ? plan.cards.filter((c) => c.in_review) : [];
  const today = plan ? pickToday(live, plan.planSubjects, { dailyMax: settings.dailyMax, doneToday: plan.doneToday, interleave: settings.interleave }) : [];
  const streak = streakInfo(days);
  // 복습 정보를 다 읽었는지 (못 읽었어도 자리 표시는 거둔다)
  const loaded = !!plan || err;
  const week = weekDots(days);
  const nextDue = live.length ? live.map((c) => c.due).sort()[0] : null;
  // 보관한 과목(과목 서랍)은 목록에서만 뺀다: 시험 날·최근 노트에 안 보인다 (복습은 그대로)
  const archived = new Set((plan?.subjects ?? []).filter((s) => s.archived).map((s) => s.id));
  const exams = (plan?.subjects ?? [])
    .filter((s) => !s.archived && s.exam_date && daysUntil(s.exam_date) >= 0)
    .sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : 1));
  const recentShown = recent ? recent.filter((s) => !archived.has(s.subject_id)) : null;
  const wrongCount = live.filter((c) => c.in_wrong_note).length;
  const hasCards = !!plan?.cards.length;
  const doneToday = plan?.doneToday ?? 0;
  const dayTotal = doneToday + today.length;
  const subjectOf = new Map((plan?.subjects ?? []).map((s) => [s.id, s]));

  const title = !plan ? '오늘' : today.length ? `오늘 복습 ${today.length}문제` : hasCards ? '오늘 할 일 끝!' : '첫 자료를 넣어 보세요';
  const subtitleText = !plan
    ? null
    : today.length
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
  // 다 읽으면 제목·부제가 바뀐다: 새 글이 살짝 번지며 나타나고, 읽는 동안에도 부제 줄 높이를 지켜 제목이 튀지 않게 한다
  const titleNode = (
    <span key={title} className={plan ? 'kok-swap' : undefined}>
      {title}
    </span>
  );
  const subtitle =
    subtitleText === null ? (
      <span className="kok-skel inline-block h-6 align-top" aria-hidden="true">
        <span className="kok-bone mt-[7px] h-2.5 w-52 max-w-full" />
      </span>
    ) : (
      <span key={subtitleText} className="kok-swap">
        {subtitleText}
      </span>
    );

  return (
    <div className="grid gap-3">
      <LargeHeader
        title={titleNode}
        compactTitle={title}
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
      {!plan && !err ? (
        <TodaySkeleton />
      ) : hasCards ? (
        // 자리 표시와 같은 크기의 카드는 그 자리에 두고, 안의 글만 번지며 나타난다. 화면의 핵심 카드라 테마 빛이 번진다(kok-hero)
        <section className="kok-card kok-hero grid gap-4 p-5">
          <div className="kok-fill flex items-center gap-4" style={{ ['--i' as string]: 0 }}>
            <ProgressRing value={dayTotal ? (doneToday / dayTotal) * 100 : 100} size={76} stroke={7} label="오늘 복습 진행">
              {today.length ? (
                <span className="text-center leading-none">
                  <span className="block font-display text-[22px] tabular-nums">{doneToday}</span>
                  <span className="text-[11px] font-semibold text-muted">/ {dayTotal}</span>
                </span>
              ) : (
                <Icon d={ICONS.check} size={30} strokeWidth={2.6} className="text-fab" />
              )}
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-muted">오늘의 KOK</p>
              <p className="font-display text-xl leading-snug">{today.length ? `${today.length}문제 남았어요` : '복습 완료'}</p>
              <p className="text-sm text-muted">{doneToday ? `오늘 ${doneToday}문제 풀었어요` : '하루 5분이면 충분해요'}</p>
            </div>
          </div>
          {today.length ? (
            <LinkButton href="/review" size="lg" className="kok-fill kok-cta w-full">
              {settings.minutes}분 KOK 시작
            </LinkButton>
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
              {loaded ? (
                <span key="n" className="kok-swap">
                  {streak.streak}
                  <span className="ml-0.5 text-sm text-muted">일</span>
                </span>
              ) : (
                <span className="kok-skel inline-block h-[1.25em] align-top" aria-hidden="true">
                  <span className="kok-bone mt-[0.35em] h-[0.6em] w-10" />
                </span>
              )}
            </span>
          </div>
          <ol className="flex justify-between" aria-label="이번 주 공부한 날">
            {week.map((d) => (
              <li key={d.label} className="grid justify-items-center gap-1">
                <span
                  className={cx(
                    'grid h-[18px] w-[18px] place-items-center rounded-full text-[11px] font-bold transition-colors duration-200',
                    d.studied ? 'kok-dot-on bg-fab text-fab-ink' : d.future ? 'bg-surface-2 text-muted/60' : 'bg-surface-2 text-muted',
                    d.today && !d.studied && 'ring-2 ring-fab ring-inset',
                  )}
                  aria-label={`${d.label}요일 ${d.studied ? '공부함' : d.future ? '' : '쉼'}`}
                >
                  {d.studied ? <Icon d={ICONS.check} size={11} strokeWidth={3.2} /> : null}
                </span>
                <span className={cx('text-[11px]', d.today ? 'font-bold text-ink' : 'text-muted')}>{d.label}</span>
              </li>
            ))}
          </ol>
          <span className="text-xs text-muted">이번 주 쉬는 날 {loaded ? `${streak.restUsedThisWeek}/2` : '–'}</span>
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

      {exams.length ? (
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
      {loaded ? <ProcessingList {...active} /> : null}

      {recent === null && !err ? (
        // 최근 노트를 읽는 동안: 같은 크기의 자리를 먼저 두어 아래 '바로 가기'가 밀려 내려가지 않게 한다
        <>
          <SectionTitle action={recentLink}>최근 노트</SectionTitle>
          <div className="kok-skel no-scrollbar -mx-4 flex gap-3 overflow-hidden px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:px-0" aria-hidden="true">
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
        </>
      ) : recentShown && recentShown.length ? (
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
            <span className="text-sm text-muted">{wrongCount ? `${wrongCount}문제` : '비어 있어요'}</span>
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
      {err ? <p className="text-sm text-bad">복습 정보를 불러오지 못했어요. 새로 고침해 주세요.</p> : null}
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
