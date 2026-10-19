'use client';
// 복습 세션: 5분 콕(집중 모드, 한 화면에 한 문제), 자동 채점·평가, FSRS 일정, 오답노트, 끝 화면.
// 노트 문제 풀기는 고르는 화면 없이 그 노트의 문제로 바로 시작한다. 시간 제한 없이 다 풀면 끝나고, 끝나면 노트로 돌아간다.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/components/AppShell';
import { MindMap } from '@/components/MindMap';
import { QuestionCard, type GradeOutcome, type ReviewQuestion } from '@/components/QuestionCard';
import { ReportSheet } from '@/components/QuestionList';
import { Button, Card, EmptyState, ICONS, Icon, LargeHeader, LinkButton, Segmented, Sheet, api, cx, useToast } from '@/components/ui';
import { fetchPlanData, fetchQuestionsByIds, fetchStudyDays, sb, type PlanData } from '@/lib/data';
import { autoGrade, autoRating, type Rating } from '@/lib/grading';
import { pickToday, streakInfo } from '@/lib/review-plan';
import { practiceFrom, type ReviewMode } from '@/lib/review-mode';
import { reviewCard, type StoredCard } from '@/lib/srs';
import { ACCEPTED_MAX_CHARS, zMindmap, type Mindmap } from '@/lib/ai/schemas';
import type { CardRow, MeResponse, QuestionRow } from '@/lib/types';

type Phase = 'loading' | 'start' | 'run' | 'end';
type Item = { q: QuestionRow; card: CardRow; requeued: number };
type Result = { correct: boolean; graduated: boolean; enteredWrong: boolean };
type PracticeNote = { id: string; title: string; sourceId: string };
type Queue = { plan: PlanData; items: Item[]; note: PracticeNote | null };

// ------------------------------------------------------------ 저장 (인터넷이 끊겨도 기록을 잃지 않게)
type SaveState = {
  seq: number;
  /** 문제마다 이어지는 카드 저장 */
  chains: Map<string, Promise<void>>;
  /** 저장 못 한 카드 상태: 문제마다 가장 새 것만 */
  failedCards: Map<string, { seq: number; patch: Record<string, unknown> }>;
  /** 넣지 못한 푼 기록 */
  failedLogs: Array<Record<string, unknown>>;
};

async function saveCard(st: SaveState, qid: string, seq: number, patch: Record<string, unknown>): Promise<void> {
  let failed = false;
  try {
    const { error } = await sb().from('cards').update(patch).eq('question_id', qid);
    failed = !!error;
  } catch {
    failed = true;
  }
  const cur = st.failedCards.get(qid);
  if (failed) {
    if (!cur || cur.seq < seq) st.failedCards.set(qid, { seq, patch });
  } else if (cur && cur.seq <= seq) {
    st.failedCards.delete(qid);
  }
}

async function saveLog(st: SaveState, log: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await sb().from('review_logs').insert(log);
    if (error) st.failedLogs.push(log);
  } catch {
    st.failedLogs.push(log);
  }
}

const MODE_TITLE: Record<ReviewMode['kind'], string> = {
  today: '오늘 복습',
  subject: '과목 복습',
  practice: '노트 문제 풀기',
  wrong: '오답 다시 풀기',
  kp: '약점 개념 풀기',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 이번 화면에서 푼 카드의 새 상태를 다시 읽은 카드 위에 덮는다.
 * '한 번 더 풀기'·'조금 더 하기'를 바로 누르면 마지막 저장이 아직 안 끝났거나(느린 인터넷) 실패했을 수 있어서,
 * 옛 카드로 고르고 옛 카드로 계산한 일정이 방금 푼 기록을 덮지 않게 한다.
 */
function withLatest(p: PlanData, latest: Map<string, CardRow>): PlanData {
  if (!latest.size) return p;
  const cards = p.cards.map((c) => {
    const l = latest.get(c.question_id);
    return l
      ? { ...c, due: l.due, state: l.state, reps: l.reps, lapses: l.lapses, wrong_count: l.wrong_count ?? 0, last_review: l.last_review, in_wrong_note: l.in_wrong_note }
      : c;
  });
  const rawCards = new Map(p.rawCards);
  for (const [id, c] of latest) if (rawCards.has(id)) rawCards.set(id, c);
  return { ...p, cards, rawCards };
}

/** 문제를 풀 노트 (노트 화면에서는 자료 id, 예전 주소는 노트 id 로 찾는다). 없으면 null */
async function fetchPracticeNote(m: Extract<ReviewMode, { kind: 'practice' }>): Promise<PracticeNote | null> {
  if (!UUID.test(m.id)) return null;
  const { data, error } = await sb()
    .from('notes')
    .select('id, title, source_id')
    .eq(m.by === 'source' ? 'source_id' : 'id', m.id)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: String(data.id), title: String(data.title ?? ''), sourceId: String(data.source_id) } : null;
}

