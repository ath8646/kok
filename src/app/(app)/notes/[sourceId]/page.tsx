'use client';
// 노트: 탭 정리 · 그림 · 문제 · 원본 (처리 중이면 진행 상태)
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { NoteView, type NoteBody } from '@/components/NoteView';
import { ProcessingView } from '@/components/note/ProcessingView';
import { OriginalPanel } from '@/components/note/OriginalPanel';
import { QuestionsPanel } from '@/components/note/QuestionsPanel';
import { VisualPanel, type NoteView as NoteViewPrefs, type Visuals } from '@/components/note/VisualPanel';
import type { CardInfo } from '@/components/QuestionList';
import { Button, Chip, EmptyState, LinkButton, Sheet, cx, inputClass, useToast } from '@/components/ui';
import { SOURCE_COLS, sb, type SourceRowWithUnit } from '@/lib/data';
import { zMindmap, zNote, zTable, zTimeline } from '@/lib/ai/schemas';
import type { QuestionRow, SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';

type Tab = 'note' | 'visual' | 'questions' | 'original';
type SourceFull = SourceRowWithUnit & { text_content: string | null };
type NoteRow = { id: string; title: string; subject_id: string; body: Record<string, unknown> };

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'note', label: '정리' },
  { id: 'visual', label: '그림' },
  { id: 'questions', label: '문제' },
  { id: 'original', label: '원본' },
];

type Bundle = {
  source: SourceFull | null;
  note: NoteRow | null;
  visuals: Visuals;
  questions: QuestionRow[];
  cards: Map<string, CardInfo>;
  subject: SubjectRow | null;
};

async function fetchBundle(sourceId: string): Promise<Bundle> {
  const empty: Bundle = { source: null, note: null, visuals: {}, questions: [], cards: new Map(), subject: null };
  const { data: s } = await sb().from('sources').select(`${SOURCE_COLS}, text_content`).eq('id', sourceId).maybeSingle();
  const source = (s as SourceFull) ?? null;
  if (!source || source.status !== 'ready') return { ...empty, source };
  const { data: n } = await sb().from('notes').select('id, title, subject_id, body').eq('source_id', sourceId).maybeSingle();
  if (!n) return { ...empty, source };
  const [{ data: vs }, { data: qs }, { data: subj }] = await Promise.all([
    sb().from('visuals').select('type, spec').eq('note_id', n.id),
    sb()
      .from('questions')
      .select(
        'id, note_id, subject_id, key_point_id, type, prompt, choices, answer, accepted, explanation, difficulty, pages, created_by, locked, edited, status, created_at',
      )
      .eq('note_id', n.id)
      .order('created_at'),
    sb().from('subjects').select('id, name, color, exam_date, position, created_at').eq('id', n.subject_id).maybeSingle(),
  ]);
  const visuals: Visuals = {};
  for (const row of vs ?? []) {
    if (row.type === 'mindmap') visuals.mindmap = zMindmap.parse(row.spec);
    if (row.type === 'table') visuals.table = zTable.parse(row.spec);
    if (row.type === 'timeline') visuals.timeline = zTimeline.parse(row.spec);
  }
  const questions = (qs ?? []) as QuestionRow[];
  let cards = new Map<string, CardInfo>();
  if (questions.length) {
    const { data: cs } = await sb()
      .from('cards')
      .select('question_id, lapses, wrong_count, in_wrong_note, due, reps')
      .in(
        'question_id',
        questions.map((q) => q.id),
      );
    cards = new Map((cs ?? []).map((c) => [c.question_id as string, c as unknown as CardInfo]));
  }
  return { source, note: n as NoteRow, visuals, questions, cards, subject: (subj as SubjectRow) ?? null };
}

function initialParam(name: string): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);
}

