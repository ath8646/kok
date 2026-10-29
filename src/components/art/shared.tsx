// 다시 그린 그림의 공통 조각: 색, 글꼴, 글자 테두리, 화살촉, 범례
import type { CSSProperties, ReactNode } from 'react';
import type { ArtTone, LegendItem } from '@/lib/art/spec';

/** 그림 글도 설정의 글꼴을 따른다 (글 자리는 textWidth 가 한글을 1em 으로 넉넉히 잡아서 다른 글꼴도 넘치지 않는다. 변수가 없는 곳 = 그림 파일로 저장할 때는 뒤의 글꼴) */
export const FONT = 'var(--font-sans, Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif)';

/**
 * 그림(SVG) 크기: 폭에 맞추되 넓은 화면에서는 460px 까지만 (360px 기준으로 그려서, 너무 키우면 글이 커진다).
 * maxHeight 가 있으면 높이도 그 안으로 (가운데 맞춤)
 */
export function svgStyle(maxHeight?: number): CSSProperties {
  return { display: 'block', width: '100%', height: 'auto', maxWidth: 460, margin: '0 auto', ...(maxHeight ? { maxHeight } : null) };
}

/** 색 이름 → 화면 색 변수 (밝은·어두운 화면, 테마를 따른다) */
export const TONE_VAR: Record<ArtTone, string> = {
  red: 'var(--bad)',
  orange: 'var(--b2)',
  yellow: 'var(--b8)',
  green: 'var(--b3)',
  teal: 'var(--b7)',
  blue: 'var(--b1)',
  navy: 'var(--b4)',
  purple: 'var(--b6)',
  pink: 'var(--b5)',
  gray: 'var(--muted)',
};

/** 그림 위 글자: 바탕색 테두리를 둘러 선·칠 위에서도 읽힌다 */
export function haloText(o: { size: number; weight?: number; color?: string; halo?: string; italic?: boolean }): CSSProperties {
  return {
    fill: o.color ?? 'var(--ink)',
    fontSize: o.size,
    fontWeight: o.weight ?? 600,
    fontStyle: o.italic ? 'italic' : undefined,
    stroke: o.halo ?? 'var(--surface)',
    strokeWidth: o.size >= 13 ? 4 : 3.4,
    strokeLinejoin: 'round',
    paintOrder: 'stroke',
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 끝 점(tip)에서 from 쪽으로 향한 화살촉 (닫힌 삼각형 길) */
export function arrowHead(from: { x: number; y: number }, tip: { x: number; y: number }, size = 8): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const w = size * 0.55;
  return `M${r1(tip.x)} ${r1(tip.y)}L${r1(bx - uy * w)} ${r1(by + ux * w)}L${r1(bx + uy * w)} ${r1(by - ux * w)}Z`;
}

/** 그림 아래 범례 (작은 색 표시 + 글) */
export function Legend({ items }: { items: LegendItem[] }) {
  if (!items.length) return null;
  return (
    <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: 'var(--muted)' }}>
      {items.map((l, i) => (
        <li key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Swatch tone={l.tone} kind={l.kind} />
          <span style={{ color: 'var(--ink)' }}>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Swatch({ tone, kind }: { tone: ArtTone; kind: 'area' | 'line' | 'dot' }) {
  const c = TONE_VAR[tone];
  return (
    <svg width={18} height={12} aria-hidden="true" style={{ flex: 'none' }}>
      {kind === 'area' ? <rect x={1} y={1} width={16} height={10} rx={3} style={{ fill: c, fillOpacity: 0.3, stroke: c, strokeWidth: 1.2 }} /> : null}
      {kind === 'line' ? <path d="M1 6H17" style={{ stroke: c, strokeWidth: 2.4, strokeLinecap: 'round' }} /> : null}
      {kind === 'dot' ? <circle cx={9} cy={6} r={4} style={{ fill: c }} /> : null}
    </svg>
  );
}

/** 그림 틀: 위에 그림 속 제목, 아래에 출처 줄 */
export function ArtFrame({
  title,
  notes,
  legend,
  className,
  children,
}: {
  title: string;
  notes: string;
  legend?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} style={{ fontFamily: FONT, color: 'var(--ink)' }}>
      {title ? <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, textAlign: 'center', lineHeight: 1.35, wordBreak: 'keep-all' }}>{title}</p> : null}
      {children}
      {legend}
      {notes ? <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--muted)', textAlign: 'right' }}>{notes}</p> : null}
    </div>
  );
}