async function fetchQueue(m: ReviewMode, practiceAhead: boolean, r: MeResponse['settings']['review'], latest: Map<string, CardRow>): Promise<Queue> {
  const [read, note] = await Promise.all([fetchPlanData(), m.kind === 'practice' ? fetchPracticeNote(m) : Promise.resolve(null)]);
  const p = withLatest(read, latest);
  let cards = p.cards;
  if (m.kind === 'subject') cards = cards.filter((c) => c.subject_id === m.id);
  if (m.kind === 'practice') cards = note ? cards.filter((c) => c.note_id === note.id) : [];
  if (m.kind === 'wrong') cards = cards.filter((c) => c.in_wrong_note);
  if (m.kind === 'kp') cards = cards.filter((c) => c.note_id === m.note && c.key_point_id === m.kp);
  let chosen =
    m.kind === 'today'
      ? pickToday(cards, p.planSubjects, { dailyMax: r.dailyMax, doneToday: p.doneToday, interleave: r.interleave })
      : pickToday(cards, p.planSubjects, { dailyMax: 10_000, doneToday: 0, interleave: r.interleave });
  // 노트·오답·약점 연습(과목은 '미리 풀어 보기'를 눌렀을 때)은 날짜가 안 된 문제도 푼다
  const includeAhead = m.kind === 'practice' || m.kind === 'wrong' || m.kind === 'kp' || (m.kind === 'subject' && practiceAhead);
  if (includeAhead) {
    const picked = new Set(chosen.map((c) => c.question_id));
    const rest = cards.filter((c) => !picked.has(c.question_id)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
    chosen = [...chosen, ...rest].slice(0, m.kind === 'practice' ? 200 : 60);
  }
  const ids = chosen.map((c) => c.question_id);
  const qs = await fetchQuestionsByIds(ids);
  const qmap = new Map(qs.map((q) => [q.id, q]));
  const items: Item[] = [];
  for (const id of ids) {
    const q = qmap.get(id);
    const c = p.rawCards.get(id);
    if (q && c && q.status === 'active') items.push({ q, card: c, requeued: 0 });
  }
  return { plan: p, items, note };
}

export function ReviewSession({ mode, fromNote = false }: { mode: ReviewMode; /** 노트 화면에서 왔는지 (노트 문제 풀기 주소의 ?from=note): 돌아갈 때 뒤로 가기 */ fromNote?: boolean }) {
  const { me, setFocus, refresh } = useMe();
  const router = useRouter();
  const toast = useToast();
  const practice = mode.kind === 'practice';
  // 노트 화면에서 들어올 때 남긴 노트 제목: 문제를 읽기 전에 위 띠에 보여 준다
  const [origin] = useState(() => (mode.kind === 'practice' && mode.by === 'source' ? practiceFrom(mode.id) : null));
  /** 문제를 푸는 노트: undefined 는 아직 읽는 중, null 은 없는 노트 */
  const [note, setNote] = useState<{ title: string; sourceId: string } | null | undefined>(() =>
    origin && mode.kind === 'practice' ? { title: origin.title, sourceId: mode.id } : undefined,
  );
  const [phase, setPhase] = useState<Phase>('loading');
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [minutes, setMinutes] = useState<5 | 10 | 25>(() => me?.settings.review.session ?? 5);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  /** 노트 문제 풀기를 다 풀기 전에 그만뒀는지 (끝 화면 제목) */
  const [stopped, setStopped] = useState(false);
  const [now, setNow] = useState(0);
  const [ahead, setAhead] = useState(false);
  const [visual, setVisual] = useState<{ spec: Mindmap; kp: string | null } | null>(null);
  const [reportQ, setReportQ] = useState<QuestionRow | null>(null);
  const [streak, setStreak] = useState(0);
  // 끝 화면에서 '조금 더 하기'·'한 번 더 풀기'로 돌아온 횟수: 그때는 탭을 바꿀 때처럼 화면이 살짝 떠오른다
  const [round, setRound] = useState(0);
  const saves = useRef<SaveState>({ seq: 0, chains: new Map(), failedCards: new Map(), failedLogs: [] });
  /** 이번 화면에서 푼 카드의 가장 새 상태 (다시 읽을 때 덮는다, withLatest) */
  const latest = useRef<Map<string, CardRow>>(new Map());
  /** 노트로 돌아가는 중 (두 번 눌러 두 번 뒤로 가지 않게) */
  const leaving = useRef(false);
  const subjectNames = useMemo(() => new Map((plan?.subjects ?? []).map((s) => [s.id, s.name])), [plan]);
  const reviewSettings = me?.settings.review;

  // 못 읽었을 때는 '오늘 할 일 끝' 대신 다시 불러오기를 보여 준다
  const [failed, setFailed] = useState(false);

  // 노트 문제 풀기는 처음부터 끝까지 집중 모드 (읽는 동안에도 메뉴가 나왔다 사라지며 화면이 흔들리지 않게, 그리기 전에 켠다).
  // 세션이 사라지면 늘 끈다: 주소가 같은 채 세션만 바뀌어도(예: /review 에서 뒤로 가기로 /review?mode=wrong) 메뉴가 숨은 채 남지 않게
  useLayoutEffect(() => {
    if (practice) setFocus(true);
    return () => setFocus(false);
  }, [practice, setFocus]);

  const applyQueue = useCallback(
    (r: Queue) => {
      setPlan(r.plan);
      setQueue(r.items);
      setIdx(0);
      setResults([]);
      setFailed(false);
      if (practice) {
        setNote(r.note ? { title: r.note.title, sourceId: r.note.sourceId } : null);
        // 고를 것이 없으니 바로 첫 문제
        if (r.items.length) {
          const t = Date.now();
          setStartedAt(t);
          setNow(t);
          setStopped(false);
          setPhase('run');
          return;
        }
      }
      setPhase('start');
    },
    [practice],
  );

  const loadFailed = useCallback(() => {
    setQueue([]);
    setFailed(true);
    // 노트 이름을 아직 몰랐으면 회색 줄 대신 '노트 문제 풀기'
    if (practice) setNote((n) => (n === undefined ? null : n));
    setPhase('start');
  }, [practice]);

  /** 버튼에서 다시 고를 때 (미리 풀기, 조금 더 하기, 한 번 더 풀기, 다시 불러오기) */
  const rebuild = (practiceAhead: boolean) => {
    if (!reviewSettings) return;
    if (phase === 'end') setRound((r) => r + 1);
    setPhase('loading');
    fetchQueue(mode, practiceAhead, reviewSettings, latest.current).then(applyQueue).catch(loadFailed);
  };

  useEffect(() => {
    if (!reviewSettings) return;
    let alive = true;
    fetchQueue(mode, false, reviewSettings, latest.current)
      .then((r) => {
        if (alive) applyQueue(r);
      })
      .catch(() => {
        if (alive) loadFailed();
      });
    return () => {
      alive = false;
    };
    // 처음 한 번만 (설정이 바뀌어도 진행 중인 세션은 그대로)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 남은 시간 표시 (노트 문제 풀기는 시간 제한이 없다)
  useEffect(() => {
    if (phase !== 'run' || practice) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, practice]);

  const finish = useCallback(
    async (early: boolean) => {
      if (!practice) setFocus(false);
      setStopped(early);
      setEndedAt(Date.now());
      setPhase('end');
      // 진행 중인 저장을 기다리고, 저장 못 한 것을 한 번 더 저장해 본다
      const st = saves.current;
      await Promise.all([...st.chains.values()]);
      for (const [qid, f] of [...st.failedCards.entries()]) await saveCard(st, qid, f.seq, f.patch);
      for (const log of st.failedLogs.splice(0)) await saveLog(st, log);
      const left = st.failedCards.size + st.failedLogs.length;
      if (left) toast(`기록 ${left}개를 저장하지 못했어요. 인터넷 연결을 확인해 주세요.`, 'bad');
      fetchStudyDays(120)
        .then((d) => setStreak(streakInfo(d).streak))
        .catch(() => {});
      refresh();
    },
    [practice, setFocus, toast, refresh],
  );

  if (!me) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />;

  const settings = me.settings.review;
  const item = queue[idx];
  const elapsed = startedAt ? now - startedAt : 0;
  const left = Math.max(0, minutes * 60_000 - elapsed);
  const noteSource = mode.kind === 'practice' && mode.by === 'source' ? mode.id : note?.sourceId;

  /** 노트로 돌아가기: 노트에서 왔으면 뒤로 가기 (노트가 보던 탭 그대로 열리고 방문 기록에 노트가 두 번 쌓이지 않는다) */
  const backToNote = () => {
    if (leaving.current) return;
    leaving.current = true;
    if (fromNote && window.history.length > 1) router.back();
    else router.replace(noteSource ? `/notes/${noteSource}` : '/library');
  };

  const onSubmit = async (given: number | boolean | string | null): Promise<GradeOutcome> => {
    const q = item.q;
    const auto = autoGrade({ type: q.type, answer: q.answer, accepted: q.accepted }, given);
    if (auto.correct || !auto.needsAi || q.type !== 'short' || !settings.aiShortGrade || !me.aiEnabled || typeof given !== 'string') {
      return { correct: auto.correct };
    }
    try {
      const g = await api<{ result: 'correct' | 'partial' | 'wrong'; feedback: string }>('/api/grade', {
        method: 'POST',
        body: JSON.stringify({ questionId: q.id, answer: given }),
      });
      return { correct: g.result !== 'wrong', partial: g.result === 'partial', feedback: g.feedback, aiUsed: true };
    } catch (e) {
      return { correct: false, feedback: `AI 채점을 못 했어요: ${(e as Error).message}` };
    }
  };

  const onNext = (r: { rating: Rating; correct: boolean; given: string; ms: number }) => {
    const { q, card } = item;
    const at = new Date();
    const stored: StoredCard = { due: card.due, state: card.state, reps: card.reps, lapses: card.lapses, last_review: card.last_review, fsrs: card.fsrs ?? {} };
    const next = reviewCard(stored, r.rating, at, settings.retention);
    const streakNow = r.correct ? (card.correct_streak ?? 0) + 1 : 0;
    const enteredWrong = !r.correct && !card.in_wrong_note;
    const graduated = r.correct && card.in_wrong_note && streakNow >= 3;
    const inWrong = r.correct ? card.in_wrong_note && !graduated : true;
    const patch = {
      ...next,
      last_correct: r.correct,
      correct_streak: streakNow,
      wrong_count: (card.wrong_count ?? 0) + (r.correct ? 0 : 1),
      in_wrong_note: inWrong,
    };
    const updated: CardRow = { ...card, ...patch };
    latest.current.set(q.id, updated);

    // 카드는 같은 문제끼리 순서대로 저장한다 (늦게 끝난 옛 저장이 새 상태를 덮지 않게)
    const st = saves.current;
    const mySeq = ++st.seq;
    const prev = st.chains.get(q.id) ?? Promise.resolve();
    st.chains.set(
      q.id,
      prev.then(() => saveCard(st, q.id, mySeq, patch)),
    );
    void saveLog(st, {
      question_id: q.id,
      subject_id: q.subject_id,
      rating: r.rating,
      correct: r.correct,
      answer: r.given.slice(0, 2000),
      ms: Math.min(r.ms, 3_600_000),
      reviewed_at: at.toISOString(),
    });
    if (graduated) toast('오답노트 졸업! 3번 연속 맞혔어요 🎓', 'ok');

    setResults((rs) => [...rs, { correct: r.correct, graduated, enteredWrong }]);
    // 곧 다시 볼 문제(틀린 문제)는 이번 세션 끝에 한 번 더
    let nextQueue = queue.map((it, i) => (i === idx ? { ...it, card: updated } : it));
    const soon = Date.parse(next.due) - at.getTime() <= 10 * 60_000;
    if (soon && item.requeued < 2) nextQueue = [...nextQueue, { q, card: updated, requeued: item.requeued + 1 }];
    setQueue(nextQueue);

    const timeUp = !practice && Date.now() - startedAt >= minutes * 60_000;
    if (timeUp || idx + 1 >= nextQueue.length) {
      finish(false);
      return;
    }
    setIdx(idx + 1);
  };

  const showVisual = async () => {
    const q = item.q;
    if (!q.note_id) return toast('이 문제에는 연결된 그림이 없어요.');
    const { data } = await sb().from('visuals').select('spec').eq('note_id', q.note_id).eq('type', 'mindmap').maybeSingle();
    if (!data) return toast('이 노트에는 마인드맵이 없어요.');
    setVisual({ spec: zMindmap.parse(data.spec), kp: q.key_point_id });
  };

  // 푸는 중: 문제 카드와 그림·신고 시트
  const running =
    phase === 'run' ? (
      <>
        {item ? (
          <QuestionCard
            key={`${item.q.id}-${idx}`}
            q={item.q as ReviewQuestion}
            index={idx}
            total={queue.length}
            subjectName={subjectNames.get(item.q.subject_id)}
            onSubmit={onSubmit}
            autoRate={(correct, ms) => autoRating(item.q.type, correct, ms)}
            onNext={onNext}
            onAppeal={async (given) => {
              const g = given.trim();
              if (!g || g.length > ACCEPTED_MAX_CHARS) return toast(`인정할 답은 ${ACCEPTED_MAX_CHARS}자까지 넣을 수 있어요.`, 'bad');
              const accepted = Array.from(new Set([...(item.q.accepted ?? []), g])).slice(0, 10);
              const { error } = await sb().from('questions').update({ accepted }).eq('id', item.q.id);
              if (error) toast('저장하지 못했어요.', 'bad');
            }}
            onShowVisual={item.q.note_id ? showVisual : undefined}
            onReport={() => setReportQ(item.q)}
          />
        ) : null}
        <p className="text-center text-xs text-muted">
          <Link href="/ai-guide" className="underline">
            AI가 만든 문제는 틀릴 수 있어요
          </Link>
        </p>

        <Sheet open={!!visual} onClose={() => setVisual(null)} title="그림으로 보기">
          {visual ? <MindMap spec={visual.spec} settings={me.settings.visual} highlightKeyPoint={visual.kp} /> : null}
        </Sheet>
        <ReportSheet q={reportQ} onClose={() => setReportQ(null)} onChanged={() => {}} />
      </>
    ) : null;

  // ------------------------------------------------------------ 노트 문제 풀기 (끝 화면 전)
  if (practice && phase !== 'end') {
    // 아무것도 안 풀고 그만두면 끝 화면 없이 노트로
    const stop = () => (results.length ? finish(true) : backToNote());
    // 노트에서 넘어올 때도 탭을 바꿀 때처럼 살짝 떠오른다 (읽는 중 → 첫 문제는 같은 틀이라 다시 움직이지 않는다)
    return (
      <div key={round} className="kok-page grid gap-4">
        <div className="flex min-h-9 items-center justify-between gap-3">
          <PracticeTitle title={note === undefined ? undefined : (note?.title ?? '')} />
          <BarButton onClick={phase === 'run' ? stop : backToNote}>{phase === 'run' ? '그만하기' : '닫기'}</BarButton>
        </div>
        {phase === 'loading' ? (
          <QuestionSkeleton />
        ) : phase === 'run' ? (
          running
        ) : (
          <div className="kok-fill">
            {failed ? (
              <EmptyState
                title="문제를 불러오지 못했어요"
                body="인터넷 연결을 확인하고 다시 불러와 주세요."
                action={<Button onClick={() => rebuild(false)}>다시 불러오기</Button>}
              />
            ) : note === null ? (
              <EmptyState title="노트를 찾지 못했어요" body="지워진 노트일 수 있어요." action={<LinkButton href="/library">자료함으로</LinkButton>} />
            ) : (
              <EmptyState title="풀 문제가 없어요" body="이 노트에는 지금 풀 문제가 없어요." action={<Button onClick={backToNote}>노트로 돌아가기</Button>} />
            )}
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ 화면
  if (phase === 'loading' || phase === 'start') {
    // 불러오는 동안과 다 불러온 뒤가 같은 틀이라 제목은 그대로 있고, 부제와 카드 안의 글만 바뀐다
    const ready = phase === 'start';
    const n = queue.length;
    const subtitleText = failed ? '불러오지 못했어요' : n ? `${n}문제가 준비됐어요` : '지금은 풀 문제가 없어요';
    const subtitle = ready ? (
      <span key={subtitleText} className="kok-swap">
        {subtitleText}
      </span>
    ) : (
      // 읽는 동안에도 부제 줄 높이를 지켜서, 다 읽었을 때 제목이 위로 튀지 않게 한다
      <span className="kok-skel inline-block h-6 align-top" aria-hidden="true">
        <span className="kok-bone mt-[7px] h-2.5 w-32 max-w-full" />
      </span>
    );
    return (
      <div key={round} className={cx('grid gap-3', round > 0 && 'kok-page')}>
        <LargeHeader title={MODE_TITLE[mode.kind]} subtitle={subtitle} />
        {!ready ? (
          <StartSkeleton />
        ) : failed ? (
          <div className="kok-fill">
            <EmptyState
              title="복습을 불러오지 못했어요"
              body="인터넷 연결을 확인하고 다시 불러와 주세요."
              action={<Button onClick={() => rebuild(ahead)}>다시 불러오기</Button>}
            />
          </div>
        ) : n === 0 ? (
          // 자리 표시와 모양이 달라서 카드째 살짝 번지며 나타난다
          <div className="kok-fill">
            <EmptyState
              title={mode.kind === 'today' ? '오늘 할 일 끝! 🎉' : '풀 문제가 없어요'}
              body={
                mode.kind === 'today'
                  ? '잊어버리기 직전이 되면 다시 나와요. 오늘은 푹 쉬어요.'
                  : mode.kind === 'subject'
                    ? '이 과목은 오늘 복습할 문제가 없어요.'
                    : '조건에 맞는 문제가 없어요.'
              }
              action={
                mode.kind === 'subject' && !ahead ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAhead(true);
                      rebuild(true);
                    }}
                  >
                    미리 풀어 보기
                  </Button>
                ) : (
                  <LinkButton href="/home">홈으로</LinkButton>
                )
              }
            />
          </div>
        ) : (
          // 자리 표시와 같은 크기의 카드는 그 자리에 두고, 안의 글만 번지며 나타난다
          <Card className="grid gap-4 p-5">
            <div className="kok-fill grid gap-2">
              <span className="text-sm font-semibold">세션 길이</span>
              <Segmented
                label="세션 길이"
                value={minutes}
                onChange={(v) => setMinutes(v)}
                options={[
                  { value: 5, label: '5분' },
                  { value: 10, label: '10분' },
                  { value: 25, label: '25분' },
                ]}
              />
            </div>
            <p className="kok-fill text-sm text-muted" style={{ ['--i' as string]: 1 }}>
              집중 모드: 한 화면에 한 문제만 보이고, 메뉴와 알림은 숨겨요. 시간이 끝나면 멈춰요.
            </p>
            <Button
              size="lg"
              className="kok-fill"
              style={{ ['--i' as string]: 2 }}
              onClick={() => {
                setStartedAt(Date.now());
                setNow(Date.now());
                setFocus(true);
                setPhase('run');
              }}
            >
              시작
            </Button>
          </Card>
        )}
      </div>
    );
  }

  if (phase === 'end') {
    const total = results.length;
    const right = results.filter((r) => r.correct).length;
    const enteredWrong = results.filter((r) => r.enteredWrong).length;
    const graduated = results.filter((r) => r.graduated).length;
    const remaining =
      mode.kind === 'today' && plan
        ? Math.max(
            0,
            pickToday(plan.cards, plan.planSubjects, { dailyMax: settings.dailyMax, doneToday: plan.doneToday + total, interleave: false }).length - total,
          )
        : 0;
    const heading = practice ? (!total ? '다음에 또 만나요' : stopped ? '여기까지 풀었어요' : '다 풀었어요!') : total ? '오늘 할 일 끝!' : '다음에 또 만나요';
    const noteTitle = practice ? note?.title || '노트' : null;
    // 끝 화면은 위에서부터 차례로 살짝 번지며 나타난다. 노트 문제 풀기는 집중 모드 그대로라 화면 위 여백(상태 표시줄 칸 포함)이 이미 있다
    return (
      <div className={cx('grid gap-4 pb-4', practice ? 'pt-3 md:pt-6' : 'pt-[calc(28px+env(safe-area-inset-top))] md:pt-10')}>
        <div className="kok-fill text-center">
          <p className="text-5xl" aria-hidden="true">
            {total && right / total >= 0.8 ? '🎉' : '👏'}
          </p>
          {noteTitle ? <p className="mt-3 truncate px-6 text-sm font-semibold text-muted">{noteTitle}</p> : null}
          <h1 className={cx('font-display text-3xl', noteTitle ? 'mt-1' : 'mt-2')}>{heading}</h1>
          {/* 연속 기록은 저장이 끝난 뒤에 읽어서 조금 늦게 온다: 줄을 미리 잡아 두어 아래가 밀리지 않게 하고, 그 자리에서 번진다 */}
          <p className="mt-1 text-muted">
            {streak ? (
              <span key={streak} className="kok-swap">
                연속 {streak}일째 공부했어요.
              </span>
            ) : (
              ' '
            )}
          </p>
        </div>
        {total ? (
          <Card className="kok-fill grid grid-cols-3 gap-2 text-center" style={{ ['--i' as string]: 1 }}>
            <div>
              <p className="font-display text-3xl">{total}</p>
              <p className="text-sm text-muted">푼 문제</p>
            </div>
            <div>
              <p className="font-display text-3xl text-ok">{Math.round((right / total) * 100)}%</p>
              <p className="text-sm text-muted">맞힌 비율</p>
            </div>
            <div>
              <p className="font-display text-3xl">{Math.max(1, Math.round((endedAt - startedAt) / 60_000))}분</p>
              <p className="text-sm text-muted">걸린 시간</p>
            </div>
          </Card>
        ) : null}
        {enteredWrong || graduated ? (
          <p className="kok-fill text-center text-sm text-muted" style={{ ['--i' as string]: 2 }}>
            {enteredWrong ? `오답노트에 ${enteredWrong}문제를 담았어요. ` : ''}
            {graduated ? `${graduated}문제가 오답노트를 졸업했어요.` : ''}
          </p>
        ) : null}
        {practice ? (
          <div className="kok-fill grid gap-2" style={{ ['--i' as string]: 3 }}>
            <Button size="lg" variant="ink" onClick={backToNote}>
              노트로 돌아가기
            </Button>
            <Button size="lg" variant="secondary" onClick={() => rebuild(false)}>
              한 번 더 풀기
            </Button>
          </div>
        ) : (
          <div className="kok-fill grid" style={{ ['--i' as string]: 3 }}>
            <LinkButton href="/home" size="lg" variant="ink">
              홈으로
            </LinkButton>
          </div>
        )}
        {remaining > 0 ? (
          <p className="kok-fill text-center text-sm text-muted" style={{ ['--i' as string]: 4 }}>
            오늘 남은 복습 {remaining}문제는 나중에 해도 괜찮아요.{' '}
            <button type="button" className="font-semibold underline" onClick={() => rebuild(false)}>
              조금 더 하기
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  // run
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm text-muted" aria-label="남은 시간">
          ⏱ {mm}:{String(ss).padStart(2, '0')}
        </span>
        <BarButton onClick={() => finish(true)}>그만하기</BarButton>
      </div>
      {running}
    </div>
  );
}

/** 위 띠의 글자 버튼 (그만하기·닫기) */
function BarButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="press shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-surface-2" onClick={onClick}>
      {children}
    </button>
  );
}

/** 노트 문제 풀기 위 띠의 노트 이름 (읽는 동안은 회색 줄) */
function PracticeTitle({ title }: { title: string | undefined }) {
  if (title === undefined) {
    return (
      <span className="kok-skel flex h-5 w-32 items-center" aria-hidden="true">
        <span className="kok-bone h-3 w-full" />
      </span>
    );
  }
  // 이 화면의 제목 (화면 읽기 프로그램이 제목으로 읽는다)
  return (
    <h1 className="kok-swap flex min-w-0 items-center gap-1.5 text-sm font-semibold text-muted">
      <Icon d={ICONS.file} size={16} className="shrink-0" />
      <span className="truncate">{title || MODE_TITLE.practice}</span>
    </h1>
  );
}

/** 노트 문제를 읽는 동안: 문제 카드와 같은 모양 (번호·유형, 문제 두 줄, 보기 넷) */
function QuestionSkeleton() {
  return (
    <div className="kok-skel grid gap-4" aria-busy="true">
      <span className="sr-only">문제를 준비하고 있어요</span>
      <div className="flex h-6 items-center gap-2" aria-hidden="true">
        <span className="kok-bone h-3 w-9" />
        <span className="kok-bone h-6 w-14" />
        <span className="kok-bone h-6 w-10" />
      </div>
      <div className="kok-card kok-shimmer grid gap-3 rounded-[28px] p-5" aria-hidden="true">
        <span className="kok-bone h-3.5 w-11/12" />
        <span className="kok-bone h-3.5 w-3/5" />
        <div className="mt-2 grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="kok-bone h-[52px] w-full rounded-2xl!" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 시작 카드를 읽는 동안: 실제 카드와 같은 모양·크기 (세션 길이, 안내 글, 시작 버튼) */
function StartSkeleton() {
  return (
    <div className="kok-card kok-skel kok-shimmer grid gap-4 p-5" aria-busy="true">
      <span className="sr-only">복습을 불러오는 중이에요</span>
      <div className="grid gap-2" aria-hidden="true">
        <span className="flex h-5 items-center">
          <span className="kok-bone h-3 w-16" />
        </span>
        <span className="kok-bone h-10 w-full" />
      </div>
      {/* 안내 글: 폰에서는 두 줄, 넓은 화면에서는 한 줄. 두 줄의 너비 합(+사이)이 실제 글 한 줄 너비(약 456px)와 같아서 같은 화면 너비에서 줄이 바뀐다 */}
      <div className="flex flex-wrap gap-x-2" aria-hidden="true">
        <span className="flex h-5 w-[290px] max-w-full items-center">
          <span className="kok-bone h-2.5 w-full" />
        </span>
        <span className="flex h-5 w-[158px] max-w-full items-center">
          <span className="kok-bone h-2.5 w-full" />
        </span>
      </div>
      <span className="kok-bone h-[52px] w-full" aria-hidden="true" />
    </div>
  );
}
