'use client';
// 홈 (오늘): 오늘 복습 수, 5분 콕, 처리 중인 자료, 시험 D-day, 연속 기록, 남은 에너지
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { ProcessingList, useActiveSources } from '@/components/ProcessingList';
import { Card, EmptyState, LinkButton, SectionTitle } from '@/components/ui';
import { fetchPlanData, fetchStudyDays, type PlanData } from '@/lib/data';
import { pickToday, streakInfo } from '@/lib/review-plan';
import { daysUntil } from '@/lib/time';
import { subjectVar } from '@/lib/colors';
import { dueLabel } from '@/lib/srs';

export default function HomePage() {
  const { me } = useMe();
  const active = useActiveSources();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchPlanData(), fetchStudyDays(120).catch(() => [])])
      .then(([p, d]) => {
        if (!alive) return;
        setPlan(p);
        setDays(d);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [active.justDone.length]);

  if (!me) return null;
  const settings = me.settings.review;
  const today = plan
    ? pickToday(plan.cards, plan.planSubjects, { dailyMax: settings.dailyMax, doneToday: plan.doneToday, interleave: settings.interleave })
    : [];
  const streak = streakInfo(days);
  const nextDue = plan?.cards.length ? plan.cards.map((c) => c.due).sort()[0] : null;
  const exams = (plan?.subjects ?? []).filter((s) => s.exam_date && daysUntil(s.exam_date) >= 0).sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : 1));
  const wrongCount = plan?.cards.filter((c) => c.in_wrong_note).length ?? 0;

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-2xl">
        {me.nickname ?? '반가워요'}님, {plan ? (today.length ? `오늘 복습 ${today.length}문제` : '오늘 할 일 끝!') : '오늘도 콕'}
      </h1>

      {/* 5분 콕 */}
      <Card className="grid gap-3 border-2 border-ink p-5 shadow-[0_4px_0_var(--ink)]">
        {!plan && !err ? (
          <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ) : today.length ? (
          <>
            <p className="text-muted">
              {plan!.doneToday ? `오늘 ${plan!.doneToday}문제 풀었어요. ` : ''}잊어버리기 직전인 문제 {today.length}개가 기다려요.
            </p>
            <LinkButton href="/review" size="lg" className="w-full text-lg">
              {settings.session}분 콕 시작
            </LinkButton>
          </>
        ) : plan && plan.cards.length ? (
          <div className="grid gap-1 text-center">
            <p className="font-display text-2xl">오늘 할 일 끝! 🎉</p>
            <p className="text-sm text-muted">
              {plan.doneToday ? `오늘 ${plan.doneToday}문제 풀었어요. ` : ''}
              {nextDue ? (dueLabel(nextDue) === '곧' ? '다음 복습이 곧 열려요.' : `다음 복습은 ${dueLabel(nextDue)} 열려요.`) : ''}
            </p>
          </div>
        ) : (
          <EmptyState
            title="아직 문제가 없어요"
            body="공부할 자료를 넣으면 AI가 정리하고 문제를 만들어요."
            action={<LinkButton href="/add">자료 넣기</LinkButton>}
          />
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="grid gap-0.5">
          <span className="text-sm text-muted">연속 공부</span>
          <span className="font-display text-2xl">{streak.streak}일</span>
          <span className="text-xs text-muted">이번 주 쉬는 날 {streak.restUsedThisWeek}/2 사용</span>
        </Card>
        <Link href="/settings#energy" className="block">
          <Card className="grid h-full gap-0.5">
            <span className="text-sm text-muted">{me.energy.period === 'month' ? '이번 달' : '오늘'} 남은 AI 에너지</span>
            <span className="font-display text-2xl">{me.energy.unlimited ? '무제한' : `⚡ ${Math.floor(me.energy.remaining ?? 0)}`}</span>
            <span className="text-xs text-muted">{me.energy.unlimited ? '관리자' : me.isPro ? 'Pro' : `하루 ${me.energy.limit}씩 채워져요`}</span>
          </Card>
        </Link>
      </div>

      {exams.length ? (
        <div className="flex flex-wrap gap-2">
          {exams.map((s) => {
            const d = daysUntil(s.exam_date!);
            return (
              <Link
                key={s.id}
                href={`/library/${s.id}`}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: subjectVar(s.color) }} />
                {s.name} 시험 {d === 0 ? 'D-DAY' : `D-${d}`}
                {d <= 3 ? <span className="text-bad">· 틀린 문제 먼저</span> : null}
              </Link>
            );
          })}
        </div>
      ) : null}

      <ProcessingList {...active} />

      <SectionTitle>바로 가기</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Link href="/add">
          <Card className="h-full hover:border-accent">
            <p className="text-2xl" aria-hidden="true">
              ➕
            </p>
            <p className="mt-1 font-bold">자료 넣기</p>
            <p className="text-sm text-muted">글 · PDF · 사진</p>
          </Card>
        </Link>
        <Link href="/wrong">
          <Card className="h-full hover:border-accent">
            <p className="text-2xl" aria-hidden="true">
              📕
            </p>
            <p className="mt-1 font-bold">오답노트</p>
            <p className="text-sm text-muted">{wrongCount ? `${wrongCount}문제` : '비어 있어요'}</p>
          </Card>
        </Link>
      </div>
      {err ? <p className="text-sm text-bad">복습 정보를 불러오지 못했어요. 새로 고침해 주세요.</p> : null}
    </div>
  );
}
