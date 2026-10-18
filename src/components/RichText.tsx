'use client';
// 글 + 수식(KaTeX) 보여 주기
import katex from 'katex';
import { memo, useMemo } from 'react';
import { splitMath } from '@/lib/richtext';

const KATEX_OPTS = {
  throwOnError: false,
  strict: 'ignore' as const,
  trust: false,
  maxSize: 20,
  maxExpand: 200,
  output: 'html' as const,
};

export function renderTex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { ...KATEX_OPTS, displayMode: display });
  } catch {
    return '';
  }
}

export const Tex = memo(function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => renderTex(tex, display), [tex, display]);
  if (!html) return <code className={className}>{tex}</code>;
  // KaTeX 가 입력을 이스케이프하고 trust:false 라서 안전한 HTML 이다
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

export const RichText = memo(function RichText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => splitMath(text), [text]);
  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => (p.kind === 'text' ? <span key={i}>{p.text}</span> : <Tex key={i} tex={p.tex} display={p.display} />))}
    </span>
  );
});
