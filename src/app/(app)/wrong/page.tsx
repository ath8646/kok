'use client';
// 오답노트: 약점 개념 5개, 틀린 문제 다시 풀기, 다 외운 문제 빼기
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { QuestionPreview } from '@/components/QuestionList';
import { Button, Card, Chip, EmptyState, ICONS, Icon, LargeHeader, LinkButton, SectionTitle, buttonClass, cx, useToast } from '@/components/ui';
import { fetchPlanData, fetchQuestionsByIds, sb } from '@/lib/data';
import { weakConcepts, type WeakConcept } from '@/lib/review-plan';
import type { QuestionRow } from '@/lib/types';

type NoteInfo = { id: string; source_id: string; title: string };

/** sourceFigures: 자료 그림 문제의 그림도 읽는다 (DB 에 칸이 있을 때만) */
async function fetchWrong(sourceFigures: boolean) {
  const plan = await fetchPlanData();
  const titles = plan.concepts;
  // 자료함에서 복습을 끈 노트의 문제는 빼고 (몇 개 뺐는지는 알려 준다)
  const wrong = plan.cards.filter((c) => c.in_wrong_note && c.in_review);
  const hidden = plan.cards.filter((c) => c.in_wrong_note && !c.in_review).length;
  const weak = weakConcepts(
    wrong.map((c) => ({ question_id: c.question_id, note_id: c.note_id, key_point_id: c.key_point_id, lapses: c.wrong_count ?? 0 })),
    5,
  );
  const qs = await fetchQuestionsByIds(
    wrong.map((c) => c.question_id),
    { sourceFigures },
  );
  const lapses = new Map(wrong.map((c) => [c.question_id, Math.max(1, c.wrong_count ?? 0)]));
  const noteIds = [...new Set(wrong.map((c) => c.note_id).filter((x): x is string => !!x))];
  const notes = new Map<string, NoteInfo>();
  for (let i = 0; i < noteIds.length; i += 100) {
    const { data } = await sb()
      .from('notes')
      .select('id, source_id, title')
      .in('id', noteIds.slice(i, i + 100));
    for (const n of data ?? []) notes.set(n.id, n as NoteInfo);
  }
  const items = qs.map((q) => ({ q, lapses: lapses.get(q.id) ?? 0 })).sort((a, b) => b.lapses - a.lapses);
  return { weak, titles, notes, items, hidden };
}

