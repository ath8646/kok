'use client';
// 자료 그림 한 장: KOK 스타일로 다시 그린 그림(Pro)과 원본에서 자른 그림을 바꿔 볼 수 있다.
// 개념 카드에서 처음 보이는 것은 설정의 '원본 그림 먼저 보기'를 따르고, 문제 위에서는 늘 원본이 먼저다
// (다시 그린 그림은 AI 가 읽은 만큼만 담겨서 문제를 풀 때 빠진 것이 있을 수 있다). 다시 그린 그림이 없으면 원본이다.
// question: 문제 위에 둘 때는 제목·설명을 숨긴다 (제목이 답을 알려 줄 수 있어서). 크게 보기는 시트로.
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArtView } from '@/components/art/ArtView';
import { artAlt } from '@/lib/art/spec';
import { FIG_KIND_LABEL, type FigKind, type QuestionFigure } from '@/lib/source-figures';
import { ICONS, Icon, Menu, Sheet, cx, type MenuItem } from '../ui';
import { useCropUrl } from './useCropUrl';

const KIND_ICON: Record<FigKind, string> = {
  map: ICONS.map,
  chart: ICONS.chart,
  table: ICONS.grid,
  timeline: ICONS.clock,
  diagram: ICONS.mindmap,
  photo: ICONS.image,
  artwork: ICONS.image,
  document: ICONS.file,
  cartoon: ICONS.pen,
  other: ICONS.image,
};

type View = 'art' | 'original';

/** 원본에서 자른 그림 (받는 동안은 같은 비율의 자리) */
function Original({ fig, alt, tall }: { fig: QuestionFigure; alt: string; tall?: boolean }) {
  const { url, failed } = useCropUrl(fig.crop);
  // 주소는 받았는데 그림을 못 읽었다 (지워졌거나 주소가 끝남)
  const [broken, setBroken] = useState<string | null>(null);
  const ratio = `${fig.w} / ${fig.h}`;
  if (failed || (url && broken === url)) {
    return (
      <div
        className="grid place-items-center bg-surface-2 px-4 py-8 text-center text-sm text-muted"
        style={{ aspectRatio: ratio, maxHeight: tall ? undefined : 420 }}
      >
        그림을 불러오지 못했어요.
      </div>
    );
  }
  if (!url) return <div className="kok-shimmer w-full bg-surface-2" style={{ aspectRatio: ratio, maxHeight: tall ? undefined : 420 }} aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 비공개 저장소의 서명 주소라 Next 이미지 최적화를 거치지 않는다
    <img
      src={url}
      alt={alt}
      width={fig.w}
      height={fig.h}
      draggable={false}
      onError={() => setBroken(url)}
      className="kok-fade mx-auto block h-auto w-full bg-white object-contain"
      style={{ aspectRatio: ratio, maxHeight: tall ? undefined : 420 }}
    />
  );
}

/** 다시 그린 그림 ↔ 원본 */
function ViewSwitch({ view, onView, label }: { view: View; onView: (v: View) => void; label: string }) {
  const opt = (v: View, text: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === v}
      className={cx(
        'press rounded-full px-3 py-1 text-xs font-semibold transition-colors duration-200',
        view === v ? 'bg-ink text-surface' : 'text-muted hover:text-ink',
      )}
      onClick={() => onView(v)}
    >
      {text}
    </button>
  );
  return (
    <div role="radiogroup" aria-label={`${label} 보기`} className="inline-flex rounded-full bg-surface-2 p-0.5">
      {opt('art', '다시 그린 그림')}
      {opt('original', '원본')}
    </div>
  );
}

