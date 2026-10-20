'use client';
// 복습 세션: 언제 공부한 문제(기간)·과목·시간(5·15·30분)을 고르면 핵심 문제부터 골라 집중 모드(한 화면에 한 문제)로 푼다.
// 시간은 문제 수만 정한다: 시간이 지나도 고른 문제는 끝까지 푼다. 자동 채점·평가, FSRS 일정, 오답노트, 끝 화면.
// 노트 문제 풀기는 고르는 화면 없이 그 노트의 문제로 바로 시작한다. 시간 제한 없이 다 풀면 끝나고, 끝나면 노트로 돌아간다.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/components/AppShell';
import { MindMap } from '@/components/MindMap';
import { QuestionCard, type GradeOutcome, type ReviewQuestion } from '@/components/QuestionCard';
import { ReportSheet } from '@/components/QuestionList';
import { ReviewStart, StartSkeleton, type StartChoice, type StartPick } from '@/components/review/ReviewStart';
import { Button, Card, EmptyState, ICONS, Icon, LargeHeader, LinkButton, Sheet, api, cx, useToast } from '@/components/ui';
import { fetchPlanData, fetchQuestionsByIds, fetchRecentPace, fetchStudyDays, sb, type PlanData } from '@/lib/data';
import { autoGrade, autoRating, type Rating } from '@/lib/grading';
import { paceFrom, periodCounts, periodPool, pickToday, streakInfo, type ReviewPeriod } from '@/lib/review-plan';
import { practiceFrom, type ReviewMode } from '@/lib/review-mode';
import { reviewCard, type StoredCard } from '@/lib/srs';
import { ACCEPTED_MAX_CHARS, zMindmap, type Mindmap } from '@/lib/ai/schemas';
import type { CardRow, MeResponse, QuestionRow } from '@/lib/types';

type Phase = 'loading' | 'start' | 'run' | 'end';
type Item = { q: QuestionRow; card: CardRow; requeued: number };
type Result = { correct: boolean; graduated: boolean; enteredWrong: boolean };
type PracticeNote = { id: string; title: string; sourceId: string };
type ReviewSettings = MeResponse['settings']['review'];
type PlanCardRow = PlanData['cards'][number];
/** 읽은 것: 복습 계획, 노트 문제 풀기의 노트, 내 빠르기, 노트 문제 풀기면 바로 풀 문제 */
type Loaded = { plan: PlanData; note: PracticeNote | null; pace: number; items: Item[] };

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

// 오늘·과목 복습은 같은 화면 (과목은 시작 화면의 칩으로 고른다)
const MODE_TITLE: Record<ReviewMode['kind'], string> = {
  today: '복습',
  subject: '복습',
  practice: '노트 문제 풀기',
  wrong: '오답 다시 풀기',
  kp: '약점 개념 풀기',
};

/** 기간·과목을 고르는 복습 (오답·약점 개념은 그 문제만 푼다) */
const choosesPeriod = (m: ReviewMode) => m.kind === 'today' || m.kind === 'subject';

/** 이 복습 방법의 문제. 자료함에서 복습을 끈 노트의 문제는 빼고 (약점 개념 풀기·노트 문제 풀기처럼 그 노트를 골라 푸는 것은 된다) */
function modeCards(m: ReviewMode, p: PlanData): PlanCardRow[] {
  if (m.kind === 'kp') return p.cards.filter((c) => c.note_id === m.note && c.key_point_id === m.kp);
  const live = p.cards.filter((c) => c.in_review);
  if (m.kind === 'wrong') return live.filter((c) => c.in_wrong_note);
  return live;
}

/**
 * 처음 고를 것: 복습할 차례인 문제가 있으면 그것, 없으면 지난번에 고른 기간(문제가 있을 때),
 * 과목 복습(?subject=)이면 그 과목 전체. 시간은 지난번에 고른 시간.
 */
