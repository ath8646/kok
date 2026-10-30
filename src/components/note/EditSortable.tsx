'use client';
// 고치기 모드에서 카드를 끌어 순서 바꾸기: 카드 왼쪽 손잡이(⋮⋮)를 잡고 끈다.
// 마우스는 조금 끌면, 손가락은 손잡이를 꾹(0.22초) 누르면 들린다. 키보드는 손잡이에서 스페이스·엔터로 들고 화살표로 옮긴다.
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { cx } from '@/components/ui';
import { useReducedMotion } from '@/components/useReducedMotion';

/** 위아래로만, 목록 안에서만 움직인다 */
const inList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  const t = { ...transform, x: 0 };
  if (!draggingNodeRect || !containerNodeRect) return t;
  if (draggingNodeRect.top + t.y < containerNodeRect.top) t.y = containerNodeRect.top - draggingNodeRect.top;
  else if (draggingNodeRect.bottom + t.y > containerNodeRect.bottom) t.y = containerNodeRect.bottom - draggingNodeRect.bottom;
  return t;
};

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 진동이 없는 기기 */
  }
}

const INSTRUCTIONS = '스페이스바나 엔터로 들고, 위아래 화살표로 옮긴 다음, 다시 스페이스바나 엔터로 놓아요. 그만두려면 Esc 를 눌러요.';

const GRIP_CLASS = 'kok-grip press grid h-9 w-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink';

/** 카드 하나: 손잡이(⋮⋮)는 여기서 만들어 render 에 넘긴다 (카드가 손잡이를 놓을 자리를 정한다) */
function Item({
  id,
  label,
  gripClass,
  children,
}: {
  id: string;
  label: string;
  gripClass?: string;
  children: (grip: ReactNode, dragging: boolean) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    attributes: { roleDescription: '옮길 수 있는 카드' },
    transition: reduced ? null : { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition: reduced ? undefined : transition };
  const grip = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      title="끌어서 순서 바꾸기"
      className={cx(GRIP_CLASS, gripClass)}
      onClick={(e) => e.stopPropagation()}
    >
      <svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round">
        <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
      </svg>
    </button>
  );
  return (
    // 카드 칸이 목록 바로 아래에 있어야 한다 (dnd-kit 이 끄는 칸의 부모를 '목록 안'으로 재서 그 안에서만 움직이게 한다)
    <div ref={setNodeRef} role="listitem" style={style} className={cx('kok-edit-item', isDragging && 'is-dragging')}>
      {children(grip, isDragging)}
    </div>
  );
}

/** 끌어서 순서를 바꾸는 카드 목록. keys: 카드마다 바뀌지 않는 이름 */
export function EditSortable<T>({
  items,
  keys,
  label,
  nameOf,
  gripLabel,
  gripClass,
  onMove,
  render,
  className = 'grid gap-3',
}: {
  items: T[];
  keys: string[];
  /** 목록 이름 (화면 읽기용) */
  label: string;
  nameOf: (item: T) => string;
  /** 손잡이 이름 (예: "'광합성' 옮기기") */
  gripLabel: (item: T, index: number) => string;
  gripClass?: string;
  onMove: (from: number, to: number) => void;
  /** grip: 카드 안 알맞은 자리에 놓을 손잡이 */
  render: (item: T, index: number, grip: ReactNode, dragging: boolean) => ReactNode;
  className?: string;
}) {
  const uid = useId();
  const dropAt = useRef<number | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const at = (id: UniqueIdentifier) => keys.indexOf(String(id));
  const name = (id: UniqueIdentifier) => {
    const i = at(id);
    const n = i >= 0 ? nameOf(items[i]).trim() : '';
    return n ? `'${n.length > 40 ? `${n.slice(0, 40)}…` : n}'` : '이 카드';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${name(active.id)} 들었어요. 지금 ${at(active.id) + 1}번째, 모두 ${keys.length}개예요.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)}: ${at(over.id) + 1}번째 자리예요.` : `${name(active.id)}: 목록 밖이에요.`),
    onDragEnd: ({ active, over }) =>
      over ? `${name(active.id)} ${(dropAt.current ?? at(over.id)) + 1}번째에 놓았어요.` : `${name(active.id)} 제자리에 놓았어요.`,
    onDragCancel: ({ active }) => `${name(active.id)} 옮기기를 그만뒀어요.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = at(active.id);
    const to = at(over.id);
    if (from < 0 || to < 0) return;
    dropAt.current = to;
    onMove(from, to);
    buzz(8);
  };
  return (
    <DndContext
      id={uid}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[inList]}
      onDragStart={() => {
        dropAt.current = null;
        // 끄는 동안 켜진 글 칸이 있으면 닫는다 (글 칸이 옮겨지며 커서를 잃지 않게)
        const el = document.activeElement as HTMLElement | null;
        if (el?.closest('.ProseMirror')) el.blur();
        buzz(12);
      }}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <div className={className} role="list" aria-label={label}>
          {items.map((it, i) => (
            <Item key={keys[i]} id={keys[i]} label={gripLabel(it, i)} gripClass={gripClass}>
              {(grip, dragging) => render(it, i, grip, dragging)}
            </Item>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
