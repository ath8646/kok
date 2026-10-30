'use client';
// 수식 적는 칸: 기호 버튼 + 글 칸(LaTeX) + 미리보기. 공식 고치기(노트의 '공식')와 글 속 수식 창이 같이 쓴다.
import { useId, useMemo, useState } from 'react';
import { insertSnippet } from '@/lib/rich-edit';
import { Tex, texProblem } from '@/components/RichText';
import { moveInToolbar, useTextEdit } from './useTextEdit';

export const TEX_SNIPPETS: Array<{ label: string; title: string; tex: string }> = [
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

/** 수식이 읽히는지 (읽을 수 없으면 쉬운 말로 까닭) */
export function useTexProblem(tex: string): string | null {
  return useMemo(() => texProblem(tex), [tex]);
}

export function TexInput({
  value,
  onChange,
  label = '공식',
  placeholder = '예: S = \\pi r^2',
  display = true,
  autoFocus = false,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  /** 미리보기를 가운데 큰 수식으로 */
  display?: boolean;
  autoFocus?: boolean;
  /** ⌘/Ctrl + 엔터 */
  onSubmit?: () => void;
}) {
  const id = useId();
  const [tool, setTool] = useState(0);
  const { ref, remember, apply } = useTextEdit(value, onChange, { maxLength: 1000, maxHeight: 220 });
  const problem = useTexProblem(value);
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <label htmlFor={id} className="px-1 text-xs font-bold text-muted">
          {label}
        </label>
        <div className="flex flex-col rounded-2xl border-2 border-transparent bg-surface-2 transition-colors focus-within:border-accent focus-within:bg-surface">
          <textarea
            id={id}
            ref={ref}
            rows={2}
            value={value}
            maxLength={1000}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus={autoFocus}
            placeholder={placeholder}
            className="block w-full resize-none bg-transparent px-3.5 pb-2.5 pt-2 font-mono text-[14px] leading-relaxed text-ink placeholder:text-muted/80 focus:outline-none"
            onChange={(e) => onChange(e.target.value)}
            onSelect={remember}
            onBlur={remember}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && onSubmit) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          <div
            role="toolbar"
            aria-label={`${label} 기호`}
            aria-controls={id}
            className="no-scrollbar order-first flex items-center gap-1 overflow-x-auto border-b border-line px-1.5 py-1.5"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) e.preventDefault();
            }}
          >
            {TEX_SNIPPETS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                tabIndex={tool === i ? 0 : -1}
                aria-label={s.title}
                title={s.title}
                className="press h-8 min-w-9 shrink-0 rounded-lg bg-surface px-2 text-[15px] font-semibold text-ink shadow-[0_1px_2px_var(--shadow)] hover:bg-surface-3"
                onFocus={() => setTool(i)}
                onKeyDown={(e) => moveInToolbar(e, i, TEX_SNIPPETS.length, setTool)}
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
          {!value.trim() ? (
            <p className="text-sm text-muted">수식을 적으면 여기에 보여요.</p>
          ) : problem ? (
            <p className="text-sm font-semibold text-bad">{problem}</p>
          ) : (
            <Tex tex={value} display={display} />
          )}
        </div>
      </div>
    </div>
  );
}
