'use client';
// 과목 하나: 단원별 자료, 시험 날짜, 과목 고치기·지우기
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProcessingList, stepLabel, useActiveSources } from '@/components/ProcessingList';
import { SubjectForm } from '@/components/SubjectForm';
import { Button, Card, Chip, EmptyState, LinkButton, Sheet, api, inputClass, useToast } from '@/components/ui';
import { fetchSources, sb, type SourceRowWithUnit } from '@/lib/data';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { daysUntil } from '@/lib/time';

const KIND = { text: '✍️ 글', pdf: '📄 PDF', image: '📷 사진' } as const;

export default function SubjectPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const router = useRouter();
  const toast = useToast();
  const active = useActiveSources(subjectId);
  const [subject, setSubject] = useState<SubjectRow | null | undefined>(undefined);
  const [sources, setSources] = useState<SourceRowWithUnit[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState<SourceRowWithUnit | null>(null);
  const [unitText, setUnitText] = useState('');
  const [titleText, setTitleText] = useState('');

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await sb().from('subjects').select('id, name, color, exam_date, position, created_at').eq('id', subjectId).maybeSingle();
      const list = data ? await fetchSources({ subjectId }) : [];
      return { subject: (data as SubjectRow) ?? null, list };
    })()
      .then((r) => {
        if (!alive) return;
        setSubject(r.subject);
        setSources(r.list);
      })
      .catch(() => {
        if (alive) setSubject(null);
      });
    return () => {
      alive = false;
    };
  }, [subjectId, version, active.justDone.length]);

  const units = useMemo(() => {
    const m = new Map<string, SourceRowWithUnit[]>();
    for (const s of sources) {
      const u = s.unit?.trim() || '';
      m.set(u, [...(m.get(u) ?? []), s]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0], 'ko', { numeric: true })));
  }, [sources]);

  if (subject === undefined) return <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />;
  if (subject === null) return <EmptyState title="과목을 찾을 수 없어요" action={<LinkButton href="/library">자료함으로</LinkButton>} />;

  const d = subject.exam_date ? daysUntil(subject.exam_date) : null;

  return (
    <div className="grid gap-4">
      <Link href="/library" className="text-sm font-semibold text-muted">
        ‹ 자료함
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-8 w-2 rounded-full" style={{ background: subjectVar(subject.color) }} aria-hidden="true" />
        <h1 className="font-display text-2xl">{subject.name}</h1>
        {d !== null && d >= 0 ? <Chip tone={d <= 3 ? 'bad' : 'accent'}>시험 {d === 0 ? 'D-DAY' : `D-${d}`}</Chip> : null}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
          과목 고치기
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/add?subject=${subject.id}`}>자료 넣기</LinkButton>
        <LinkButton href={`/review?subject=${subject.id}`} variant="secondary">
          이 과목만 복습
        </LinkButton>
        <LinkButton href={`/questions?subject=${subject.id}`} variant="secondary">
          문제 모아 보기
        </LinkButton>
      </div>

      <ProcessingList {...active} />

      {sources.length === 0 ? (
        <EmptyState title="아직 자료가 없어요" body="교과서 사진, 학습지 PDF, 내가 쓴 필기를 넣어 보세요." />
      ) : (
        units.map(([unit, list]) => (
          <section key={unit || 'none'} className="grid gap-2">
            <h2 className="mt-2 font-display text-lg">{unit || '단원 없음'}</h2>
            {list.map((s) => (
              <Card key={s.id} className="flex items-center gap-3">
                <Link href={`/notes/${s.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.title || '제목 없는 자료'}</span>
                  <span className="text-sm text-muted">
                    {KIND[s.kind]}
                    {s.page_count ? ` · ${s.kind === 'image' ? `${s.page_count}장` : `${s.page_count}쪽`}` : ''} ·{' '}
                    {new Date(s.created_at).toLocaleDateString('ko-KR')}
                    {s.status !== 'ready' ? ` · ${stepLabel(s)}` : ''}
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMoving(s);
                    setUnitText(s.unit ?? '');
                    setTitleText(s.title ?? '');
                  }}
                >
                  이름·단원
                </Button>
              </Card>
            ))}
          </section>
        ))
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title="과목 고치기">
        <div className="grid gap-6">
          <SubjectForm
            initial={subject}
            saving={saving}
            onCancel={() => setEditing(false)}
            onSave={async (dft) => {
              setSaving(true);
              const { error } = await sb().from('subjects').update({ name: dft.name, color: dft.color, exam_date: dft.exam_date }).eq('id', subject.id);
              setSaving(false);
              if (error) toast('저장하지 못했어요.', 'bad');
              else {
                setEditing(false);
                load();
              }
            }}
          />
          <div className="border-t border-line pt-4">
            <Button
              variant="ghost"
              className="text-bad"
              onClick={async () => {
                if (!confirm(`'${subject.name}' 과목과 그 안의 자료·노트·문제·복습 기록을 모두 지울까요? 되돌릴 수 없어요.`)) return;
                try {
                  await api(`/api/subjects/${subject.id}`, { method: 'DELETE' });
                  router.replace('/library');
                } catch (e) {
                  toast((e as Error).message, 'bad');
                }
              }}
            >
              과목 지우기
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!moving} onClose={() => setMoving(null)} title="자료 이름·단원">
        {moving ? (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const { error } = await sb()
                .from('sources')
                .update({ title: titleText.trim().slice(0, 120), unit: unitText.trim().slice(0, 40) })
                .eq('id', moving.id);
              if (error) toast('저장하지 못했어요.', 'bad');
              else {
                setMoving(null);
                load();
              }
            }}
          >
            <label className="grid gap-1.5 text-sm font-semibold">
              자료 이름
              <input className={inputClass} value={titleText} maxLength={120} onChange={(e) => setTitleText(e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              단원 (같은 이름끼리 묶여요)
              <input className={inputClass} value={unitText} maxLength={40} list="unit-list" onChange={(e) => setUnitText(e.target.value)} />
              <datalist id="unit-list">{units.map(([u]) => (u ? <option key={u} value={u} /> : null))}</datalist>
            </label>
            <div className="flex gap-2">
              <Button type="submit">저장</Button>
              <Button
                variant="ghost"
                className="ml-auto text-bad"
                onClick={async () => {
                  if (!confirm('이 자료와 노트·문제를 지울까요?')) return;
                  try {
                    await api(`/api/sources/${moving.id}`, { method: 'DELETE' });
                    setMoving(null);
                    load();
                  } catch (err) {
                    toast((err as Error).message, 'bad');
                  }
                }}
              >
                자료 지우기
              </Button>
            </div>
          </form>
        ) : null}
      </Sheet>
    </div>
  );
}
