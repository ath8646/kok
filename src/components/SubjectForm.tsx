'use client';
import { useState } from 'react';
import { SUBJECT_COLORS } from '@/lib/settings';
import { SUBJECT_COLOR_LABEL, subjectVar } from '@/lib/colors';
import { Button, Field, cx, inputClass } from './ui';
import { DatePicker } from './DatePicker';

export type SubjectDraft = { name: string; color: string; exam_date: string | null };

export function SubjectForm({
  initial,
  onSave,
  onCancel,
  saving,
  withExam = true,
}: {
  initial?: Partial<SubjectDraft>;
  onSave: (d: SubjectDraft) => void;
  onCancel?: () => void;
  saving?: boolean;
  withExam?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? 'blue');
  const [exam, setExam] = useState(initial?.exam_date ?? '');
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave({ name: name.trim(), color, exam_date: exam || null });
      }}
    >
      <Field label="과목 이름" htmlFor="sf-name">
        <input id="sf-name" className={inputClass} value={name} maxLength={40} placeholder="예: 과학" onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="과목 색">
        {SUBJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={SUBJECT_COLOR_LABEL[c]}
            onClick={() => setColor(c)}
            className={cx('h-9 w-9 rounded-full border-4', color === c ? 'border-ink' : 'border-transparent')}
            style={{ background: subjectVar(c) }}
          />
        ))}
      </div>
      {withExam ? (
        <Field
          label="시험 날짜 (넣으면 시험 모드가 켜져요)"
          htmlFor="sf-exam"
          hint="시험까지 모든 문제를 적어도 2번 보도록 일정을 당기고, 3일 전부터는 틀린 문제와 중요한 문제를 먼저 내요."
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <DatePicker id="sf-exam" label="시험 날짜" value={exam} onChange={setExam} dDay />
            </div>
            {exam ? (
              <Button variant="ghost" onClick={() => setExam('')}>
                지우기
              </Button>
            ) : null}
          </div>
        </Field>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" busy={saving} disabled={!name.trim()}>
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
