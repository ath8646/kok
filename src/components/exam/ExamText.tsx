'use client';
// 문제를 실제 시험지처럼 (lib/exam-layout.ts 가 나눈 대로 그리기만): 원래 번호, 발문(굵게), 자료·지문 상자(과목마다 모양:
// 국어·영어는 읽는 지문, 수학은 조건, 과학·사회는 자료·실험, 코딩은 코드), <보기> 상자, 남은 글.
// 정답·해설은 ExplainText: '이름: 내용'·①·(가)마다 한 줄 (이름은 굵게).
// ㉠·(가) 같은 표시는 눈에 띄게(MarkedText). 빈칸 문제는 첫 빈칸 자리에 blank() 를 그린다 (풀기 화면)
import { useMemo, type ReactNode } from 'react';
import { clozeBlank } from '@/lib/cloze';
import { examLayout, explainLines, type ExamBlock, type ExamLine, type ExamStyle } from '@/lib/exam-layout';
import { hasRichMarks } from '@/lib/richtext';
import { RichText } from '../RichText';
import { cx } from '../ui';

/** 눈에 띄게 할 표시: ㉠㉡ · ㈎ · ⓐ · (가) */
const MARKS = /[㉠-㉻㈎-㈛Ⓐ-ⓩ]|\((?:가|나|다|라|마|바|사|아|자|차)\)/g;

/** 글 + 표시(㉠·(가)) 강조. 꾸미기·수식·코드가 든 글은 나누지 않는다 (꾸미기가 표시를 넘나들 수 있어서) */
export function MarkedText({ text }: { text: string }) {
  const parts = useMemo(() => {
    if (!text.match(MARKS) || hasRichMarks(text)) return null;
    const out: Array<{ mark: boolean; text: string }> = [];
    let from = 0;
    for (const m of text.matchAll(MARKS)) {
      const at = m.index ?? 0;
      if (at > from) out.push({ mark: false, text: text.slice(from, at) });
      out.push({ mark: true, text: m[0] });
      from = at + m[0].length;
    }
    if (from < text.length) out.push({ mark: false, text: text.slice(from) });
    return out;
  }, [text]);
  if (!parts) return <RichText text={text} />;
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) =>
        p.mark ? (
          <span key={i} className={p.text.startsWith('(') ? 'kok-exam-blank' : 'kok-exam-mark'}>
            {p.text}
          </span>
        ) : (
          <RichText key={i} text={p.text} />
        ),
      )}
    </span>
  );
}

/** 빈칸 문제의 문장: 첫 빈칸 자리에 blank (없으면 글 그대로) */
function ClozeText({ text, blank }: { text: string; blank: () => ReactNode }) {
  const at = clozeBlank(text);
  if (!at) return <MarkedText text={text} />;
  return (
    <>
      <MarkedText text={text.slice(0, at.start)} />
      {blank()}
      <MarkedText text={text.slice(at.end)} />
    </>
  );
}

function Line({ l }: { l: ExamLine }) {
  if (l.kind === 'head') return <p className="kok-exam-head">{l.text}</p>;
  if (l.kind === 'step')
    return (
      <p className="kok-exam-step">
        <span className="kok-exam-step-mark">{l.mark}</span>
        <span className="min-w-0">
          <MarkedText text={l.text} />
        </span>
      </p>
    );
  if (l.kind === 'label')
    return (
      <p>
        <b className="font-bold">{l.label}</b>
        {': '}
        <MarkedText text={l.text} />
      </p>
    );
  return (
    <p className="kok-exam-p">
      <MarkedText text={l.text} />
    </p>
  );
}

/**
 * 문제 글을 시험지처럼. style: 과목마다 상자 모양 (examStyle), size: 풀기 화면은 lg.
 * blank: 빈칸 문제의 첫 빈칸 자리에 그릴 칸 (없으면 글 그대로 '____')
 */
export function ExamPrompt({
  text,
  style,
  size = 'md',
  blank,
  className,
}: {
  text: string;
  style: ExamStyle;
  size?: 'md' | 'lg';
  blank?: () => ReactNode;
  className?: string;
}) {
  const layout = useMemo(() => examLayout(text, style), [text, style]);
  // 빈칸 칸은 첫 빈칸이 든 발문·글 덩이에 한 번만
  const blankAt = blank ? layout.blocks.findIndex((b) => (b.kind === 'stem' || b.kind === 'text') && !!clozeBlank(b.text)) : -1;
  const words = (b: Extract<ExamBlock, { text: string }>, i: number) => (i === blankAt && blank ? <ClozeText text={b.text} blank={blank} /> : <MarkedText text={b.text} />);
  return (
    <div className={cx('kok-exam grid', size === 'lg' ? 'gap-3.5 text-[18px]' : 'gap-2.5 text-[15px]', className)} data-style={style}>
      {layout.label ? <span className="kok-exam-label">{layout.label}</span> : null}
      {layout.blocks.map((b, i) => {
        if (b.kind === 'stem')
          return (
            <p key={i} className="kok-exam-stem">
              {words(b, i)}
            </p>
          );
        if (b.kind === 'text')
          return (
            <p key={i} className="leading-relaxed">
              {words(b, i)}
            </p>
          );
        if (b.kind === 'bogi')
          return (
            <span key={i} className="kok-bogi" role="group" aria-label="보기">
              <span className="kok-bogi-label" aria-hidden="true">
                보기
              </span>
              {b.items.map((item, j) => (
                <span key={j} className="kok-bogi-item">
                  <MarkedText text={item} />
                </span>
              ))}
            </span>
          );
        return (
          <div key={i} className="kok-exam-box" data-style={style} role="group" aria-label={style === 'korean' || style === 'english' ? '지문' : '자료'}>
            {b.lines.map((l, j) => (
              <Line key={j} l={l} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 접힌 목록에 보일 발문 (문제 글의 묻는 문장, 없으면 앞부분) */
export function examAsk(text: string, style: ExamStyle): string {
  return examLayout(text, style).ask;
}

/** 정답·해설: '이름: 내용'·①·(가)마다 한 줄 (이름은 굵게), 아니면 한 문단 그대로 */
export function ExplainText({ text, className }: { text: string; className?: string }) {
  const lines = useMemo(() => explainLines(text), [text]);
  if (lines.length <= 1 && !lines[0]?.label) {
    return (
      <p className={className}>
        <RichText text={text} />
      </p>
    );
  }
  return (
    <div className={cx('grid gap-1.5', className)}>
      {lines.map((l, i) =>
        // 짧은 표시(①·(가))는 내어쓰기, 이름('혈당량 조절')은 줄 앞에 굵게
        l.label && l.label.length <= 4 ? (
          <p key={i} className="kok-explain-step">
            <b className="font-bold">{l.label}</b>
            <span className="min-w-0">
              <RichText text={l.text} />
            </span>
          </p>
        ) : l.label ? (
          <p key={i}>
            <b className="font-bold">{l.label}</b>{' '}
            <RichText text={l.text} />
          </p>
        ) : (
          <p key={i}>
            <RichText text={l.text} />
          </p>
        ),
      )}
    </div>
  );
}
