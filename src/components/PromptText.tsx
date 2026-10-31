'use client';
// 문제 글: 실제 시험처럼 <보기> 상자를 그린다 (lib/bogi.ts). 상자가 없으면 RichText 그대로
import { splitBogi } from '@/lib/bogi';
import { RichText } from './RichText';

export function PromptText({ text }: { text: string }) {
  const parts = splitBogi(text);
  if (!parts) return <RichText text={text} />;
  return (
    <>
      {parts.before ? <RichText text={parts.before} /> : null}
      <span className="kok-bogi" role="group" aria-label="보기">
        <span className="kok-bogi-label" aria-hidden="true">
          보기
        </span>
        {parts.items.map((item, i) => (
          <span key={i} className="kok-bogi-item">
            <RichText text={item} />
          </span>
        ))}
      </span>
      {parts.after ? <RichText text={parts.after} className="mt-1 block" /> : null}
    </>
  );
}
