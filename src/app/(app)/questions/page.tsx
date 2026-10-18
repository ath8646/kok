'use client';
// 문제 모아 보기: 과목·단원·유형·틀린 횟수로 거르기, 고치기·잠그기·쉬게 하기·지우기
import { useCallback, useEffect, useMemo, useState } from 'react';
import { QuestionList, type CardInfo } from '@/components/QuestionList';
import { Segmented, inputClass } from '@/components/ui';
import { fetchAll, fetchSubjects, sb } from '@/lib/data';
import type { QuestionRow, SubjectRow } from '@/lib/types';

const QCOLS =
  'id, note_id, subject_id, key_point_id, type, prompt, choices, answer, accepted, explanation, difficulty, pages, created_by, locked, edited, status, created_at';

export default function QuestionsPage() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[] | null>(null);
  const [cards, setCards] = useState<Map<string, CardInfo>>(new Map());
  const [unitOf, setUnitOf] = useState<Map<string, string>>(new Map());
  const [subject, setSubject] = useState(() => (typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('subject') ?? '')));
  const [unit, setUnit] = useState('');
  const [type, setType] = useState<'all' | 'mcq' | 'ox' | 'cloze' | 'short'>('all');
  const [wrong, setWrong] = useState<'all' | 'wrong' | 'resting'>('all');
  const [q, setQ] = useState('');

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchSubjects(),
      fetchAll<QuestionRow>((a, b) => sb().from('questions').select(QCOLS).order('created_at', { ascending: false }).order('id').range(a, b)),
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
  }, [version]);

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
    <div className="grid gap-4">
      <h1 className="font-display text-2xl">문제 모아 보기</h1>
      <div className="grid gap-2 rounded-2xl border border-line bg-surface p-3">
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="과목"
            className={inputClass}
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setUnit('');
            }}
          >
            <option value="">모든 과목</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select aria-label="단원" className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">모든 단원</option>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
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
        <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />
      ) : (
        <>
          <p className="text-sm text-muted">{filtered.length}문제</p>
          <QuestionList questions={filtered.slice(0, 300)} cards={cards} onChanged={load} emptyText="조건에 맞는 문제가 없어요." />
          {filtered.length > 300 ? <p className="text-sm text-muted">처음 300문제만 보여요. 조건을 좁혀 주세요.</p> : null}
        </>
      )}
    </div>
  );
}
