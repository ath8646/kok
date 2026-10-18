'use client';
// 자료를 정리하는 동안 보이는 화면 (진행 막대, 멈추면 이어서 하기)
import { useEffect, useRef, useState } from 'react';
import type { SourceRowWithUnit } from '@/lib/data';
import { stepLabel } from '../ProcessingList';
import { Button, Card, ProgressBar, api, useToast } from '../ui';

const STAGES = ['올리기', '글자 읽기', '정리', '마인드맵·문제', '완료'];

function stageIndex(s: SourceRowWithUnit): number {
  if (s.status === 'ready') return 4;
  if (s.status === 'queued') return 1;
  if (s.step === 'organize' || s.step === 'merge') return 2;
  return 3;
}

export function ProcessingView({ source, onReload }: { source: SourceRowWithUnit; onReload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const nudged = useRef(0);

  // 3초마다 새로 읽고, 오래 멈춰 있으면 이어서 하라고 서버에 알린다
  useEffect(() => {
    if (source.status === 'error') return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') onReload();
    }, 3000);
    return () => clearInterval(t);
  }, [source.status, onReload]);

  useEffect(() => {
    if (source.status !== 'queued' && source.status !== 'processing') return;
    const lockedFree = !source.locked_until || Date.parse(source.locked_until) < Date.now();
    const stale = Date.now() - Date.parse(source.updated_at) > 45_000;
    if (lockedFree && stale && Date.now() - nudged.current > 60_000) {
      nudged.current = Date.now();
      api(`/api/sources/${source.id}/process`, { method: 'POST', body: '{}' }).catch(() => {});
    }
  }, [source]);

  const idx = stageIndex(source);
  return (
    <Card className="grid gap-4 p-5">
      <div>
        <p className="font-display text-xl">{source.status === 'error' ? '정리하다가 멈췄어요' : 'AI가 정리하고 있어요'}</p>
        <p className="text-sm text-muted">{source.status === 'error' ? source.error : `${stepLabel(source)} · 화면을 닫아도 계속 진행해요.`}</p>
      </div>
      {source.status !== 'error' ? <ProgressBar value={source.progress} label="정리 진행" /> : null}
      <ol className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
        {STAGES.map((s, i) => (
          <li key={s} className={i < idx ? 'text-ok' : i === idx ? 'font-bold text-accent' : 'text-muted'}>
            {i < idx ? '✓ ' : ''}
            {s}
            {i < STAGES.length - 1 ? <span className="ml-2 text-muted">→</span> : null}
          </li>
        ))}
      </ol>
      {source.status === 'error' ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted">쓴 에너지는 돌려줬어요.</p>
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/sources/${source.id}/retry`, { method: 'POST', body: '{}' });
                onReload();
              } catch (e) {
                toast((e as Error).message, 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            다시 하기
          </Button>
        </div>
      ) : (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">기다리는 동안 오늘 복습을 먼저 해도 좋아요. 끝나면 홈에 알려 줄게요.</p>
      )}
    </Card>
  );
}
