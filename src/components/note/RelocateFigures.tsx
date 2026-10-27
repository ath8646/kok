'use client';
// 자료 그림 다시 찾기 (이미 만든 노트): 그림마다 서버에 한 번씩 물어(POST /api/notes/[id]/figures/relocate) 자리를 원본에서 다시 찾아 자른다.
// 그 쪽을 AI 가 한 장씩 보고 찾는 새 방법이라, 예전 방법으로 엉뚱한 곳을 자른 그림이 바로잡힌다. 끝내 못 찾은 그림은 노트에서 빠진다.
import { useRef, useState } from 'react';
import { ApiError, Button, Icon, Sheet, api } from '../ui';
import { ICONS } from '@/lib/icons';
import type { PageAnchor } from '@/lib/page-labels';

type Item = { id: string; title: string };
type Result = { id: string; title: string; outcome: 'found' | 'removed' | 'error'; text: string };
type Reply = { ok: true; outcome: 'found' | 'removed'; where?: string; rested?: number; anchors: PageAnchor[] };

/** 그림 하나가 아니라 계정·서비스 때문에 안 되는 것 (에너지·한도·AI 쉼·계정): 남은 그림도 안 되니 멈춘다 */
const STOP_STATUS = new Set([401, 402, 403, 429, 503]);

export function RelocateFiguresSheet({
  open,
  onClose,
  noteId,
  figures,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  noteId: string;
  figures: Item[];
  /** 하나라도 바꿨으면 끝날 때 (노트를 다시 읽는다) */
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'ask' | 'run' | 'done'>('ask');
  const [at, setAt] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const stop = useRef(false);
  // 다시 열 때마다 처음 화면 (닫을 때 지우면 닫히는 동안 바뀌어 보여서)
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setPhase('ask');
      setAt(0);
      setResults([]);
    }
  }

  const run = async () => {
    stop.current = false;
    setPhase('run');
    setResults([]);
    let anchors: PageAnchor[] = [];
    let changed = false;
    const out: Result[] = [];
    for (let i = 0; i < figures.length && !stop.current; i++) {
      const f = figures[i];
      setAt(i);
      try {
        const r = await api<Reply>(`/api/notes/${noteId}/figures/relocate`, { method: 'POST', body: JSON.stringify({ figure: f.id, anchors }) });
        anchors = r.anchors ?? anchors;
        changed = true;
        out.push(
          r.outcome === 'found'
            ? { id: f.id, title: f.title, outcome: 'found', text: r.where ? `${r.where}에서 다시 잘랐어요` : '다시 잘랐어요' }
            : {
                id: f.id,
                title: f.title,
                outcome: 'removed',
                text: `원본에서 찾지 못해 노트에서 뺐어요${r.rested ? ` (그림 문제 ${r.rested}개는 쉬게 했어요)` : ''}`,
              },
        );
      } catch (e) {
        out.push({ id: f.id, title: f.title, outcome: 'error', text: (e as Error).message });
        if (e instanceof ApiError && STOP_STATUS.has(e.status)) break;
      }
      setResults([...out]);
    }
    setPhase('done');
    if (changed) onDone();
  };

  const close = () => {
    // 찾는 중이면 지금 그림까지만 하고 멈춘다
    stop.current = true;
    onClose();
  };

  const found = results.filter((r) => r.outcome === 'found').length;
  const removed = results.filter((r) => r.outcome === 'removed').length;
  return (
    <Sheet
      open={open}
      onClose={close}
      title="자료 그림 다시 찾기"
      footer={
        phase === 'ask' ? (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={close}>
              취소
            </Button>
            <Button className="flex-1" onClick={run} disabled={!figures.length}>
              다시 찾기
            </Button>
          </div>
        ) : phase === 'run' ? (
          <Button variant="secondary" className="w-full" onClick={() => (stop.current = true)}>
            지금 그림까지만 하기
          </Button>
        ) : (
          <Button className="w-full" onClick={close}>
            확인
          </Button>
        )
      }
    >
      {phase === 'ask' ? (
        <div className="grid gap-3 text-[15px] leading-relaxed">
          <p>원본 파일에서 그림 {figures.length}개의 자리를 다시 찾아 잘라요. 그림이 있는 쪽을 AI가 한 장씩 보고 찾고, 없으면 앞뒤 쪽까지 찾아봐요.</p>
          <p className="text-sm text-muted">찾지 못한 그림은 노트에서 빼고, 그 그림으로 만든 문제는 쉬게 해요. 그림마다 번개가 조금 들어요.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {phase === 'run' ? (
            <div className="grid gap-2" aria-live="polite">
              <p className="text-sm font-semibold">
                그림 {Math.min(at + 1, figures.length)}/{figures.length} 찾는 중 · <span className="text-muted">{figures[at]?.title}</span>
              </p>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label="그림 다시 찾기"
                aria-valuemin={0}
                aria-valuemax={figures.length}
                aria-valuenow={results.length}
              >
                <div className="kok-bar h-full rounded-full bg-fab" style={{ width: `${(results.length / Math.max(1, figures.length)) * 100}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-sm font-semibold" aria-live="polite">
              {found ? `${found}개를 다시 잘랐어요.` : ''}
              {removed ? ` ${removed}개는 찾지 못해 뺐어요.` : ''}
              {!found && !removed ? '바뀐 그림이 없어요.' : ''}
            </p>
          )}
          {results.length ? (
            <ul className="grid gap-1.5" aria-label="그림마다 결과">
              {results.map((r) => (
                <li key={r.id} className="flex items-start gap-2.5 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm">
                  <span className={r.outcome === 'found' ? 'text-ok' : r.outcome === 'removed' ? 'text-muted' : 'text-bad'} aria-hidden="true">
                    <Icon d={r.outcome === 'found' ? ICONS.check : r.outcome === 'removed' ? ICONS.trash : ICONS.close} size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="block text-muted">{r.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
