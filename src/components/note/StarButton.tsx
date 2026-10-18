'use client';
// 별표 버튼: 켜면 별이 튀어 오르고 작은 빛이 퍼진다 (transform·opacity 만, 300ms 안. 움직임 줄이기면 바로 바뀐다)
import { useState, type CSSProperties } from 'react';
import { cx } from '@/components/ui';

const STAR = 'M12 3.3l2.65 5.5 6.05.85-4.4 4.2 1.08 6L12 17l-5.38 2.85 1.08-6-4.4-4.2 6.05-.85z';

export function StarGlyph({ on, size = 22, className }: { on: boolean; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" className={cx('kok-star', on && 'is-on', className)}>
      <path d={STAR} strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
}

export function StarButton({ on, onToggle, label, className }: { on: boolean; onToggle: () => void; label: string; className?: string }) {
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
      className={cx('press grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-surface-2', className ?? 'relative')}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) setBurst((b) => b + 1);
        onToggle();
      }}
    >
      <StarGlyph key={burst} on={on} className={popping ? 'is-pop' : undefined} />
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
