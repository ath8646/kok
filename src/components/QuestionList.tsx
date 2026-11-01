'use client';
// 문제 관리: 실제 시험지처럼 보기(번호·발문·자료 상자·①② 보기, 펼치면 정답·해설), 고치기, 잠그기, 쉬게 하기, 지우기, 문제 신고.
// 과목마다 시험지 모양이 다르다 (lib/exam-layout.ts examStyle: 과목 이름·노트 자료 종류·문제 글).
// 꾹 누르면(키보드는 Shift+F10) 여러 개 고르기: 아래 띠에서 한꺼번에 쉬게 하기·다시 내기·잠그기·지우기·선택 해제 (노트의 문제 탭·문제 모아 보기)
import { useMemo, useState, type ReactNode } from 'react';
import type { QuestionRow } from '@/lib/types';
import { THINK_OUT, estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { useMe } from './AppShell';
import { useConfirm } from './Confirm';
import { QuestionFigure, StepsDisclosure, useSolution } from './figure/SolutionView';
import { SourceFigureView } from './figure/SourceFigureView';
import { readQuestionFigure } from '@/lib/source-figures';
import { QuestionEditor, type QuestionDraft } from './QuestionEditor';
import { RichText } from './RichText';
import { ExamPrompt, ExplainText } from './exam/ExamText';
import { ReportSheet, type ReportWhat } from './ReportSheet';
import { choiceMark, examStyle, examSummary, questionFormat, type ExamStyle } from '@/lib/exam-layout';
import { Button, Chip, Energy, ICONS, Icon, IconButton, Sheet, cx, api, useToast, DONE } from './ui';
import { BarAction, PICKED_RING, PickBadge, SelectionBar, pickKeyHandler, useMultiSelect } from './SelectionBar';
import { useLongPress } from './useLongPress';

/** 한 번에 고치는 문제 수 (주소 길이를 넘지 않게) */
const BULK = 100;

/** 정답을 한 줄 글로 (객관식은 ③ 보기 글, OX 는 O·X) */
function answerLine(q: Pick<QuestionRow, 'type' | 'choices' | 'answer'>): string {
  if (q.type === 'mcq') return `${choiceMark(Number(q.answer))} ${q.choices?.[Number(q.answer)] ?? ''}`;
  if (q.type === 'ox') return q.answer ? 'O' : 'X';
  return String(q.answer ?? '');
}

/**
 * 문제 하나를 시험지처럼: 발문·자료 상자·<보기>(ExamPrompt) → ①② 보기 → (정답을 보이면) 정답·해설 칸.
 * style: 과목마다 시험지 모양 (없으면 문제 글로 짐작)
 */
export function QuestionPreview({
  q,
  showAnswer = true,
  style,
}: {
  q: Pick<QuestionRow, 'type' | 'prompt' | 'choices' | 'answer' | 'explanation'> & { figure?: unknown; steps?: unknown; source_figure?: unknown };
  showAnswer?: boolean;
  style?: ExamStyle;
}) {
  const solution = useSolution(q);
  const { me } = useMe();
  // 자료 그림 문제: 답을 보여 줄 때는 그림의 제목·설명도 (풀기 전에는 숨긴다)
  const sourceFig = useMemo(() => readQuestionFigure(q.source_figure), [q.source_figure]);
  const st = style ?? examStyle({ text: q.prompt });
  const descriptive = questionFormat(q).descriptive;
  return (
    <div className="grid gap-3">
      <ExamPrompt text={q.prompt} style={st} />
      <QuestionFigure solution={solution} className="my-1" />
      {sourceFig ? (
        <SourceFigureView fig={sourceFig} variant={showAnswer ? 'card' : 'question'} originalFirst={!!me?.settings.visual.originalFirst} className="my-1" />
      ) : null}
      {q.type === 'mcq' && q.choices ? (
        <ol className="grid gap-1 text-[15px]" aria-label="선택지">
          {q.choices.map((c, i) => (
            <li key={i} className={cx('kok-exam-step', showAnswer && Number(q.answer) === i ? 'font-bold text-ok' : 'text-ink')}>
              <span aria-hidden="true">{choiceMark(i)}</span>
              <span className="min-w-0">
                <span className="sr-only">{i + 1}번 </span>
                <RichText text={c} />
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {showAnswer ? (
        // 문제집의 정답·해설처럼: 가는 줄 아래에 정답, 해설 (여러 부분이면 한 줄씩)
        <div className="grid gap-2 border-t border-dashed border-line pt-3 text-sm leading-relaxed">
          <div className={descriptive ? 'grid gap-1' : undefined}>
            <b className="text-ok">정답</b>{' '}
            {descriptive ? <ExplainText text={answerLine(q)} /> : <RichText text={answerLine(q)} />}
          </div>
          {q.explanation ? (
            <div className="grid gap-1 text-muted">
              <b className="text-ink">{st === 'math' ? '풀이' : '해설'}</b>
              <ExplainText text={q.explanation} />
            </div>
          ) : null}
          <StepsDisclosure solution={solution} className="mt-1" />
        </div>
      ) : null}
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
/** 문제 빼기·지우기: 단추 글, 확인 창의 묻는 말·덧붙이는 말, 되돌릴 수 없는 일인지, 할 일 */
export type QuestionRemoval = { label: string; confirm: string; note?: string; danger?: boolean; run: () => Promise<boolean> };

export function QuestionList({
  questions,
  cards,
  keyPoints,
  onChanged,
  removal,
  removeMany,
  conceptEdit,
  emptyText = '문제가 없어요.',
  styleOf,
}: {
  questions: QuestionRow[];
  cards?: Map<string, CardInfo>;
  keyPoints?: Array<{ id: string; title: string }>;
  onChanged: () => void;
  removal?: (q: QuestionRow) => QuestionRemoval;
  /** 여러 개 지우기를 바꿀 때 (노트 버전: 다른 버전에 있는 문제는 이 버전에서만 뺀다). 없으면 모두 지운다 */
  removeMany?: (qs: QuestionRow[]) => QuestionRemoval;
  /**
   * 지난 버전을 보고 있을 때: 문제의 개념 바꾸기는 문제 행 대신 이것으로 (그 버전의 개념 기록만 고친다).
   * 문제 행의 개념은 지금 버전의 것이라 그대로 둔다
   */
  conceptEdit?: (questionId: string, keyPointId: string | null) => Promise<boolean>;
  emptyText?: string;
  /** 문제마다 시험지 모양 (과목 이름·노트 자료 종류로: examStyle). 없으면 문제 글로 짐작 */
  styleOf?: (q: QuestionRow) => ExamStyle;
}) {
  const toast = useToast();
  const ask = useConfirm();
  const { me } = useMe();
  const [editing, setEditing] = useState<QuestionRow | null>(null);
  const [reporting, setReporting] = useState<ReportWhat | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [solving, setSolving] = useState<string | null>(null);
  const { selecting, picked, setPicked, startSelect, endSelect, togglePick } = useMultiSelect();
  const [bulk, setBulk] = useState<'rest' | 'lock' | 'remove' | null>(null);
  const figuresOn = !!me?.features.figures;
  // 그림 풀이 만들기 (Pro): 문제 하나 (먼저 생각하고 답해서 답이 조금 길다)
  const solveEst = me ? Math.round(estimateSmallTask(clientModel(me, me.settings.models.quiz), me.usdPerEnergy, 4500, THINK_OUT.solveOne) * 10) / 10 : 0;

  const solve = async (q: QuestionRow) => {
    if (solving) return;
    setSolving(q.id);
    try {
      await api(`/api/questions/${q.id}/solve`, { method: 'POST', body: '{}' });
      toast('그림 풀이를 만들었어요.', 'ok', DONE);
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
      if (msg) toast(msg, 'ok', DONE);
      onChanged();
    }
  };

  // 고른 문제 (목록에 남아 있는 것만: 고르는 사이 목록이 바뀌어도)
  const chosen = questions.filter((q) => picked.has(q.id));
  const restable = chosen.filter((q) => q.status !== 'hidden');
  const anyActive = restable.some((q) => q.status === 'active');
  const anyUnlocked = chosen.some((q) => !q.locked);
  const allPicked = questions.length > 0 && chosen.length === questions.length;

  /** 고른 문제를 한꺼번에 고친다 (100개씩). 다 되면 고르기를 끝낸다 */
  const updateMany = async (ids: string[], patch: Record<string, unknown>, msg: string, kind: 'rest' | 'lock') => {
    if (!ids.length || bulk) return;
    setBulk(kind);
    let ok = true;
    for (let i = 0; i < ids.length; i += BULK) {
      const { error } = await sb()
        .from('questions')
        .update(patch)
        .in('id', ids.slice(i, i + BULK));
      if (error) ok = false;
    }
    setBulk(null);
    if (!ok) toast('몇 개는 저장하지 못했어요. 다시 해 주세요.', 'bad');
    else {
      toast(msg, 'ok', DONE);
      endSelect();
    }
    onChanged();
  };

  const removePicked = async () => {
    if (!chosen.length || bulk) return;
    const n = chosen.length;
    const r = removeMany?.(chosen) ?? {
      label: '지우기',
      confirm: `고른 문제 ${n}개를 지울까요?`,
      note: '푼 기록도 같이 지워지고 되돌릴 수 없어요.',
      danger: true,
      run: async () => {
        let ok = true;
        for (let i = 0; i < chosen.length; i += BULK) {
          const { error } = await sb()
            .from('questions')
            .delete()
            .in(
              'id',
              chosen.slice(i, i + BULK).map((q) => q.id),
            );
          if (error) ok = false;
        }
        return ok;
      },
    };
    if (!(await ask({ title: r.danger ? '문제 지우기' : '문제 빼기', body: r.confirm, note: r.note, ok: r.label, danger: r.danger }))) return;
    setBulk('remove');
    const ok = await r.run();
    setBulk(null);
    if (!ok) toast('몇 개는 지우지 못했어요. 다시 해 주세요.', 'bad');
    else {
      toast(r.danger ? `${n}개를 지웠어요.` : `${n}개를 뺐어요.`, 'ok', DONE);
      endSelect();
    }
    onChanged();
  };

  if (!questions.length) return <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{emptyText}</p>;

  return (
    <div className={cx('grid gap-2', selecting && 'pb-24')}>
      {selecting ? (
        // 고르는 중: 몇 개 골랐는지·모두 고르기·끝내기 (Esc 도 끝낸다)
        <div className="flex min-h-11 items-center gap-2 rounded-2xl bg-accent-soft py-1 pl-4 pr-1" role="status">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-accent">
            {chosen.length ? `${chosen.length}개 골랐어요` : '문제를 눌러 골라 주세요'}
          </span>
          <button
            type="button"
            className="press rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-accent hover:brightness-95"
            onClick={() => setPicked(allPicked ? new Set() : new Set(questions.map((q) => q.id)))}
          >
            {allPicked ? '모두 풀기' : '모두 고르기'}
          </button>
          <IconButton label="고르기 끝내기" onClick={endSelect}>
            <Icon d={ICONS.close} />
          </IconButton>
        </div>
      ) : questions.length > 1 ? (
        <p className="px-1 text-xs text-muted">문제를 꾹 누르면 여러 개를 골라 한꺼번에 쉬게 하거나 지울 수 있어요.</p>
      ) : null}
      {questions.map((q, i) => {
        const c = cards?.get(q.id);
        const isOpen = open === q.id;
        const st = styleOf?.(q) ?? examStyle({ text: q.prompt });
        return (
          <QuestionItem
            key={q.id}
            q={q}
            number={i + 1}
            summary={examSummary(q.prompt, st)}
            selecting={selecting}
            picked={picked.has(q.id)}
            onPick={() => togglePick(q.id)}
            onLongPress={() => (selecting ? togglePick(q.id) : startSelect(q.id))}
            isOpen={isOpen}
            onToggle={() => setOpen(isOpen ? null : q.id)}
            chips={
              <>
                <Chip>{questionFormat(q).label}</Chip>
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
              </>
            }
          >
            <QuestionPreview q={q} style={st} />
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
              {figuresOn && me?.canFigures && !q.steps && !q.source_figure ? (
                <Button size="sm" variant="secondary" busy={solving === q.id} disabled={!!solving && solving !== q.id} onClick={() => solve(q)}>
                  그림 풀이 만들기 <Energy n={solveEst} />
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setReporting({ kind: 'question', target: q.id })}>
                <Icon d={ICONS.flag} size={15} />
                문제 신고
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-bad"
                onClick={async () => {
                  const r = removal?.(q) ?? {
                    label: '지우기',
                    confirm: '이 문제를 지울까요?',
                    note: '푼 기록도 같이 지워지고 되돌릴 수 없어요.',
                    danger: true,
                    run: async () => !(await sb().from('questions').delete().eq('id', q.id)).error,
                  };
                  if (!(await ask({ title: r.danger ? '문제 지우기' : '문제 빼기', body: r.confirm, note: r.note, ok: r.label, danger: r.danger }))) return;
                  const ok = await r.run();
                  if (!ok) toast('지우지 못했어요.', 'bad');
                  else onChanged();
                }}
              >
                {removal?.(q).label ?? '지우기'}
              </Button>
            </div>
          </QuestionItem>
        );
      })}

      {/* 여러 개 고르기: 아래 띠 (폰은 아래 메뉴 자리, 넓은 화면은 가운데 떠 있는 띠) */}
      {selecting ? (
        <SelectionBar count={chosen.length} noun="문제" onClear={endSelect}>
          <BarAction
            icon={anyActive || !restable.length ? ICONS.reviewOff : ICONS.review}
            label={anyActive || !restable.length ? '쉬기' : '다시 내기'}
            disabled={!restable.length || !!bulk}
            busy={bulk === 'rest'}
            onClick={() =>
              anyActive
                ? updateMany(
                    restable.filter((q) => q.status === 'active').map((q) => q.id),
                    { status: 'suspended' },
                    '고른 문제를 복습에서 잠깐 뺐어요.',
                    'rest',
                  )
                : updateMany(
                    restable.map((q) => q.id),
                    { status: 'active' },
                    '고른 문제를 다시 복습에 넣었어요.',
                    'rest',
                  )
            }
          />
          <BarAction
            icon={anyUnlocked || !chosen.length ? ICONS.lock : ICONS.unlock}
            label={anyUnlocked || !chosen.length ? '잠그기' : '잠금 풀기'}
            disabled={!chosen.length || !!bulk}
            busy={bulk === 'lock'}
            onClick={() =>
              updateMany(
                chosen.map((q) => q.id),
                { locked: anyUnlocked },
                anyUnlocked ? '잠갔어요. AI가 다시 만들어도 그대로 남아요.' : '잠금을 풀었어요.',
                'lock',
              )
            }
          />
          <BarAction
            icon={ICONS.trash}
            label={removeMany && chosen.length ? removeMany(chosen).label : '지우기'}
            danger
            disabled={!chosen.length || !!bulk}
            busy={bulk === 'remove'}
            onClick={removePicked}
          />
        </SelectionBar>
      ) : null}

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
              if (conceptEdit) {
                // 지난 버전: 개념은 그 버전 기록에만, 나머지는 문제 행에 (문제 글·정답은 버전끼리 같은 문제다)
                const { key_point_id: kp, ...rest } = d;
                if ((kp ?? null) !== (editing.key_point_id ?? null) && !(await conceptEdit(editing.id, kp ?? null))) {
                  toast('저장하지 못했어요.', 'bad');
                  setSaving(false);
                  return;
                }
                await update(
                  editing.id,
                  { ...rest, edited: true, ...(reset ? { figure: null, steps: null } : {}) },
                  '고쳤어요. AI가 다시 만들어도 그대로 남아요.',
                );
              } else {
                await update(
                  editing.id,
                  { ...d, edited: true, ...(reset ? { figure: null, steps: null } : {}) },
                  '고쳤어요. AI가 다시 만들어도 그대로 남아요.',
                );
              }
              setSaving(false);
              setEditing(null);
            }}
          />
        ) : null}
      </Sheet>

      <ReportSheet what={reporting} onClose={() => setReporting(null)} />
    </div>
  );
}

/**
 * 문제 카드 하나: 누르면 펼치고, 꾹 누르면 여러 개 고르기. 고르는 동안은 카드 모양 그대로 어디를 눌러도 고르기만 한다
 * (모서리에 동그라미, 고른 카드는 고리)
 */
function QuestionItem({
  q,
  number,
  summary,
  selecting,
  picked,
  onPick,
  onLongPress,
  isOpen,
  onToggle,
  chips,
  children,
}: {
  q: QuestionRow;
  /** 목록의 번호 (시험지처럼 1. 2. …) */
  number: number;
  /** 접혔을 때 보일 발문과 자료 첫머리 (examSummary) */
  summary: { ask: string; hint: string };
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  onLongPress: () => void;
  isOpen: boolean;
  onToggle: () => void;
  chips: ReactNode;
  children: ReactNode;
}) {
  const press = useLongPress(onLongPress, true);
  const selectProps = selecting
    ? { role: 'checkbox' as const, 'aria-checked': picked, 'aria-label': q.prompt.slice(0, 80), tabIndex: 0, onKeyDown: pickKeyHandler(onPick) }
    : {};
  return (
    <div
      className="kok-no-callout relative"
      data-question={q.id}
      {...press}
      onClickCapture={(e) => {
        press.onClickCapture(e);
        if (e.defaultPrevented) return;
        // 고르는 중에는 카드 안 어디를 눌러도 고르기만 한다
        if (selecting) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        }
      }}
    >
      <div
        className={cx(
          'kok-card p-4',
          q.status === 'suspended' && 'opacity-70 outline-1 outline-dashed outline-line',
          selecting && 'cursor-pointer',
          selecting && picked && PICKED_RING,
        )}
        {...selectProps}
      >
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          onClick={onToggle}
          aria-expanded={isOpen}
          tabIndex={selecting ? -1 : undefined}
          aria-hidden={selecting || undefined}
        >
          <span className="font-display text-[17px] leading-7 tabular-nums" aria-hidden="true">
            {number}.
          </span>
          <span className="min-w-0 flex-1">
            <span className="mb-1 flex flex-wrap items-center gap-1.5">{chips}</span>
            {/* 접혔을 때: 묻는 문장 + 흐린 자료 첫머리, 두 줄까지 (line-clamp 는 display 를 바꾸면 풀린다: block 을 같이 쓰지 않는다) */}
            {!isOpen ? (
              <span className="line-clamp-2 leading-relaxed">
                <span className="font-semibold">
                  <RichText text={summary.ask} />
                </span>
                {summary.hint ? <span className="text-muted"> · {summary.hint}</span> : null}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-sm text-muted">{isOpen ? '접기' : '보기'}</span>
        </button>
        {/* 펼친 내용은 고르는 동안에도 보이지만 누를 수 없다 (누르면 카드를 고른다: 카드가 줄어들어 밀리지 않게) */}
        {isOpen ? (
          <div className="mt-3 grid gap-3 border-t border-line pt-3" inert={selecting || undefined} aria-hidden={selecting || undefined}>
            {children}
          </div>
        ) : null}
      </div>
      {selecting ? <PickBadge picked={picked} /> : null}
    </div>
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
