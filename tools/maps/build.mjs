// 지도 밑그림(땅 모양·나라 경계) 만들기: Natural Earth 자료(퍼블릭 도메인, world-atlas 2.0.2 의 TopoJSON)를
// 화면에서 바로 쓰는 납작한 경도·위도 배열로 바꿔 public/maps/ 에 쓴다. 만든 파일은 저장소에 올린다 (앱은 이 도구를 돌리지 않는다).
// 실행: node tools/maps/build.mjs  (Node 22 이상: src/lib/art/geo.ts 를 그대로 불러 쓴다)
//  - land-world-110m.json   세계 (110m)
//  - land-east-asia-50m.json 동아시아 (50m: 한반도·만주·황해·산둥·일본)
//  - land-korea-10m.json    한반도 (10m: 섬과 해안이 자세하다)
//  - borders-world-110m.json, borders-east-asia-50m.json  오늘날 나라 경계 (지리 지도에서만 쓴다)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { feature, mesh } from 'topojson-client';
import { clipLine, clipRing, simplifyFlat } from '../../src/lib/art/geo.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../public/maps');
const require = createRequire(import.meta.url);
const atlas = (name) => JSON.parse(readFileSync(require.resolve(`world-atlas/${name}`), 'utf8'));
const SRC = 'Natural Earth (public domain), via world-atlas 2.0.2';

// 파일마다 덮는 범위 [서, 남, 동, 북]
const WORLD = { west: -180, south: -85, east: 180, north: 85 };
const EAST_ASIA = { west: 95, south: 15, east: 150, north: 56 };
const KOREA = { west: 123, south: 32.5, east: 132.5, north: 43.6 };

const round2 = (n) => Math.round(n * 100) / 100;

/** 고리·선 목록을 범위로 자르고, 단순하게 하고, 소수 둘째 자리로 */
function rings(geo, bounds, tol, minArea) {
  const out = [];
  const polys = geo.type === 'FeatureCollection' ? geo.features.map((f) => f.geometry) : [geo.geometry ?? geo];
  for (const g of polys) {
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of list) {
      for (const ring of poly) {
        let flat = ring.flat();
        if (bounds !== WORLD) flat = clipRing(flat, bounds);
        if (flat.length < 6) continue;
        flat = simplifyFlat(flat, tol).map(round2);
        // 같은 점이 이어지면 하나로
        const clean = [];
        for (let k = 0; k + 1 < flat.length; k += 2) {
          const n = clean.length;
          if (n >= 2 && clean[n - 2] === flat[k] && clean[n - 1] === flat[k + 1]) continue;
          clean.push(flat[k], flat[k + 1]);
        }
        if (clean.length < 8 || areaOf(clean) < minArea) continue;
        out.push(clean);
      }
    }
  }
  return out;
}

function lines(geo, bounds, tol) {
  const out = [];
  const list = geo.type === 'MultiLineString' ? geo.coordinates : geo.type === 'LineString' ? [geo.coordinates] : [];
  for (const line of list) {
    const flat = line.flat();
    const pieces = bounds === WORLD ? [flat] : clipLine(flat, bounds);
    for (const p of pieces) {
      const s = simplifyFlat(p, tol).map(round2);
      if (s.length >= 4) out.push(s);
    }
  }
  return out;
}

function areaOf(flat) {
  let a = 0;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (flat[j * 2] + flat[i * 2]) * (flat[j * 2 + 1] - flat[i * 2 + 1]);
  return Math.abs(a / 2);
}

function write(name, bounds, body) {
  mkdirSync(out, { recursive: true });
  const json = JSON.stringify({ v: 1, src: SRC, bbox: [bounds.west, bounds.south, bounds.east, bounds.north], ...body });
  writeFileSync(path.join(out, name), json);
  console.log(name.padEnd(28), `${(json.length / 1024).toFixed(1)} KB`, Object.entries(body).map(([k, v]) => `${k}:${v.length}`).join(' '));
}

const land110 = atlas('land-110m.json');
const land50 = atlas('land-50m.json');
const land10 = atlas('land-10m.json');
const countries110 = atlas('countries-110m.json');
const countries50 = atlas('countries-50m.json');

write('land-world-110m.json', WORLD, { rings: rings(feature(land110, land110.objects.land), WORLD, 0.05, 0.3) });
write('land-east-asia-50m.json', EAST_ASIA, { rings: rings(feature(land50, land50.objects.land), EAST_ASIA, 0.018, 0.003) });
write('land-korea-10m.json', KOREA, { rings: rings(feature(land10, land10.objects.land), KOREA, 0.006, 0.0003) });
write('borders-world-110m.json', WORLD, { lines: lines(mesh(countries110, countries110.objects.countries, (a, b) => a !== b), WORLD, 0.08) });
write('borders-east-asia-50m.json', EAST_ASIA, {
  lines: lines(mesh(countries50, countries50.objects.countries, (a, b) => a !== b), EAST_ASIA, 0.03),
});
