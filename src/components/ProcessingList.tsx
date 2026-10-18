'use client';
// 처리 중인 자료: 진행 막대, 멈추면 이어서 하기, 실패하면 다시 하기
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SourceRowWithUnit } from '@/lib/data';
import { fetchSources } from '@/lib/data';
import { Button, Card, Chip, ProgressBar, api, useToast } from './ui';

export function stepLabel(s: Pick<SourceRowWithUnit, 'status' | 'step' | 'chunk_index' | 'chunk_total'>): string {
  if (s.status === 'error') return '멈췄어요';
  if (s.status === 'ready') return '완료';
  if (s.status === 'queued') return '준비 중';
  switch (s.step) {
    case 'organize':
      return s.chunk_total > 1 ? `정리 중 (${Math.min(s.chunk_index + 1, s.chunk_total)}/${s.chunk_total})` : '글자 읽고 정리하는 중';
    case 'merge':
      return '정리 합치는 중';
    case 'visual':
    case 'quiz':
    case 'check':
      return '마인드맵·문제 만드는 중';
    default:
      return '처리 중';
  }
}

const KIND_LABEL = { text: '글', pdf: 'PDF', image: '사진' } as const;

export function useActiveSources(subjectId?: string) {
  const [items, setItems] = useState<SourceRowWithUnit[] | null>(null);
  const [justDone, setJustDone] = useState<SourceRowWithUnit[]>([]);
  const prev = useRef<Map<string, string>>(new Map());
  const nudged = useRef<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    try {
      const rows = await fetchSources({ subjectId, active: true, limit: 20 });
      // 방금 끝난 자료 찾기
      const nowIds = new Set(rows.map((r) => r.id));
      const finished = [...prev.current.keys()].filter((id) => !nowIds.has(id));
      if (finished.length) {
        const all = await fetchSources({ subjectId, limit: 30 });
        setJustDone((d) => [...all.filter((r) => finished.includes(r.id) && r.status === 'ready'), ...d].slice(0, 5));
      }
      prev.current = new Map(rows.filter((r) => r.status !== 'error').map((r) => [r.id, r.status]));
      setItems(rows);
      // 멈춘 처리 이어서 하기 (화면이 열려 있을 때)
      for (const r of rows) {
        if (r.status !== 'queued' && r.status !== 'processing') continue;
        const lockedFree = !r.locked_until || Date.parse(r.locked_until) < Date.now();
        const stale = Date.now() - Date.parse(r.updated_at) > 45_000;
        const last = nudged.current.get(r.id) ?? 0;
        if (lockedFree && stale && Date.now() - last > 60_000) {
          nudged.current.set(r.id, Date.now());
          api(`/api/sources/${r.id}/process`, { method: 'POST', body: '{}' }).catch(() => {});
        }
      }
    } catch {
      setItems((x) => x ?? []);
    }
  }, [subjectId]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 4000);
    return () => clearInterval(t);
  }, [load]);

  return { items, justDone, reload: load };
}

export function ProcessingList({ items, justDone, reload }: ReturnType<typeof useActiveSources>) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items) return null;
  if (!items.length && !justDone.length) return null;
  return (
    <div className="grid gap-2">
      {justDone.map((s) => (
        <Link
          key={`done-${s.id}`}
          href={`/notes/${s.id}`}
          className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ok bg-ok-soft px-4 py-3"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold text-ok">정리 끝! 🎉</span>
            <span className="block truncate font-semibold">{s.title || '새 자료'}</span>
          </span>
          <span className="shrink-0 text-sm font-bold text-ok">보러 가기 →</span>
        </Link>
      ))}
      {items.map((s) => (
        <Card key={s.id} className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <Link href={`/notes/${s.id}`} className="min-w-0">
              <span className="block truncate font-semibold">{s.title || `${KIND_LABEL[s.kind]} 자료`}</span>
              <span className="text-sm text-muted">{stepLabel(s)}</span>
            </Link>
            <Chip tone={s.status === 'error' ? 'bad' : 'accent'}>{KIND_LABEL[s.kind]}</Chip>
          </div>
          {s.status === 'error' ? (
            <div className="grid gap-2">
              <p className="text-sm text-bad">{s.error ?? '정리하다가 멈췄어요.'} 쓴 에너지는 돌려줬어요.</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  busy={busy === s.id}
                  onClick={async () => {
                    setBusy(s.id);
                    try {
                      await api(`/api/sources/${s.id}/retry`, { method: 'POST', body: '{}' });
                      toast('다시 시작했어요.');
                      await reload();
                    } catch (e) {
                      toast((e as Error).message, 'bad');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  다시 하기
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm('이 자료를 지울까요?')) return;
                    try {
                      await api(`/api/sources/${s.id}`, { method: 'DELETE' });
                      await reload();
                    } catch (e) {
                      toast((e as Error).message, 'bad');
                    }
                  }}
                >
                  지우기
                </Button>
              </div>
            </div>
          ) : (
            <ProgressBar value={s.progress} label={`${s.title} 진행`} />
          )}
        </Card>
      ))}
    </div>
  );
}
