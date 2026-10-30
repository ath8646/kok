'use client';
// 고치기 모드의 글 칸 하나. 평소에는 보이는 그대로의 글(RichText)이고, 누르면 그 자리에서 편집기가 켜진다(누른 자리에 커서).
// 키보드(Tab)로 와도 켜진다. 편집기 조각은 처음 쓸 때 받는다 (읽기만 할 때는 받지 않는다).
import { lazy, Suspense } from 'react';
import { RichText } from '@/components/RichText';
import { cx } from '@/components/ui';
import { useEditSession } from './EditSession';

const RichEditor = lazy(() => import('./RichEditor'));

export function EditableRich({
  fieldKey,
  value,
  onCommit,
  onEmptyLeave,
  single = false,
  placeholder,
  label,
  className,
  maxLength = 3000,
}: {
  fieldKey: string;
  value: string;
  onCommit: (text: string) => void;
  onEmptyLeave?: () => void;
  single?: boolean;
  placeholder: string;
  /** 화면 읽기 프로그램이 읽을 칸 이름 */
  label: string;
  /** 읽을 때와 같은 글자 모양 (크기·굵기·줄 간격) */
  className?: string;
  maxLength?: number;
}) {
  const session = useEditSession();
  const active = session.activeKey === fieldKey;
  const empty = !value.trim();

  const view = (
    <div
      data-field-key={fieldKey}
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline={!single}
      aria-placeholder={placeholder}
      className={cx('kok-field', empty && 'is-empty', className)}
      // 누르는 순간 초점이 이 칸으로 오지 않게 (누른 자리를 받아 편집기를 켠다)
      onPointerDown={(e) => {
        if (e.button === 0) e.preventDefault();
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        e.stopPropagation();
        session.activate(fieldKey, { x: e.clientX, y: e.clientY });
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget) session.activate(fieldKey, 'end');
      }}
      onKeyDown={(e) => {
        // 켜지기 전에 친 글자는 버리지 않게 바로 켠다
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          session.activate(fieldKey, 'end');
        }
      }}
    >
      {empty ? (
        <span className="kok-field-placeholder" aria-hidden="true">
          {placeholder}
        </span>
      ) : (
        <RichText text={value} />
      )}
    </div>
  );

  if (!active) return view;
  return (
    <Suspense fallback={view}>
      <RichEditor
        fieldKey={fieldKey}
        initial={value}
        single={single}
        placeholder={placeholder}
        label={label}
        className={className}
        maxLength={maxLength}
        onCommit={onCommit}
        onEmptyLeave={onEmptyLeave}
      />
    </Suspense>
  );
}
