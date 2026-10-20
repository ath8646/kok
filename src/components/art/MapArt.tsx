'use client';
// 지도 다시 그리기: 실제 해안선(Natural Earth) 위에 AI 가 준 영역·선·점·글을 그린다.
// 영역은 땅 모양으로 잘라서(clipPath), AI 가 대강 그린 경계여도 해안선은 반듯하게 나온다.
import { memo, useId, useMemo, useState, type ReactNode } from 'react';
import { BORDER_FILES, LAND_FILES, pickMapFile, type MapFile } from '@/lib/art/basemap';
import { boundsOf, fitFrame, inRing, labelSpot, linePath, overlaps, projectFlat, ringPath, type Bounds, type Frame, type XY } from '@/lib/art/geo';
import { placeLabels, textWidth, type LabelReq, type Rect } from '@/lib/figure/layout';
import { placeLineLabels, type LineLabelReq } from '@/lib/art/layout';
import type { ArtTone, MapArt } from '@/lib/art/spec';
import { useMapFile } from './useLand';
import { FONT, TONE_VAR, arrowHead, haloText, svgStyle } from './shared';

const W = 360;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** 밑그림 파일의 고리·선마다 범위 (파일마다 한 번만 센다) */
const knownBounds = new WeakMap<number[][], Array<Bounds | null>>();
function boundsList(list: number[][]): Array<Bounds | null> {
  let b = knownBounds.get(list);
  if (!b) {
    b = list.map((r) => boundsOf(r));
    knownBounds.set(list, b);
  }
  return b;
}

/** 보는 범위에 걸치는 땅 고리들 (화면 좌표) */
function visibleRings(file: MapFile | null | undefined, frame: Frame): XY[][] {
  if (!file?.rings) return [];
  const v = frame.view;
  const pad = { west: v.west - 1, east: v.east + 1, south: v.south - 1, north: v.north + 1 };
  const bs = boundsList(file.rings);
  const out: XY[][] = [];
  file.rings.forEach((ring, i) => {
    const b = bs[i];
    if (b && overlaps(b, pad)) out.push(projectFlat(ring, frame));
  });
  return out;
}

function visibleLines(file: MapFile | null | undefined, frame: Frame): XY[][] {
  if (!file?.lines) return [];
  const v = frame.view;
  const pad = { west: v.west - 1, east: v.east + 1, south: v.south - 1, north: v.north + 1 };
  const bs = boundsList(file.lines);
  const out: XY[][] = [];
  file.lines.forEach((line, i) => {
    const b = bs[i];
    if (b && overlaps(b, pad)) out.push(projectFlat(line, frame));
  });
  return out;
}

type LabelDraw = LabelReq & { text: string; style: ReturnType<typeof haloText> };

