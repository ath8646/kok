'use client';
// 원본 보기: 내가 쓴 글, 한글·워드·PPT 에서 꺼낸 글(그림은 제자리에), PDF(쪽 번호로 열기), 사진
import { useEffect, useState } from 'react';
import { sb } from '@/lib/data';
import { PICTURE_LINE } from '@/lib/doc-pictures';
import { officeFileName } from '@/lib/office/names';
import { pageName, type PageLabels } from '@/lib/page-labels';
import { Card, buttonClass } from '../ui';

export function OriginalPanel({
  kind,
  text,
  paths,
  expireAt,
  focusPage,
  pageLabels,
}: {
  kind: 'text' | 'pdf' | 'image';
  text: string | null;
  paths: string[];
  expireAt: string | null;
  focusPage: number | null;
  /** 인쇄된 쪽 번호 (노트의 body.page_labels): 버튼 글만 책의 쪽으로, 여는 자리는 PDF 쪽 그대로 */
  pageLabels?: PageLabels;
}) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    if (!paths.length) return;
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
    if (focusPage) document.getElementById(`${kind === 'text' ? 'doc-pic' : 'photo'}-${focusPage}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [kind, focusPage, urls]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const zoomView = zoom ? (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={zoom.alt}
      onClick={() => setZoom(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={zoom.url} alt={zoom.alt} className="max-h-full max-w-full object-contain" />
      <button type="button" className="absolute right-4 top-[calc(16px+env(safe-area-inset-top))] rounded-full bg-white px-3 py-1 font-bold text-black">
        닫기
      </button>
    </div>
  ) : null;

  if (kind === 'text') {
    // 빈 노트로 만든 노트는 원문이 없다
    if (!text?.trim()) return <Card className="text-sm text-muted">직접 만든 노트라 원본이 없어요. 정리 탭에서 바로 채워 보세요.</Card>;
    const file = officeFileName(text);
    if (!file)
      return (
        <Card>
          <p className="mb-2 text-sm font-semibold text-muted">내가 쓴 원문 (AI가 바꾸지 않아요)</p>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</div>
        </Card>
      );
    return (
      <>
        <DocOriginal file={file} text={text} paths={paths} urls={urls} expireAt={expireAt} onZoom={setZoom} />
        {zoomView}
      </>
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
            {focusPage ? `${pageName('pdf', focusPage, pageLabels)} 열기` : 'PDF 열기'}
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
            onClick={() => setZoom({ url: u, alt: `원본 사진 ${i + 1} 크게 보기` })}
            className={`relative overflow-hidden rounded-xl border-2 ${focusPage === i + 1 ? 'border-hl' : 'border-line'}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={`원본 사진 ${i + 1}`} className="aspect-[3/4] w-full object-cover" loading="lazy" />
            <span className="absolute left-1 top-1 rounded-full bg-ink/80 px-2 text-xs font-bold text-surface">사진 {i + 1}</span>
          </button>
        ))}
      </div>
      {zoomView}
    </div>
  );
}

/** 한글·워드·PPT 에서 꺼낸 글: 첫 줄의 파일 이름은 위에, 그림 자리([[picture N]] 줄)에는 그 그림 (보관 기간이 지나 지웠으면 그 자리에 알림) */
function DocOriginal({
  file,
  text,
  paths,
  urls,
  expireAt,
  onZoom,
}: {
  file: string;
  text: string;
  paths: string[];
  urls: string[] | null;
  expireAt: string | null;
  onZoom: (z: { url: string; alt: string }) => void;
}) {
  const body = text.replace(/^\(파일: [^\n]+\)\n+/, '');
  // 글 덩이와 그림을 차례대로
  const blocks: Array<{ text: string } | { pic: number }> = [];
  for (const line of body.split('\n')) {
    const m = PICTURE_LINE.exec(line);
    if (m) blocks.push({ pic: Number(m[1]) });
    else {
      const last = blocks[blocks.length - 1];
      if (last && 'text' in last) last.text += `\n${line}`;
      else blocks.push({ text: line });
    }
  }
  const pictures = blocks.filter((b) => 'pic' in b).length;
  const gone = pictures > 0 && !paths.length;
  return (
    <Card className="grid gap-3">
      <p className="text-sm font-semibold text-muted">
        &lsquo;{file}&rsquo;에서 꺼낸 {pictures ? '글과 그림' : '글'} (AI가 바꾸지 않아요)
      </p>
      {gone ? <p className="text-xs text-muted">문서 속 그림은 보관 기간이 지나 지워졌어요. 글과 노트·문제는 그대로 남아 있어요.</p> : null}
      {expireAt && pictures && !gone ? (
        <p className="text-xs text-muted">문서 속 그림은 {new Date(expireAt).toLocaleDateString('ko-KR')}에 지워져요 (무료 요금제). 글은 그대로 남아요.</p>
      ) : null}
      {blocks.map((b, i) => {
        if ('text' in b) {
          const t = b.text.replace(/^\n+|\n+$/g, '');
          return t ? (
            <div key={i} className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {t}
            </div>
          ) : null;
        }
        if (gone || b.pic > paths.length) return null;
        const url = urls?.[b.pic - 1];
        return (
          <button
            key={i}
            id={`doc-pic-${b.pic}`}
            type="button"
            onClick={() => url && onZoom({ url, alt: `문서 그림 ${b.pic} 크게 보기` })}
            className="relative justify-self-start overflow-hidden rounded-xl border border-line bg-surface-2"
            aria-label={`문서 그림 ${b.pic} 크게 보기`}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={`문서 그림 ${b.pic}`} className="max-h-[420px] w-auto max-w-full object-contain" loading="lazy" />
            ) : (
              <span className="block h-32 w-48" aria-hidden="true" />
            )}
            <span className="absolute left-1 top-1 rounded-full bg-ink/80 px-2 text-xs font-bold text-surface">그림 {b.pic}</span>
          </button>
        );
      })}
    </Card>
  );
}
