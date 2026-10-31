'use client';
// 과목 이름·색 (자료함의 새 과목·과목 고치기)
import { useState } from 'react';
import { SUBJECT_COLORS } from '@/lib/settings';
import { SUBJECT_COLOR_LABEL, subjectVar } from '@/lib/colors';
import { Button, Field, cx, inputClass, radioKeys } from './ui';

export type SubjectDraft = { name: string; color: string };

export function SubjectForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<SubjectDraft>;
  onSave: (d: SubjectDraft) => void;
  onCancel?: () => void;
  saving?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? 'blue');
  const changed = !initial || name.trim() !== (initial.name ?? '') || color !== (initial.color ?? 'blue');
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave({ name: name.trim(), color });
      }}
    >
      <Field label="과목 이름" htmlFor="sf-name">
        <input id="sf-name" className={inputClass} value={name} maxLength={40} placeholder="예: 과학" onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="과목 색">
        {SUBJECT_COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={SUBJECT_COLOR_LABEL[c]}
            // 고른 색만 Tab 으로 들어간다 (목록에 없는 예전 색이면 첫 칸)
            tabIndex={color === c || (i === 0 && !(SUBJECT_COLORS as readonly string[]).includes(color)) ? 0 : -1}
            onClick={() => setColor(c)}
            onKeyDown={(e) => radioKeys(e, i, SUBJECT_COLORS.length, (n) => setColor(SUBJECT_COLORS[n]))}
            className={cx('h-9 w-9 rounded-full border-4', color === c ? 'border-ink' : 'border-transparent')}
            style={{ background: subjectVar(c) }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" busy={saving} disabled={!name.trim() || !changed}>
          저장
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
        ) : null}
      </div>
    </form>
  );
}