export const MapArtView = memo(function MapArtView({ art, label }: { art: MapArt; label: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const frame = useMemo(() => fitFrame(art.view, W, 220, 480), [art.view]);
  const landName = art.land ? pickMapFile(LAND_FILES, frame.view) : null;
  const borderName = art.land && art.borders ? pickMapFile(BORDER_FILES, frame.view) : null;
  const land = useMapFile(landName);
  const borders = useMapFile(borderName);
  // 해안선을 받는 중 (못 받으면 null 이라 밑그림 없이 그린다). 처음에 기다렸으면 나타날 때 살짝 나타난다
  const waiting = land === undefined;
  const [waitedAtStart] = useState(waiting);
  const landRings = useMemo(() => visibleRings(land, frame), [land, frame]);
  const landD = useMemo(() => landRings.map(ringPath).join(''), [landRings]);
  const borderD = useMemo(
    () =>
      visibleLines(borders, frame)
        .map((l) => linePath(l))
        .join(''),
    [borders, frame],
  );
  const H = frame.H;

  // 땅 위의 점인지 (영역 이름을 바다에 두지 않게)
  const onLand = useMemo(() => {
    if (!landRings.length) return undefined;
    const boxes = landRings.map((r) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of r) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      return { x0, x1, y0, y1 };
    });
    return (p: XY) => {
      let n = 0;
      landRings.forEach((r, i) => {
        const b = boxes[i];
        if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && inRing(p, r)) n++;
      });
      return n % 2 === 1;
    };
  }, [landRings]);

  const areas = useMemo(() => art.areas.map((a) => ({ a, pts: projectFlat(a.pts, frame) })), [art.areas, frame]);
  const lines = useMemo(() => art.lines.map((l) => ({ l, pts: projectFlat(l.pts, frame) })), [art.lines, frame]);

  const clipLand = landD ? `url(#${uid}-land)` : undefined;
  const hatches = new Set<ArtTone>(art.areas.filter((a) => a.style === 'hatch').map((a) => a.tone));

  // 영역
  const areaFills: ReactNode[] = [];
  const freeFills: ReactNode[] = [];
  areas.forEach(({ a, pts }, i) => {
    const d = ringPath(pts);
    if (!d) return;
    const c = TONE_VAR[a.tone];
    const el = (
      <g key={`a${i}`}>
        {a.style === 'outline' ? null : (
          <path d={d} style={{ fill: a.style === 'hatch' ? `url(#${uid}-h-${a.tone})` : c, fillOpacity: a.style === 'hatch' ? 1 : 0.26 }} />
        )}
        {a.style === 'hatch' ? <path d={d} style={{ fill: c, fillOpacity: 0.08 }} /> : null}
        <path
          d={d}
          style={{
            fill: 'none',
            stroke: c,
            strokeWidth: a.style === 'outline' ? 1.8 : 1.3,
            strokeOpacity: 0.9,
            strokeDasharray: a.style === 'outline' ? '5 3' : undefined,
            strokeLinejoin: 'round',
          }}
        />
      </g>
    );
    if (a.clip && clipLand) areaFills.push(el);
    else freeFills.push(el);
  });

  // 선: 강 → 경계·성벽·길 → 진출로·바닷길 (화살표는 맨 위)
  const segs: Array<[XY, XY]> = [];
  const lineEls: ReactNode[] = [];
  const order = (k: string) => (k === 'river' ? 0 : k === 'route' || k === 'sea_route' ? 2 : 1);
  [...lines]
    .map((x, i) => ({ ...x, i }))
    .sort((p, q) => order(p.l.kind) - order(q.l.kind))
    .forEach(({ l, pts, i }) => {
      if (pts.length < 2) return;
      for (let k = 1; k < pts.length; k++) segs.push([pts[k - 1], pts[k]]);
      const c = TONE_VAR[l.tone];
      const smooth = l.kind === 'route' || l.kind === 'sea_route' || l.kind === 'river';
      const tip = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      // 화살표면 선 끝을 화살촉 뒤로 조금 당긴다 (둥근 끝이 촉 밖으로 나오지 않게)
      const body = l.arrow ? [...pts.slice(0, -1), pull(prev, tip, 5)] : pts;
      const d = linePath(body, smooth);
      const key = `l${i}`;
      if (l.kind === 'river') {
        lineEls.push(
          <path key={key} d={d} style={{ fill: 'none', stroke: c, strokeWidth: 1.7, strokeOpacity: 0.85, strokeLinecap: 'round', strokeLinejoin: 'round' }} />,
        );
      } else if (l.kind === 'border') {
        lineEls.push(<path key={key} d={d} style={{ fill: 'none', stroke: c, strokeWidth: 1.5, strokeDasharray: '5 3', strokeLinecap: 'round' }} />);
      } else if (l.kind === 'wall') {
        lineEls.push(
          <g key={key}>
            <path d={d} style={{ fill: 'none', stroke: c, strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
            <path d={d} style={{ fill: 'none', stroke: c, strokeWidth: 4.2, strokeDasharray: '2 3', strokeLinejoin: 'round' }} />
          </g>,
        );
      } else if (l.kind === 'road') {
        lineEls.push(
          <path key={key} d={d} style={{ fill: 'none', stroke: c, strokeWidth: 1.3, strokeOpacity: 0.9, strokeLinecap: 'round', strokeLinejoin: 'round' }} />,
        );
      } else {
        lineEls.push(
          <g key={key}>
            <path
              d={d}
              style={{ fill: 'none', stroke: 'var(--surface)', strokeWidth: 5.4, strokeOpacity: 0.85, strokeLinecap: 'round', strokeLinejoin: 'round' }}
            />
            <path
              d={d}
              style={{
                fill: 'none',
                stroke: c,
                strokeWidth: 2.6,
                strokeDasharray: l.kind === 'sea_route' ? '7 4' : undefined,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }}
            />
          </g>,
        );
      }
      if (l.arrow) lineEls.push(<path key={`${key}h`} d={arrowHead(prev, tip, 9)} style={{ fill: c, stroke: 'var(--surface)', strokeWidth: 0.8 }} />);
    });

  // 점
  const obstacles: Rect[] = [];
  const marks: ReactNode[] = [];
  const P = (lon: number, lat: number): XY => ({ x: frame.x(lon), y: frame.y(lat) });
  art.places.forEach((p, i) => {
    const at = P(p.lon, p.lat);
    obstacles.push({ x: at.x - 5, y: at.y - 5, w: 10, h: 10 });
    const key = `p${i}`;
    if (p.kind === 'capital') {
      marks.push(
        <g key={key}>
          <circle cx={r1(at.x)} cy={r1(at.y)} r={4.6} style={{ fill: 'var(--surface)', stroke: 'var(--ink)', strokeWidth: 1.6 }} />
          <circle cx={r1(at.x)} cy={r1(at.y)} r={1.9} style={{ fill: 'var(--ink)' }} />
        </g>,
      );
    } else if (p.kind === 'battle') {
      marks.push(
        <path
          key={key}
          d={`M${r1(at.x - 4)} ${r1(at.y - 4)}L${r1(at.x + 4)} ${r1(at.y + 4)}M${r1(at.x + 4)} ${r1(at.y - 4)}L${r1(at.x - 4)} ${r1(at.y + 4)}`}
          style={{ stroke: 'var(--bad)', strokeWidth: 2.4, strokeLinecap: 'round' }}
        />,
      );
    } else if (p.kind === 'site') {
      marks.push(
        <path
          key={key}
          d={`M${r1(at.x)} ${r1(at.y - 5)}L${r1(at.x + 5)} ${r1(at.y)}L${r1(at.x)} ${r1(at.y + 5)}L${r1(at.x - 5)} ${r1(at.y)}Z`}
          style={{ fill: 'var(--b6)', stroke: 'var(--surface)', strokeWidth: 1.2 }}
        />,
      );
    } else if (p.kind === 'mountain') {
      marks.push(
        <path
          key={key}
          d={`M${r1(at.x)} ${r1(at.y - 5.5)}L${r1(at.x + 5.5)} ${r1(at.y + 4)}L${r1(at.x - 5.5)} ${r1(at.y + 4)}Z`}
          style={{ fill: 'var(--muted)', stroke: 'var(--surface)', strokeWidth: 1 }}
        />,
      );
    } else if (p.kind === 'port') {
      marks.push(<circle key={key} cx={r1(at.x)} cy={r1(at.y)} r={3.8} style={{ fill: 'var(--b1)', stroke: 'var(--surface)', strokeWidth: 1.4 }} />);
    } else {
      marks.push(<circle key={key} cx={r1(at.x)} cy={r1(at.y)} r={3.2} style={{ fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 1.3 }} />);
    }
  });

  // 글자: 자리가 정해진 것(영역 이름·지도 위 글)부터, 그다음 점 이름, 선 이름
  const reqs: LabelDraw[] = [];
  const add = (key: string, at: XY, text: string, style: ReturnType<typeof haloText>, dir?: XY, dist = 5) => {
    if (!text) return;
    const size = Number(style.fontSize);
    const w = textWidth(text, size) + 4;
    const h = size + 4;
    // 자리가 정해진 글은 그림 밖으로 나가지 않게 안으로 민다
    const spot = dir ? at : { x: Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, at.x)), y: Math.max(h / 2 + 4, Math.min(H - h / 2 - 4, at.y)) };
    reqs.push({ key, at: spot, dir, dist, w, h, text, style });
  };
  areas.forEach(({ a, pts }, i) => {
    if (!a.label) return;
    const at = labelSpot(pts, a.clip ? onLand : undefined);
    if (at) add(`al${i}`, at, a.label, haloText({ size: 13.5, weight: 800 }));
  });
  art.labels.forEach((l, i) => {
    const at = P(l.lon, l.lat);
    const style =
      l.kind === 'sea'
        ? haloText({ size: 11.5, weight: 600, color: 'var(--b1)', italic: true })
        : l.kind === 'marker'
          ? haloText({ size: 14, weight: 800 })
          : l.kind === 'note'
            ? haloText({ size: 11, weight: 500, color: 'var(--muted)' })
            : haloText({ size: 12.5, weight: 700, color: 'var(--muted)' });
    add(`fl${i}`, at, l.text, style);
  });
  art.places.forEach((p, i) => add(`pl${i}`, P(p.lon, p.lat), p.label, haloText({ size: 11.5, weight: 600 }), { x: 1, y: -0.35 }, 5));
  const bounds = { x: 3, y: 3, w: W - 6, h: H - 6 };
  const spots = placeLabels(reqs, obstacles, bounds, segs);
  const placed: Rect[] = [...obstacles, ...reqs.map((r) => rectAt(spots.get(r.key) ?? r.at, r))];
  // 선 이름은 따로, 제 선 곁에 (옆 진출로의 이름처럼 읽히면 틀린 그림이 된다)
  const lineReqs: LineLabelReq[] = [];
  lines.forEach(({ l, pts }, i) => {
    if (!l.label || pts.length < 2) return;
    const size = 11.5;
    const w = textWidth(l.label, size) + 4;
    reqs.push({ key: `ll${i}`, at: pts[0], dist: 0, w, h: size + 4, text: l.label, style: haloText({ size, weight: 700, color: TONE_VAR[l.tone] }) });
    lineReqs.push({ key: `ll${i}`, line: i, w, h: size + 4 });
  });
  placeLineLabels(
    lineReqs,
    lines.map((x) => x.pts),
    placed,
    bounds,
  ).forEach((c, key) => spots.set(key, c));
  const labels = reqs.map((r) => {
    const c = spots.get(r.key) ?? r.at;
    return (
      <text key={r.key} x={r1(c.x)} y={r1(c.y)} textAnchor="middle" dominantBaseline="central" style={r.style}>
        {r.text}
      </text>
    );
  });

  const radius = 14;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ ...svgStyle(560), fontFamily: FONT }}>
      <defs>
        <clipPath id={`${uid}-frame`}>
          <rect x={0} y={0} width={W} height={H} rx={radius} />
        </clipPath>
        {landD ? (
          <clipPath id={`${uid}-land`}>
            <path d={landD} clipRule="evenodd" />
          </clipPath>
        ) : null}
        {[...hatches].map((t) => (
          <pattern key={t} id={`${uid}-h-${t}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: TONE_VAR[t], strokeWidth: 1.7, strokeOpacity: 0.75 }} />
          </pattern>
        ))}
      </defs>
      <g clipPath={`url(#${uid}-frame)`}>
        <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--bg)' }} />
        {art.land ? <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--b1)', fillOpacity: 0.07 }} /> : null}
        {/* 해안선을 받는 동안은 바다만 (자르지 않은 영역이 잠깐 보였다가 바뀌지 않게) */}
        {waiting ? null : (
          <g className={waitedAtStart ? 'kok-fig-in' : undefined}>
            {landD ? (
              <path d={landD} style={{ fill: 'var(--surface)', fillRule: 'evenodd', stroke: 'var(--muted)', strokeOpacity: 0.45, strokeWidth: 0.8 }} />
            ) : null}
            {borderD ? (
              <path d={borderD} style={{ fill: 'none', stroke: 'var(--muted)', strokeOpacity: 0.55, strokeWidth: 0.8, strokeDasharray: '3 2' }} />
            ) : null}
            {areaFills.length ? <g clipPath={clipLand}>{areaFills}</g> : null}
            {freeFills}
            {lineEls}
            {marks}
            {labels}
          </g>
        )}
      </g>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={radius} style={{ fill: 'none', stroke: 'var(--line)' }} />
    </svg>
  );
});

const rectAt = (c: XY, r: { w: number; h: number }): Rect => ({ x: c.x - r.w / 2, y: c.y - r.h / 2, w: r.w, h: r.h });

/** a 에서 b 로 가다가 b 앞 by 만큼에서 멈춘 점 */
function pull(a: XY, b: XY, by: number): XY {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= by * 1.5) return b;
  return { x: b.x - ((b.x - a.x) * by) / len, y: b.y - ((b.y - a.y) * by) / len };
}
