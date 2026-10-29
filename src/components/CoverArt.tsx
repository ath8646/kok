'use client';
// 표지 그림 (lib/cover.ts): 문제 그림과 같은 그림체(FigureView)에 요소마다 색. 담는 칸을 꽉 채운다 (가운데 맞춤).
// 카드에서는 옆에 제목이 있어서 꾸미는 그림(화면 읽기 프로그램이 건너뜀), 표지 그림 창에서는 설명(alt)을 읽어 준다
import { COVER_FRAME, type Cover } from '@/lib/cover';
import { FigureView } from './figure/FigureView';

export function CoverArt({ cover, className, describe = false }: { cover: Cover; className?: string; describe?: boolean }) {
  return (
    <FigureView
      figure={cover.figure}
      tones={cover.tones}
      frame={COVER_FRAME}
      fill
      className={className}
      title={describe ? `표지 그림: ${cover.alt || '노트 내용 그림'}` : undefined}
      decorative={!describe}
    />
  );
}
