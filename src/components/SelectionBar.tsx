'use client';
// 여러 개 고르기: 카드를 꾹 누르면 고르기가 시작되고, 아래 띠에서 한꺼번에 바꾼다 (자료함 · 오답노트 · PDF 요약 목록이 같이 쓴다)
// - useMultiSelect: 고르는 중인지·고른 번호들. 고르는 동안 + 버튼을 숨기고(띠가 그 자리를 쓴다) Esc 로 끝낸다
// - SelectionBar: 아래 띠 (폰은 아래 메뉴 자리를 덮고, 넓은 화면은 가운데에 뜬다). 안에는 BarAction 만 넣는다
import { Children, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuickAdd } from './QuickAdd';
import { ICONS, Icon, Spinner, cx } from './ui';

export function useMultiSelect() {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const startSelect = useCallback((id?: string) => {
    setSelecting(true);
    setPicked(new Set(id ? [id] : []));
  }, []);
  const endSelect = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
  }, []);
  const togglePick = useCallback(
    (id: string) =>
      setPicked((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  // 고르는 동안 + 버튼은 숨기고(아래 띠가 그 자리를 쓴다), Esc 로 끝낸다
  const { setFabHidden } = useQuickAdd();
  useEffect(() => {
    if (!selecting) return;
    setFabHidden(true);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') endSelect();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      setFabHidden(false);
    };
  }, [selecting, setFabHidden, endSelect]);
  return { selecting, picked, setPicked, startSelect, endSelect, togglePick };
}

/**
 * 고르는 동안 카드 왼쪽 위 모서리에 걸친 동그라미 (고르면 채워지며 체크가 톡).
 * 카드 밖으로 반쯤 나와 있어서 카드 안의 글·단추는 그대로다 (고르기를 시작해도 카드 모양이 바뀌지 않게).
 * 부모는 relative, 카드를 자르지(overflow) 않는 칸이어야 한다
 */
export function PickBadge({ picked }: { picked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'kok-pick-badge kok-appear pointer-events-none absolute -left-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full transition-colors duration-150',
        picked ? 'bg-accent text-accent-ink' : 'bg-surface ring-2 ring-inset ring-line',
      )}
    >
      {picked ? <Icon key="on" d={ICONS.check} size={14} strokeWidth={3} className="kok-check-in" /> : null}
    </span>
  );
}

/** 고른 카드의 테두리 (카드 모양은 그대로, 바깥에 포인트 색 고리) */
export const PICKED_RING = 'ring-2 ring-accent ring-offset-2 ring-offset-bg';

/** 고른 칸의 키보드: 스페이스·엔터로 고른다 (role=checkbox) */
export function pickKeyHandler(onPick: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onPick();
    }
  };
}

/**
 * 여러 개 고르는 동안 아래 띠. 단추(BarAction)마다 한 칸씩 같은 너비로 나눈다
 * (폰은 아래 메뉴 자리를 덮고, 넓은 화면은 가운데에 뜬다: 엄지가 닿는 자리에 큰 단추)
 */
export function SelectionBar({ count, noun = '자료', children }: { count: number; noun?: string; children: ReactNode }) {
  const cols = Math.max(1, Children.toArray(children).filter(Boolean).length);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 md:bottom-6 md:left-60 md:flex md:justify-center">
      <div
        role="toolbar"
        aria-label={`고른 ${noun} ${count}개`}
        className={cx(
          'kok-selbar pointer-events-auto grid border-t border-line bg-surface px-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1.5 md:rounded-[24px] md:border md:pb-1.5 md:shadow-[0_12px_36px_var(--shadow-strong)]',
          cols >= 5 ? 'md:w-[520px]' : cols >= 3 ? 'md:w-[440px]' : 'md:w-[360px]',
        )}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
    </div>
  );
}

export function BarAction({
  icon,
  label,
  onClick,
  disabled,
  busy = false,
  danger,
  prominent,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy?: boolean;
  danger?: boolean;
  /** 띠에 단추가 하나뿐일 때: 가로로 긴 포인트 색 단추 (엄지 자리의 큰 단추 하나) */
  prominent?: boolean;
}) {
  if (prominent) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cx(
          'press mx-1.5 my-1 flex min-h-[52px] items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-opacity hover:brightness-110 disabled:opacity-45',
          danger ? 'bg-bad text-white' : 'bg-accent text-accent-ink',
        )}
      >
        {busy ? <Spinner /> : <Icon d={icon} size={20} strokeWidth={2.4} />}
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'press flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-[12px] font-semibold transition-opacity hover:bg-surface-2 disabled:opacity-40',
        danger ? 'text-bad' : 'text-ink',
      )}
    >
      <span className="grid h-6 place-items-center">{busy ? <Spinner /> : <Icon d={icon} size={22} />}</span>
      {label}
    </button>
  );
}
