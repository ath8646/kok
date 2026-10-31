'use client';
// 자료함 과목 칩 줄의 차례 바꾸기: 칩을 꾹 누르면(손가락·마우스 모두 0.35초) 들려서 옆으로 끌어 놓는다.
// 키보드는 칩에서 Alt + ←/→ 로 한 칸씩 (칩은 탭 목록의 탭이라 스페이스·엔터는 그대로 과목 고르기).
// 끌고 나서 손을 떼면 브라우저가 누르기(click)도 보내서, 끈 뒤 잠깐은 그 칩의 누르기를 무시한다(blockClick).
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from './useReducedMotion';

/** 칩에 붙이는 것: 끌기 손잡이(누르기 듣기), 자리, 들렸는지, 끈 뒤 누르기 무시, 키보드 옮기기 */
export type ChipSortProps = {
  ref: (el: HTMLElement | null) => void;
  listeners: Record<string, unknown>;
  style: CSSProperties;
  dragging: boolean;
  /** 방금 끌었으면 true (그 누르기는 과목 고르기가 아니다) */
  blockClick: () => boolean;
  /** Alt + ←/→ */
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/** 옆으로만 움직인다 (칩 줄) */
const sideways: Modifier = ({ transform }) => ({ ...transform, y: 0 });

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 진동이 없는 기기 */
  }
}

export function ChipSort<T extends { id: string; name: string }>({
  items,
  enabled,
  onReorder,
  onMoved,
  children,
}: {
  items: T[];
  /** 끌 수 있는지 (자료를 읽는 중·고르는 중이면 끈다) */
  enabled: boolean;
  /** 새 차례 (칩 줄에 보이는 과목만) */
  onReorder: (ids: string[]) => void;
  /** 키보드로 옮긴 뒤 알릴 말 */
  onMoved?: (message: string) => void;
  children: (item: T, sort: ChipSortProps) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 350, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
  );
  const ids = items.map((i) => i.id);
  /** 방금 끌기를 마쳤다 (잠깐 뒤에 풀린다: 손을 뗄 때 오는 누르기를 무시) */
  const justDragged = useRef(false);
  const settle = () => {
    justDragged.current = true;
    window.setTimeout(() => {
      justDragged.current = false;
    }, 400);
  };
  const nameOf = (id: string | number) => `'${items.find((x) => x.id === String(id))?.name ?? '과목'}'`;
  const at = (id: string | number) => ids.indexOf(String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} 과목을 들었어요. 지금 ${at(active.id) + 1}번째예요.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)}: ${at(over.id) + 1}번째 자리예요.` : `${nameOf(active.id)}: 줄 밖이에요.`),
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} 과목을 ${at(over.id) + 1}번째에 놓았어요.` : `${nameOf(active.id)} 과목을 제자리에 놓았어요.`,
    onDragCancel: ({ active }) => `${nameOf(active.id)} 옮기기를 그만뒀어요.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    settle();
    if (!over || active.id === over.id) return;
    const from = at(active.id);
    const to = at(over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
    buzz(8);
  };
  const move = (id: string, dir: -1 | 1) => {
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    onReorder(arrayMove(ids, from, to));
    onMoved?.(`${nameOf(id)} 과목을 ${to + 1}번째로 옮겼어요.`);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[sideways]}
      // 끝에 아주 가까울 때만 줄을 넘긴다 (기본 20% 는 폰에서 셋째 칩이 벌써 그 안이라, 놓는 동안 줄이 밀려 엉뚱한 자리에 놓였다)
      autoScroll={{ threshold: { x: 0.08, y: 0 }, acceleration: 6 }}
      onDragStart={() => buzz(12)}
      onDragEnd={onDragEnd}
      onDragCancel={settle}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: '꾹 누른 채 옆으로 끌면 과목 차례가 바뀌어요. 키보드는 Alt와 왼쪽·오른쪽 화살표로 옮겨요.' },
      }}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy} disabled={!enabled}>
        {items.map((it) => (
          <ChipSortItem key={it.id} id={it.id} enabled={enabled} justDragged={justDragged} onMove={(dir) => move(it.id, dir)}>
            {(p) => children(it, p)}
          </ChipSortItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function ChipSortItem({
  id,
  enabled,
  justDragged,
  onMove,
  children,
}: {
  id: string;
  enabled: boolean;
  justDragged: React.RefObject<boolean>;
  onMove: (dir: -1 | 1) => void;
  children: (p: ChipSortProps) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled: !enabled,
    transition: reduced ? null : { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  });
  return children({
    ref: setNodeRef,
    listeners: enabled ? ((listeners ?? {}) as Record<string, unknown>) : {},
    style: {
      transform: CSS.Translate.toString(transform),
      transition: reduced ? undefined : transition,
      ...(isDragging ? { zIndex: 5, position: 'relative' } : null),
    },
    dragging: isDragging,
    blockClick: () => justDragged.current,
    onKeyDown: (e) => {
      if (!enabled || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      onMove(e.key === 'ArrowLeft' ? -1 : 1);
    },
  });
}
