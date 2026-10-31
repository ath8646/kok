'use client';
// 글 + 수식(KaTeX) + 코드(`코드`, ``` 블록) + 쉬운 꾸미기(**굵게**, ==형광펜==, !!빨간 글씨!!, '- ' 목록, '1. ' 번호) 보여 주기.
// 꾸미기는 parseRich 가 나눈 조각을 React 요소로만 그린다 (글을 HTML 로 바꾸지 않는다)
import katex from 'katex';
import { Fragment, memo, useMemo } from 'react';
import { parseRich, richBlocks, type Inline } from '@/lib/richtext';

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

/** 공식을 읽을 수 없으면 쉬운 말로 이유를 (공식 고치기 칸의 미리보기) */
export function texProblem(tex: string): string | null {
  if (!tex.trim()) return null;
  try {
    katex.renderToString(tex, { ...KATEX_OPTS, throwOnError: true });
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (/Expected '}'|Unexpected end|Extra }|Expected group/i.test(m)) return '괄호 { } 의 짝이 맞지 않아요.';
    if (/Undefined control sequence/i.test(m)) return '모르는 명령이 있어요. \\ 뒤의 글자를 확인해 주세요.';
    return '공식을 읽지 못했어요. 적은 것을 한 번 확인해 주세요.';
  }
}

export const Tex = memo(function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => renderTex(tex, display), [tex, display]);
  if (!html) return <code className={className}>{tex}</code>;
  // KaTeX 가 입력을 이스케이프하고 trust:false 라서 안전한 HTML 이다
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

function Nodes({ ns }: { ns: Inline[] }) {
  return (
    <>
      {ns.map((n, i) => {
        if (n.t === 'text') return <Fragment key={i}>{n.v}</Fragment>;
        if (n.t === 'code')
          return (
            <code key={i} className="kok-code">
              {n.v}
            </code>
          );
        if (n.t === 'math') return <Tex key={i} tex={n.tex} display={n.display} />;
        if (n.t === 'b')
          return (
            <strong key={i} className="font-bold">
              <Nodes ns={n.c} />
            </strong>
          );
        if (n.t === 'mark')
          return (
            <mark key={i} className="kok-mark">
              <Nodes ns={n.c} />
            </mark>
          );
        return (
          <span key={i} className="kok-red">
            <Nodes ns={n.c} />
          </span>
        );
      })}
    </>
  );
}

export const RichText = memo(function RichText({ text, className }: { text: string; className?: string }) {
  const lines = useMemo(() => parseRich(text), [text]);
  // 목록·코드 블록이 없으면 글 흐름 그대로 (줄바꿈만 지킨다)
  if (!lines.some((l) => l.list || l.code)) {
    return (
      <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i ? '\n' : null}
            <Nodes ns={l.c} />
          </Fragment>
        ))}
      </span>
    );
  }
  // 목록·코드 블록이 있으면 줄마다 한 덩이 (span 이라 <p>·<li> 안에 넣어도 된다). 코드 블록은 옆으로 넘기는 칸 하나
  return (
    <span className={className ? `kok-rich ${className}` : 'kok-rich'}>
      {richBlocks(lines).map((b, i) => {
        if (b.code)
          return (
            <span key={i} className="kok-code-block" data-lang={b.lang || undefined} tabIndex={0} role="group" aria-label={b.lang ? `${b.lang} 코드` : '코드'}>
              <code>{b.lines.join('\n')}</code>
            </span>
          );
        const l = b.line;
        return l.list ? (
          <span key={i} className="kok-li" data-kind={l.list} data-mark={l.list === 'number' ? `${l.n}.` : undefined}>
            <Nodes ns={l.c} />
          </span>
        ) : (
          <span key={i} className="block">
            {l.c.length ? <Nodes ns={l.c} /> : <br />}
          </span>
        );
      })}
    </span>
  );
});
