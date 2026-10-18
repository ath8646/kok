'use client';
// 자료를 정리하는 동안 보이는 화면 (진행 막대, 멈추면 이어서 하기)
import { useEffect, useRef, useState } from 'react';
import type { SourceRowWithUnit } from '@/lib/data';
import { stepLabel } from '../ProcessingList';
import { Button, Card, ICONS, Icon, ProgressRing, api, cx, useToast } from '../ui';

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
  const failed = source.status === 'error';
  return (
    <Card className="kok-rise grid gap-5 p-5">
      <div className="flex items-center gap-4">
        {failed ? (
          <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-bad-soft text-bad">
            <Icon d={ICONS.retry} size={30} />
          </span>
        ) : (
          <ProgressRing value={source.progress} size={72} stroke={7} label="정리 진행">
            <span className="font-display text-lg tabular-nums">{Math.round(source.progress)}%</span>
          </ProgressRing>
        )}
        <div className="min-w-0">
          <p className="font-display text-xl">{failed ? '정리하다가 멈췄어요' : 'AI가 정리하고 있어요'}</p>
          <p className="text-sm text-muted">{failed ? source.error : `${stepLabel(source)} · 화면을 닫아도 계속 진행해요.`}</p>
        </div>
      </div>
      <ol className="grid gap-0" aria-label="정리 단계">
        {STAGES.map((s, i) => {
          const done = i < idx;
          const now = i === idx && !failed;
          return (
            <li key={s} className="relative flex items-center gap-3 py-1.5">
              {i < STAGES.length - 1 ? (
                <span
                  className={cx('absolute left-[11px] top-[calc(50%+12px)] h-[calc(100%-24px)] w-0.5 rounded-full', done ? 'bg-ok' : 'bg-surface-3')}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={cx(
                  'relative grid h-6 w-6 shrink-0 place-items-center rounded-full',
                  done ? 'bg-ok text-white' : now ? 'bg-accent-soft ring-2 ring-fab ring-inset' : 'bg-surface-2',
                )}
                aria-hidden="true"
              >
                {done ? <Icon d={ICONS.check} size={13} strokeWidth={3} /> : now ? <span className="h-2 w-2 animate-pulse rounded-full bg-fab" /> : null}
              </span>
              <span className={cx('text-[15px]', done ? 'text-ink' : now ? 'font-bold text-accent' : 'text-muted')}>{s}</span>
            </li>
          );
        })}
      </ol>
      {failed ? (
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
        <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">기다리는 동안 오늘 복습을 먼저 해도 좋아요. 끝나면 홈에 알려 줄게요.</p>
      )}
    </Card>
  );
}
