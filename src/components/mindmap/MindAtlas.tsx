'use client';
// 한눈 지도: 가운데 주제 둘레에 1단계 가지를 궤도처럼 놓은 작은 그림. 폰에서도 한 화면에 노트 전체 모양이 보인다.
// 가지 수에 따라 모양이 바뀐다 (lib/mindmap-atlas.ts): 8개까지 한 겹 궤도, 16개까지 두 겹 궤도, 그보다 많으면 번호 붙은 '목차 지도'.
// 가지를 누르면 그 가지 카드로 간다. 가지 모서리의 점은 기억 상태 (헷갈려요·복습할 때·잘 기억해요)
import { useMemo } from 'react';
import type { Branch } from '@/lib/mindmap-branches';
import { MEMORY_LABEL, MEMORY_TONE, type MemoryInfo } from '@/lib/memory';
import { ATLAS_ROOT_R, ATLAS_W, atlasLayout, atlasMode, fitLabel, pillStyle, pillWidth } from '@/lib/mindmap-atlas';
import { cx } from '@/components/ui';

const W = ATLAS_W;
const TONE_COLOR = { bad: 'var(--bad)', warn: 'var(--warn)', ok: 'var(--ok)', plain: 'transparent' } as const;

/** 긴 이름은 줄인다 (가운데 주제) */
function short(s: string, max = 9): string {
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

/** 가운데 주제를 두 줄까지 나눈다 */
function rootLines(label: string): string[] {
  const chars = [...label];
  if (chars.length <= 6) return [label];
  const words = label.split(/\s+/);
  if (words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    return [short(words.slice(0, mid).join(' '), 7), short(words.slice(mid).join(' '), 7)];
  }
  return [chars.slice(0, 6).join(''), short(chars.slice(6).join(''), 6)];
}

const memoryText = (mem?: MemoryInfo) => (mem ? `, ${MEMORY_LABEL[mem.status]}` : '');

export function MindAtlas({
  rootLabel,
  branches,
  colorOf,
  memory,
  icons,
  active,
  step = false,
  onPick,
  onRoot,
  limit,
  className,
}: {
  rootLabel: string;
  branches: Branch[];
  colorOf: (b: Branch) => string;
  memory?: Map<string, MemoryInfo>;
  icons: boolean;
  /** 지금 보는 가지 (테두리로 표시) */
  active?: string | null;
  /** 펼치는 방식이 '한 가지씩'이면 가지가 차례로 나타난다 */
  step?: boolean;
  onPick: (id: string) => void;
  /** 가운데 주제를 누르면 (노트의 한눈에 보기: 그림 탭으로) */
  onRoot?: () => void;
  /** 목차 지도에서 보일 가지 수 (넘으면 '더 보기': 노트의 한눈에 보기) */
  limit?: number;
  className?: string;
}) {
  const n = branches.length;
  const mode = atlasMode(n);
  const style = pillStyle(n);
  const layout = useMemo(() => {
    // 목차 지도는 자리를 계산하지 않는다
    if (mode === 'index') return { H: 0, rings: [], pills: [], texts: [] as string[] };
    const texts = branches.map((b) => fitLabel(`${icons && b.icon ? `${b.icon} ` : ''}${b.label}`, style.font, style.chars));
    const l = atlasLayout(texts.map((t) => ({ w: pillWidth(t, style.font), h: style.h })));
    return { ...l, texts };
  }, [branches, icons, mode, style.font, style.chars, style.h]);
  const H = layout.H;
  const cx0 = W / 2;
  const cy0 = H / 2;
  const R0 = ATLAS_ROOT_R;

  const pills = useMemo(
    () =>
      layout.pills.map((_, i) => {
        const b = branches[i];
        const { x, y, w, h } = layout.pills[i];
        // 가운데 원 가장자리에서 가지 쪽으로
        const dx = x - cx0;
        const dy = y - cy0;
        const len = Math.hypot(dx, dy) || 1;
        const sx = cx0 + (dx / len) * (R0 + 2);
        const sy = cy0 + (dy / len) * (R0 + 2);
        // 살짝 휜 선 (가운데에서 시계 방향으로 조금 비켜 간다)
        const mx = (sx + x) / 2 - (dy / len) * 14;
        const my = (sy + y) / 2 + (dx / len) * 14;
        return {
          b,
          text: layout.texts[i],
          w,
          h,
          x,
          y,
          path: `M${sx.toFixed(1)} ${sy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`,
        };
      }),
    [branches, layout, cx0, cy0, R0],
  );

  if (mode === 'index') {
    return (
      <AtlasIndex
        rootLabel={rootLabel}
        branches={branches}
        colorOf={colorOf}
        memory={memory}
        icons={icons}
        active={active}
        step={step}
        onPick={onPick}
        onRoot={onRoot}
        limit={limit}
        className={className}
      />
    );
  }

  const lines = rootLines(rootLabel);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cx('block h-auto w-full', className)}
      role="group"
      aria-label={`한눈 지도: ${rootLabel}, 가지 ${n}개`}
      style={{
        fontFamily: 'var(--font-sans, Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif)',
        maxHeight: mode === 'rings' ? 460 : 340,
      }}
    >
      {/* 궤도 (두 겹이면 둘) */}
      {layout.rings.map((r, k) => (
        <ellipse key={k} cx={cx0} cy={cy0} rx={r.rx} ry={r.ry} style={{ fill: 'none', stroke: 'var(--line)', strokeWidth: 1, strokeDasharray: '3 6' }} />
      ))}
      {pills.map(({ b, path }, i) => (
        <path
          key={`l-${b.id}`}
          d={path}
          className={step ? 'mm-step' : undefined}
          style={{
            fill: 'none',
            stroke: colorOf(b),
            strokeOpacity: 0.55,
            strokeWidth: 3,
            strokeLinecap: 'round',
            animationDelay: step ? `${i * 60}ms` : undefined,
          }}
        />
      ))}
      {/* 가운데 주제 */}
      <g
        role={onRoot ? 'button' : undefined}
        tabIndex={onRoot ? 0 : undefined}
        aria-label={onRoot ? `${rootLabel} 마인드맵 크게 보기` : undefined}
        style={onRoot ? { cursor: 'pointer' } : undefined}
        onClick={onRoot}
        onKeyDown={
          onRoot
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRoot();
                }
              }
            : undefined
        }
      >
        <circle cx={cx0} cy={cy0} r={R0 + 7} style={{ fill: 'var(--surface-2)', opacity: 0.7 }} />
        <circle cx={cx0} cy={cy0} r={R0} style={{ fill: 'var(--surface)', stroke: 'var(--ink)', strokeWidth: 2 }} />
        {lines.map((l, k) => (
          <text
            key={k}
            x={cx0}
            y={cy0 + (k - (lines.length - 1) / 2) * 17}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fill: 'var(--ink)', fontSize: 14.5, fontWeight: 800 }}
          >
            {l}
          </text>
        ))}
      </g>
      {pills.map(({ b, text, w, h, x, y }, i) => {
        const color = colorOf(b);
        const mem = b.keyPointId ? memory?.get(b.keyPointId) : undefined;
        const tone = mem ? MEMORY_TONE[mem.status] : 'plain';
        const on = active === b.id;
        return (
          <g
            key={b.id}
            className={step ? 'mm-step' : undefined}
            style={{ cursor: 'pointer', animationDelay: step ? `${80 + i * 60}ms` : undefined }}
            role="button"
            tabIndex={0}
            aria-label={`${b.label}${memoryText(mem)}`}
            onClick={() => onPick(b.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick(b.id);
              }
            }}
          >
            {on ? (
              <rect
                x={x - w / 2 - 5}
                y={y - h / 2 - 5}
                width={w + 10}
                height={h + 10}
                rx={(h + 10) / 2}
                style={{ fill: 'none', stroke: 'var(--hl)', strokeWidth: 4 }}
              />
            ) : null}
            <rect
              x={x - w / 2}
              y={y - h / 2}
              width={w}
              height={h}
              rx={h / 2}
              style={{ fill: `color-mix(in srgb, ${color} 14%, var(--surface))`, stroke: color, strokeWidth: 2 }}
            />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central" style={{ fill: 'var(--ink)', fontSize: style.font, fontWeight: 700 }}>
              {text}
            </text>
            {tone !== 'plain' ? (
              <circle cx={x + w / 2 - 6} cy={y - h / 2 + 5} r={5} style={{ fill: TONE_COLOR[tone], stroke: 'var(--surface)', strokeWidth: 2 }} />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 목차 지도 (가지 17개부터): 궤도에 다 놓으면 겹쳐서 읽을 수 없으니, 가운데 주제 아래에 번호 붙은 가지를 두 줄(넓으면 세 줄)로.
 * 번호는 가지 차례(색과 같은 번호)라 거르기를 해도 바뀌지 않는다. 가지 모서리의 점은 기억 상태
 */
function AtlasIndex({
  rootLabel,
  branches,
  colorOf,
  memory,
  icons,
  active,
  step,
  onPick,
  onRoot,
  limit,
  className,
}: {
  rootLabel: string;
  branches: Branch[];
  colorOf: (b: Branch) => string;
  memory?: Map<string, MemoryInfo>;
  icons: boolean;
  active?: string | null;
  step: boolean;
  onPick: (id: string) => void;
  onRoot?: () => void;
  limit?: number;
  className?: string;
}) {
  const shown = limit ? branches.slice(0, limit) : branches;
  const more = branches.length - shown.length;
  return (
    <div className={cx('grid gap-2.5 p-1.5', className)} role="group" aria-label={`한눈 지도: ${rootLabel}, 가지 ${branches.length}개`}>
      <div className="flex justify-center">
        {onRoot ? (
          <button
            type="button"
            onClick={onRoot}
            className="press max-w-full truncate rounded-full border-2 border-ink bg-surface px-4 py-1.5 text-[15px] font-extrabold"
          >
            {rootLabel}
          </button>
        ) : (
          <p className="max-w-full truncate rounded-full border-2 border-ink bg-surface px-4 py-1.5 text-[15px] font-extrabold">{rootLabel}</p>
        )}
      </div>
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {shown.map((b, i) => {
          const color = colorOf(b);
          const mem = b.keyPointId ? memory?.get(b.keyPointId) : undefined;
          const tone = mem ? MEMORY_TONE[mem.status] : 'plain';
          return (
            <li key={b.id} className={step ? 'mm-step' : undefined} style={step ? { animationDelay: `${Math.min(i, 20) * 40}ms` } : undefined}>
              <button
                type="button"
                onClick={() => onPick(b.id)}
                aria-label={`${b.index + 1}. ${b.label}${memoryText(mem)}`}
                className={cx(
                  'press relative flex min-h-11 w-full items-center gap-2 rounded-xl border-2 px-2 py-1.5 text-left',
                  active === b.id && 'ring-4 ring-[var(--hl)]',
                )}
                style={{ borderColor: color, background: `color-mix(in srgb, ${color} 10%, var(--surface))` }}
              >
                <span
                  className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1 text-[11px] font-extrabold"
                  style={{ background: color, color: 'var(--surface)' }}
                  aria-hidden="true"
                >
                  {b.index + 1}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug">
                  {icons && b.icon ? `${b.icon} ` : ''}
                  {b.label}
                </span>
                {tone !== 'plain' ? (
                  <span
                    className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface"
                    style={{ background: TONE_COLOR[tone] }}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      {more > 0 && onRoot ? (
        <button type="button" onClick={onRoot} className="press mx-auto rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted">
          가지 {more}개 더 보기
        </button>
      ) : null}
    </div>
  );
}
