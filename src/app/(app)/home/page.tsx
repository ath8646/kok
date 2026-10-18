'use client';
// 홈 (오늘): 오늘 복습, 5분 콕, 이번 주 공부한 날, 남은 에너지, 시험 D-day, 정리 중인 자료, 최근 노트
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EnergyPill, useMe } from '@/components/AppShell';
import { ProcessingList, useActiveSources } from '@/components/ProcessingList';
import { SOURCES_CHANGED, useQuickAdd } from '@/components/QuickAdd';
import { ICONS, Icon, LargeHeader, LinkButton, ProgressRing, SectionTitle, cx } from '@/components/ui';
import { fetchPlanData, fetchSources, fetchStudyDays, sb, type PlanData, type SourceRowWithUnit } from '@/lib/data';
import { pickToday, streakInfo } from '@/lib/review-plan';
import { daysUntil, kstDateString } from '@/lib/time';
import { subjectVar } from '@/lib/colors';
import { dueLabel } from '@/lib/srs';
import { previewText } from '@/lib/richtext';

type Recent = SourceRowWithUnit & { summary: string | null };

async function fetchRecent(): Promise<Recent[]> {
  const rows = await fetchSources({ limit: 8 });
  const ready = rows.filter((r) => r.status === 'ready').map((r) => r.id);
  const sums = new Map<string, string | null>();
  if (ready.length) {
    const { data } = await sb().from('notes').select('source_id, summary:body->>summary').in('source_id', ready);
    for (const n of (data ?? []) as Array<{ source_id: string; summary: string | null }>) sums.set(n.source_id, n.summary);
  }
  return rows.map((r) => ({ ...r, summary: sums.get(r.id) ?? null }));
}

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

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
  const today = plan
    ? pickToday(plan.cards, plan.planSubjects, { dailyMax: settings.dailyMax, doneToday: plan.doneToday, interleave: settings.interleave })
    : [];
  const streak = streakInfo(days);
  const week = weekDots(days);
  const nextDue = plan?.cards.length ? plan.cards.map((c) => c.due).sort()[0] : null;
  const exams = (plan?.subjects ?? []).filter((s) => s.exam_date && daysUntil(s.exam_date) >= 0).sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : 1));
  const wrongCount = plan?.cards.filter((c) => c.in_wrong_note).length ?? 0;
  const hasCards = !!plan?.cards.length;
  const doneToday = plan?.doneToday ?? 0;
  const dayTotal = doneToday + today.length;
  const subjectOf = new Map((plan?.subjects ?? []).map((s) => [s.id, s]));

  const title = !plan ? '오늘' : today.length ? `오늘 복습 ${today.length}문제` : hasCards ? '오늘 할 일 끝!' : '첫 자료를 넣어 보세요';
  const subtitle = !plan
    ? ' '
    : today.length
      ? `${me.nickname ?? ''}님, 잊어버리기 직전인 문제가 기다려요`
      : hasCards
        ? nextDue
          ? dueLabel(nextDue) === '곧'
            ? '다음 복습이 곧 열려요'
            : `다음 복습은 ${dueLabel(nextDue)} 열려요`
          : '잘했어요!'
        : '자료를 넣으면 AI가 정리하고 문제를 만들어요';

  return (
    <div className="grid gap-3">
      <LargeHeader
        title={title}
        subtitle={subtitle}
        actions={
          <span className="md:hidden">
            <EnergyPill me={me} />
          </span>
        }
      />

      {/* 5분 콕 */}
      {!plan && !err ? (
        <div className="kok-card kok-shimmer h-[196px]" />
      ) : hasCards ? (
        <section className="kok-card kok-rise grid gap-4 p-5" style={{ ['--i' as string]: 0 }}>
          <div className="flex items-center gap-4">
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
              <p className="text-sm font-semibold text-muted">오늘의 콕</p>
              <p className="font-display text-xl leading-snug">{today.length ? `${today.length}문제 남았어요` : '복습 완료 🎉'}</p>
              <p className="text-sm text-muted">{doneToday ? `오늘 ${doneToday}문제 풀었어요` : '하루 5분이면 충분해요'}</p>
            </div>
          </div>
          {today.length ? (
            <LinkButton href="/review" size="lg" className="w-full">
              {settings.session}분 콕 시작
            </LinkButton>
          ) : (
            <LinkButton href="/review?mode=wrong" variant="secondary" className="w-full">
              {wrongCount ? `오답 ${wrongCount}문제 다시 보기` : '더 풀고 싶으면 오답노트로'}
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
              {streak.streak}
              <span className="ml-0.5 text-sm text-muted">일</span>
            </span>
          </div>
          <ol className="flex justify-between" aria-label="이번 주 공부한 날">
            {week.map((d) => (
              <li key={d.label} className="grid justify-items-center gap-1">
                <span
                  className={cx(
                    'grid h-[18px] w-[18px] place-items-center rounded-full text-[11px] font-bold',
                    d.studied ? 'bg-fab text-fab-ink' : d.future ? 'bg-surface-2 text-muted/60' : 'bg-surface-2 text-muted',
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
          <span className="text-xs text-muted">이번 주 쉬는 날 {streak.restUsedThisWeek}/2</span>
        </section>
        <Link href="/settings#energy" className="kok-card kok-card-hover press kok-rise grid content-between gap-1 p-4" style={{ ['--i' as string]: 2 }}>
          <span className="text-sm font-semibold text-muted">{me.energy.period === 'month' ? '이번 달' : '오늘'} AI 에너지</span>
          <span className="font-display text-[28px] leading-tight tabular-nums">
            {me.energy.unlimited ? '∞' : `⚡ ${Math.floor(me.energy.remaining ?? 0)}`}
          </span>
          {!me.energy.unlimited && me.energy.limit ? (
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-fab transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, ((me.energy.remaining ?? 0) / me.energy.limit) * 100))}%` }}
              />
            </span>
          ) : null}
          <span className="text-xs text-muted">{me.energy.unlimited ? '관리자' : me.isPro ? 'Pro' : `하루 ${me.energy.limit}씩 채워져요`}</span>
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

      <ProcessingList {...active} />

      {recent && recent.length ? (
        <>
          <SectionTitle
            action={
              <Link href="/library" className="press rounded-full px-3 py-1 text-sm font-semibold text-accent hover:bg-accent-soft">
                자료함 →
              </Link>
            }
          >
            최근 노트
          </SectionTitle>
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
            {recent.map((s, i) => {
              const subj = subjectOf.get(s.subject_id);
              const busy = s.status === 'queued' || s.status === 'processing';
              return (
                <Link
                  key={s.id}
                  href={`/notes/${s.id}`}
                  className="kok-card kok-card-hover press kok-rise flex h-[150px] w-[150px] shrink-0 snap-start flex-col overflow-hidden p-3.5 md:w-auto"
                  style={{ ['--i' as string]: i + 3 }}
                >
                  <p className={cx('line-clamp-3 min-h-0 flex-1 text-xs leading-relaxed text-muted', busy && 'kok-shimmer rounded-lg')}>
                    {busy
                      ? '정리하는 중이에요…'
                      : s.status === 'error'
                        ? '멈췄어요. 눌러서 다시 해 보세요.'
                        : s.summary
                          ? previewText(s.summary)
                          : '정리 노트가 준비됐어요.'}
                  </p>
                  <p className="line-clamp-2 text-sm font-bold leading-snug">{s.title || '제목 없는 자료'}</p>
                  <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted">
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
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Icon d={ICONS.plus} size={22} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block font-bold">자료 넣기</span>
            <span className="text-sm text-muted">글 · PDF · 사진</span>
          </span>
        </button>
        <Link href="/wrong" className="kok-card kok-card-hover press grid gap-2 p-4">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-bad-soft text-bad">
            <Icon d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1zM9.5 8.5l5 5M14.5 8.5l-5 5" size={21} />
          </span>
          <span>
            <span className="block font-bold">오답노트</span>
            <span className="text-sm text-muted">{wrongCount ? `${wrongCount}문제` : '비어 있어요'}</span>
          </span>
        </Link>
        <Link href="/questions" className="kok-card kok-card-hover press hidden gap-2 p-4 sm:grid">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ok-soft text-ok">
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
