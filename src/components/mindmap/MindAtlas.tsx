'use client';
// 한눈 지도: 가운데 주제 둘레에 1단계 가지를 궤도처럼 놓은 작은 그림. 폰에서도 한 화면에 노트 전체 모양이 보인다.
// 가지를 누르면 그 가지 카드로 간다. 가지 모서리의 점은 기억 상태 (헷갈려요·복습할 때·잘 기억해요)
import { useMemo } from 'react';
import type { Branch } from '@/lib/mindmap-branches';
import { MEMORY_TONE, type MemoryInfo } from '@/lib/memory';
import { textWidth } from '@/lib/mindmap-layout';
import { cx } from '@/components/ui';

const W = 360;
const FONT = 13.5;
const TONE_COLOR = { bad: 'var(--bad)', warn: 'var(--warn)', ok: 'var(--ok)', plain: 'transparent' } as const;

/** 긴 이름은 줄인다 (지도에서는 짧게, 카드에서 다 보인다) */
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
  className?: string;
}) {
  const n = branches.length;
  const H = n <= 3 ? 220 : n <= 6 ? 276 : 316;
  const cx0 = W / 2;
  const cy0 = H / 2;
  const R0 = 44;

  const pills = useMemo(() => {
    const start = n === 2 ? Math.PI : -Math.PI / 2;
    return branches.map((b, i) => {
      const text = `${icons && b.icon ? `${b.icon} ` : ''}${short(b.label)}`;
      const w = Math.max(58, textWidth(text, FONT) + 26);
      const h = 34;
      const a = start + (i * Math.PI * 2) / Math.max(1, n);
      const rx = Math.min(126, W / 2 - w / 2 - 6);
      const ry = H / 2 - h / 2 - 8;
      let x = cx0 + Math.cos(a) * rx;
      let y = cy0 + Math.sin(a) * ry;
      x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x));
      y = Math.max(h / 2 + 4, Math.min(H - h / 2 - 4, y));
      // 가운데 원 가장자리에서 가지 쪽으로
      const dx = x - cx0;
      const dy = y - cy0;
      const len = Math.hypot(dx, dy) || 1;
      const sx = cx0 + (dx / len) * (R0 + 2);
      const sy = cy0 + (dy / len) * (R0 + 2);
      // 살짝 휜 선 (가운데에서 시계 방향으로 조금 비켜 간다)
      const mx = (sx + x) / 2 - (dy / len) * 14;
      const my = (sy + y) / 2 + (dx / len) * 14;
      return { b, text, w, h, x, y, path: `M${sx.toFixed(1)} ${sy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}` };
    });
  }, [branches, icons, n, H, cx0, cy0]);

  const lines = rootLines(rootLabel);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cx('block h-auto w-full', className)}
      role="group"
      aria-label={`한눈 지도: ${rootLabel}, 가지 ${n}개`}
      style={{ fontFamily: 'var(--font-sans, Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif)', maxHeight: 340 }}
    >
      {/* 궤도 */}
      <ellipse
        cx={cx0}
        cy={cy0}
        rx={Math.min(126, W / 2 - 40)}
        ry={H / 2 - 24}
        style={{ fill: 'none', stroke: 'var(--line)', strokeWidth: 1, strokeDasharray: '3 6' }}
      />
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
            aria-label={`${b.label}${mem ? `, ${mem.status === 'weak' ? '헷갈려요' : mem.status === 'due' ? '복습할 때예요' : mem.status === 'good' ? '잘 기억해요' : '아직 안 풀었어요'}` : ''}`}
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
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central" style={{ fill: 'var(--ink)', fontSize: FONT, fontWeight: 700 }}>
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
