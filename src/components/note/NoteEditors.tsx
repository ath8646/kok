'use client';
// 노트 고치기 칸들: 요약, 개념(설명·시험 포인트·함정·예시·중요도), 공식(기호 버튼 + 미리보기), 용어.
// 글 칸은 RichField (쉬운 꾸미기 + 미리보기). 저장을 누르기 전에는 노트를 바꾸지 않는다.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { KeyPoint, Note } from '@/lib/ai/schemas';
import { insertSnippet } from '@/lib/rich-edit';
import { Tex, texProblem } from '@/components/RichText';
import { Button, Icon, ICONS, Segmented, cx, inputClass } from '@/components/ui';
import { RichField, moveInToolbar, useTextEdit } from './RichField';

export type Formula = Note['formulas'][number];
export type Term = Note['terms'][number];

export const IMPORTANCE_OPTIONS: Array<{ value: KeyPoint['importance']; label: string }> = [
  { value: 'high', label: '꼭 외우기' },
  { value: 'medium', label: '중요' },
  { value: 'low', label: '참고' },
];

/** 고치던 내용이 저장되지 않았는지 노트 화면에 알린다 (다른 칸을 열 때 한 번 묻게). 닫히면 '없음' */
export type OnDirty = (dirty: boolean) => void;

function useReportDirty(dirty: boolean, onDirty?: OnDirty) {
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
}

