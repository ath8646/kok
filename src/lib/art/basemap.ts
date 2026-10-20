// 지도 밑그림 파일 고르기 (public/maps/, tools/maps/build.mjs 가 만든다). 보는 범위를 다 덮는 가장 자세한 파일을 쓴다.
import { inside, type Bounds } from './geo';

export type MapFileInfo = { name: string; bbox: Bounds };

/** 땅 모양: 자세한 것부터 (한반도 10m → 동아시아 50m → 세계 110m) */
export const LAND_FILES: MapFileInfo[] = [
  { name: 'land-korea-10m', bbox: { west: 123, south: 32.5, east: 132.5, north: 43.6 } },
  { name: 'land-east-asia-50m', bbox: { west: 95, south: 15, east: 150, north: 56 } },
  { name: 'land-world-110m', bbox: { west: -180, south: -85, east: 180, north: 85 } },
];

/** 오늘날 나라 경계 */
export const BORDER_FILES: MapFileInfo[] = [
  { name: 'borders-east-asia-50m', bbox: { west: 95, south: 15, east: 150, north: 56 } },
  { name: 'borders-world-110m', bbox: { west: -180, south: -85, east: 180, north: 85 } },
];

/** 범위를 다 덮는 가장 자세한 파일 (없으면 세계 파일) */
export function pickMapFile(files: MapFileInfo[], view: Bounds): string {
  return (files.find((f) => inside(view, f.bbox)) ?? files[files.length - 1]).name;
}

/** 밑그림 파일 모양: rings 는 땅 고리들(짝홀 규칙으로 칠한다), lines 는 경계선들. 모두 [경도, 위도, …] */
export type MapFile = { v: 1; bbox: [number, number, number, number]; rings?: number[][]; lines?: number[][] };

export function readMapFile(raw: unknown): MapFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const okList = (v: unknown) => Array.isArray(v) && v.every((x) => Array.isArray(x) && x.every((n) => typeof n === 'number'));
  if (r.rings !== undefined && !okList(r.rings)) return null;
  if (r.lines !== undefined && !okList(r.lines)) return null;
  if (!Array.isArray(r.bbox) || r.bbox.length !== 4) return null;
  return r as unknown as MapFile;
}
