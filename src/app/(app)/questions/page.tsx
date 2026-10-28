'use client';
// 문제 모아 보기: 과목·단원·유형·틀린 횟수로 거르기, 고치기·잠그기·쉬게 하기·지우기
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { QuestionList, type CardInfo } from '@/components/QuestionList';
import { Select } from '@/components/Select';
import { LargeHeader, Segmented, inputClass } from '@/components/ui';
import { fetchAll, fetchSubjects, questionCols, sb } from '@/lib/data';
import { pickerOrder } from '@/lib/subject-order';
import { useMe } from '@/components/AppShell';
import type { QuestionRow, SubjectRow } from '@/lib/types';

export default function QuestionsPage() {
  return (
    <Suspense fallback={null}>
      <QuestionsView />
    </Suspense>
  );
}

function QuestionsView() {
  // 자료함의 '문제 모아 보기'로 들어오면 그 과목 (다른 화면에서 눌러 들어오면 그리는 동안 window.location 이 아직 앞 화면 주소라 useSearchParams 로 읽는다)
  const params = useSearchParams();
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[] | null>(null);
  const [cards, setCards] = useState<Map<string, CardInfo>>(new Map());
  const [unitOf, setUnitOf] = useState<Map<string, string>>(new Map());
  const [subject, setSubject] = useState(() => params.get('subject') ?? '');
  const [unit, setUnit] = useState('');
  const [type, setType] = useState<'all' | 'mcq' | 'ox' | 'cloze' | 'short'>('all');
  const [wrong, setWrong] = useState<'all' | 'wrong' | 'resting'>('all');
  const [q, setQ] = useState('');

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  // 문제 그림 칸은 DB 에 있을 때만 읽는다 (내 정보를 받은 뒤에 읽기 시작)
  const { me } = useMe();
  const ready = !!me;
  const figuresOn = !!me?.features.figures;
  const sourceFiguresOn = !!me?.features.sourceFigures;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    Promise.all([
      fetchSubjects(),
      fetchAll<QuestionRow>(
        (a, b) =>
          sb()
            .from('questions')
            .select(questionCols({ figures: figuresOn, sourceFigures: sourceFiguresOn }))
            .neq('status', 'hidden')
            .order('created_at', { ascending: false })
            .order('id')
            .range(a, b) as unknown as PromiseLike<{ data: QuestionRow[] | null; error: unknown }>,
      ),
      fetchAll<{ question_id: string } & CardInfo>((a, b) =>
        sb().from('cards').select('question_id, lapses, wrong_count, in_wrong_note, due, reps').order('question_id').range(a, b),
      ),
      fetchAll<{ id: string; source_id: string }>((a, b) => sb().from('notes').select('id, source_id').order('id').range(a, b)),
      fetchAll<{ id: string; unit: string }>((a, b) => sb().from('sources').select('id, unit').order('id').range(a, b)),
    ])
      .then(([subs, qs, cs, ns, ss]) => {
        if (!alive) return;
        const unitBySource = new Map(ss.map((s) => [s.id, s.unit ?? '']));
        setUnitOf(new Map(ns.map((n) => [n.id, unitBySource.get(n.source_id) ?? ''])));
        setSubjects(subs);
        setQuestions(qs);
        setCards(new Map(cs.map((c) => [c.question_id, c])));
      })
      .catch(() => {
        if (alive) setQuestions([]);
      });
    return () => {
      alive = false;
    };
  }, [version, ready, figuresOn, sourceFiguresOn]);

  const units = useMemo(() => {
    const set = new Set<string>();
    for (const x of questions ?? []) {
      if (subject && x.subject_id !== subject) continue;
      const u = x.note_id ? unitOf.get(x.note_id) : '';
      if (u) set.add(u);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  }, [questions, subject, unitOf]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (questions ?? []).filter((x) => {
      if (subject && x.subject_id !== subject) return false;
      if (unit && (x.note_id ? unitOf.get(x.note_id) : '') !== unit) return false;
      if (type !== 'all' && x.type !== type) return false;
      const c = cards.get(x.id);
      if (wrong === 'wrong' && !(c && c.wrong_count > 0)) return false;
      if (wrong === 'resting' && x.status !== 'suspended') return false;
      if (term && !x.prompt.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [questions, subject, unit, type, wrong, q, cards, unitOf]);

  return (
    <div className="grid gap-3">
      <LargeHeader
        title="문제 모아 보기"
        subtitle={questions === null ? ' ' : `${filtered.length}문제`}
        back={{ href: subject ? `/library/${subject}` : '/library', label: '자료함으로' }}
      />
      <div className="kok-card grid gap-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="과목"
            // 주소로 고른 과목은 과목 목록을 읽기 전에는 빈칸 (읽기 전에 '모든 과목'이 잠깐 보였다가 바뀌지 않게)
            placeholder={questions === null && subject ? '' : undefined}
            value={subject}
            onChange={(v) => {
              setSubject(v);
              setUnit('');
            }}
            // 고정 → 최근 쓴 과목 → 보관한 과목 (보관한 과목의 문제도 볼 수 있게 맨 아래에)
            options={[
              { value: '', label: '모든 과목' },
              ...[...pickerOrder(subjects), ...subjects.filter((s) => s.archived)].map((s) => ({ value: s.id, label: s.archived ? `${s.name} (보관)` : s.name })),
            ]}
          />
          <Select
            aria-label="단원"
            value={unit}
            onChange={setUnit}
            options={[{ value: '', label: '모든 단원' }, ...units.map((u) => ({ value: u, label: u }))]}
          />
        </div>
        <Segmented
          label="유형"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: '전체' },
            { value: 'mcq', label: '객관식' },
            { value: 'ox', label: 'OX' },
            { value: 'cloze', label: '빈칸' },
            { value: 'short', label: '단답' },
          ]}
        />
        <Segmented
          label="상태"
          value={wrong}
          onChange={setWrong}
          options={[
            { value: 'all', label: '모두' },
            { value: 'wrong', label: '틀린 적 있음' },
            { value: 'resting', label: '쉬는 중' },
          ]}
        />
        <input aria-label="문제 찾기" className={inputClass} placeholder="문제 글자로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {questions === null ? (
        // 읽는 동안의 자리: 조금 늦게 나타나 금방 읽히면 보이지 않는다
        <div className="kok-card kok-shimmer kok-skel h-40" aria-hidden="true" />
      ) : (
        <>
          <QuestionList questions={filtered.slice(0, 300)} cards={cards} onChanged={load} emptyText="조건에 맞는 문제가 없어요." />
          {filtered.length > 300 ? <p className="text-sm text-muted">처음 300문제만 보여요. 조건을 좁혀 주세요.</p> : null}
        </>
      )}
    </div>
  );
}
