'use client';
// 가지 카드: 마인드맵의 1단계 가지마다 카드 한 장 (폰에서 읽기 쉽게). 아래 가지는 칩으로, 그 아래는 작은 글로.
// 카드를 누르면 가지 자세히 (노트 설명·문제 풀기·이전·다음 가지)
import type { CSSProperties } from 'react';
import type { Branch } from '@/lib/mindmap-branches';
import { MEMORY_LABEL, MEMORY_TONE, type MemoryInfo } from '@/lib/memory';
import { Chip, ICONS, Icon, cx } from '@/components/ui';

/** 기억 상태 칩 */
export function MemoryChip({ info, className }: { info: MemoryInfo; className?: string }) {
  return (
    <Chip tone={MEMORY_TONE[info.status]} className={cx('shrink-0 whitespace-nowrap', className)}>
      {MEMORY_LABEL[info.status]}
    </Chip>
  );
}

export function BranchCards({
  branches,
  colorOf,
  memory,
  icons,
  flash,
  highlight,
  onOpen,
}: {
  branches: Branch[];
  colorOf: (b: Branch) => string;
  memory?: Map<string, MemoryInfo>;
  icons: boolean;
  /** 한눈 지도에서 고른 가지 (잠깐 빛난다) */
  flash?: string | null;
  /** 고른 개념이 걸린 가지 (테두리로 계속 표시) */
  highlight?: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2" aria-label="가지 카드">
      {branches.map((b, i) => {
        const color = colorOf(b);
        const mem = b.keyPointId ? memory?.get(b.keyPointId) : undefined;
        return (
          <li key={b.id} id={`branch-${b.id}`} className="scroll-mt-28">
            <button
              type="button"
              onClick={() => onOpen(b.id)}
              className={cx(
                'kok-card kok-card-hover press kok-rise relative block h-full w-full overflow-hidden p-4 pl-5 text-left',
                highlight === b.id && 'shadow-[0_0_0_3px_var(--hl)]',
                flash === b.id && 'kok-branch-flash',
              )}
              style={{ '--br': color, ['--i' as string]: i } as CSSProperties}
            >
              <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} aria-hidden="true" />
              <span className="flex items-start gap-3">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-[20px] font-display"
                  style={{ background: `color-mix(in srgb, ${color} 15%, var(--surface))`, color }}
                  aria-hidden="true"
                >
                  {icons && b.icon ? b.icon : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[17px] leading-snug text-ink">{b.label}</span>
                  {b.hint ? (
                    <span className="mt-0.5 flex gap-1 text-sm leading-snug text-muted">
                      <Icon d={ICONS.bulb} size={15} className="mt-px shrink-0" />
                      <span className="min-w-0">{b.hint}</span>
                    </span>
                  ) : null}
                </span>
                {mem ? <MemoryChip info={mem} /> : null}
              </span>
              {b.children.length ? (
                <span className="mt-3 grid gap-1.5">
                  {b.children.map((c) => (
                    <span key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13.5px] font-semibold text-ink"
                        style={{ background: `color-mix(in srgb, ${color} 10%, var(--surface-2))` }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
                        {c.label}
                      </span>
                      {c.children.length ? (
                        <span className="min-w-0 text-[13px] leading-snug text-muted">
                          {c.children.map((g) => `${g.label}${g.children.length ? ` (+${g.children.length})` : ''}`).join(' · ')}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="mt-3 inline-flex items-center gap-0.5 text-sm font-bold" style={{ color }}>
                자세히 보기
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
