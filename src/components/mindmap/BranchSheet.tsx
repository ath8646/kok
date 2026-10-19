'use client';
// 가지 자세히: 노트의 그 개념 설명·왜 중요한지·예·헷갈리는 점, 아래 가지, 기억 상태와 '이 개념 문제 풀기'.
// 아래의 이전·다음으로 가지를 차례로 넘겨 본다
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Note } from '@/lib/ai/schemas';
import type { Branch } from '@/lib/mindmap-branches';
import type { MemoryInfo } from '@/lib/memory';
import type { TreeNode } from '@/lib/mindmap-layout';
import { RichText } from '@/components/RichText';
import { Button, ICONS, Icon, Sheet, cx } from '@/components/ui';
import { MemoryChip } from './BranchCards';

function SubTree({ nodes, color, depth = 0 }: { nodes: TreeNode[]; color: string; depth?: number }) {
  if (!nodes.length) return null;
  return (
    <ul
      className={cx('grid gap-1.5', depth > 0 && 'mt-1.5 border-l-2 pl-3')}
      style={depth > 0 ? { borderColor: `color-mix(in srgb, ${color} 35%, transparent)` } : undefined}
    >
      {nodes.map((n) => (
        <li key={n.id}>
          <span className={cx('inline-flex items-center gap-1.5', depth === 0 ? 'text-[15px] font-semibold' : 'text-sm text-muted')}>
            {depth === 0 ? <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" /> : null}
            {n.label}
          </span>
          <SubTree nodes={n.children} color={color} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export function BranchSheet({
  branch,
  branches,
  color,
  note,
  memory,
  practiceHref,
  onShowInNote,
  onMove,
  onClose,
}: {
  branch: Branch | null;
  branches: Branch[];
  color: string;
  note: Note | null;
  memory?: MemoryInfo;
  /** 이 개념 문제 풀기 주소 (개념이 없거나 문제가 없으면 없음) */
  practiceHref?: string | null;
  /** 정리 탭에서 이 개념 보기 */
  onShowInNote?: (keyPointId: string) => void;
  onMove: (id: string) => void;
  onClose: () => void;
}) {
  const i = branch ? branches.findIndex((b) => b.id === branch.id) : -1;
  const prev = i > 0 ? branches[i - 1] : null;
  const next = i >= 0 && i < branches.length - 1 ? branches[i + 1] : null;
  const kp = branch?.keyPointId ? (note?.key_points.find((k) => k.id === branch.keyPointId) ?? null) : null;
  const examples = kp ? (note?.examples ?? []).filter((e) => e.key_point_id === kp.id).slice(0, 3) : [];
  const pitfalls = kp ? (note?.pitfalls ?? []).filter((p) => p.key_point_id === kp.id).slice(0, 3) : [];

  return (
    <Sheet
      open={!!branch}
      onClose={onClose}
      title={branch ? `${branch.icon ? `${branch.icon} ` : ''}${branch.label}` : ''}
      footer={
        branch ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="press inline-flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35"
              disabled={!prev}
              onClick={() => prev && onMove(prev.id)}
            >
              <Icon d={ICONS.back} size={17} />
              <span className="truncate">{prev ? prev.label : '이전 가지'}</span>
            </button>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
              {i + 1} / {branches.length}
            </span>
            <button
              type="button"
              className="press inline-flex h-11 min-w-0 flex-1 items-center justify-end gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35"
              disabled={!next}
              onClick={() => next && onMove(next.id)}
            >
              <span className="truncate">{next ? next.label : '다음 가지'}</span>
              <Icon d="M9 5l7 7-7 7" size={17} />
            </button>
          </div>
        ) : null
      }
    >
      {branch ? (
        <div key={branch.id} className="kok-step-next grid gap-4" style={{ '--br': color } as CSSProperties}>
          <div className="flex flex-wrap items-center gap-2">
            {memory ? <MemoryChip info={memory} /> : null}
            {memory ? (
              <span className="text-xs text-muted">
                문제 {memory.total}개{memory.wrong ? ` · 틀린 문제 ${memory.wrong}` : ''}
                {memory.due ? ` · 복습할 문제 ${memory.due}` : ''}
              </span>
            ) : null}
          </div>

          {branch.hint ? (
            <p
              className="rounded-2xl px-4 py-3 text-[15px] font-semibold leading-relaxed"
              style={{ background: `color-mix(in srgb, ${color} 12%, var(--surface))` }}
            >
              💡 {branch.hint}
            </p>
          ) : null}

          {kp ? (
            <section className="grid gap-1.5" aria-label="노트 설명">
              <p className="text-xs font-bold tracking-wide text-muted">노트 설명</p>
              <p className="text-[16px] font-bold leading-snug">
                <RichText text={kp.title} />
              </p>
              {kp.explanation ? (
                <p className="text-[15px] leading-relaxed">
                  <RichText text={kp.explanation} />
                </p>
              ) : null}
              {kp.why ? (
                <p className="text-sm leading-relaxed text-muted">
                  <b className="font-semibold text-ink">시험 포인트</b> <RichText text={kp.why} />
                </p>
              ) : null}
            </section>
          ) : null}

          {branch.children.length ? (
            <section className="grid gap-2" aria-label="아래 가지">
              <p className="text-xs font-bold tracking-wide text-muted">가지</p>
              <SubTree nodes={branch.children} color={color} />
            </section>
          ) : null}

          {examples.length ? (
            <section className="grid gap-1.5" aria-label="예">
              <p className="text-xs font-bold tracking-wide text-muted">예</p>
              {examples.map((e, k) => (
                <p key={k} className="rounded-xl bg-surface-2 px-3 py-2 text-sm leading-relaxed">
                  <RichText text={e.text} />
                </p>
              ))}
            </section>
          ) : null}
          {pitfalls.length ? (
            <section className="grid gap-1.5" aria-label="헷갈리는 점">
              <p className="text-xs font-bold tracking-wide text-bad">헷갈리는 점</p>
              {pitfalls.map((p, k) => (
                <p key={k} className="rounded-xl bg-bad-soft px-3 py-2 text-sm leading-relaxed">
                  <RichText text={p.text} />
                </p>
              ))}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {practiceHref ? (
              <Link href={practiceHref} className="press inline-flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-ink">
                <Icon d={ICONS.sparkle} size={17} strokeWidth={2.2} />이 개념 문제 풀기
              </Link>
            ) : null}
            {kp && onShowInNote ? (
              <Button variant="secondary" onClick={() => onShowInNote(kp.id)}>
                정리에서 보기
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
