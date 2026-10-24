'use client';
// 앱 안에서 PDF 보기: 전체 화면 창에 pdf.js 로 쪽을 차례로 그린다 (내려받기·새 창 없이).
// pdf.js 는 legacy 빌드(오래된 폰 브라우저도 되는 쪽: 보통 빌드는 Map.getOrInsertComputed 같은 새 기능을 써서 멈춘다),
// 일꾼은 public/pdfjs/ (tools/pdfjs/copy-worker.mjs 가 설치·빌드 때 같은 버전의 legacy 일꾼을 복사한다)
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Button, ICONS, Icon, Spinner, cx } from './ui';

const WORKER_SRC = '/pdfjs/pdf.worker.min.mjs';
/** 한 번에 그리는 쪽 수 (아래로 내리면 더 그린다) */
const PAGES_AT_ONCE = 6;

export function PdfViewer({
  url,
  title,
  onClose,
  onDownload,
}: {
  /** 서명 주소 (만든 쪽이 만든다) */
  url: string;
  title: string;
  onClose: () => void;
  onDownload?: () => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGES_AT_ONCE);
  const [width, setWidth] = useState(0);
  /** 보는 크기: 1 = 창 너비에 맞춤 (폰에서 글씨가 작으면 키운다) */
  const [zoom, setZoom] = useState(1);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 쪽 너비 = 창 너비 (최대 820px)
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(820, el.clientWidth - 24));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      try {
        // 파일을 통째로 받아서 연다 (pdf.js 의 조각 받기(Range)는 저장소마다 달라서)
        const [pdfjs, res] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), fetch(url)]);
        if (!res.ok) throw new Error('fetch');
        const data = new Uint8Array(await res.arrayBuffer());
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        const d = await pdfjs.getDocument({ data }).promise;
        if (!alive) {
          void d.loadingTask.destroy();
          return;
        }
        loaded = d;
        setDoc(d);
      } catch (e) {
        if (alive) setError(e instanceof Error && /worker|version/i.test(e.message) ? 'PDF 보기 준비가 안 됐어요. 새로 고친 뒤 다시 해 주세요.' : 'PDF를 불러오지 못했어요.');
      }
    })();
    return () => {
      alive = false;
      void loaded?.loadingTask.destroy();
    };
  }, [url]);

  const total = doc?.numPages ?? 0;
  const pages = Array.from({ length: Math.min(total, shown) }, (_, i) => i + 1);

  return (
    <div className="kok-player fixed inset-0 z-[70] flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={`PDF 보기: ${title}`}>
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 pb-2 pt-[calc(10px+env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="PDF 닫기" className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink hover:bg-surface-2">
          <Icon d={ICONS.close} size={24} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          {total ? <p className="text-xs text-muted">{total}쪽</p> : null}
        </div>
        <div className="flex items-center rounded-full bg-surface-2" role="group" aria-label="보는 크기">
          <button type="button" className="press grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-surface-3 disabled:opacity-40" aria-label="작게" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))}>
            <span className="text-lg font-bold leading-none" aria-hidden="true">−</span>
          </button>
          <span className="w-11 text-center text-xs font-semibold tabular-nums text-muted" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" className="press grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-surface-3 disabled:opacity-40" aria-label="크게" disabled={zoom >= 2.5} onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.25) * 100) / 100))}>
            <span className="text-lg font-bold leading-none" aria-hidden="true">+</span>
          </button>
        </div>
        {onDownload ? (
          <button type="button" onClick={onDownload} aria-label="내려받기" title="내려받기" className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink hover:bg-surface-2">
            <Icon d={ICONS.download} size={22} />
          </button>
        ) : null}
      </div>
      <div
        ref={(el) => {
          body.current = el;
          panel.current = el;
        }}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-auto bg-surface-2 px-3 py-4 outline-none"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 800 && shown < total) setShown((s) => Math.min(total, s + PAGES_AT_ONCE));
        }}
      >
        {error ? (
          <p className="mx-auto max-w-md rounded-2xl bg-surface p-4 text-sm text-bad">{error}</p>
        ) : !doc ? (
          <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted">
            <Spinner /> PDF를 여는 중…
          </p>
        ) : (
          <div className={cx('grid gap-4', zoom > 1 ? 'w-max justify-items-start' : 'mx-auto justify-items-center')}>
            {width > 0 ? pages.map((n) => <PdfPage key={n} doc={doc} n={n} width={Math.round(width * zoom)} />) : null}
            {shown < total ? (
              <Button variant="secondary" onClick={() => setShown((s) => Math.min(total, s + PAGES_AT_ONCE))}>
                더 보기 ({shown}/{total}쪽)
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** 쪽 하나: 보이는 크기에 맞춰 캔버스에 그린다 (선명하게 devicePixelRatio 만큼 크게) */
function PdfPage({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(Math.round(width * 1.414));
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      try {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: scale * dpr });
        const el = canvas.current;
        if (!el) return;
        el.width = Math.floor(vp.width);
        el.height = Math.floor(vp.height);
        setHeight(Math.round(vp.height / dpr));
        const ctx = el.getContext('2d');
        if (!ctx) return;
        const r = page.render({ canvasContext: ctx, viewport: vp, canvas: el });
        task = r;
        await r.promise;
        if (!cancelled) setReady(true);
      } catch {
        /* 취소되었거나 그리지 못한 쪽: 빈 칸으로 둔다 */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, width]);
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-white shadow-[0_6px_24px_var(--shadow-strong)]', !ready && 'kok-skel')} style={{ width, height }} aria-label={`${n}쪽`}>
      <canvas ref={canvas} style={{ width, height }} className="block" />
    </div>
  );
}
