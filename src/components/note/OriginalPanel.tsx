'use client';
// 원본 보기: 내가 쓴 글, PDF(쪽 번호로 열기), 사진
import { useEffect, useState } from 'react';
import { sb } from '@/lib/data';
import { Card, buttonClass } from '../ui';

export function OriginalPanel({
  kind,
  text,
  paths,
  expireAt,
  focusPage,
}: {
  kind: 'text' | 'pdf' | 'image';
  text: string | null;
  paths: string[];
  expireAt: string | null;
  focusPage: number | null;
}) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (kind === 'text' || !paths.length) return;
    let alive = true;
    sb()
      .storage.from('sources')
      .createSignedUrls(paths, 60 * 30)
      .then(({ data }) => {
        if (alive) setUrls((data ?? []).map((d) => d.signedUrl ?? ''));
      })
      .catch(() => {
        if (alive) setUrls([]);
      });
    return () => {
      alive = false;
    };
  }, [kind, paths]);

  useEffect(() => {
    if (kind === 'image' && focusPage) document.getElementById(`photo-${focusPage}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [kind, focusPage, urls]);

  if (kind === 'text') {
    // 빈 노트로 만든 노트는 원문이 없다
    if (!text?.trim()) return <Card className="text-sm text-muted">직접 만든 노트라 원본이 없어요. 정리 탭에서 바로 채워 보세요.</Card>;
    return (
      <Card>
        <p className="mb-2 text-sm font-semibold text-muted">내가 쓴 원문 (AI가 바꾸지 않아요)</p>
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</div>
      </Card>
    );
  }
  if (!paths.length) {
    return <Card className="text-sm text-muted">원본 파일은 보관 기간이 지나 지워졌어요. 노트·그림·문제는 그대로 남아 있어요.</Card>;
  }
  const expireNote = expireAt ? `원본 파일은 ${new Date(expireAt).toLocaleDateString('ko-KR')}에 지워져요 (무료 요금제).` : null;
  if (kind === 'pdf') {
    const url = urls?.[0];
    return (
      <Card className="grid gap-3">
        <p className="text-sm text-muted">PDF는 새 창에서 열려요. 쪽 번호를 누르면 그 쪽으로 열려요.</p>
        {url ? (
          <a
            href={focusPage ? `${url}#page=${focusPage}` : url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('primary', 'md', 'justify-self-start')}
          >
            {focusPage ? `${focusPage}쪽 열기` : 'PDF 열기'}
          </a>
        ) : (
          <p className="text-sm text-muted">여는 중…</p>
        )}
        {expireNote ? <p className="text-xs text-muted">{expireNote}</p> : null}
      </Card>
    );
  }
  return (
    <div className="grid gap-3">
      {expireNote ? <p className="text-xs text-muted">{expireNote}</p> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(urls ?? []).map((u, i) => (
          <button
            key={i}
            id={`photo-${i + 1}`}
            type="button"
            onClick={() => setZoom(u)}
            className={`relative overflow-hidden rounded-xl border-2 ${focusPage === i + 1 ? 'border-hl' : 'border-line'}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={`원본 사진 ${i + 1}`} className="aspect-[3/4] w-full object-cover" loading="lazy" />
            <span className="absolute left-1 top-1 rounded-full bg-ink/80 px-2 text-xs font-bold text-surface">사진 {i + 1}</span>
          </button>
        ))}
      </div>
      {zoom ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3" role="dialog" aria-modal="true" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="원본 사진 크게 보기" className="max-h-full max-w-full object-contain" />
          <button type="button" className="absolute right-4 top-[calc(16px+env(safe-area-inset-top))] rounded-full bg-white px-3 py-1 font-bold text-black">
            닫기
          </button>
        </div>
      ) : null}
    </div>
  );
}