function Labeled({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="px-1 text-xs font-bold text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function EditorActions({
  onSave,
  onCancel,
  onDelete,
  canSave = true,
  deleteLabel = '지우기',
}: {
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  canSave?: boolean;
  deleteLabel?: string;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button size="sm" disabled={!canSave} onClick={onSave}>
        저장
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        취소
      </Button>
      {onDelete ? (
        confirm ? (
          <Button size="sm" variant="danger" className="ml-auto" onClick={onDelete}>
            정말 지우기
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={() => setConfirm(true)}>
            {deleteLabel}
          </Button>
        )
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ 요약
export function SummaryEditor({
  initial,
  onSave,
  onCancel,
  onDirty,
}: {
  initial: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  onDirty?: OnDirty;
}) {
  const [v, setV] = useState(initial);
  useReportDirty(v !== initial, onDirty);
  const save = () => onSave(v.trim());
  return (
    <div className="grid gap-3">
      <RichField label="요약" hideLabel value={v} onChange={setV} rows={2} maxLength={1000} autoFocus onSubmit={save} placeholder="이 노트를 한 줄로 적어요" />
      <EditorActions onSave={save} onCancel={onCancel} />
    </div>
  );
}

// ------------------------------------------------------------------ 개념
/** 함정·예시처럼 여러 개를 적는 칸. 줄마다 번호를 붙여 두어 중간 것을 빼도 다른 칸이 섞이지 않는다 */
type Item = { id: string; text: string };

function toItems(texts: string[], prefix: string): Item[] {
  return texts.map((text, i) => ({ id: `${prefix}${i}`, text }));
}

function ItemsField({
  label,
  items,
  onChange,
  addLabel,
  placeholder,
}: {
  label: string;
  items: Item[];
  onChange: (next: Item[]) => void;
  addLabel: string;
  placeholder: string;
}) {
  // 방금 더한 칸에 바로 쓸 수 있게
  const [fresh, setFresh] = useState<string | null>(null);
  return (
    <div className="grid gap-2.5">
      {items.map((it, i) => (
        <RichField
          key={it.id}
          label={items.length > 1 ? `${label} ${i + 1}` : label}
          value={it.text}
          rows={2}
          maxLength={1000}
          placeholder={placeholder}
          autoFocus={it.id === fresh}
          onChange={(v) => onChange(items.map((x) => (x.id === it.id ? { ...x, text: v } : x)))}
          action={
            <button
              type="button"
              className="press inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-bad"
              onClick={() => onChange(items.filter((x) => x.id !== it.id))}
            >
              <Icon d={ICONS.close} size={13} strokeWidth={2.4} />
              {label} 빼기
            </button>
          }
        />
      ))}
      <button
        type="button"
        className="press inline-flex items-center gap-1.5 justify-self-start rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-surface-3"
        onClick={() => {
          const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          setFresh(id);
          onChange([...items, { id, text: '' }]);
        }}
      >
        <Icon d={ICONS.plus} size={15} strokeWidth={2.4} />
        {addLabel}
      </button>
    </div>
  );
}

export type KeyPointDraft = { kp: KeyPoint; pitfalls: string[]; examples: string[] };

export function KeyPointEditor({
  kp,
  pitfalls,
  examples,
  onSave,
  onCancel,
  onDelete,
  onDirty,
}: {
  kp: KeyPoint;
  pitfalls: string[];
  examples: string[];
  onSave: (d: KeyPointDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onDirty?: OnDirty;
}) {
  const titleId = useId();
  const [title, setTitle] = useState(kp.title);
  const [explanation, setExplanation] = useState(kp.explanation);
  const [why, setWhy] = useState(kp.why);
  const [importance, setImportance] = useState<KeyPoint['importance']>(kp.importance);
  const [pits, setPits] = useState(() => toItems(pitfalls, 'p'));
  const [exs, setExs] = useState(() => toItems(examples, 'e'));
  const joined = (xs: Item[]) => xs.map((x) => x.text).join('\u0000');
  useReportDirty(
    title !== kp.title ||
      explanation !== kp.explanation ||
      why !== kp.why ||
      importance !== kp.importance ||
      joined(pits) !== pitfalls.join('\u0000') ||
      joined(exs) !== examples.join('\u0000'),
    onDirty,
  );
  const canSave = !!title.trim();
  const save = () => {
    if (!canSave) return;
    onSave({
      kp: { ...kp, title: title.trim(), explanation: explanation.trim(), why: why.trim(), importance },
      pitfalls: pits.map((x) => x.text.trim()).filter(Boolean),
      examples: exs.map((x) => x.text.trim()).filter(Boolean),
    });
  };
  return (
    <div className="grid gap-4" onClick={(e) => e.stopPropagation()}>
      <Labeled label="개념 이름" htmlFor={titleId}>
        <input
          id={titleId}
          className={cx(inputClass, 'font-bold')}
          value={title}
          maxLength={120}
          placeholder="예: 광합성"
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </Labeled>
      <div className="grid gap-1.5">
        <span className="px-1 text-xs font-bold text-muted">중요도</span>
        <div>
          <Segmented label="중요도" value={importance} onChange={setImportance} options={IMPORTANCE_OPTIONS} />
        </div>
      </div>
      <RichField label="설명" value={explanation} onChange={setExplanation} rows={4} maxLength={3000} onSubmit={save} placeholder="이 개념을 내 말로 적어요" />
      <RichField
        label="시험 포인트 (없어도 돼요)"
        value={why}
        onChange={setWhy}
        rows={2}
        maxLength={1000}
        onSubmit={save}
        placeholder="시험에 어떻게 나오는지 적어요"
      />
      <ItemsField label="함정" items={pits} onChange={setPits} addLabel="함정 추가" placeholder="틀리기 쉬운 점을 적어요" />
      <ItemsField label="예시" items={exs} onChange={setExs} addLabel="예시 추가" placeholder="예시를 적어요" />
      <EditorActions onSave={save} onCancel={onCancel} onDelete={onDelete} canSave={canSave} deleteLabel="개념 지우기" />
    </div>
  );
}

// ------------------------------------------------------------------ 공식
const SNIPPETS: Array<{ label: string; title: string; tex: string }> = [
  { label: 'a/b', title: '분수', tex: '\\frac{□}{□}' },
  { label: 'x²', title: '거듭제곱', tex: '^{□}' },
  { label: 'x₂', title: '아래 첨자', tex: '_{□}' },
  { label: '√', title: '루트', tex: '\\sqrt{□}' },
  { label: '×', title: '곱하기', tex: '\\times ' },
  { label: '÷', title: '나누기', tex: '\\div ' },
  { label: '±', title: '플러스 마이너스', tex: '\\pm ' },
  { label: '→', title: '화살표', tex: '\\rightarrow ' },
  { label: '⇌', title: '양쪽 화살표', tex: '\\rightleftharpoons ' },
  { label: '≤', title: '작거나 같다', tex: '\\le ' },
  { label: '≥', title: '크거나 같다', tex: '\\ge ' },
  { label: '≠', title: '같지 않다', tex: '\\ne ' },
  { label: 'π', title: '파이', tex: '\\pi ' },
  { label: 'θ', title: '세타', tex: '\\theta ' },
  { label: 'Δ', title: '델타', tex: '\\Delta ' },
  { label: '°', title: '도', tex: '^{\\circ}' },
  { label: '가', title: '글자 넣기', tex: '\\text{□}' },
];

export function FormulaEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
  onDirty,
}: {
  initial: Formula;
  onSave: (f: Formula) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onDirty?: OnDirty;
}) {
  const nameId = useId();
  const texId = useId();
  const [label, setLabel] = useState(initial.label);
  const [latex, setLatex] = useState(initial.latex);
  const [tool, setTool] = useState(0);
  useReportDirty(label !== initial.label || latex !== initial.latex, onDirty);
  const { ref, remember, apply } = useTextEdit(latex, setLatex, { maxLength: 1000, maxHeight: 220 });
  const problem = useMemo(() => texProblem(latex), [latex]);
  // 읽을 수 없는 공식은 저장하지 않는다 (처음부터 그랬던 공식은 이름만 고쳐도 되게 둔다)
  const canSave = !!latex.trim() && (!problem || latex === initial.latex);
  const save = () => {
    if (canSave) onSave({ ...initial, label: label.trim(), latex: latex.trim() });
  };
  return (
    <div className="grid gap-4" onClick={(e) => e.stopPropagation()}>
      <Labeled label="공식 이름 (없어도 돼요)" htmlFor={nameId}>
        <input id={nameId} className={inputClass} value={label} maxLength={120} placeholder="예: 원의 넓이" onChange={(e) => setLabel(e.target.value)} />
      </Labeled>
      <div className="grid gap-1.5">
        <label htmlFor={texId} className="px-1 text-xs font-bold text-muted">
          공식
        </label>
        <div className="flex flex-col rounded-2xl border-2 border-transparent bg-surface-2 transition-colors focus-within:border-accent focus-within:bg-surface">
          <textarea
            id={texId}
            ref={ref}
            rows={2}
            value={latex}
            maxLength={1000}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            placeholder="예: S = \pi r^2"
            className="block w-full resize-none bg-transparent px-3.5 pb-2.5 pt-2 font-mono text-[14px] leading-relaxed text-ink placeholder:text-muted/80 focus:outline-none"
            onChange={(e) => setLatex(e.target.value)}
            onSelect={remember}
            onBlur={remember}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
          />
          <div
            role="toolbar"
            aria-label="공식 기호"
            aria-controls={texId}
            className="no-scrollbar order-first flex items-center gap-1 overflow-x-auto border-b border-line px-1.5 py-1.5"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) e.preventDefault();
            }}
          >
            {SNIPPETS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                tabIndex={tool === i ? 0 : -1}
                aria-label={s.title}
                title={s.title}
                className="press h-8 min-w-9 shrink-0 rounded-lg bg-surface px-2 text-[15px] font-semibold text-ink shadow-[0_1px_2px_var(--shadow)] hover:bg-surface-3"
                onFocus={() => setTool(i)}
                onKeyDown={(e) => moveInToolbar(e, i, SNIPPETS.length, setTool)}
                onClick={() => apply((v, a, b) => insertSnippet(v, a, b, s.tex))}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <p className="px-1 text-xs text-muted">위 버튼으로 기호를 넣고 □ 자리에 숫자나 글자를 적어요. LaTeX 로 직접 적어도 돼요.</p>
      </div>
      <div className="grid gap-1.5">
        <span className="px-1 text-xs font-bold text-muted">미리보기</span>
        <div className="grid min-h-16 place-items-center overflow-x-auto rounded-2xl border border-dashed border-line px-3 py-3" aria-live="polite">
          {!latex.trim() ? (
            <p className="text-sm text-muted">공식을 적으면 여기에 보여요.</p>
          ) : problem ? (
            <p className="text-sm font-semibold text-bad">{problem}</p>
          ) : (
            <Tex tex={latex} display />
          )}
        </div>
      </div>
      <EditorActions onSave={save} onCancel={onCancel} onDelete={onDelete} canSave={canSave} deleteLabel="공식 지우기" />
    </div>
  );
}

// ------------------------------------------------------------------ 용어
export function TermEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
  onDirty,
}: {
  initial: Term;
  onSave: (t: Term) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onDirty?: OnDirty;
}) {
  const termId = useId();
  const [term, setTerm] = useState(initial.term);
  const [meaning, setMeaning] = useState(initial.meaning);
  useReportDirty(term !== initial.term || meaning !== initial.meaning, onDirty);
  const canSave = !!term.trim() && !!meaning.trim();
  const save = () => {
    if (canSave) onSave({ ...initial, term: term.trim(), meaning: meaning.trim() });
  };
  return (
    <div className="grid gap-4">
      <Labeled label="용어" htmlFor={termId}>
        <input
          id={termId}
          className={cx(inputClass, 'font-bold')}
          value={term}
          maxLength={100}
          placeholder="예: 엽록체"
          autoFocus
          onChange={(e) => setTerm(e.target.value)}
        />
      </Labeled>
      <RichField label="뜻" value={meaning} onChange={setMeaning} rows={2} maxLength={1500} onSubmit={save} placeholder="뜻을 적어요" />
      <EditorActions onSave={save} onCancel={onCancel} onDelete={onDelete} canSave={canSave} deleteLabel="용어 지우기" />
    </div>
  );
}
