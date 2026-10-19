'use client';
// 문제 관리: 보기, 고치기, 잠그기, 쉬게 하기, 지우기, 이상해요 신고
import { useState } from 'react';
import type { QuestionRow } from '@/lib/types';
import { THINK_OUT, estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { useMe } from './AppShell';
import { QuestionFigure, StepsDisclosure, useSolution } from './figure/SolutionView';
import { QuestionEditor, type QuestionDraft } from './QuestionEditor';
import { answerText, type ReviewQuestion } from './QuestionCard';
import { RichText } from './RichText';
import { Button, Chip, Energy, ICONS, Icon, Sheet, cx, inputClass, api, useToast } from './ui';

const TYPE_LABEL = { mcq: '객관식', ox: 'OX', cloze: '빈칸', short: '단답' } as const;

export function QuestionPreview({
  q,
  showAnswer = true,
}: {
  q: Pick<QuestionRow, 'type' | 'prompt' | 'choices' | 'answer' | 'explanation'> & { figure?: unknown; steps?: unknown };
  showAnswer?: boolean;
}) {
  const solution = useSolution(q);
  return (
    <div className="grid gap-1.5">
      <p className="font-semibold leading-relaxed">
        <RichText text={q.prompt} />
      </p>
      <QuestionFigure solution={solution} className="my-1" />
      {q.type === 'mcq' && q.choices ? (
        <ol className="grid gap-0.5 pl-1 text-sm">
          {q.choices.map((c, i) => (
            <li key={i} className={cx(showAnswer && Number(q.answer) === i ? 'font-bold text-ok' : 'text-muted')}>
              {i + 1}. <RichText text={c} />
            </li>
          ))}
        </ol>
      ) : null}
      {showAnswer ? (
        <p className="text-sm">
          <b className="text-ok">정답</b> <RichText text={answerText(q as ReviewQuestion)} />
        </p>
      ) : null}
      {showAnswer && q.explanation ? (
        <p className="text-sm text-muted">
          <RichText text={q.explanation} />
        </p>
      ) : null}
      {showAnswer ? <StepsDisclosure solution={solution} className="mt-1" /> : null}
    </div>
  );
}

/** 문제가 바뀌면(유형·보기·정답) 예전 그림 풀이는 맞지 않을 수 있어 지운다 (그림 풀이 칸이 있는 DB 만) */
export function clearsSolution(before: Pick<QuestionRow, 'type' | 'choices' | 'answer'>, after: Pick<QuestionRow, 'type' | 'choices' | 'answer'>): boolean {
  return (
    before.type !== after.type ||
    JSON.stringify(before.choices ?? null) !== JSON.stringify(after.choices ?? null) ||
    JSON.stringify(before.answer) !== JSON.stringify(after.answer)
  );
}

export type CardInfo = { lapses: number; wrong_count: number; in_wrong_note: boolean; due: string; reps: number };

/** 지우기를 바꿀 때 (노트 버전: 다른 버전에 있는 문제는 지우지 않고 이 버전에서만 뺀다) */
export type QuestionRemoval = { label: string; confirm: string; run: () => Promise<boolean> };

export function QuestionList({
  questions,
  cards,
  keyPoints,
  onChanged,
  removal,
  emptyText = '문제가 없어요.',
}: {
  questions: QuestionRow[];
  cards?: Map<string, CardInfo>;
  keyPoints?: Array<{ id: string; title: string }>;
  onChanged: () => void;
  removal?: (q: QuestionRow) => QuestionRemoval;
  emptyText?: string;
}) {
  const toast = useToast();
  const { me } = useMe();
  const [editing, setEditing] = useState<QuestionRow | null>(null);
  const [reporting, setReporting] = useState<QuestionRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [solving, setSolving] = useState<string | null>(null);
  const figuresOn = !!me?.features.figures;
  // 그림 풀이 만들기 (Pro): 문제 하나 (먼저 생각하고 답해서 답이 조금 길다)
  const solveEst = me ? Math.round(estimateSmallTask(clientModel(me, me.settings.models.quiz), me.usdPerEnergy, 4500, THINK_OUT.solveOne) * 10) / 10 : 0;

  const solve = async (q: QuestionRow) => {
    if (solving) return;
    setSolving(q.id);
    try {
      await api(`/api/questions/${q.id}/solve`, { method: 'POST', body: '{}' });
      toast('그림 풀이를 만들었어요.', 'ok');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setSolving(null);
    }
  };

  const update = async (id: string, patch: Record<string, unknown>, msg?: string) => {
    const { error } = await sb().from('questions').update(patch).eq('id', id);
    if (error) toast('저장하지 못했어요.', 'bad');
    else {
      if (msg) toast(msg, 'ok');
      onChanged();
    }
  };

  if (!questions.length) return <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{emptyText}</p>;

  return (
    <div className="grid gap-2">
      {questions.map((q) => {
        const c = cards?.get(q.id);
        const isOpen = open === q.id;
        return (
          <div key={q.id} className={cx('kok-card p-4', q.status === 'suspended' && 'opacity-70 outline-1 outline-dashed outline-line')}>
            <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(isOpen ? null : q.id)} aria-expanded={isOpen}>
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Chip>{TYPE_LABEL[q.type]}</Chip>
                  {q.created_by === 'ai' ? <Chip>AI</Chip> : <Chip tone="ok">내가 만듦</Chip>}
                  {q.locked ? (
                    <Chip tone="hl">
                      <Icon d={ICONS.lock} size={12} strokeWidth={2.4} />
                      잠금
                    </Chip>
                  ) : null}
                  {q.edited ? <Chip tone="accent">고침</Chip> : null}
                  {q.status === 'suspended' || (q.status === 'hidden' && q.rested_hidden) ? <Chip tone="warn">쉬는 중</Chip> : null}
                  {q.status === 'hidden' ? <Chip>지금 버전엔 없음</Chip> : null}
                  {q.steps ? <Chip tone="accent">{q.figure ? '그림 풀이' : '단계 풀이'}</Chip> : null}
                  {c && c.wrong_count > 0 ? <Chip tone="bad">틀림 {c.wrong_count}</Chip> : null}
                </span>
                {!isOpen ? (
                  <span className="line-clamp-2 block font-semibold">
                    <RichText text={q.prompt} />
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm text-muted">{isOpen ? '접기' : '보기'}</span>
            </button>
            {isOpen ? (
              <div className="mt-3 grid gap-3 border-t border-line pt-3">
                <QuestionPreview q={q} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(q)}>
                    고치기
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => update(q.id, { locked: !q.locked }, q.locked ? '잠금을 풀었어요.' : '잠갔어요. AI가 다시 만들어도 그대로 남아요.')}
                  >
                    {q.locked ? '잠금 풀기' : '잠그기'}
                  </Button>
                  {/* 지금 버전에 없는 문제(hidden)는 복습에 나오지 않으므로 쉬기·다시 내기가 없다 */}
                  {q.status !== 'hidden' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        update(
                          q.id,
                          { status: q.status === 'active' ? 'suspended' : 'active' },
                          q.status === 'active' ? '복습에서 뺐어요.' : '다시 복습에 넣었어요.',
                        )
                      }
                    >
                      {q.status === 'active' ? '잠깐 쉬기' : '다시 내기'}
                    </Button>
                  ) : null}
                  {figuresOn && me?.canFigures && !q.steps ? (
                    <Button size="sm" variant="secondary" busy={solving === q.id} disabled={!!solving && solving !== q.id} onClick={() => solve(q)}>
                      그림 풀이 만들기 <Energy n={solveEst} />
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setReporting(q)}>
                    이상해요
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-bad"
                    onClick={async () => {
                      const r = removal?.(q);
                      if (!confirm(r?.confirm ?? '이 문제를 지울까요? 푼 기록도 같이 지워져요.')) return;
                      const ok = r ? await r.run() : !(await sb().from('questions').delete().eq('id', q.id)).error;
                      if (!ok) toast('지우지 못했어요.', 'bad');
                      else onChanged();
                    }}
                  >
                    {removal?.(q).label ?? '지우기'}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="문제 고치기">
        {editing ? (
          <QuestionEditor
            initial={{ ...editing, key_point_id: editing.key_point_id }}
            keyPoints={keyPoints}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={async (d: QuestionDraft) => {
              setSaving(true);
              // 정답·보기가 바뀌면 예전 그림 풀이는 지운다 (Pro 는 다시 만들 수 있다)
              const reset = figuresOn && !!(editing.steps || editing.figure) && clearsSolution(editing, d);
              await update(editing.id, { ...d, edited: true, ...(reset ? { figure: null, steps: null } : {}) }, '고쳤어요. AI가 다시 만들어도 그대로 남아요.');
              setSaving(false);
              setEditing(null);
            }}
          />
        ) : null}
      </Sheet>

      <ReportSheet q={reporting} onClose={() => setReporting(null)} onChanged={onChanged} figuresOn={figuresOn} />
    </div>
  );
}

type Proposal = Pick<QuestionRow, 'type' | 'prompt' | 'choices' | 'answer' | 'accepted' | 'explanation' | 'difficulty' | 'pages'> & { key_point_id: string };

export function ReportSheet({
  q,
  onClose,
  onChanged,
  figuresOn = false,
}: {
  q: (Pick<QuestionRow, 'id' | 'type' | 'prompt' | 'choices' | 'answer' | 'explanation'> & { figure?: unknown; steps?: unknown }) | null;
  onClose: () => void;
  onChanged: () => void;
  /** 그림 풀이 칸이 있는 DB 인지 (고친 문제로 바꾸면 예전 그림 풀이를 지운다) */
  figuresOn?: boolean;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [fix, setFix] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ proposal: Proposal | null; removeSuggested?: boolean; fixError?: string } | null>(null);

  const close = () => {
    setReason('');
    setResult(null);
    setBusy(false);
    onClose();
  };

  return (
    <Sheet open={!!q} onClose={close} title="이상해요">
      {q && !result ? (
        <div className="grid gap-3">
          <QuestionPreview q={q} />
          <label className="grid gap-1.5 text-sm font-semibold">
            무엇이 이상한가요?
            <textarea
              className={cx(inputClass, 'min-h-24 font-normal')}
              value={reason}
              maxLength={1000}
              placeholder="예: 정답이 2번이 아니라 3번이에요"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={fix} onChange={(e) => setFix(e.target.checked)} />
            AI가 고친 문제를 제안받기 (에너지 1 미만)
          </label>
          <Button
            busy={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ proposal: Proposal | null; removeSuggested?: boolean; fixError?: string }>(`/api/questions/${q.id}/report`, {
                  method: 'POST',
                  body: JSON.stringify({ reason: reason.trim(), fix }),
                });
                if (!fix) {
                  toast('신고했어요. 고마워요!', 'ok');
                  close();
                  return;
                }
                setResult(r);
              } catch (e) {
                toast((e as Error).message, 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            보내기
          </Button>
        </div>
      ) : null}
      {q && result ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted">신고가 들어갔어요.</p>
          {result.proposal ? (
            <>
              <p className="font-bold">AI가 고친 문제</p>
              <div className="rounded-2xl border-2 border-accent p-4">
                <QuestionPreview q={result.proposal} />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    const p = result.proposal!;
                    const { error } = await sb()
                      .from('questions')
                      .update({
                        type: p.type,
                        prompt: p.prompt,
                        choices: p.choices,
                        answer: p.answer,
                        accepted: p.accepted,
                        explanation: p.explanation,
                        difficulty: p.difficulty,
                        edited: true,
                        ...(figuresOn && (q.steps || q.figure) && clearsSolution(q, p) ? { figure: null, steps: null } : {}),
                      })
                      .eq('id', q.id);
                    if (error) toast('바꾸지 못했어요.', 'bad');
                    else {
                      toast('고친 문제로 바꿨어요.', 'ok');
                      onChanged();
                      close();
                    }
                  }}
                >
                  이걸로 바꾸기
                </Button>
                <Button variant="ghost" onClick={close}>
                  그대로 두기
                </Button>
              </div>
            </>
          ) : result.removeSuggested ? (
            <>
              <p>AI는 이 문제를 지우는 게 좋겠다고 했어요.</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  onClick={async () => {
                    const { error } = await sb().from('questions').delete().eq('id', q.id);
                    if (error) toast('지우지 못했어요.', 'bad');
                    else {
                      onChanged();
                      close();
                    }
                  }}
                >
                  지우기
                </Button>
                <Button variant="ghost" onClick={close}>
                  그대로 두기
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">{result.fixError ?? '고친 문제를 만들지 못했어요.'} 직접 고칠 수도 있어요.</p>
              <Button variant="secondary" onClick={close}>
                닫기
              </Button>
            </>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * 직접 문제 만들기 (AI 비용 없음): 문제 + 복습 카드를 같이 만든다 → 만든 문제 번호 (못 만들면 null).
 * hidden: 지난 노트 버전에 만드는 문제 (그 버전을 쓰기 전에는 복습에 나오지 않는다)
 */
export async function createOwnQuestion(d: QuestionDraft, ctx: { noteId: string | null; subjectId: string; hidden?: boolean }): Promise<string | null> {
  const { data, error } = await sb()
    .from('questions')
    .insert({
      ...(ctx.hidden ? { status: 'hidden' } : {}),
      note_id: ctx.noteId,
      subject_id: ctx.subjectId,
      key_point_id: d.key_point_id,
      type: d.type,
      prompt: d.prompt,
      choices: d.choices,
      answer: d.answer,
      accepted: d.accepted,
      explanation: d.explanation,
      difficulty: d.difficulty,
      created_by: 'user',
    })
    .select('id')
    .single();
  if (error || !data) return null;
  const { error: cErr } = await sb().from('cards').insert({ question_id: data.id, subject_id: ctx.subjectId, due: new Date().toISOString() });
  return cErr ? null : (data.id as string);
}
