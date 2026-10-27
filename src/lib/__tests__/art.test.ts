import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ART_KINDS, ART_LIMITS, ART_MAX_BYTES, artAlt, artJsonSchema, normalizeArt, readArt, yearFrom, type ArtKind, type MapArt } from '@/lib/art/spec';
import { clipLine, clipRing, fitFrame, inRing, labelSpot, ringArea, simplifyFlat, type XY } from '@/lib/art/geo';
import { BORDER_FILES, LAND_FILES, pickMapFile, readMapFile } from '@/lib/art/basemap';
import { layoutDiagram, layoutTimeline, linkRoute, niceRange, placeLineLabels, pointAlong, rectLineDist } from '@/lib/art/layout';
import { redrawPrompt } from '@/lib/ai/prompts';

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** 구조화 출력 규칙: 모든 객체는 additionalProperties:false, required 가 모든 칸, 재귀·길이 제한 없음 */
function walk(schema: unknown, at: string, problems: string[]) {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;
  for (const bad of ['$ref', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'oneOf', 'anyOf', 'allOf', 'pattern', 'format']) {
    if (bad in s) problems.push(`${at}: ${bad}`);
  }
  if (s.type === 'object') {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    if (s.additionalProperties !== false) problems.push(`${at}: additionalProperties`);
    const req = new Set((s.required ?? []) as string[]);
    const keys = Object.keys(props);
    if (req.size !== keys.length || keys.some((k) => !req.has(k))) problems.push(`${at}: required`);
    for (const k of keys) walk(props[k], `${at}.${k}`, problems);
  }
  if (s.type === 'array') walk(s.items, `${at}[]`, problems);
}

const MAP_RAW = {
  title: '<5세기 고구려의 전성기>',
  notes: '',
  view: { west: 119.5, east: 133, south: 33.2, north: 46 },
  land: true,
  borders: false,
  areas: [
    { label: '(가)', tone: 'red', style: 'fill', clip: true, pts: [121, 40.6, 124, 44.6, 130, 44.6, 129.2, 37.6, 126.3, 37.6] },
    { label: '(나)', tone: 'green', style: 'fill', clip: true, pts: [126, 37, 127.4, 37.1, 127.6, 35.4, 126, 34.2] },
  ],
  lines: [{ label: '남진', tone: 'red', kind: 'route', arrow: true, pts: [125.75, 39, 127, 37.6] }],
  places: [{ label: '평양', lon: 125.75, lat: 39.03, kind: 'capital' }],
  labels: [{ text: '동해', lon: 131, lat: 38, kind: 'sea' }],
  legend: [{ tone: 'red', text: '고구려의 진출', kind: 'line' }],
};

describe('다시 그리기 설계도: JSON 스키마', () => {
  it.each(ART_KINDS)('%s 스키마는 구조화 출력 규칙을 지킨다', (kind) => {
    const problems: string[] = [];
    walk(artJsonSchema(kind), kind, problems);
    expect(problems).toEqual([]);
  });

  it('종류마다 스키마가 따로이고 작다, 그대로 다시 그릴 수 있는지(redrawable)를 맨 먼저 쓴다', () => {
    for (const kind of ART_KINDS) {
      expect(bytes(artJsonSchema(kind))).toBeLessThan(2500);
      expect(Object.keys((artJsonSchema(kind) as { properties: object }).properties)[0]).toBe('redrawable');
    }
    expect(artJsonSchema('map')).not.toEqual(artJsonSchema('chart'));
    expect(redrawPrompt({ kind: 'map' })).toContain('redrawable: false');
  });

  it('지시에 종류별 설명과 그대로 옮기기 규칙이 들어간다', () => {
    const p = redrawPrompt({ kind: 'map' });
    expect(p).toContain('longitude');
    expect(p).toContain('(가)');
    expect(p).toContain('Never add a name');
    // 그림 문제에서 숨기는 이름·설명(정리할 때 AI 가 쓴 것)은 보내지 않는다
    expect(p).not.toContain('What it shows');
    expect(redrawPrompt({ kind: 'chart' })).toContain('pyramid');
  });
});

