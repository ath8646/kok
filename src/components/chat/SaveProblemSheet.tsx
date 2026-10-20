'use client';
// AI 채팅에서 푼 문제를 노트 문제로 넣기: 과목(또는 새 과목) → 단원 → 노트(또는 새 노트)를 고르고 [넣기].
// 문제는 복습 카드와 같이 만들고(오늘부터 복습), 그림 풀이도 같이 넣는다. AI 가 노트 문제를 다시 만들어도 남게 잠가 둔다.
// 채팅 창을 떠나지 않고 끝낼 수 있게 과목도 여기서 만든다 (홈 채팅은 홈을 떠나면 사라진다)
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { QuestionPreview } from '@/components/QuestionList';
import { Button, ICONS, Icon, Sheet, api, cx, inputClass, useToast } from '@/components/ui';
import { fetchSources, fetchSubjects, sb } from '@/lib/data';
import { subjectVar } from '@/lib/colors';
import { pickerOrder } from '@/lib/subject-order';
import { SUBJECT_COLORS } from '@/lib/settings';
import type { ChatSolution } from '@/lib/chat';
import type { SubjectRow } from '@/lib/types';

export type SavedPlace = { noteTitle: string; sourceId: string };

type NoteItem = { noteId: string; sourceId: string; title: string; unit: string };

