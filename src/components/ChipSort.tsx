'use client';
// 자료함 과목 칩 줄의 차례 바꾸기: 칩을 꾹 누르면(손가락 0.3초, 마우스는 누른 채 조금 끌면) 칩이 들려서 옆으로 끌어 놓는다.
// 크롬 탭 줄·트렐로처럼 검증된 방식으로 한다:
// - 들린 칩은 줄 밖의 맨 위 층(DragOverlay, body 에 붙임)에 그린 복사본이 손가락을 따라간다. 원래 칩은 자리 표시(흐리게)로 남아
//   새 자리로 미끄러지고, 옆 칩들이 비켜 준다. (예전처럼 줄 안의 칩을 끌면 칩이 줄을 늘려 줄이 끝없이 넘어가고 칩이 화면 밖으로 나갔다)
// - 들린 칩은 칩 줄이 보이는 칸 안에만 있다 (화면 밖으로 나가지 않는다, 위아래로도 움직이지 않는다)
// - 손가락이 줄의 왼쪽·오른쪽 끝에 가까우면 줄이 그쪽으로 천천히 넘어가고(끝에 가까울수록 빠르게), 칩이 끝나는 곳에서 멈춘다
// - 놓으면 들린 칩이 새 자리로 내려앉는 동안(0.18초) 화면은 새 차례를 먼저 보이고, 저장(자료함 전체를 다시 그림)은 그 뒤에 한다
// 키보드는 칩에서 Alt + ←/→ 로 한 칸씩 (칩은 탭 목록의 탭이라 스페이스·엔터는 그대로 과목 고르기).
// 끌고 나서 손을 떼면 브라우저가 누르기(click)도 보내서, 끈 뒤 잠깐은 그 칩의 누르기를 무시한다(blockClick).
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from './useReducedMotion';