export default function NotePage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const { me } = useMe();
  const toast = useToast();
  const [bundle, setBundle] = useState<Bundle | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>(() => {
    const t = initialParam('tab');
    return t === 'note' || t === 'visual' || t === 'questions' || t === 'original' ? t : 'note';
  });
  const [kp, setKp] = useState<string | null>(() => initialParam('kp'));
  const [page, setPage] = useState<number | null>(null);
  const [glance, setGlance] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    fetchBundle(sourceId)
      .then((b) => {
        if (alive) setBundle(b);
      })
      .catch(() => {
        if (alive) setBundle((cur) => cur ?? null);
      });
    return () => {
      alive = false;
    };
  }, [sourceId, version]);

  const source = bundle === undefined ? undefined : (bundle?.source ?? null);
  const note = bundle?.note ?? null;
  const visuals = bundle?.visuals ?? {};
  const questions = bundle?.questions ?? [];
  const cards = bundle?.cards ?? new Map<string, CardInfo>();
  const subject = bundle?.subject ?? null;
  const noteId = note?.id;

  // 약점 개념에서 왔으면 그 개념으로 스크롤
  useEffect(() => {
    const target = initialParam('kp');
    if (noteId && target) setTimeout(() => document.getElementById(`kp-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
  }, [noteId]);

  const body = useMemo<NoteBody | null>(
    () => (note ? ({ ...zNote.parse(note.body), recommended: note.body.recommended as string | undefined } as NoteBody) : null),
    [note],
  );
  const view = (note?.body.view ?? {}) as NoteViewPrefs;
  const keyPoints = useMemo(() => (body?.key_points ?? []).map((k) => ({ id: k.id, title: k.title })), [body]);

  const saveBody = async (next: Record<string, unknown>) => {
    if (!note) return;
    setBundle((b) => (b && b.note ? { ...b, note: { ...b.note, body: next } } : b));
    const { error } = await sb().from('notes').update({ body: next }).eq('id', note.id);
    if (error) toast('저장하지 못했어요.', 'bad');
  };

  if (!me) return null;
  if (source === undefined) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />;
  if (source === null) return <EmptyState title="자료를 찾을 수 없어요" action={<LinkButton href="/library">자료함으로</LinkButton>} />;

  const header = (
    <div className="grid gap-1">
      <Link href={subject ? `/library/${subject.id}` : '/library'} className="text-sm font-semibold text-muted">
        ‹ {subject?.name ?? '자료함'}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        {subject ? <span className="h-6 w-1.5 rounded-full" style={{ background: subjectVar(subject.color) }} aria-hidden="true" /> : null}
        <h1 className="font-display text-2xl">{note?.title || source.title || '새 자료'}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {source.unit ? <Chip>{source.unit}</Chip> : null}
        <Chip>AI 정리</Chip>
        <span>{source.kind === 'pdf' ? `PDF ${source.page_count ?? ''}쪽` : source.kind === 'image' ? `사진 ${source.page_count ?? ''}장` : '직접 쓴 글'}</span>
      </div>
    </div>
  );

  if (source.status !== 'ready' || !note || !body) {
    return (
      <div className="grid gap-4">
        {header}
        <ProcessingView source={source} onReload={reload} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {header}
      <div className="sticky top-[calc(52px+env(safe-area-inset-top))] z-20 -mx-4 border-b border-line bg-bg/90 px-4 py-2 backdrop-blur md:top-0">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="노트 보기">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx('rounded-lg py-2 text-sm font-bold', tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
            >
              {t.label}
              {t.id === 'questions' ? ` ${questions.length}` : ''}
            </button>
          ))}
        </div>
      </div>

      {tab === 'note' ? (
        <div className="grid gap-4">
          {visuals.mindmap || visuals.table || visuals.timeline ? (
            <section className="rounded-2xl border border-line bg-surface p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between px-1 font-display text-lg"
                onClick={() => setGlance((g) => !g)}
                aria-expanded={glance}
              >
                한눈에 보기
                <span className="text-sm font-normal text-muted">{glance ? '접기' : '펼치기'}</span>
              </button>
              {glance ? (
                <div className="mt-2">
                  <VisualPanel
                    compact
                    me={me}
                    noteId={note.id}
                    subjectId={note.subject_id}
                    subjectColor={subject?.color ?? 'blue'}
                    visuals={visuals}
                    recommended={body.recommended}
                    view={view}
                    highlightKeyPoint={kp}
                    onSaved={reload}
                    onOpen={() => setTab('visual')}
                  />
                  <button type="button" className="mt-2 text-sm font-semibold text-accent" onClick={() => setTab('visual')}>
                    그림 크게 보기·고치기 →
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
          <NoteView
            note={body}
            kind={source.kind}
            editable
            onChange={(next) => saveBody({ ...note.body, ...next })}
            highlightKeyPoint={kp}
            onSelectKeyPoint={setKp}
            onOpenPage={(p) => {
              setPage(p);
              setTab('original');
            }}
          />
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/review?note=${note.id}`}>이 노트 문제 풀기</LinkButton>
            <Button variant="ghost" onClick={() => setReporting(true)}>
              이상해요
            </Button>
          </div>
        </div>
      ) : null}

      {tab === 'visual' ? (
        <VisualPanel
          me={me}
          noteId={note.id}
          subjectId={note.subject_id}
          subjectColor={subject?.color ?? 'blue'}
          visuals={visuals}
          recommended={body.recommended}
          view={view}
          highlightKeyPoint={kp}
          onSaved={reload}
          onViewChange={(v) => saveBody({ ...note.body, view: v })}
          onReport={() => setReporting(true)}
        />
      ) : null}

      {tab === 'questions' ? (
        <QuestionsPanel me={me} noteId={note.id} subjectId={note.subject_id} questions={questions} cards={cards} keyPoints={keyPoints} onChanged={reload} />
      ) : null}

      {tab === 'original' ? (
        <OriginalPanel kind={source.kind} text={source.text_content} paths={source.file_paths} expireAt={source.files_expire_at} focusPage={page} />
      ) : null}

      <Sheet open={reporting} onClose={() => setReporting(false)} title="이상해요">
        <div className="grid gap-3">
          <p className="text-sm text-muted">정리나 그림에서 틀린 곳, 이상한 곳을 알려 주세요. 관리자가 확인해요. 직접 고칠 수도 있어요.</p>
          <textarea
            className={cx(inputClass, 'min-h-24')}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 2번 개념 설명이 교과서와 달라요"
          />
          <Button
            disabled={!reason.trim()}
            onClick={async () => {
              const { error } = await sb().from('reports').insert({ target_type: 'note', target_id: note.id, reason: reason.trim() });
              if (error) toast('보내지 못했어요.', 'bad');
              else {
                toast('신고했어요. 고마워요!', 'ok');
                setReason('');
                setReporting(false);
              }
            }}
          >
            보내기
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