const NEW = '__new__';
const ALL = '__all__';
/** 새 과목에는 노트가 없다 (그릴 때마다 새 배열을 만들지 않게) */
const NO_NOTES: NoteItem[] = [];

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** 이름이 서로 들어 있으면 같은 것으로 본다 ('수학' ↔ '수학 I', '이차함수' ↔ '2. 이차함수') */
function sameName(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

export function SaveProblemSheet({ solution, onClose, onSaved }: { solution: ChatSolution | null; onClose: () => void; onSaved: (p: SavedPlace) => void }) {
  const { me } = useMe();
  const toast = useToast();
  const open = !!solution?.question;
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [newSubject, setNewSubject] = useState('');
  /** 읽은 노트 목록과 그 과목 (과목을 바꾸면 그 과목의 것을 다시 읽는다) */
  const [loaded, setLoaded] = useState<{ subjectId: string; items: NoteItem[] } | null>(null);
  const [unit, setUnit] = useState<string>(ALL);
  const [newUnit, setNewUnit] = useState('');
  const [noteId, setNoteId] = useState<string>('');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  // 다른 문제로 열면 고른 것을 처음으로 (AI 가 짐작한 단원·이름을 미리 적어 둔다)
  const [prev, setPrev] = useState<ChatSolution | null>(null);
  if (solution !== prev) {
    setPrev(solution);
    if (solution) {
      setSubjects(null);
      setSubjectId('');
      setNewSubject(solution.subject ?? '');
      setLoaded(null);
      setUnit(ALL);
      setNewUnit(solution.unit ?? '');
      setNoteId('');
      setNewTitle(solution.unit ? `${solution.unit} 문제` : 'AI로 푼 문제');
    }
  }

  // 열 때마다 과목을 읽고, AI 가 짐작한 과목이 있으면 그것을 고른다. 없는 과목이면 그 이름으로 새 과목을 만들 준비를 한다
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchSubjects()
      .then((subs) => {
        if (!alive) return;
        setSubjects(subs);
        const named = (solution?.subject ?? '').trim();
        const guess = subs.find((s) => sameName(s.name, named));
        if (guess) setSubjectId(guess.id);
        else if (named || !subs.length) {
          setSubjectId(NEW);
          setUnit(NEW);
          setNoteId(NEW);
        } else setSubjectId((pickerOrder(subs)[0] ?? subs[0]).id);
      })
      .catch(() => alive && setSubjects([]));
    return () => {
      alive = false;
    };
  }, [open, solution]);

  // 과목을 고르면 그 과목의 노트(정리가 끝난 것)와 단원을 읽는다
  useEffect(() => {
    if (!open || !subjectId || subjectId === NEW) return;
    let alive = true;
    (async () => {
      const rows = (await fetchSources({ subjectId })).filter((r) => r.status === 'ready');
      const ids = rows.map((r) => r.id);
      const byNote = new Map<string, { id: string; title: string }>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await sb()
          .from('notes')
          .select('id, source_id, title')
          .in('source_id', ids.slice(i, i + 100));
        for (const n of data ?? []) byNote.set(n.source_id as string, { id: n.id as string, title: (n.title as string) || '' });
      }
      const items: NoteItem[] = rows
        .filter((r) => byNote.has(r.id))
        .map((r) => ({ noteId: byNote.get(r.id)!.id, sourceId: r.id, title: r.title || byNote.get(r.id)!.title || '제목 없는 노트', unit: r.unit ?? '' }));
      if (!alive) return;
      setLoaded({ subjectId, items });
      // AI 가 짐작한 단원이 있으면 그 단원, 노트는 그 단원의 가장 최근 노트
      const units = [...new Set(items.map((n) => n.unit).filter(Boolean))];
      const u = units.find((x) => sameName(x, solution?.unit ?? ''));
      setUnit(u ?? ALL);
      const first = items.find((n) => !u || n.unit === u);
      setNoteId(first?.noteId ?? NEW);
    })().catch(() => alive && setLoaded({ subjectId, items: [] }));
    return () => {
      alive = false;
    };
  }, [open, subjectId, solution]);

  const newSubjectPicked = subjectId === NEW;
  const notes = newSubjectPicked ? NO_NOTES : loaded && loaded.subjectId === subjectId ? loaded.items : null;
  const units = useMemo(() => [...new Set((notes ?? []).map((n) => n.unit).filter(Boolean))], [notes]);
  const shown = useMemo(() => (notes ?? []).filter((n) => unit === ALL || unit === NEW || n.unit === unit), [notes, unit]);
  const q = solution?.question ?? null;
  const makingNew = newSubjectPicked || unit === NEW || noteId === NEW;

  const pickSubject = (id: string) => {
    setSubjectId(id);
    if (id === NEW) {
      setUnit(NEW);
      setNoteId(NEW);
    }
  };

  const save = async () => {
    if (!q || !me || busy) return;
    if (!subjectId) return toast('과목을 골라 주세요.', 'bad');
    if (newSubjectPicked && !newSubject.trim()) return toast('새 과목 이름을 적어 주세요.', 'bad');
    setBusy(true);
    try {
      let target: NoteItem | undefined = (notes ?? []).find((n) => n.noteId === noteId);
      let sid = subjectId;
      if (newSubjectPicked) {
        // 새 과목 (다시 눌러도 둘이 생기지 않게 만든 과목을 바로 고른다)
        const name = newSubject.trim().slice(0, 40);
        const list = subjects ?? [];
        const color = SUBJECT_COLORS[list.length % SUBJECT_COLORS.length];
        const { data: made, error: sErr } = await sb().from('subjects').insert({ name, color, position: list.length }).select('*').single();
        if (sErr || !made) throw new Error(/kok_row_limit/.test(sErr?.message ?? '') ? '과목은 100개까지 만들 수 있어요.' : '과목을 만들지 못했어요.');
        sid = made.id as string;
        setSubjects([...list, made as SubjectRow]);
        setSubjectId(sid);
        setLoaded({ subjectId: sid, items: [] });
      }
      if (makingNew) {
        // 새 노트 (AI 없이, 에너지 0): 고른 단원으로
        const u = unit === NEW ? newUnit.trim() : unit === ALL ? (solution?.unit ?? '') : unit;
        const title = newTitle.trim() || 'AI로 푼 문제';
        const r = await api<{ id: string; noteId?: string }>('/api/notes/blank', { method: 'POST', body: JSON.stringify({ subjectId: sid, title, unit: u }) });
        if (!r.noteId) throw new Error('새 노트를 만들지 못했어요.');
        const made: NoteItem = { noteId: r.noteId, sourceId: r.id, title, unit: u };
        target = made;
        // 문제를 넣다가 실패해서 다시 눌러도 새 노트가 또 생기지 않게, 만든 노트를 목록에 넣고 고른다
        setLoaded((cur) => ({ subjectId: sid, items: [made, ...(cur && cur.subjectId === sid ? cur.items : [])] }));
        setUnit(u || ALL);
        setNoteId(made.noteId);
      }
      if (!target) throw new Error('노트를 골라 주세요.');
      const { data, error } = await sb()
        .from('questions')
        .insert({
          note_id: target.noteId,
          subject_id: sid,
          key_point_id: null,
          type: q.type,
          prompt: q.prompt,
          choices: q.choices,
          answer: q.answer,
          accepted: q.accepted,
          explanation: q.explanation,
          difficulty: q.difficulty,
          created_by: 'ai',
          // 노트 문제를 AI 로 다시 만들어도 지워지지 않게
          locked: true,
          ...(me.features.figures && solution ? { figure: solution.figure, steps: solution.steps.length ? solution.steps : null } : {}),
        })
        .select('id')
        .single();
      if (error || !data) throw new Error('문제를 넣지 못했어요.');
      const { error: cErr } = await sb().from('cards').insert({ question_id: data.id, subject_id: sid, due: new Date().toISOString() });
      if (cErr) {
        await sb().from('questions').delete().eq('id', data.id);
        throw new Error('복습 카드를 만들지 못했어요.');
      }
      onSaved({ noteTitle: target.title, sourceId: target.sourceId });
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="노트에 넣기"
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" busy={busy} disabled={!subjectId || (!makingNew && !noteId) || notes === null} onClick={save}>
            {makingNew ? '새 노트를 만들어 넣기' : '이 노트에 넣기'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
        </div>
      }
    >
      {q ? (
        <div className="grid gap-5">
          <div className="rounded-2xl bg-surface-2/70 p-3.5">
            <QuestionPreview q={{ ...q, figure: solution?.figure, steps: solution?.steps }} />
          </div>

          <section className="grid gap-2" aria-label="과목">
            <p className="text-sm font-bold">과목</p>
            {subjects === null ? (
              <div className="kok-shimmer h-9 w-2/3 rounded-full" />
            ) : (
              <>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="과목">
                  {/* 고정 → 최근 쓴 과목 (보관한 과목은 빼고, 고른 것은 남긴다) */}
                  {pickerOrder(subjects, subjectId).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={s.id === subjectId}
                      onClick={() => pickSubject(s.id)}
                      className={cx(
                        'press inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset',
                        s.id === subjectId ? 'bg-accent-soft text-accent ring-accent' : 'bg-surface text-ink ring-line hover:ring-accent',
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
                      {s.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={newSubjectPicked}
                    onClick={() => pickSubject(NEW)}
                    className={cx(
                      'press inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset',
                      newSubjectPicked ? 'bg-accent-soft text-accent ring-accent' : 'bg-surface text-ink ring-line hover:ring-accent',
                    )}
                  >
                    <Icon d={ICONS.plus} size={14} strokeWidth={2.4} />새 과목
                  </button>
                </div>
                {newSubjectPicked ? (
                  <input
                    aria-label="새 과목 이름"
                    className={inputClass}
                    placeholder="과목 이름 (예: 수학)"
                    value={newSubject}
                    maxLength={40}
                    onChange={(e) => setNewSubject(e.target.value)}
                  />
                ) : null}
              </>
            )}
          </section>

          {subjectId ? (
            <section className="grid gap-2" aria-label="단원">
              <p className="text-sm font-bold">단원</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="단원">
                {(newSubjectPicked ? [NEW] : [ALL, ...units, NEW]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    role="radio"
                    aria-checked={unit === u}
                    onClick={() => {
                      setUnit(u);
                      if (u === NEW) setNoteId(NEW);
                      else {
                        const first = (notes ?? []).find((n) => u === ALL || n.unit === u);
                        setNoteId(first?.noteId ?? NEW);
                      }
                    }}
                    className={cx(
                      'press inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-semibold ring-1 ring-inset',
                      unit === u ? 'kok-chip-on ring-transparent' : 'bg-surface text-ink ring-line hover:ring-accent',
                    )}
                  >
                    {u === NEW ? (
                      <>
                        <Icon d={ICONS.plus} size={14} strokeWidth={2.4} />새 단원
                      </>
                    ) : u === ALL ? (
                      '모든 단원'
                    ) : (
                      u
                    )}
                  </button>
                ))}
              </div>
              {unit === NEW ? (
                <input
                  aria-label="새 단원 이름"
                  className={inputClass}
                  placeholder="단원 이름 (예: 이차함수)"
                  value={newUnit}
                  maxLength={40}
                  onChange={(e) => setNewUnit(e.target.value)}
                />
              ) : null}
            </section>
          ) : null}

          {subjectId ? (
            <section className="grid gap-2" aria-label="노트">
              <p className="text-sm font-bold">노트</p>
              {notes === null ? (
                <div className="grid gap-2">
                  <div className="kok-shimmer h-12 rounded-2xl" />
                  <div className="kok-shimmer h-12 rounded-2xl" />
                </div>
              ) : (
                <div className="grid gap-1.5" role="radiogroup" aria-label="노트">
                  {unit !== NEW
                    ? shown.map((n) => (
                        <button
                          key={n.noteId}
                          type="button"
                          role="radio"
                          aria-checked={noteId === n.noteId}
                          onClick={() => setNoteId(n.noteId)}
                          className={cx(
                            'press flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left ring-1 ring-inset',
                            noteId === n.noteId ? 'bg-accent-soft ring-accent' : 'bg-surface ring-line hover:ring-accent',
                          )}
                        >
                          <span
                            className={cx(
                              'grid h-5 w-5 shrink-0 place-items-center rounded-full ring-2 ring-inset',
                              noteId === n.noteId ? 'bg-accent text-accent-ink ring-accent' : 'ring-line',
                            )}
                            aria-hidden="true"
                          >
                            {noteId === n.noteId ? <Icon d={ICONS.check} size={12} strokeWidth={3} /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold">{n.title}</span>
                            {n.unit ? <span className="block truncate text-xs text-muted">{n.unit}</span> : null}
                          </span>
                        </button>
                      ))
                    : null}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={makingNew}
                    onClick={() => setNoteId(NEW)}
                    className={cx(
                      'press flex items-center gap-3 rounded-2xl border border-dashed px-3.5 py-2.5 text-left',
                      makingNew ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent',
                    )}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true">
                      <Icon d={ICONS.plus} size={13} strokeWidth={2.6} />
                    </span>
                    <span className="text-[15px] font-semibold">새 노트 만들기</span>
                  </button>
                  {makingNew ? (
                    <input
                      aria-label="새 노트 이름"
                      className={inputClass}
                      placeholder="노트 이름"
                      value={newTitle}
                      maxLength={120}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  ) : null}
                  {!shown.length && unit !== NEW ? <p className="px-1 text-xs text-muted">이 단원에는 노트가 없어요. 새 노트를 만들어 넣을게요.</p> : null}
                </div>
              )}
            </section>
          ) : null}
          <p className="text-xs text-muted">넣은 문제는 오늘부터 복습에 나오고, AI가 노트 문제를 다시 만들어도 그대로 남아요.</p>
        </div>
      ) : null}
    </Sheet>
  );
}