/** 칩에 붙이는 것: 끌기 손잡이(누르기 듣기), 자리, 들렸는지, 끈 뒤 누르기 무시, 키보드 옮기기 */
export type ChipSortProps = {
  ref: (el: HTMLElement | null) => void;
  listeners: Record<string, unknown>;
  style: CSSProperties;
  /** 들려 있는 칩의 원래 자리 (흐린 자리 표시로 그린다) */
  dragging: boolean;
  /** 방금 끌었으면 true (그 누르기는 과목 고르기가 아니다) */
  blockClick: () => boolean;
  /** Alt + ←/→ */
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/** 들린 칩이 새 자리로 내려앉는 시간 (ms). 저장은 이 뒤에 한다 */
const DROP_MS = 180;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** 들린 칩과 줄 끝 사이의 여유 (px) */
const EDGE_PAD = 4;

/**
 * 들린 칩을 칩 줄이 보이는 칸 안에 둔다 (옆으로만). 줄의 칸을 모르면 화면 안에.
 * 부딪힘(어느 칩 자리인지)도 이 자리로 재서, 끝에 붙어 있는 동안 줄이 넘어가면 그 밑의 칩과 자리를 바꾼다
 */
function insideRow(row: RefObject<HTMLElement | null> | undefined): Modifier {
  return ({ transform, draggingNodeRect }) => {
    if (!draggingNodeRect) return { ...transform, y: 0 };
    const box = row?.current?.getBoundingClientRect();
    const left = Math.max(box ? box.left : 0, 0) + EDGE_PAD;
    const right = Math.min(box ? box.right : window.innerWidth, window.innerWidth) - EDGE_PAD;
    const min = left - draggingNodeRect.left;
    const max = Math.max(min, right - draggingNodeRect.right);
    return { ...transform, x: Math.min(Math.max(transform.x, min), max), y: 0 };
  };
}

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
  rowRef,
  onReorder,
  onMoved,
  lifted,
  children,
}: {
  items: T[];
  /** 끌 수 있는지 (자료를 읽는 중·고르는 중이면 끈다) */
  enabled: boolean;
  /** 칩 줄 (가로로 넘기는 칸): 들린 칩은 이 칸 안에만 있다 */
  rowRef?: RefObject<HTMLElement | null>;
  /** 새 차례 (칩 줄에 보이는 과목만). 놓은 칩이 내려앉은 뒤에 부른다 */
  onReorder: (ids: string[]) => void;
  /** 키보드로 옮긴 뒤 알릴 말 */
  onMoved?: (message: string) => void;
  /** 들린 칩의 모습 (누를 수 없는 복사본) */
  lifted: (item: T) => ReactNode;
  children: (item: T, sort: ChipSortProps) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const sensors = useSensors(
    // 마우스는 누른 채 조금(8px) 끌면 들린다 (크롬 탭 줄처럼: 그냥 누르면 과목 열기)
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // 손가락은 꾹(0.3초) 누르면 들린다. 그 전에 10px 넘게 움직이면 줄 넘기기(가로 스크롤)
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 10 } }),
  );

  // 놓은 차례를 저장하기 전까지 먼저 보인다 (부모의 차례가 그대로인 동안만: 부모가 새로 읽으면 그것을 따른다)
  const baseIds = items.map((i) => i.id);
  const baseKey = baseIds.join(',');
  const [pending, setPending] = useState<{ ids: string[]; from: string } | null>(null);
  const ids = pending && pending.from === baseKey ? pending.ids : baseIds;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const shown = ids.map((id) => byId.get(id)).filter((x): x is T => !!x);

  // 저장은 내려앉는 움직임이 끝난 뒤에 (자료함 전체를 다시 그리는 동안 움직임이 끊기지 않게). 화면을 떠나면 바로
  const flush = useRef<{ timer: number; ids: string[] } | null>(null);
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    onReorderRef.current = onReorder;
  });
  const saveNow = () => {
    const f = flush.current;
    if (!f) return;
    window.clearTimeout(f.timer);
    flush.current = null;
    onReorderRef.current(f.ids);
  };
  const saveSoon = (next: string[]) => {
    if (flush.current) window.clearTimeout(flush.current.timer);
    flush.current = { ids: next, timer: window.setTimeout(saveNow, reduced ? 0 : DROP_MS + 40) };
  };
  useEffect(
    () => () => {
      const f = flush.current;
      if (!f) return;
      window.clearTimeout(f.timer);
      flush.current = null;
      onReorderRef.current(f.ids);
    },
    [],
  );

  /** 방금 끌기를 마쳤다 (잠깐 뒤에 풀린다: 손을 뗄 때 오는 누르기를 무시) */
  const justDragged = useRef(false);
  const settle = () => {
    justDragged.current = true;
    window.setTimeout(() => {
      justDragged.current = false;
    }, 400);
  };
  const [activeId, setActiveId] = useState<string | null>(null);
  const nameOf = (id: UniqueIdentifier) => `'${byId.get(String(id))?.name ?? '과목'}'`;
  const at = (id: UniqueIdentifier) => ids.indexOf(String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} 과목을 들었어요. 지금 ${at(active.id) + 1}번째예요.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)}: ${at(over.id) + 1}번째 자리예요.` : `${nameOf(active.id)}: 줄 밖이에요.`),
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} 과목을 ${at(over.id) + 1}번째에 놓았어요.` : `${nameOf(active.id)} 과목을 제자리에 놓았어요.`,
    onDragCancel: ({ active }) => `${nameOf(active.id)} 옮기기를 그만뒀어요.`,
  };
  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    buzz(10);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    settle();
    if (!over || active.id === over.id) return;
    const from = at(active.id);
    const to = at(over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setPending({ ids: next, from: baseKey });
    saveSoon(next);
    buzz(6);
  };
  const onDragCancel = () => {
    setActiveId(null);
    settle();
  };
  const move = (id: string, dir: -1 | 1) => {
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = arrayMove(ids, from, to);
    setPending({ ids: next, from: baseKey });
    saveSoon(next);
    saveNow();
    onMoved?.(`${nameOf(id)} 과목을 ${to + 1}번째로 옮겼어요.`);
  };

  const modifiers = useMemo(() => [insideRow(rowRef)], [rowRef]);
  const dropAnimation: DropAnimation | null = reduced
    ? null
    : {
        duration: DROP_MS,
        easing: EASE_OUT,
        // 내려앉는 동안 원래 자리는 비워 둔다 (같은 칩이 두 개로 보이지 않게)
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
      };
  // 들린 칩의 모습: 이 컴포넌트가 다시 그려질 때만 새로 만든다 (손가락이 움직일 때는 DragOverlay 만 움직이고 안의 칩은 그대로)
  const activeItem = activeId ? byId.get(activeId) : undefined;
  const liftedChip = activeItem ? (
    <div className={reduced ? 'kok-chip-lifted' : 'kok-chip-lifted is-animated'} aria-hidden="true">
      {lifted(activeItem)}
    </div>
  ) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={modifiers}
      // 손가락이 줄 끝(폭의 15%)에 들어가면 줄이 넘어간다: 끝에 가까울수록 빠르게, 칩이 끝나면 멈춤 (위아래로는 넘기지 않는다)
      autoScroll={{ threshold: { x: 0.15, y: 0 }, acceleration: 5, interval: 8 }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: '꾹 누른 채 옆으로 끌면 과목 차례가 바뀌어요. 키보드는 Alt와 왼쪽·오른쪽 화살표로 옮겨요.' },
      }}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy} disabled={!enabled}>
        {shown.map((it) => (
          <ChipSortItem key={it.id} id={it.id} enabled={enabled} justDragged={justDragged} onMove={(dir) => move(it.id, dir)}>
            {(p) => children(it, p)}
          </ChipSortItem>
        ))}
      </SortableContext>
      {/* 들린 칩: 줄 밖 맨 위 층 (줄이 자르거나 늘어나지 않게 body 에) */}
      {typeof document !== 'undefined' ? createPortal(<DragOverlay dropAnimation={dropAnimation}>{liftedChip}</DragOverlay>, document.body) : null}
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
    transition: reduced ? null : { duration: 200, easing: EASE_OUT },
  });
  return children({
    ref: setNodeRef,
    listeners: enabled ? ((listeners ?? {}) as Record<string, unknown>) : {},
    style: {
      transform: CSS.Translate.toString(transform),
      transition: reduced ? undefined : transition,
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