describe('다시 그리기 설계도: 검사 (normalizeArt)', () => {
  it.each(ART_KINDS)('%s: 엉뚱한 값은 null', (kind: ArtKind) => {
    for (const raw of [null, undefined, 'map', 3, [], {}, { areas: 'x', rows: 5, events: {}, nodes: null, categories: 7 }]) {
      expect(normalizeArt(kind, raw)).toBeNull();
    }
  });

  it('지도: 표시 글을 그대로 옮기고, 이상한 색·점·범위를 고친다', () => {
    const art = normalizeArt('map', {
      ...MAP_RAW,
      view: { west: 'x', east: 0, south: 0, north: 0 },
      areas: [
        ...MAP_RAW.areas,
        { label: '두 점뿐', tone: 'red', style: 'fill', clip: true, pts: [1, 1, 2, 2] },
        { label: '  ㉠  ', tone: 'crimson', style: 'weird', clip: 'yes', pts: [10, 10, 20, 10, 20, 20, 999] },
      ],
      places: [
        { label: '먼 곳', lon: 500, lat: -200, kind: 'castle' },
        { label: '빠진 위도', lon: 1 },
      ],
    }) as MapArt;
    expect(art).not.toBeNull();
    expect(art.v).toBe(1);
    expect(art.kind).toBe('map');
    expect(art.areas.map((a) => a.label)).toEqual(['(가)', '(나)', '㉠']);
    expect(art.areas[2]).toMatchObject({ tone: 'blue', style: 'fill', clip: true, pts: [10, 10, 20, 10, 20, 20] });
    expect(art.places).toEqual([{ label: '먼 곳', lon: 180, lat: -85, kind: 'city' }]);
    // 범위가 이상하면 그릴 것들을 감싸는 범위로
    expect(art.view.west).toBeLessThan(10);
    expect(art.view.east).toBeGreaterThanOrEqual(180);
  });

  it('그대로 다시 그릴 수 없는 그림은 원본만 (null): AI 가 아니라고 함·도시 크기 지도·한가운데 몰린 지도', () => {
    expect(normalizeArt('map', { ...MAP_RAW, redrawable: false })).toBeNull();
    expect(normalizeArt('table', { redrawable: false, title: '', notes: '', columns: ['a'], rows: [['1']], row_header: false })).toBeNull();
    // 예전에 저장한 설계도(redrawable 칸이 없다)는 그대로 읽는다
    expect(readArt(normalizeArt('map', MAP_RAW))).not.toBeNull();
    expect(normalizeArt('map', { ...MAP_RAW, redrawable: true })).not.toBeNull();
    // 도성도처럼 도시 안의 지도 (보는 범위가 가로·세로 모두 약 45km 아래)
    const city = [
      { label: '경복궁', lon: 126.977, lat: 37.579, kind: 'site' },
      { label: '종묘', lon: 126.994, lat: 37.574, kind: 'site' },
      { label: '숭례문', lon: 126.975, lat: 37.56, kind: 'site' },
      { label: '흥인지문', lon: 127.009, lat: 37.571, kind: 'site' },
    ];
    expect(
      normalizeArt('map', { ...MAP_RAW, view: { west: 126.95, east: 127.03, south: 37.54, north: 37.6 }, areas: [], lines: [], places: city, labels: [] }),
    ).toBeNull();
    // 범위는 넓은데 점·글이 모두 한 곳에 몰려 있다 (이름이 한가운데 겹쳐 그려진다)
    expect(
      normalizeArt('map', { ...MAP_RAW, view: { west: 120, east: 132, south: 33, north: 43 }, areas: [], lines: [], places: city, labels: [] }),
    ).toBeNull();
    // 둘레의 설명 글을 옮긴 긴 글은 빼고 지도에 쓰인 이름만
    const art = normalizeArt('map', {
      ...MAP_RAW,
      labels: [...MAP_RAW.labels, { text: '세계 유산 종묘: 왕실 조상의 패를 모신 곳이다. 유교 예법에 따라', lon: 127, lat: 37.5, kind: 'note' }],
    }) as MapArt;
    expect(art.labels.map((l) => l.text)).toEqual(['동해']);
  });

  it('긴 글은 줄이고 개수는 한도까지만', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ label: `도시${i}`, lon: 126 + i * 0.01, lat: 37, kind: 'city' }));
    const art = normalizeArt('map', { ...MAP_RAW, title: '가'.repeat(200), places: many }) as MapArt;
    expect(Array.from(art.title).length).toBe(ART_LIMITS.title);
    expect(art.title.endsWith('…')).toBe(true);
    expect(art.places.length).toBe(ART_LIMITS.places);
  });

  it('너무 큰 지도는 선을 단순하게 해서 16000바이트 안으로', () => {
    const ring = (cx: number, cy: number) =>
      Array.from({ length: 400 }, (_, k) => {
        const a = (k / 400) * Math.PI * 2;
        const r = 1 + 0.3 * Math.sin(a * 7);
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      }).flat();
    const areas = Array.from({ length: 14 }, (_, i) => ({
      label: `영역${i}`,
      tone: 'blue',
      style: 'fill',
      clip: true,
      pts: ring(120 + (i % 5) * 3, 30 + Math.floor(i / 5) * 3),
    }));
    const lines = Array.from({ length: 24 }, (_, i) => ({ label: '', tone: 'red', kind: 'route', arrow: true, pts: ring(120 + i, 40).slice(0, 200) }));
    const art = normalizeArt('map', { ...MAP_RAW, areas, lines }) as MapArt;
    expect(art).not.toBeNull();
    expect(bytes(art)).toBeLessThanOrEqual(ART_MAX_BYTES);
    expect(art.areas.length).toBe(14);
    for (const a of art.areas) expect(a.pts.length / 2).toBeLessThanOrEqual(ART_LIMITS.areaPts);
  });

  it('그래프: 값을 이름 수에 맞추고, 원은 한 줄·피라미드는 두 줄, 막대+꺾은선만 줄마다 모양·축을 고른다', () => {
    const series = [
      { name: '가', tone: 'red', values: [1, '2,000', 'x'], as: 'line', axis: 'right' },
      { name: '나', tone: 'blue', values: [5], as: 'line', axis: 'right' },
      { name: '다', tone: 'green', values: [7, 8, 9], as: 'bar', axis: 'left' },
    ];
    const bar = normalizeArt('chart', { type: 'bar', categories: ['1월', '2월', '3월'], series });
    expect(bar?.kind === 'chart' && bar.series.map((s) => [s.values, s.as, s.axis])).toEqual([
      [[1, 2000, 0], 'bar', 'left'],
      [[5, 0, 0], 'bar', 'left'],
      [[7, 8, 9], 'bar', 'left'],
    ]);
    const combo = normalizeArt('chart', { type: 'combo', categories: ['1월', '2월', '3월'], series });
    expect(combo?.kind === 'chart' && combo.series[0]).toMatchObject({ as: 'line', axis: 'right' });
    const pie = normalizeArt('chart', { type: 'pie', categories: ['a', 'b', 'c'], series, slice_tones: ['gray', 'nope'] });
    expect(pie?.kind === 'chart' && pie.series.length).toBe(1);
    expect(pie?.kind === 'chart' && pie.slice_tones).toEqual(['gray', 'orange', 'green']);
    expect(bar?.kind === 'chart' && bar.slice_tones).toEqual([]);
    const pyramid = normalizeArt('chart', { type: 'pyramid', categories: ['0~9', '10~19', '20~29'], series });
    expect(pyramid?.kind === 'chart' && pyramid.series.length).toBe(2);
    expect(normalizeArt('chart', { type: 'bar', categories: [], series })).toBeNull();
    expect(normalizeArt('chart', { type: 'bar', categories: ['a'], series: [{ name: '', values: [0] }] })).toBeNull();
  });

  it('표: 줄마다 칸 수를 맞추고(넘친 칸도 버리지 않는다) 빈 줄은 뺀다', () => {
    const t = normalizeArt('table', {
      columns: ['구분', '고구려', '백제'],
      rows: [['건국', '기원전 37년'], [], ['', '', ''], ['수도', '국내성', '한성', '넘친 칸']],
      row_header: true,
    });
    expect(t?.kind === 'table' && t.columns).toEqual(['구분', '고구려', '백제', '']);
    expect(t?.kind === 'table' && t.rows).toEqual([
      ['건국', '기원전 37년', '', ''],
      ['수도', '국내성', '한성', '넘친 칸'],
    ]);
    expect(normalizeArt('table', { columns: [], rows: [] })).toBeNull();
  });

  it('연표: 날짜 글에서 해를 읽고, 해 순서로, 거꾸로 된 기간은 바로잡는다', () => {
    expect(yearFrom('기원전 2333')).toBe(-2333);
    expect(yearFrom('BC 57')).toBe(-57);
    expect(yearFrom('1392년')).toBe(1392);
    expect(Number.isNaN(yearFrom('조선 전기'))).toBe(true);
    const t = normalizeArt('timeline', {
      events: [
        { when: '1446', year: 1446, label: '훈민정음 반포', detail: '', tone: 'orange' },
        { when: '기원전 2333', year: 'x', label: '고조선 건국', detail: '', tone: 'blue' },
      ],
      spans: [{ from: 1485, to: 1446, label: '(가)', tone: 'purple', lane: 9 }],
      even: false,
    });
    expect(t?.kind === 'timeline' && t.events.map((e) => e.year)).toEqual([-2333, 1446]);
    expect(t?.kind === 'timeline' && t.spans[0]).toMatchObject({ from: 1446, to: 1485, label: '(가)', lane: ART_LIMITS.lanes - 1 });
  });

  it('도식: 겹친 번호는 바꾸고, 없는 상자로 가는 선은 빼고, 칸 수를 상자에 맞춘다', () => {
    const d = normalizeArt('diagram', {
      cols: 1,
      rows: 1,
      nodes: [
        { id: 'a', label: '국왕', col: 0, row: 0, span: 9, shape: 'round', tone: 'orange', strong: true },
        { id: 'a', label: '의정부', col: 2, row: 1, span: 1, shape: 'star', tone: 'blue', strong: false },
      ],
      links: [
        { from: 'a', to: "a'", label: '', kind: 'arrow' },
        { from: 'a', to: 'zz', label: '', kind: 'arrow' },
      ],
      groups: [{ label: '중앙', tone: 'blue', col: 0, row: 0, cols: 9, rows: 9 }],
    });
    // 칸 수는 6 까지: 9 칸을 달라는 상자는 6 칸으로, 칸 수는 상자들이 들어가게 늘린다
    expect(d?.kind === 'diagram' && d.nodes.map((n) => [n.id, n.shape, n.span])).toEqual([
      ['a', 'round', 6],
      ["a'", 'box', 1],
    ]);
    expect(d?.kind === 'diagram' && [d.cols, d.rows]).toEqual([6, 2]);
    expect(d?.kind === 'diagram' && d.links.map((l) => l.to)).toEqual(["a'"]);
    expect(d?.kind === 'diagram' && d.groups[0]).toMatchObject({ cols: 6, rows: 2 });
  });

  it('저장한 설계도를 다시 읽으면 그대로다 (readArt)', () => {
    const art = normalizeArt('map', MAP_RAW);
    expect(readArt(JSON.parse(JSON.stringify(art)))).toEqual(art);
    expect(readArt({ kind: 'photo' })).toBeNull();
  });

  it('화면 읽기 글은 종류 이름으로 시작한다', () => {
    const art = normalizeArt('map', MAP_RAW)!;
    expect(artAlt(art)).toMatch(/^지도: <5세기 고구려의 전성기> — /);
    expect(artAlt(art)).toContain('(가)');
    const t = normalizeArt('table', { columns: ['구분', '고구려'], rows: [['건국', '기원전 37년']], row_header: true })!;
    expect(artAlt(t)).toBe('표: 구분, 고구려 · 1줄');
  });
});

