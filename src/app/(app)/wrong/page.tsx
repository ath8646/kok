'use client';
// 오답노트: 약점 개념 5개, 틀린 문제 다시 풀기, 다 외운 문제 빼기
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { QuestionPreview } from '@/components/QuestionList';
import { Button, Card, Chip, EmptyState, LinkButton, SectionTitle, buttonClass, useToast } from '@/components/ui';
import { fetchImportance, fetchPlanData, fetchQuestionsByIds, sb } from '@/lib/data';
import { weakConcepts, type WeakConcept } from '@/lib/review-plan';
import type { QuestionRow } from '@/lib/types';

type NoteInfo = { id: string; source_id: string; title: string };

async function fetchWrong() {
  const [plan, titles] = await Promise.all([fetchPlanData(), fetchImportance()]);
  const wrong = plan.cards.filter((c) => c.in_wrong_note);
  const weak = weakConcepts(
    wrong.map((c) => ({ question_id: c.question_id, note_id: c.note_id, key_point_id: c.key_point_id, lapses: c.wrong_count ?? 0 })),
    5,
  );
  const qs = await fetchQuestionsByIds(wrong.map((c) => c.question_id));
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
  return { weak, titles, notes, items };
}

export default function WrongPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [weak, setWeak] = useState<WeakConcept[]>([]);
  const [titles, setTitles] = useState<Map<string, Map<string, { title: string }>>>(new Map());
  const [notes, setNotes] = useState<Map<string, NoteInfo>>(new Map());
  const [items, setItems] = useState<Array<{ q: QuestionRow; lapses: number }>>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchWrong()
      .then((r) => {
        if (!alive) return;
        setWeak(r.weak);
        setTitles(r.titles);
        setNotes(r.notes);
        setItems(r.items);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        toast('오답노트를 불러오지 못했어요.', 'bad');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  if (loading) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl">오답노트</h1>
        {items.length ? <LinkButton href="/review?mode=wrong">전부 다시 풀기</LinkButton> : null}
      </div>
      <p className="text-sm text-muted">틀린 문제가 모여요. 3번 연속 맞히면 졸업해요.</p>

      {!items.length ? (
        <EmptyState title="오답노트가 비어 있어요" body="틀린 문제가 생기면 여기에 모여요." action={<LinkButton href="/home">홈으로</LinkButton>} />
      ) : (
        <>
          {weak.length ? (
            <>
              <SectionTitle>약점 개념 {weak.length}개</SectionTitle>
              <div className="grid gap-2">
                {weak.map((w) => {
                  const n = notes.get(w.note_id);
                  const t = titles.get(w.note_id)?.get(w.key_point_id)?.title ?? w.key_point_id;
                  return (
                    <Card key={`${w.note_id}:${w.key_point_id}`} className="grid gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-bold">{t}</p>
                          <p className="truncate text-sm text-muted">{n?.title ?? '노트'}</p>
                        </div>
                        <Chip tone="bad">틀린 문제 {w.count}</Chip>
                      </div>
                      <div className="flex flex-wrap gap-2">
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

          <SectionTitle>틀린 문제 {items.length}개</SectionTitle>
          <div className="grid gap-2">
            {items.map(({ q, lapses }) => (
              <Card key={q.id} className="grid gap-2">
                <button
                  type="button"
                  className="flex items-start gap-2 text-left"
                  onClick={() => setOpen(open === q.id ? null : q.id)}
                  aria-expanded={open === q.id}
                >
                  <span className="line-clamp-2 min-w-0 flex-1 font-semibold">{q.prompt}</span>
                  <Chip tone="bad">{lapses}번 틀림</Chip>
                </button>
                {open === q.id ? <QuestionPreview q={q} /> : null}
                <div className="flex justify-end">
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