function firstChoice(m: ReviewMode, p: PlanData, r: ReviewSettings): StartChoice {
  const live = modeCards(m, p);
  const subjectId = m.kind === 'subject' && live.some((c) => c.subject_id === m.id) ? m.id : null;
  if (!choosesPeriod(m)) return { period: 'all', subjectId: null, minutes: r.minutes };
  const cards = subjectId ? live.filter((c) => c.subject_id === subjectId) : live;
  const counts = periodCounts(cards, p.planSubjects, { dailyMax: r.dailyMax, doneToday: p.doneToday, interleave: r.interleave });
  let period: ReviewPeriod = 'due';
  if (!counts.due) {
    if (r.period !== 'due' && counts[r.period]) period = r.period;
    else if (subjectId && counts.all) period = 'all';
  }
  return { period, subjectId, minutes: r.minutes };
}

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
      ? {
          ...c,
          due: l.due,
          state: l.state,
          reps: l.reps,
          lapses: l.lapses,
          wrong_count: l.wrong_count ?? 0,
          last_review: l.last_review,
          in_wrong_note: l.in_wrong_note,
        }
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

/** 노트 문제 풀기: 복습할 차례인 문제 먼저, 그다음 날짜가 가까운 문제 (200개까지) */
function practiceIds(p: PlanData, note: PracticeNote | null, interleave: boolean): string[] {
  const cards = note ? p.cards.filter((c) => c.note_id === note.id) : [];
  const due = pickToday(cards, p.planSubjects, { dailyMax: 10_000, doneToday: 0, interleave });
  const picked = new Set(due.map((c) => c.question_id));
  const rest = cards.filter((c) => !picked.has(c.question_id)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  return [...due, ...rest].slice(0, 200).map((c) => c.question_id);
}

/** 고른 문제를 순서대로 읽는다 (그사이 쉬게 했거나 지운 문제는 뺀다) */
/** 문제에서 더 읽을 칸: figures 그림 풀이(Pro), sourceFigures 자료 그림 문제의 그림 (DB 에 칸이 있을 때만) */
type QCols = { figures: boolean; sourceFigures: boolean };

async function buildItems(ids: string[], p: PlanData, cols: QCols): Promise<Item[]> {
  const qs = await fetchQuestionsByIds(ids, cols);
  const qmap = new Map(qs.map((q) => [q.id, q]));
  const items: Item[] = [];
  for (const id of ids) {
    const q = qmap.get(id);
    const c = p.rawCards.get(id);
    if (q && c && q.status === 'active') items.push({ q, card: c, requeued: 0 });
  }
  return items;
}

async function load(m: ReviewMode, r: ReviewSettings, latest: Map<string, CardRow>, cols: QCols): Promise<Loaded> {
  const practice = m.kind === 'practice';
  const [read, note, logs] = await Promise.all([
    fetchPlanData(),
    practice ? fetchPracticeNote(m) : Promise.resolve(null),
    // 내 빠르기는 못 읽어도 보통 빠르기로
    practice ? Promise.resolve([]) : fetchRecentPace().catch(() => []),
  ]);
  const plan = withLatest(read, latest);
  const types = new Map(read.cards.map((c) => [c.question_id, c.type]));
  const pace = paceFrom(logs.map((l) => ({ ms: l.ms, type: l.question_id ? types.get(l.question_id) : null })));
  const items = practice ? await buildItems(practiceIds(plan, note, r.interleave), plan, cols) : [];
  return { plan, note, pace, items };
}

export function ReviewSession({
  mode,
  fromNote = false,
}: {
  mode: ReviewMode;
  /** 노트 화면에서 왔는지 (노트 문제 풀기 주소의 ?from=note): 돌아갈 때 뒤로 가기 */ fromNote?: boolean;
}) {
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
  /** 내 빠르기 (복습 시간마다 문제 수) */
  const [pace, setPace] = useState(1);
  /** 시작 화면에서 고른 기간·과목·시간 ('조금 더 하기'로 돌아와도 그대로) */
  const [choice, setChoice] = useState<StartChoice | null>(null);
  const [starting, setStarting] = useState(false);
  const [queue, setQueue] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  /** 목표 시간(ms): 지나도 멈추지 않고, 남은 시간을 안내만 한다 */
  const [target, setTarget] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  /** 다 풀기 전에 그만뒀는지 (끝 화면 제목) */
  const [stopped, setStopped] = useState(false);
  const [now, setNow] = useState(0);
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
  /** 이번 세션에서 답한 수 (다시 나온 문제도 센다: 오늘 푼 수) */
  const answered = useRef(0);
  /** 끝 화면: 고른 기간에 아직 안 푼 문제 수 ('조금 더 하기') */
  const [remaining, setRemaining] = useState(0);
  const subjectNames = useMemo(() => new Map((plan?.subjects ?? []).map((s) => [s.id, s.name])), [plan]);
  const reviewSettings = me?.settings.review;
  const figuresOn = !!me?.features.figures;
  const qcols: QCols = { figures: figuresOn, sourceFigures: !!me?.features.sourceFigures };

  // 못 읽었을 때는 '오늘 할 일 끝' 대신 다시 불러오기를 보여 준다
  const [failed, setFailed] = useState(false);

  // 노트 문제 풀기는 처음부터 끝까지 집중 모드 (읽는 동안에도 메뉴가 나왔다 사라지며 화면이 흔들리지 않게, 그리기 전에 켠다).
  // 세션이 사라지면 늘 끈다: 주소가 같은 채 세션만 바뀌어도(예: /review 에서 뒤로 가기로 /review?mode=wrong) 메뉴가 숨은 채 남지 않게
  useLayoutEffect(() => {
    if (practice) setFocus(true);
    return () => setFocus(false);
  }, [practice, setFocus]);

  // 다음 문제는 맨 위에서 시작한다 (긴 해설을 내려 읽었어도 새 문제가 처음부터 보이게. 새 문제가 나타나는 움직임이 있으니 스크롤은 바로)
  useLayoutEffect(() => {
    if (phase === 'run' && idx > 0 && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [idx, phase]);

  const applyLoaded = useCallback(
    (r: Loaded) => {
      setPlan(r.plan);
      setPace(r.pace);
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
      } else if (reviewSettings) {
        // 처음 읽을 때만 정한다 ('조금 더 하기'로 다시 읽어도 고른 것은 그대로)
        setChoice((c) => c ?? firstChoice(mode, r.plan, reviewSettings));
      }
      setPhase('start');
    },
    [practice, mode, reviewSettings],
  );

  const loadFailed = useCallback(() => {
    setQueue([]);
    setFailed(true);
    // 노트 이름을 아직 몰랐으면 회색 줄 대신 '노트 문제 풀기'
    if (practice) setNote((n) => (n === undefined ? null : n));
    setPhase('start');
  }, [practice]);

  /** 다시 읽을 때 (조금 더 하기, 한 번 더 풀기, 다시 불러오기) */
  const rebuild = () => {
    if (!reviewSettings) return;
    if (phase === 'end') setRound((r) => r + 1);
    setPhase('loading');
    load(mode, reviewSettings, latest.current, qcols).then(applyLoaded).catch(loadFailed);
  };

  useEffect(() => {
    if (!reviewSettings) return;
    let alive = true;
    load(mode, reviewSettings, latest.current, qcols)
      .then((r) => {
        if (alive) applyLoaded(r);
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

  // 남은 시간 안내 (노트 문제 풀기는 시간이 없다)
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
      // 고른 기간에 아직 안 푼 문제 (이번 화면에서 푼 문제는 빼고)
      let more = 0;
      if (!practice && plan && choice && reviewSettings) {
        const after = withLatest(plan, latest.current);
        let pool = modeCards(mode, after);
        if (choosesPeriod(mode)) {
          if (choice.subjectId) pool = pool.filter((c) => c.subject_id === choice.subjectId);
          pool = periodPool(pool, after.planSubjects, choice.period, {
            dailyMax: reviewSettings.dailyMax,
            doneToday: after.doneToday + answered.current,
            interleave: false,
          });
        }
        more = pool.filter((c) => !latest.current.has(c.question_id)).length;
      }
      setRemaining(more);
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
    [practice, setFocus, toast, refresh, plan, choice, reviewSettings, mode],
  );

  if (!me) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />;

  const settings = me.settings.review;
  const item = queue[idx];
  const elapsed = startedAt ? now - startedAt : 0;
  const left = Math.max(0, target - elapsed);
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
    answered.current += 1;

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
    if (graduated) toast('오답노트 졸업! 3번 연속 맞혔어요', 'ok');

    setResults((rs) => [...rs, { correct: r.correct, graduated, enteredWrong }]);
    // 곧 다시 볼 문제(틀린 문제)는 이번 세션 끝에 한 번 더. 목표 시간이 지났으면 더 늘리지 않는다 (다음 복습에 나온다)
    let nextQueue = queue.map((it, i) => (i === idx ? { ...it, card: updated } : it));
    const soon = Date.parse(next.due) - at.getTime() <= 10 * 60_000;
    const overTime = !practice && Date.now() - startedAt >= target;
    if (soon && item.requeued < 2 && !overTime) nextQueue = [...nextQueue, { q, card: updated, requeued: item.requeued + 1 }];
    setQueue(nextQueue);

    // 시간이 지나도 고른 문제는 끝까지 푼다
    if (idx + 1 >= nextQueue.length) {
      finish(false);
      return;
    }
    setIdx(idx + 1);
  };

  /** 지난번에 고른 시간·기간을 기억한다 (다음에 그대로 고른 채 연다) */
  const remember = (c: StartChoice, timed: boolean) => {
    const r = me.settings.review;
    const next = { ...r, ...(timed ? { minutes: c.minutes } : {}), ...(choosesPeriod(mode) ? { period: c.period } : {}) };
    if (next.minutes === r.minutes && next.period === r.period) return;
    void sb()
      .from('profiles')
      .update({ settings: { ...me.settings, review: next } })
      .eq('id', me.userId)
      .then(
        () => {},
        () => {},
      );
  };

  /** 시작: 고른 문제를 읽고 집중 모드로 */
  const start = async (pick: StartPick) => {
    if (!plan || !choice || starting) return;
    setStarting(true);
    try {
      const items = await buildItems(
        pick.cards.map((c) => c.question_id),
        plan,
        qcols,
      );
      if (!items.length) {
        toast('문제를 불러오지 못했어요. 다시 해 주세요.', 'bad');
        return;
      }
      setQueue(items);
      setIdx(0);
      setResults([]);
      setStopped(false);
      answered.current = 0;
      // 목표 시간: 고른 시간 (기간의 문제가 다 들어가면 예상 시간)
      setTarget(pick.all ? Math.max(1, Math.ceil(pick.seconds / 60)) * 60_000 : choice.minutes * 60_000);
      const t = Date.now();
      setStartedAt(t);
      setNow(t);
      setFocus(true);
      setPhase('run');
      remember(choice, pick.timed);
    } catch {
      toast('문제를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.', 'bad');
    } finally {
      setStarting(false);
    }
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
        <ReportSheet q={reportQ} onClose={() => setReportQ(null)} onChanged={() => {}} figuresOn={figuresOn} />
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
                action={<Button onClick={rebuild}>다시 불러오기</Button>}
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

  // ------------------------------------------------------------ 시작 화면
  if (phase === 'loading' || phase === 'start') {
    // 불러오는 동안과 다 불러온 뒤가 같은 틀이라 제목은 그대로 있고, 부제와 카드 안의 글만 바뀐다
    const ready = phase === 'start' && !!plan && !!choice;
    const cards = plan ? modeCards(mode, plan) : [];
    const periods = choosesPeriod(mode);
    const dueCount =
      plan && periods ? periodPool(cards, plan.planSubjects, 'due', { dailyMax: settings.dailyMax, doneToday: plan.doneToday, interleave: false }).length : 0;
    const kpTitle = mode.kind === 'kp' ? plan?.concepts.get(mode.note)?.get(mode.kp)?.title : undefined;
    const subtitleText = failed
      ? '불러오지 못했어요'
      : !cards.length
        ? '지금은 풀 문제가 없어요'
        : mode.kind === 'wrong'
          ? `오답노트에 ${cards.length}문제가 있어요`
          : mode.kind === 'kp'
            ? kpTitle
              ? `${kpTitle} · ${cards.length}문제`
              : `${cards.length}문제`
            : dueCount
              ? `복습할 차례인 문제가 ${dueCount}개 있어요`
              : '오늘 복습은 다 했어요';
    const subtitle =
      ready || failed ? (
        <span key={subtitleText} className="kok-swap">
          {subtitleText}
        </span>
      ) : (
        // 읽는 동안에도 부제 줄 높이를 지켜서, 다 읽었을 때 제목이 위로 튀지 않게 한다
        <span className="kok-skel inline-block h-6 align-top" aria-hidden="true">
          <span className="kok-bone mt-[7px] h-2.5 w-44 max-w-full" />
        </span>
      );
    return (
      <div key={round} className={cx('grid gap-3', round > 0 && 'kok-page')}>
        <LargeHeader title={MODE_TITLE[mode.kind]} subtitle={subtitle} />
        {phase === 'start' && failed ? (
          <div className="kok-fill">
            <EmptyState
              title="복습을 불러오지 못했어요"
              body="인터넷 연결을 확인하고 다시 불러와 주세요."
              action={<Button onClick={rebuild}>다시 불러오기</Button>}
            />
          </div>
        ) : !ready ? (
          <StartSkeleton periods={periods} />
        ) : !cards.length ? (
          // 자리 표시와 모양이 달라서 카드째 살짝 번지며 나타난다
          <div className="kok-fill">
            {periods ? (
              <EmptyState
                title="아직 풀 문제가 없어요"
                body="자료를 넣으면 AI가 정리하고 문제를 만들어요."
                action={<LinkButton href="/library?compose=1">자료 넣기</LinkButton>}
              />
            ) : (
              <EmptyState
                title="풀 문제가 없어요"
                body={mode.kind === 'wrong' ? '오답노트가 비어 있어요.' : '이 개념에는 지금 풀 문제가 없어요.'}
                action={<LinkButton href="/home">홈으로</LinkButton>}
              />
            )}
          </div>
        ) : (
          <ReviewStart
            plan={plan}
            cards={cards}
            periods={periods}
            choice={choice}
            onChoice={setChoice}
            pace={pace}
            review={settings}
            starting={starting}
            onStart={start}
          />
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ 끝 화면
  if (phase === 'end') {
    const total = results.length;
    const right = results.filter((r) => r.correct).length;
    const enteredWrong = results.filter((r) => r.enteredWrong).length;
    const graduated = results.filter((r) => r.graduated).length;
    const dueDone = choosesPeriod(mode) && choice?.period === 'due' && !remaining;
    const heading = !total ? '다음에 또 만나요' : stopped ? '여기까지 풀었어요' : dueDone ? '오늘 할 일 끝!' : '다 풀었어요!';
    const great = total > 0 && right / total >= 0.8;
    const noteTitle = practice ? note?.title || '노트' : null;
    // 끝 화면은 위에서부터 차례로 살짝 번지며 나타난다. 노트 문제 풀기는 집중 모드 그대로라 화면 위 여백(상태 표시줄 칸 포함)이 이미 있다
    return (
      <div className={cx('grid gap-4 pb-4', practice ? 'pt-3 md:pt-6' : 'pt-[calc(28px+env(safe-area-inset-top))] md:pt-10')}>
        <div className="kok-fill grid justify-items-center text-center">
          {/* 잘 풀었으면 트로피, 아니면 체크 (이모지 대신 앱 아이콘) */}
          <span
            className={cx(
              'kok-badge grid h-[72px] w-[72px] place-items-center rounded-full',
              !total ? 'bg-surface-2 text-muted' : great ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent',
            )}
            aria-hidden="true"
          >
            <Icon d={great ? ICONS.trophy : ICONS.check} size={34} strokeWidth={great ? 1.9 : 2.4} />
          </span>
          {noteTitle ? <p className="mt-3 w-full truncate px-6 text-sm font-semibold text-muted">{noteTitle}</p> : null}
          <h1 className={cx('font-display text-3xl', noteTitle ? 'mt-1' : 'mt-3')}>{heading}</h1>
          {/* 연속 기록은 저장이 끝난 뒤에 읽어서 조금 늦게 온다: 줄을 미리 잡아 두어 아래가 밀리지 않게 하고, 그 자리에서 번진다 */}
          <p className="mt-1 text-muted">
            {streak ? (
              <span key={streak} className="kok-swap">
                연속 {streak}일째 공부했어요.
              </span>
            ) : (
              ' '
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
            <Button size="lg" variant="secondary" onClick={rebuild}>
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
            남은 {remaining}문제는 나중에 해도 괜찮아요.{' '}
            <button type="button" className="font-semibold underline" onClick={rebuild}>
              조금 더 하기
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  // ------------------------------------------------------------ 푸는 중: 남은 시간은 안내만 (지나도 멈추지 않는다)
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const leftQs = Math.max(1, queue.length - idx);
  return (
    <div className="grid gap-4">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
          <Icon d={ICONS.clock} size={16} className="shrink-0" />
          {left > 0 ? (
            <span className="font-mono tabular-nums">
              <span className="sr-only">남은 시간 </span>
              {mm}:{String(ss).padStart(2, '0')}
            </span>
          ) : (
            <span key="over" className="kok-swap truncate">
              {leftQs === 1 ? '마지막 문제예요' : `남은 ${leftQs}문제만 풀면 끝나요`}
            </span>
          )}
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
    <button
      type="button"
      className="press shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-surface-2"
      onClick={onClick}
    >
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