export function SourceFigureView({
  fig,
  variant = 'card',
  originalFirst = false,
  pageLabel,
  onOpenPage,
  menu,
  className,
  footer,
}: {
  fig: QuestionFigure;
  /** card: 개념 카드·자료 그림 (제목·설명), question: 문제 위 (제목·설명을 숨긴다) */
  variant?: 'card' | 'question';
  /** 설정: 원본 그림 먼저 보기 (개념 카드에서만. 문제 위에서는 늘 원본이 먼저) */
  originalFirst?: boolean;
  /** 원본 자리 ('3쪽', '사진 2'). onOpenPage 가 있으면 누르면 원본 탭으로 */
  pageLabel?: string;
  onOpenPage?: (page: number) => void;
  menu?: MenuItem[];
  className?: string;
  /** 설명 아래에 더 보여 줄 것 */
  footer?: ReactNode;
}) {
  const hasArt = !!fig.art;
  const question = variant === 'question';
  const [view, setView] = useState<View>(hasArt && !originalFirst && !question ? 'art' : 'original');
  const shown: View = view === 'art' && hasArt ? 'art' : 'original';
  const [zoom, setZoom] = useState(false);
  const kindLabel = FIG_KIND_LABEL[fig.kind];
  // 문제 위에서는 제목·설명을 화면 읽기에도 알리지 않는다 (답을 알려 줄 수 있어서)
  const name = question ? '자료 그림' : fig.title || kindLabel;
  const alt = question ? `자료 그림 (${kindLabel})` : `${name}${fig.caption ? `: ${fig.caption}` : ''}`;

  const body = (tall: boolean) =>
    shown === 'art' && fig.art ? (
      <div className="bg-surface p-2">
        <ArtView art={fig.art} title={question ? `자료 그림 (${kindLabel})` : artAlt(fig.art)} hideTitle={question} />
      </div>
    ) : (
      <Original fig={fig} alt={alt} tall={tall} />
    );

  return (
    // data-own-keys: 그림의 버튼에서 누른 Enter·숫자 키로 문제를 넘기거나 답하지 않게 (QuestionCard 의 키보드)
    <figure className={cx('grid gap-2', className)} data-own-keys="" onClick={(e) => e.stopPropagation()}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
          <Icon d={KIND_ICON[fig.kind]} size={13} className="shrink-0" />
          {question ? '자료 그림' : kindLabel}
        </span>
        {!question && fig.title ? <span className="min-w-0 truncate text-sm font-bold">{fig.title}</span> : null}
        <span className="flex-1" />
        {menu?.length ? <Menu small label={`${name} 메뉴`} items={menu} /> : null}
      </div>
      <div className="overflow-hidden rounded-2xl ring-1 ring-line">{body(false)}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {hasArt ? <ViewSwitch view={shown} onView={setView} label={name} /> : null}
        <span className="flex-1" />
        <button
          type="button"
          className="press inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink"
          onClick={() => setZoom(true)}
        >
          <Icon d={ICONS.expand} size={14} />
          크게 보기
        </button>
      </div>
      {!question && (fig.caption || pageLabel) ? (
        <figcaption className="text-[13px] leading-relaxed text-muted">
          {fig.caption}
          {pageLabel ? (
            <>
              {fig.caption ? ' · ' : null}
              {onOpenPage && fig.page ? (
                <button type="button" className="font-semibold text-accent underline-offset-2 hover:underline" onClick={() => onOpenPage(fig.page)}>
                  {pageLabel}
                </button>
              ) : (
                <span>{pageLabel}</span>
              )}
            </>
          ) : null}
        </figcaption>
      ) : null}
      {footer}
      {/* 카드·문제는 움직임(transform) 때문에 겹침 순서가 따로 생겨서, 크게 보기는 화면 맨 위(body)에 띄운다 */}
      {zoom
        ? createPortal(
            <Sheet open onClose={() => setZoom(false)} title={name}>
              <div className="grid gap-3">
                {hasArt ? (
                  <div className="flex justify-center">
                    <ViewSwitch view={shown} onView={setView} label={name} />
                  </div>
                ) : null}
                <div className="overflow-hidden rounded-2xl ring-1 ring-line">{body(true)}</div>
                {!question && fig.caption ? <p className="text-sm leading-relaxed text-muted">{fig.caption}</p> : null}
              </div>
            </Sheet>,
            document.body,
          )
        : null}
    </figure>
  );
}