export default function WrongPage() {
  const toast = useToast();
  const { me } = useMe();
  const sourceFiguresOn = !!me?.features.sourceFigures;
  const [loading, setLoading] = useState(true);
  const [weak, setWeak] = useState<WeakConcept[]>([]);
  const [titles, setTitles] = useState<Map<string, Map<string, { title: string }>>>(new Map());
  const [notes, setNotes] = useState<Map<string, NoteInfo>>(new Map());
  const [items, setItems] = useState<Array<{ q: QuestionRow; lapses: number }>>([]);
  /** 복습을 끈 노트라서 뺀 틀린 문제 수 */
  const [hidden, setHidden] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  // 못 읽었을 때는 '비어 있어요' 대신 다시 불러오기를 보여 준다
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchWrong(sourceFiguresOn)
      .then((r) => {
        if (!alive) return;
        setWeak(r.weak);
        setTitles(r.titles);
        setNotes(r.notes);
        setItems(r.items);
        setHidden(r.hidden);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt, sourceFiguresOn]);

  const retry = () => {
    setLoading(true);
    setFailed(false);
    setAttempt((a) => a + 1);
  };

  const subtitleText = failed ? '불러오지 못했어요' : items.length ? `틀린 문제 ${items.length}개 · 3번 연속 맞히면 졸업해요` : '틀린 문제가 모이는 곳이에요';
  const subtitle = loading ? (
    // 읽는 동안에도 부제 줄 높이를 지켜서, 다 읽었을 때 제목이 위로 튀지 않게 한다
    <span className="kok-skel inline-block h-6 align-top" aria-hidden="true">
      <span className="kok-bone mt-[7px] h-2.5 w-52 max-w-full" />
    </span>
  ) : (
    <span key={subtitleText} className="kok-swap">
      {subtitleText}
    </span>
  );
  // 틀린 문제 카드가 번지는 순서 (약점 개념 카드 다음)
  const itemsFrom = weak.length ? weak.length + 2 : 1;

  return (
    <div className="grid gap-3">
      <LargeHeader
        title="오답노트"
        subtitle={subtitle}
        actions={
          items.length ? (
            <LinkButton href="/review?mode=wrong" size="sm" className="kok-fill mr-1">
              전부 다시 풀기
            </LinkButton>
          ) : null
        }
      />

      {!loading && !failed && hidden ? <p className="kok-fill -mt-1 px-1 text-sm text-muted">복습을 끈 노트의 틀린 문제 {hidden}개는 빼고 보여 줘요.</p> : null}
      {loading ? (
        <WrongSkeleton />
      ) : failed ? (
        <div className="kok-fill">
          <EmptyState
            icon={<Icon d={ICONS.retry} size={34} strokeWidth={2.2} />}
            title="오답노트를 불러오지 못했어요"
            body="인터넷 연결을 확인하고 다시 불러와 주세요."
            action={<Button onClick={retry}>다시 불러오기</Button>}
          />
        </div>
      ) : !items.length ? (
        // 자리 표시와 모양이 달라서 카드째 살짝 번지며 나타난다
        <div className="kok-fill">
          <EmptyState
            icon={<Icon d={ICONS.check} size={34} strokeWidth={2.2} />}
            title="오답노트가 비어 있어요"
            body="틀린 문제가 생기면 여기에 모여요."
            action={<LinkButton href="/home">홈으로</LinkButton>}
          />
        </div>
      ) : (
        // 자리 표시와 같은 모양의 카드는 그 자리에 두고, 안의 글만 위에서부터 차례로 번지며 나타난다
        <>
          {weak.length ? (
            <>
              <SectionTitle>
                <span className="kok-fill block">약점 개념 {weak.length}개</span>
              </SectionTitle>
              <div className="grid gap-2">
                {weak.map((w, i) => {
                  const n = notes.get(w.note_id);
                  const t = titles.get(w.note_id)?.get(w.key_point_id)?.title ?? w.key_point_id;
                  return (
                    <Card key={`${w.note_id}:${w.key_point_id}`} className="grid gap-2" style={{ ['--i' as string]: i + 1 }}>
                      <div className="kok-fill flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-bold">{t}</p>
                          <p className="truncate text-sm text-muted">{n?.title ?? '노트'}</p>
                        </div>
                        <Chip tone="bad">틀린 문제 {w.count}</Chip>
                      </div>
                      <div className="kok-fill flex flex-wrap gap-2">
                        <LinkButton size="sm" href={`/review?kp=${w.note_id}:${w.key_point_id}`}>
                          이 개념 풀기
                        </LinkButton>
                        {n ? (
                          <>
                            <Link className={buttonClass('secondary', 'sm')} href={`/notes/${n.source_id}?kp=${encodeURIComponent(w.key_point_id)}`}>
                              노트에서 보기
                            </Link>
                            <Link className={buttonClass('secondary', 'sm')} href={`/notes/${n.source_id}?tab=visual&kp=${encodeURIComponent(w.key_point_id)}`}>
                              마인드맵에서 보기
                            </Link>
                          </>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : null}

          <SectionTitle>
            <span className="kok-fill block" style={{ ['--i' as string]: itemsFrom - 1 }}>
              틀린 문제 {items.length}개
            </span>
          </SectionTitle>
          <div className="grid gap-2">
            {items.map(({ q, lapses }, i) => (
              <Card key={q.id} className="grid gap-2" style={{ ['--i' as string]: itemsFrom + i }}>
                <button
                  type="button"
                  className="kok-fill flex items-start gap-2 text-left"
                  onClick={() => setOpen(open === q.id ? null : q.id)}
                  aria-expanded={open === q.id}
                >
                  <span className="line-clamp-2 min-w-0 flex-1 font-semibold">{q.prompt}</span>
                  <Chip tone="bad">{lapses}번 틀림</Chip>
                </button>
                {open === q.id ? (
                  // 펼친 답은 바로 (늦추지 않고) 살짝 번지며 나타난다
                  <div className="kok-fill" style={{ ['--i' as string]: 0 }}>
                    <QuestionPreview q={q} />
                  </div>
                ) : null}
                <div className="kok-fill flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const { error } = await sb().from('cards').update({ in_wrong_note: false }).eq('question_id', q.id);
                      if (error) toast('빼지 못했어요.', 'bad');
                      else {
                        setItems((xs) => xs.filter((x) => x.q.id !== q.id));
                        toast('다 외운 문제로 뺐어요.', 'ok');
                      }
                    }}
                  >
                    다 외웠어요 · 빼기
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 오답노트를 읽는 동안: 실제 목록과 같은 모양·크기 (약점 개념 카드 둘, 틀린 문제 카드 둘) */
function WrongSkeleton() {
  return (
    <div className="kok-skel grid gap-3" aria-busy="true">
      <span className="sr-only">오답을 불러오는 중이에요</span>
      <SectionBone width="w-24" />
      <div className="grid gap-2" aria-hidden="true">
        <WeakCardBone title="w-28" />
        <WeakCardBone title="w-36" />
      </div>
      <SectionBone width="w-24" />
      <div className="grid gap-2" aria-hidden="true">
        <WrongCardBone lines={2} />
        <WrongCardBone lines={1} />
      </div>
    </div>
  );
}

/** 구역 제목 자리 (SectionTitle 과 같은 여백·높이) */
function SectionBone({ width }: { width: string }) {
  return (
    <div className="mb-1 mt-5 flex h-7 items-center px-1" aria-hidden="true">
      <span className={cx('kok-bone h-3.5', width)} />
    </div>
  );
}

/** 약점 개념 카드 자리: 개념·노트 이름, 틀린 수, 버튼 셋 (버튼과 같은 너비라 같은 화면 너비에서 줄이 바뀐다) */
function WeakCardBone({ title }: { title: string }) {
  return (
    <div className="kok-card kok-shimmer grid gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="grid">
          <span className="flex h-[25.6px] items-center">
            <span className={cx('kok-bone h-3', title)} />
          </span>
          <span className="flex h-5 items-center">
            <span className="kok-bone h-2.5 w-12" />
          </span>
        </div>
        <span className="kok-bone h-5 w-[74px]" />
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="kok-bone h-8 w-[95px]" />
        <span className="kok-bone h-8 w-[104px]" />
        <span className="kok-bone h-8 w-32" />
      </div>
    </div>
  );
}

/** 틀린 문제 카드 자리: 문제 글(한두 줄), 틀린 횟수, 빼기 버튼 */
function WrongCardBone({ lines }: { lines: 1 | 2 }) {
  return (
    <div className="kok-card kok-shimmer grid gap-2 p-4">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1">
          <span className="flex h-[25.6px] items-center">
            <span className={cx('kok-bone h-3', lines === 2 ? 'w-full' : 'w-[70%]')} />
          </span>
          {lines === 2 ? (
            <span className="flex h-[25.6px] items-center">
              <span className="kok-bone h-3 w-[45%]" />
            </span>
          ) : null}
        </div>
        <span className="kok-bone h-5 w-[62px]" />
      </div>
      <div className="flex h-8 items-center justify-end">
        <span className="kok-bone mr-3.5 h-2.5 w-24" />
      </div>
    </div>
  );
}
