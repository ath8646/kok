'use client';
// 문제 직접 만들기·고치기
import { useState } from 'react';
import { Button, Field, Segmented, cx, inputClass } from './ui';

export type QuestionDraft = {
  type: 'mcq' | 'ox' | 'cloze' | 'short';
  prompt: string;
  choices: string[] | null;
  answer: number | boolean | string;
  accepted: string[];
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  key_point_id: string | null;
};

export function validateDraft(d: QuestionDraft): string | null {
  if (!d.prompt.trim()) return '문제를 적어 주세요.';
  if (d.prompt.length > 1000) return '문제가 너무 길어요 (1000자까지).';
  if (d.type === 'mcq') {
    const cs = (d.choices ?? []).map((c) => c.trim());
    if (cs.length < 2 || cs.some((c) => !c)) return '보기를 모두 채워 주세요 (2개 이상).';
    if (new Set(cs).size !== cs.length) return '같은 보기가 있어요.';
    if (typeof d.answer !== 'number' || d.answer < 0 || d.answer >= cs.length) return '정답 보기를 골라 주세요.';
  }
  if (d.type === 'cloze' && !/_{2,}/.test(d.prompt)) return '빈칸 문제는 가릴 곳에 ____ (밑줄 4개)를 넣어 주세요.';
  if ((d.type === 'cloze' || d.type === 'short') && !String(d.answer).trim()) return '정답을 적어 주세요.';
  return null;
}

export function QuestionEditor({
  initial,
  keyPoints,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<QuestionDraft>;
  keyPoints?: Array<{ id: string; title: string }>;
  onSave: (d: QuestionDraft) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [d, setD] = useState<QuestionDraft>({
    type: initial?.type ?? 'mcq',
    prompt: initial?.prompt ?? '',
    choices: initial?.choices ?? ['', '', '', ''],
    answer: initial?.answer ?? 0,
    accepted: initial?.accepted ?? [],
    explanation: initial?.explanation ?? '',
    difficulty: initial?.difficulty ?? 'medium',
    key_point_id: initial?.key_point_id ?? null,
  });
  const [err, setErr] = useState<string | null>(null);

  const setType = (type: QuestionDraft['type']) => {
    setD((x) => ({
      ...x,
      type,
      choices: type === 'mcq' ? (x.choices && x.choices.length >= 2 ? x.choices : ['', '', '', '']) : null,
      answer: type === 'mcq' ? 0 : type === 'ox' ? true : typeof x.answer === 'string' ? x.answer : '',
    }));
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const clean: QuestionDraft = {
          ...d,
          prompt: d.prompt.trim(),
          choices: d.type === 'mcq' ? (d.choices ?? []).map((c) => c.trim()) : null,
          answer: d.type === 'cloze' || d.type === 'short' ? String(d.answer).trim() : d.answer,
          accepted: d.accepted
            .map((a) => a.trim())
            .filter(Boolean)
            .slice(0, 10),
          explanation: d.explanation.trim(),
        };
        const msg = validateDraft(clean);
        setErr(msg);
        if (!msg) onSave(clean);
      }}
    >
      <Segmented
        label="문제 유형"
        value={d.type}
        onChange={setType}
        options={[
          { value: 'mcq', label: '객관식' },
          { value: 'ox', label: 'OX' },
          { value: 'cloze', label: '빈칸' },
          { value: 'short', label: '단답' },
        ]}
      />
      <Field label="문제" htmlFor="q-prompt" hint={d.type === 'cloze' ? '가릴 곳에 ____ 를 넣어요. 예: 광합성은 ____ 에서 일어난다.' : undefined}>
        <textarea
          id="q-prompt"
          className={cx(inputClass, 'min-h-24')}
          value={d.prompt}
          maxLength={1000}
          onChange={(e) => setD({ ...d, prompt: e.target.value })}
        />
      </Field>

      {d.type === 'mcq' ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">보기 (정답에 표시)</legend>
          {(d.choices ?? []).map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="q-answer"
                aria-label={`${i + 1}번이 정답`}
                checked={d.answer === i}
                onChange={() => setD({ ...d, answer: i })}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              <input
                aria-label={`보기 ${i + 1}`}
                className={inputClass}
                value={c}
                maxLength={300}
                onChange={(e) => setD({ ...d, choices: (d.choices ?? []).map((x, j) => (j === i ? e.target.value : x)) })}
              />
              {(d.choices ?? []).length > 2 ? (
                <button
                  type="button"
                  aria-label={`보기 ${i + 1} 지우기`}
                  className="rounded-lg px-2 py-1 text-bad hover:bg-bad-soft"
                  onClick={() => {
                    const cs = (d.choices ?? []).filter((_, j) => j !== i);
                    const a = typeof d.answer === 'number' ? (d.answer === i ? 0 : d.answer > i ? d.answer - 1 : d.answer) : 0;
                    setD({ ...d, choices: cs, answer: a });
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {(d.choices ?? []).length < 6 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="justify-self-start"
              onClick={() => setD({ ...d, choices: [...(d.choices ?? []), ''] })}
            >
              보기 추가
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      {d.type === 'ox' ? (
        <Field label="정답">
          <Segmented
            label="OX 정답"
            value={d.answer ? 'o' : 'x'}
            onChange={(v) => setD({ ...d, answer: v === 'o' })}
            options={[
              { value: 'o', label: 'O (맞다)' },
              { value: 'x', label: 'X (틀리다)' },
            ]}
          />
        </Field>
      ) : null}

      {d.type === 'cloze' || d.type === 'short' ? (
        <>
          <Field label="정답" htmlFor="q-answer">
            <input id="q-answer" className={inputClass} value={String(d.answer)} maxLength={200} onChange={(e) => setD({ ...d, answer: e.target.value })} />
          </Field>
          <Field label="같이 인정할 답 (쉼표로 나눠요)" htmlFor="q-accepted" hint="띄어쓰기·대소문자 차이는 자동으로 인정해요.">
            <input
              id="q-accepted"
              className={inputClass}
              value={d.accepted.join(', ')}
              maxLength={600}
              onChange={(e) => setD({ ...d, accepted: e.target.value.split(',').map((s) => s.trimStart()) })}
            />
          </Field>
        </>
      ) : null}

      <Field label="해설 (없어도 돼요)" htmlFor="q-exp">
        <textarea
          id="q-exp"
          className={cx(inputClass, 'min-h-20')}
          value={d.explanation}
          maxLength={2000}
          onChange={(e) => setD({ ...d, explanation: e.target.value })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="난이도">
          <Segmented
            label="난이도"
            value={d.difficulty}
            onChange={(v) => setD({ ...d, difficulty: v })}
            options={[
              { value: 'easy', label: '쉬움' },
              { value: 'medium', label: '보통' },
              { value: 'hard', label: '어려움' },
            ]}
          />
        </Field>
        {keyPoints?.length ? (
          <Field label="연결할 개념" htmlFor="q-kp">
            <select id="q-kp" className={inputClass} value={d.key_point_id ?? ''} onChange={(e) => setD({ ...d, key_point_id: e.target.value || null })}>
              <option value="">없음</option>
              {keyPoints.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      {err ? <p className="text-sm font-semibold text-bad">{err}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" busy={saving}>
          저장
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  );
}