describe('지도 계산 (geo)', () => {
  it('선 단순하게: 끝점은 남고 곧은 점은 빠진다', () => {
    expect(simplifyFlat([0, 0, 1, 0.001, 2, 0, 3, 5], 0.1)).toEqual([0, 0, 2, 0, 3, 5]);
    expect(simplifyFlat([0, 0, 1, 1], 1)).toEqual([0, 0, 1, 1]);
  });

  it('그림 틀: 높이는 한도 안, 넓힌 범위는 원래 범위를 품고 모서리가 틀 모서리로 간다', () => {
    const view = { west: 124, east: 131, south: 33, north: 43 };
    const f = fitFrame(view, 360, 220, 480);
    expect(f.H).toBeGreaterThanOrEqual(220);
    expect(f.H).toBeLessThanOrEqual(480);
    expect(f.view.west).toBeLessThanOrEqual(view.west);
    expect(f.view.east).toBeGreaterThanOrEqual(view.east);
    expect(f.x(f.view.west)).toBeCloseTo(0);
    expect(f.x(f.view.east)).toBeCloseTo(360);
    expect(f.y(f.view.north)).toBeCloseTo(0);
    expect(f.y(f.view.south)).toBeCloseTo(f.H);
  });

  it('영역 이름 자리는 오목한 모양에서도 안쪽', () => {
    // ㄴ 자 모양
    const L: XY[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const spot = labelSpot(L)!;
    expect(inRing(spot, L)).toBe(true);
    // ok 로 고른 쪽에만
    const right = labelSpot(L, (p) => p.x > 40)!;
    expect(right.x).toBeGreaterThan(40);
    expect(inRing(right, L)).toBe(true);
  });

  it('고리를 네모로 자르면 겹친 넓이만 남는다, 선은 나갔다 들어오면 조각난다', () => {
    const clipped = clipRing([0, 0, 10, 0, 10, 10, 0, 10], { west: 2, east: 5, south: -1, north: 3 });
    const pts: XY[] = [];
    for (let k = 0; k < clipped.length; k += 2) pts.push({ x: clipped[k], y: clipped[k + 1] });
    expect(ringArea(pts)).toBeCloseTo(9);
    expect(clipRing([0, 0, 1, 0, 1, 1], { west: 5, east: 6, south: 5, north: 6 })).toEqual([]);
    expect(clipLine([0, 0, 1, 1, 9, 9, 2, 2, 3, 3], { west: 0, east: 5, south: 0, north: 5 })).toEqual([
      [0, 0, 1, 1],
      [2, 2, 3, 3],
    ]);
  });
});

describe('지도 밑그림 파일', () => {
  const dir = path.resolve(__dirname, '../../../public/maps');

  it('보는 범위를 다 덮는 가장 자세한 파일을 고른다', () => {
    expect(pickMapFile(LAND_FILES, { west: 124, east: 131, south: 33, north: 43 })).toBe('land-korea-10m');
    expect(pickMapFile(LAND_FILES, { west: 115, east: 134, south: 29.5, north: 43 })).toBe('land-east-asia-50m');
    expect(pickMapFile(LAND_FILES, { west: -10, east: 40, south: 35, north: 60 })).toBe('land-world-110m');
    expect(pickMapFile(BORDER_FILES, { west: 124, east: 131, south: 33, north: 43 })).toBe('borders-east-asia-50m');
  });

  it('모든 파일이 public/maps 에 있고, 읽을 수 있고, 작다', () => {
    const names = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of [...LAND_FILES, ...BORDER_FILES]) expect(names).toContain(`${f.name}.json`);
    for (const name of names) {
      const file = readMapFile(JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
      expect(file, name).not.toBeNull();
      expect((file?.rings ?? file?.lines ?? []).length, name).toBeGreaterThan(5);
      expect(statSync(path.join(dir, name)).size, name).toBeLessThan(150 * 1024);
    }
  });
});

describe('그래프·연표·도식 자리', () => {
  it('눈금 범위는 0 과 값을 품고, 준 범위가 있으면 그것을 쓴다', () => {
    const r = niceRange(2499, 5184, 5);
    expect(r.min).toBe(0);
    expect(r.max).toBeGreaterThanOrEqual(5184);
    expect(r.ticks[0]).toBe(0);
    expect(niceRange(-2, 25.7, 5).min).toBeLessThanOrEqual(-2);
    expect(niceRange(0, 50, 5, { min: 0, max: 100 })).toMatchObject({ min: 0, max: 100 });
  });

  it('연표: 사건은 위에서 아래로, 기간 끝은 같은 해의 사건과 같은 높이, 긴 빈 시간은 줄인다', () => {
    const t = normalizeArt('timeline', {
      events: [
        { when: '1392', year: 1392, label: '조선 건국', detail: '', tone: 'blue' },
        { when: '1446', year: 1446, label: '훈민정음 반포', detail: '', tone: 'blue' },
        { when: '1485', year: 1485, label: '경국대전 완성', detail: '', tone: 'blue' },
        { when: '1592', year: 1592, label: '임진왜란', detail: '', tone: 'red' },
      ],
      spans: [
        { from: 1446, to: 1485, label: '(가)', tone: 'purple', lane: 0 },
        { from: 1592, to: 1700, label: '뒤', tone: 'gray', lane: 0 },
      ],
      even: false,
    });
    if (t?.kind !== 'timeline') throw new Error('timeline');
    const L = layoutTimeline(t);
    const ys = L.events.map((e) => e.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(L.spans[0].y0).toBeCloseTo(L.events[1].y);
    expect(L.spans[0].y1).toBeCloseTo(L.events[2].y);
    // 1592 → 1700 은 사건 뒤로 이어지지만 끝없이 길지 않다
    expect(L.spans[1].y1).toBeGreaterThan(L.events[3].y);
    expect(L.spans[1].y1 - L.events[3].y).toBeLessThanOrEqual(46 * 3 + 1);
    expect(L.H).toBeGreaterThan(L.spans[1].y1);
  });

  it('도식: 상자는 그림 안에, 같은 줄 상자끼리 겹치지 않고, 여러 칸 상자는 칸을 채운다', () => {
    const d = normalizeArt('diagram', {
      cols: 6,
      rows: 3,
      nodes: [
        { id: 'k', label: '국왕', col: 2, row: 0, span: 2, shape: 'round', tone: 'orange', strong: true },
        ...['이조', '호조', '예조', '병조', '형조', '공조'].map((label, i) => ({
          id: `e${i}`,
          label,
          col: i,
          row: 2,
          span: 1,
          shape: 'box',
          tone: 'gray',
          strong: false,
        })),
      ],
      links: [{ from: 'k', to: 'e0', label: '', kind: 'line' }],
      groups: [],
    });
    if (d?.kind !== 'diagram') throw new Error('diagram');
    const L = layoutDiagram(d);
    expect(L.W).toBeLessThanOrEqual(400);
    const row2 = d.nodes.filter((n) => n.row === 2).map((n) => L.boxes.get(n.id)!);
    for (const b of row2) {
      expect(b.cx - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(b.cx + b.w / 2).toBeLessThanOrEqual(L.W);
    }
    for (let i = 1; i < row2.length; i++) expect(row2[i].cx - row2[i].w / 2).toBeGreaterThan(row2[i - 1].cx + row2[i - 1].w / 2);
    const king = L.boxes.get('k')!;
    expect(king.w).toBeGreaterThan(row2[0].w * 1.5);
    // 아래 줄로 가는 선은 가운데 높이에서 꺾인다
    const route = linkRoute(king, L.boxes.get('e0')!);
    expect(route).toHaveLength(4);
    expect(route[1].y).toBeCloseTo(route[2].y);
  });

  it('지도 선 이름: 다른 선보다 제 선에 가깝고, 놓인 글과 겹치지 않으며, 그림 안에 있다', () => {
    const mid = pointAlong(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      0.5,
    );
    expect(mid.at.x).toBeCloseTo(50);
    expect(Math.abs(mid.normal.x)).toBeCloseTo(0);
    expect(mid.normal.y).toBeCloseTo(-1);
    // 한 곳에서 갈라지는 두 진출로 (한성 → 평양성, 한성 → 요서처럼): 갈라지는 곳 근처는 헷갈린다
    const A: XY[] = [
      { x: 200, y: 200 },
      { x: 170, y: 120 },
    ];
    const B: XY[] = [
      { x: 200, y: 200 },
      { x: 60, y: 110 },
    ];
    const label = { x: 150, y: 150, w: 40, h: 16 };
    const bounds = { x: 0, y: 0, w: 360, h: 300 };
    const spots = placeLineLabels([{ key: 'a', line: 0, w: 96, h: 15.5 }], [A, B], [label], bounds);
    const c = spots.get('a')!;
    const rect = { x: c.x - 48, y: c.y - 7.75, w: 96, h: 15.5 };
    expect(rectLineDist(rect, A)).toBeLessThan(rectLineDist(rect, B));
    expect(rect.x + rect.w < label.x || rect.x > label.x + label.w || rect.y + rect.h < label.y || rect.y > label.y + label.h).toBe(true);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(360);
  });
});
