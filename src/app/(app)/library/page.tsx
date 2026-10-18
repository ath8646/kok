'use client';
// 자료함: 과목 목록
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ProcessingList, useActiveSources } from '@/components/ProcessingList';
import { SubjectForm } from '@/components/SubjectForm';
import { Button, Card, EmptyState, LinkButton, Sheet, useToast } from '@/components/ui';
import { fetchAll, fetchSubjects, sb } from '@/lib/data';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { daysUntil } from '@/lib/time';

async function fetchLibrary() {
  const [subjects, srcs, qs] = await Promise.all([
    fetchSubjects(),
    fetchAll<{ subject_id: string }>((a, b) => sb().from('sources').select('subject_id').order('id').range(a, b)),
    fetchAll<{ subject_id: string }>((a, b) => sb().from('questions').select('subject_id').eq('status', 'active').order('id').range(a, b)),
  ]);
  const counts = new Map<string, { sources: number; questions: number }>();
  for (const s of subjects) counts.set(s.id, { sources: 0, questions: 0 });
  for (const r of srcs) {
    const c = counts.get(r.subject_id);
    if (c) c.sources += 1;
  }
  for (const r of qs) {
    const c = counts.get(r.subject_id);
    if (c) c.questions += 1;
  }
  return { subjects, counts };
}

export default function LibraryPage() {
  const toast = useToast();
  const active = useActiveSources();
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const [counts, setCounts] = useState<Map<string, { sources: number; questions: number }>>(new Map());
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    fetchLibrary()
      .then((r) => {
        if (!alive) return;
        setSubjects(r.subjects);
        setCounts(r.counts);
      })
      .catch(() => {
        if (!alive) return;
        toast('자료함을 불러오지 못했어요.', 'bad');
        setSubjects([]);
      });
    return () => {
      alive = false;
    };
  }, [version, active.justDone.length, toast]);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl">자료함</h1>
        <LinkButton href="/add">자료 넣기</LinkButton>
      </div>

      <ProcessingList {...active} />

      {subjects === null ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      ) : subjects.length === 0 ? (
        <EmptyState title="과목이 없어요" body="과목을 만들고 자료를 넣어 보세요." action={<Button onClick={() => setAdding(true)}>과목 만들기</Button>} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {subjects.map((s) => {
            const c = counts.get(s.id);
            const d = s.exam_date ? daysUntil(s.exam_date) : null;
            return (
              <Link key={s.id} href={`/library/${s.id}`}>
                <Card className="flex h-full items-center gap-3 hover:border-accent">
                  <span className="h-10 w-2 shrink-0 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-bold">{s.name}</span>
                    <span className="text-sm text-muted">
                      자료 {c?.sources ?? 0} · 문제 {c?.questions ?? 0}
                      {d !== null && d >= 0 ? ` · 시험 ${d === 0 ? 'D-DAY' : `D-${d}`}` : ''}
                    </span>
                  </span>
                  <span className="text-muted" aria-hidden="true">
                    ›
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {subjects && subjects.length ? (
        <Button variant="secondary" className="justify-self-start" onClick={() => setAdding(true)}>
          과목 추가
        </Button>
      ) : null}

      <Sheet open={adding} onClose={() => setAdding(false)} title="과목 만들기">
        <SubjectForm
          saving={saving}
          onCancel={() => setAdding(false)}
          onSave={async (d) => {
            setSaving(true);
            const { error } = await sb()
              .from('subjects')
              .insert({ name: d.name, color: d.color, exam_date: d.exam_date, position: subjects?.length ?? 0 });
            setSaving(false);
            if (error) toast('과목을 만들지 못했어요.', 'bad');
            else {
              setAdding(false);
              reload();
            }
          }}
        />
      </Sheet>
    </div>
  );
}
