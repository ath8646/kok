'use client';
// 자료 그림을 콕 스타일로 다시 그린 것 (Pro): 지도·그래프·표·연표·도식. 설계도(Art)는 src/lib/art/spec.ts
// 색은 화면 색 변수만 써서 밝은·어두운 화면과 테마를 따른다. 그림 속 제목은 위에, 범례·출처는 아래에
import { artAlt, type Art } from '@/lib/art/spec';
import { ChartArtView } from './ChartArt';
import { DiagramArtView } from './DiagramArt';
import { MapArtView } from './MapArt';
import { TableArtView } from './TableArt';
import { TimelineArtView } from './TimelineArt';
import { ArtFrame, Legend } from './shared';

/** title: 화면 읽기 이름 (기본 artAlt). hideTitle: 그림 속 제목을 숨긴다 (그림 문제 위: 답을 알려 줄 수 있어서) */
export function ArtView({ art, className, title, hideTitle = false }: { art: Art; className?: string; title?: string; hideTitle?: boolean }) {
  const label = title ?? artAlt(art);
  // 범례: 지도는 그림의 범례, 그래프는 이름 있는 줄을 (원·피라미드는 그림 안에 쓴다)
  const legend =
    art.kind === 'map' ? (
      <Legend items={art.legend} />
    ) : art.kind === 'chart' && art.type !== 'pie' && art.type !== 'pyramid' ? (
      <Legend items={art.series.filter((s) => s.name).map((s) => ({ tone: s.tone, text: s.name, kind: s.as === 'line' ? 'line' : 'area' }))} />
    ) : null;
  return (
    <ArtFrame title={hideTitle ? '' : art.title} notes={art.notes} legend={legend} className={className}>
      {art.kind === 'map' ? <MapArtView art={art} label={label} /> : null}
      {art.kind === 'chart' ? <ChartArtView art={art} label={label} /> : null}
      {art.kind === 'table' ? <TableArtView art={art} label={label} /> : null}
      {art.kind === 'timeline' ? <TimelineArtView art={art} label={label} /> : null}
      {art.kind === 'diagram' ? <DiagramArtView art={art} label={label} /> : null}
    </ArtFrame>
  );
}
