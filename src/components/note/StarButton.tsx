'use client';
// 별표 버튼: 켜면 별이 튀어 오르고 작은 빛이 퍼진다 (transform·opacity 만, 300ms 안. 움직임 줄이기면 바로 바뀐다).
// 채운 별은 별표 빛 두 색(--glow-star-1 → --glow-star-2) 그라데이션이다 (테마에서 색을 고른다).
import { useId, useState, type CSSProperties } from 'react';
import { cx } from '@/components/ui';

const STAR = 'M12 3.3l2.65 5.5 6.05.85-4.4 4.2 1.08 6L12 17l-5.38 2.85 1.08-6-4.4-4.2 6.05-.85z';

export function StarGlyph({ on, size = 22, className }: { on: boolean; size?: number; className?: string }) {
  // 별마다 그라데이션 번호 (useId 의 글자 중 SVG 주소에 쓰기 어려운 것은 뺀다)
  const gid = `kok-sg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" className={cx('kok-star', on && 'is-on', className)}>
      {on ? (
        <defs>
          <linearGradient id={gid} x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--glow-star-1)' }} />
            <stop offset="1" style={{ stopColor: 'var(--glow-star-2)' }} />
          </linearGradient>
        </defs>
      ) : null}
      <path d={STAR} strokeWidth={1.75} strokeLinejoin="round" style={on ? { fill: `url(#${gid})` } : undefined} />
    </svg>
  );
}

export function StarButton({
  on,
  onToggle,
  label,
  className,
  small = false,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
  /** 자료함 카드 모서리처럼 좁은 곳 (32px 버튼, 18px 별) */
  small?: boolean;
}) {
  // 켤 때마다 늘어나는 수: 별과 빛을 새로 그려 움직임을 처음부터 다시 한다
  const [burst, setBurst] = useState(0);
  const popping = burst > 0 && on;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={on ? '별표 빼기' : '별표하기'}
      // 자리(absolute 등)는 className 으로. 없으면 relative (빛이 버튼 안에서 퍼지게)
      className={cx('press grid shrink-0 place-items-center rounded-full hover:bg-surface-2', small ? 'h-8 w-8' : 'h-10 w-10', className ?? 'relative')}
      onClick={(e) => {
        // 카드(링크) 안에 있어도 카드로 가지 않는다
        e.preventDefault();
        e.stopPropagation();
        if (!on) setBurst((b) => b + 1);
        onToggle();
      }}
    >
      <StarGlyph key={burst} on={on} size={small ? 18 : 22} className={popping ? 'is-pop' : undefined} />
      {popping ? (
        <span key={`burst-${burst}`} className="kok-burst" aria-hidden="true">
          <span className="kok-burst-ring" />
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="kok-burst-dot" style={{ '--a': `${i * 45 + 22.5}deg` } as CSSProperties} />
          ))}
        </span>
      ) : null}
    </button>
  );
}
