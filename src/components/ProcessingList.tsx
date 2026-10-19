'use client';
// 처리 중인 자료: 진행 막대, 멈추면 이어서 하기, 실패하면 다시 하기
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SourceRowWithUnit } from '@/lib/data';
import { fetchSources } from '@/lib/data';
import { SOURCES_CHANGED } from '@/lib/events';
import { dropView } from '@/lib/view-cache';
import { Button, ICONS, Icon, ProgressRing, api, cx, useToast } from './ui';

export function stepLabel(s: Pick<SourceRowWithUnit, 'status' | 'step' | 'chunk_index' | 'chunk_total' | 'progress'>): string {
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
      return '마인드맵·문제 만드는 중';
    case 'check':
      // 검사가 끝나면(91%~) Pro 는 문제 그림·단계 풀이를 만든다
      return s.progress >= 91 && s.progress < 100 ? '문제 그림·풀이 만드는 중' : '마인드맵·문제 만드는 중';
    default:
      return '처리 중';
  }
}

const KIND_LABEL = { text: '글', pdf: 'PDF', image: '사진' } as const;
const KIND_ICON = { text: ICONS.pen, pdf: ICONS.file, image: ICONS.image } as const;

export function useActiveSources(subjectId?: string) {
  const [items, setItems] = useState<SourceRowWithUnit[] | null>(null);
  const [justDone, setJustDone] = useState<SourceRowWithUnit[]>([]);
  /** 정리가 끝난 자료 수 (화면이 다시 불러올 때 쓴다) */
  const [doneCount, setDoneCount] = useState(0);
  const prev = useRef<Map<string, string>>(new Map());
  const nudged = useRef<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    try {
      const rows = await fetchSources({ subjectId, active: true, limit: 20 });
      // 방금 끝난 자료 찾기
      const nowIds = new Set(rows.map((r) => r.id));
      const finished = [...prev.current.keys()].filter((id) => !nowIds.has(id));
      if (finished.length) {
        // 기억해 둔 자료함 목록은 이제 옛것이다 (정리 중으로 보이지 않게)
        dropView();
        setDoneCount((c) => c + finished.length);
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

  return { items, justDone, doneCount, reload: load };
}

export function ProcessingList({ items, justDone, reload }: Pick<ReturnType<typeof useActiveSources>, 'items' | 'justDone' | 'reload'>) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items) return null;
  if (!items.length && !justDone.length) return null;
  return (
    <section className="grid gap-2" aria-label="정리 중인 자료">
      {justDone.map((s) => (
        <Link key={`done-${s.id}`} href={`/notes/${s.id}`} className="kok-new kok-card press flex items-center gap-3 p-3.5 pr-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ok-soft text-ok">
            <Icon d={ICONS.check} size={22} strokeWidth={2.6} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-ok">정리 끝!</span>
            <span className="block truncate font-semibold">{s.title || '새 자료'}</span>
          </span>
          <span className="shrink-0 text-sm font-bold text-accent">보러 가기</span>
        </Link>
      ))}
      {items.map((s) => {
        const failed = s.status === 'error';
        return (
          <div key={s.id} className={cx('kok-card kok-rise grid gap-2.5 p-3.5', failed && 'ring-2 ring-bad/30')}>
            <div className="flex items-center gap-3">
              {failed ? (
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-bad-soft text-bad">
                  <Icon d={ICONS.retry} size={20} />
                </span>
              ) : (
                <ProgressRing value={s.progress} size={44} stroke={5} label={`${s.title || '자료'} 진행`}>
                  <Icon d={KIND_ICON[s.kind]} size={16} className="text-muted" />
                </ProgressRing>
              )}
              <Link href={`/notes/${s.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.title || `${KIND_LABEL[s.kind]} 자료`}</span>
                <span className={cx('block truncate text-sm', failed ? 'text-bad' : 'text-muted')}>{stepLabel(s)}</span>
              </Link>
            </div>
            {failed ? (
              <div className="grid gap-2 pl-14">
                <p className="text-sm text-muted">{s.error ?? '정리하다가 멈췄어요.'} 쓴 에너지는 돌려줬어요.</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    busy={busy === s.id}
                    onClick={async () => {
                      setBusy(s.id);
                      try {
                        await api(`/api/sources/${s.id}/retry`, { method: 'POST', body: '{}' });
                        toast('다시 시작했어요.');
                        window.dispatchEvent(new Event(SOURCES_CHANGED));
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
                        window.dispatchEvent(new Event(SOURCES_CHANGED));
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
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
