'use client';
// 끌어서 순서 바꾸기 (개념·공식·용어). 마우스는 조금 끌면, 손가락은 꾹(0.22초) 누르면 들린다.
// 키보드는 스페이스·엔터로 들고 화살표로 옮긴다. 화면 읽기 프로그램에는 한국어로 알려 준다.
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
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

function GripIcon() {
  return (
    <svg
      aria-hidden="true"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      className="shrink-0 text-muted"
    >
      <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
    </svg>
  );
}

function Row({ id, index, enter, children }: { id: string; index: number; enter: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    attributes: { roleDescription: '옮길 수 있는 줄' },
    transition: reduced ? null : { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  });
  const style = { transform: CSS.Translate.toString(transform), transition: reduced ? undefined : transition, '--i': index } as CSSProperties;
  // 목록 줄(li)은 그대로 두고, 잡는 곳(버튼 역할)은 안의 카드
  return (
    <li ref={setNodeRef} style={style} className={cx('kok-sort-row', enter && 'kok-sort-in', isDragging && 'is-dragging')}>
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="kok-sort-card flex min-h-14 items-center gap-3 rounded-[18px] bg-surface py-2.5 pl-3 pr-2.5 shadow-[0_1px_2px_var(--shadow)]"
      >
        {children}
        <GripIcon />
      </div>
    </li>
  );
}

/**
 * 순서를 바꿀 수 있는 목록. keyOf 가 없으면(공식·용어) 이 목록이 보이는 동안만 쓰는 번호를 붙여 같은 줄을 알아본다.
 * 놓으면 onReorder(새 순서) 를 부른다.
 */
export function SortList<T>({
  items,
  keyOf,
  label,
  nameOf,
  render,
  onReorder,
}: {
  items: T[];
  keyOf?: (item: T) => string;
  /** 목록 이름 (화면 읽기용) */
  label: string;
  /** 줄 이름 (화면 읽기 알림용) */
  nameOf: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  onReorder: (next: T[]) => void;
}) {
  const uid = useId();
  // keyOf 가 없을 때 쓰는 번호: 내가 옮기면 같이 옮기고, 밖에서 개수가 바뀌면 새로 붙인다
  const [own, setOwn] = useState(() => ({ items, keys: items.map((_, i) => `${uid}-0-${i}`), gen: 0 }));
  if (!keyOf && own.items !== items) {
    const keep = items.length === own.keys.length;
    setOwn({ items, keys: keep ? own.keys : items.map((_, i) => `${uid}-${own.gen + 1}-${i}`), gen: own.gen + 1 });
  }
  const keys = keyOf ? items.map(keyOf) : own.keys;
  const dropAt = useRef<number | null>(null);
  // 줄이 차례로 나타나는 움직임은 처음 한 번만 (옮긴 뒤 다시 그려질 때 깜빡이지 않게)
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 320);
    return () => clearTimeout(t);
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const at = (id: UniqueIdentifier) => keys.indexOf(String(id));
  const name = (id: UniqueIdentifier) => {
    const i = at(id);
    const n = i >= 0 ? nameOf(items[i]).trim() : '';
    return n ? `'${n.length > 40 ? `${n.slice(0, 40)}…` : n}'` : '이 줄';
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
    const next = arrayMove(items, from, to);
    if (!keyOf) setOwn({ items: next, keys: arrayMove(own.keys, from, to), gen: own.gen });
    onReorder(next);
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
        buzz(12);
      }}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ul className="grid gap-2" aria-label={label}>
          {items.map((it, i) => (
            <Row key={keys[i]} id={keys[i]} index={i} enter={!entered}>
              {render(it, i)}
            </Row>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
