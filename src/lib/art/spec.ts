// 자료 그림을 'KOK 스타일로 다시 그리기' 위한 설계도 (Pro).
// AI 는 잘라 낸 그림(사진 한 장)을 보고 종류별 JSON 만 준다: 지도·그래프·표·연표·도식. 그림은 앱이 그린다 (src/components/art).
// 1) artJsonSchema(kind): Claude structured outputs 에 넣는다 (종류마다 따로, 모든 칸 필수, 재귀 없음, 안 쓰는 칸은 빈 값).
// 2) normalizeArt(kind, raw): 받은 값을 검사해 그릴 수 있는 것만 남긴다 (DB·노트에도 이 모양으로 저장, 16000바이트 안).
// 글자는 그림에 쓰인 그대로 옮긴다: (가)·(나)·A·㉠ 같은 표시를 이름으로 바꾸면 그림 문제의 답이 보인다.
import { simplifyFlat } from './geo';

export const ART_KINDS = ['map', 'chart', 'table', 'timeline', 'diagram'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

/** 색 이름 (화면 색 변수로 바뀐다: 밝은·어두운 화면, 테마를 따른다) */
export const ART_TONES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'navy', 'purple', 'pink', 'gray'] as const;
export type ArtTone = (typeof ART_TONES)[number];

export type LegendItem = { tone: ArtTone; text: string; kind: 'area' | 'line' | 'dot' };

// ---------------------------------------------------------------- 지도 (경도·위도)
export const AREA_STYLES = ['fill', 'hatch', 'outline'] as const;
export const LINE_KINDS = ['route', 'sea_route', 'river', 'border', 'wall', 'road'] as const;
export const PLACE_KINDS = ['capital', 'city', 'battle', 'site', 'mountain', 'port'] as const;
export const MAP_LABEL_KINDS = ['sea', 'region', 'marker', 'note'] as const;

/** 영역 (나라·세력 범위). pts = [경도1, 위도1, 경도2, 위도2, …]. clip: 땅 모양으로 자른다 (바다를 덮는 영역만 false) */
export type MapArea = { label: string; tone: ArtTone; pts: number[]; style: (typeof AREA_STYLES)[number]; clip: boolean };
/** 선: 진출로·바닷길(화살표), 강, 경계, 성벽(장성), 길 */
export type MapLine = { label: string; tone: ArtTone; pts: number[]; kind: (typeof LINE_KINDS)[number]; arrow: boolean };
/** 점: 도읍, 도시, 싸움터, 유적, 산, 항구 */
export type MapPlace = { label: string; lon: number; lat: number; kind: (typeof PLACE_KINDS)[number] };
/** 지도 위의 글: 바다 이름, 지역 이름, (가) 같은 표시, 짧은 설명 */
export type MapLabel = { text: string; lon: number; lat: number; kind: (typeof MAP_LABEL_KINDS)[number] };
export type MapView = { west: number; east: number; south: number; north: number };

export type MapArt = {
  v: 1;
  kind: 'map';
  title: string;
  notes: string;
  view: MapView;
  /** 실제 땅 모양(해안선)을 밑그림으로 그린다 */
  land: boolean;
  /** 지금 나라 경계를 밑그림에 그린다 (오늘날 지도일 때만) */
  borders: boolean;
  areas: MapArea[];
  lines: MapLine[];
  places: MapPlace[];
  labels: MapLabel[];
  legend: LegendItem[];
};

// ---------------------------------------------------------------- 그래프
/** bar 세로 막대, hbar 가로 막대, stacked 쌓은 막대, line 꺾은선, pie 원(도넛), combo 막대+꺾은선(기후 그래프), pyramid 인구 피라미드 */
export const CHART_TYPES = ['bar', 'hbar', 'stacked', 'line', 'pie', 'combo', 'pyramid'] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export type ChartSeries = { name: string; tone: ArtTone; values: number[]; as: 'bar' | 'line'; axis: 'left' | 'right' };
export type ChartArt = {
  v: 1;
  kind: 'chart';
  title: string;
  notes: string;
  type: ChartType;
  /** x 축 이름들 (원: 조각 이름, 인구 피라미드: 나이대를 어린 것부터) */
  categories: string[];
  series: ChartSeries[];
  x_label: string;
  y_label: string;
  unit: string;
  right_label: string;
  right_unit: string;
  /** 축 범위 (둘 다 0 이면 앱이 정한다) */
  y_min: number;
  y_max: number;
  /** 막대·점 위에 값을 쓴다 */
  value_labels: boolean;
  /** 원 그래프 조각마다 색 (그림의 색과 맞추려고. 다른 그래프는 []) */
  slice_tones: ArtTone[];
};

// ---------------------------------------------------------------- 표
export type TableArt = { v: 1; kind: 'table'; title: string; notes: string; columns: string[]; rows: string[][]; row_header: boolean };

// ---------------------------------------------------------------- 연표
/** year: 자리를 정하는 수 (기원전은 음수), when: 그림에 쓰인 날짜 그대로 */
export type TimelineEvent = { when: string; year: number; label: string; detail: string; tone: ArtTone };
/** 기간 (왕조·재위·시대, 두 사건 사이의 (가) 같은 구간). lane: 0 이 기본 줄 */
export type TimelineSpan = { from: number; to: number; label: string; tone: ArtTone; lane: number };
export type TimelineArt = { v: 1; kind: 'timeline'; title: string; notes: string; events: TimelineEvent[]; spans: TimelineSpan[]; even: boolean };

// ---------------------------------------------------------------- 도식 (상자·화살표)
export const NODE_SHAPES = ['box', 'round', 'ellipse', 'circle', 'plain'] as const;
export const LINK_KINDS = ['arrow', 'both', 'line', 'dashed'] as const;
/** 칸(col, row: 0 부터, 왼쪽 위가 0,0)에 놓인 상자. span: 가로로 차지하는 칸 수 */
export type DiagramNode = {
  id: string;
  label: string;
  col: number;
  row: number;
  span: number;
  shape: (typeof NODE_SHAPES)[number];
  tone: ArtTone;
  strong: boolean;
};
export type DiagramLink = { from: string; to: string; label: string; kind: (typeof LINK_KINDS)[number] };
/** 여러 상자를 묶는 칠한 영역 (중앙·지방 같은 구분) */
export type DiagramGroup = { label: string; tone: ArtTone; col: number; row: number; cols: number; rows: number };
export type DiagramArt = {
  v: 1;
  kind: 'diagram';
  title: string;
  notes: string;
  cols: number;
  rows: number;
  nodes: DiagramNode[];
  links: DiagramLink[];
  groups: DiagramGroup[];
};

export type Art = MapArt | ChartArt | TableArt | TimelineArt | DiagramArt;

/** 저장하는 설계도의 최대 크기 (JSON 바이트). 넘으면 지도 선을 더 단순하게 하고, 그래도 넘으면 덜 중요한 것부터 뺀다 */
export const ART_MAX_BYTES = 16000;

export const ART_LIMITS = {
  title: 60,
  notes: 100,
  label: 40,
  detail: 60,
  cell: 60,
  areas: 14,
  areaPts: 60,
  lines: 24,
  linePts: 40,
  places: 40,
  labels: 24,
  legend: 10,
  categories: 24,
  series: 6,
  columns: 8,
  rows: 24,
  events: 24,
  spans: 12,
  lanes: 3,
  nodes: 24,
  links: 36,
  groups: 8,
  gridCols: 6,
  gridRows: 8,
} as const;

// ---------------------------------------------------------------- AI 에게 줄 JSON 스키마
type JsonSchema = Record<string, unknown>;
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const int = { type: 'integer' } as const;
const bool = { type: 'boolean' } as const;
const strArr = { type: 'array', items: str } as const;
const numArr = { type: 'array', items: num } as const;
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
function obj(properties: Record<string, unknown>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
const arr = (items: unknown) => ({ type: 'array', items });
const tone = oneOf(ART_TONES);
const legend = arr(obj({ tone, text: str, kind: oneOf(['area', 'line', 'dot']) }));

const SCHEMAS: Record<ArtKind, JsonSchema> = {
  map: obj({
    title: str,
    notes: str,
    view: obj({ west: num, east: num, south: num, north: num }),
    land: bool,
    borders: bool,
    areas: arr(obj({ label: str, tone, pts: numArr, style: oneOf(AREA_STYLES), clip: bool })),
    lines: arr(obj({ label: str, tone, pts: numArr, kind: oneOf(LINE_KINDS), arrow: bool })),
    places: arr(obj({ label: str, lon: num, lat: num, kind: oneOf(PLACE_KINDS) })),
    labels: arr(obj({ text: str, lon: num, lat: num, kind: oneOf(MAP_LABEL_KINDS) })),
    legend,
  }),
  chart: obj({
    title: str,
    notes: str,
    type: oneOf(CHART_TYPES),
    categories: strArr,
    series: arr(obj({ name: str, tone, values: numArr, as: oneOf(['bar', 'line']), axis: oneOf(['left', 'right']) })),
    x_label: str,
    y_label: str,
    unit: str,
    right_label: str,
    right_unit: str,
    y_min: num,
    y_max: num,
    value_labels: bool,
    slice_tones: arr(tone),
  }),
  table: obj({ title: str, notes: str, columns: strArr, rows: arr(strArr), row_header: bool }),
  timeline: obj({
    title: str,
    notes: str,
    events: arr(obj({ when: str, year: num, label: str, detail: str, tone })),
    spans: arr(obj({ from: num, to: num, label: str, tone, lane: int })),
    even: bool,
  }),
  diagram: obj({
    title: str,
    notes: str,
    cols: int,
    rows: int,
    nodes: arr(obj({ id: str, label: str, col: int, row: int, span: int, shape: oneOf(NODE_SHAPES), tone, strong: bool })),
    links: arr(obj({ from: str, to: str, label: str, kind: oneOf(LINK_KINDS) })),
    groups: arr(obj({ label: str, tone, col: int, row: int, cols: int, rows: int })),
  }),
};

/** 종류마다 따로인 JSON 스키마 (작을수록 AI 가 덜 헷갈린다) */
export function artJsonSchema(kind: ArtKind): Record<string, unknown> {
  return SCHEMAS[kind];
}

// ---------------------------------------------------------------- 검사
type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v.filter(isObj) as Raw[]) : []);
/** 글: 줄바꿈·겹친 빈칸을 한 칸으로, 길이 제한 (글자 단위로 자른다) */
const text = (v: unknown, max: number): string => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
};
const num_ = (v: unknown, fb = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : fb;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const toneOf = (v: unknown, fb: ArtTone = 'blue'): ArtTone => {
  const s = String(v ?? '').toLowerCase();
  return (ART_TONES as readonly string[]).includes(s) ? (s as ArtTone) : fb;
};
function pick<T extends string>(v: unknown, values: readonly T[], fb: T): T {
  const s = String(v ?? '').toLowerCase();
  return (values as readonly string[]).includes(s) ? (s as T) : fb;
}
const bool_ = (v: unknown, fb = false): boolean => (typeof v === 'boolean' ? v : fb);

function legendOf(v: unknown): LegendItem[] {
  return list(v)
    .map((l) => ({ tone: toneOf(l.tone), text: text(l.text, ART_LIMITS.label), kind: pick(l.kind, ['area', 'line', 'dot'] as const, 'area') }))
    .filter((l) => l.text)
    .slice(0, ART_LIMITS.legend);
}

/** [경도, 위도, …] → 짝이 맞는 점만, 범위 안으로, 소수 둘째 자리까지 (같은 점이 이어지면 하나로) */
function lonLatPts(v: unknown, maxPts: number): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (let k = 0; k + 1 < v.length && out.length / 2 < maxPts * 4; k += 2) {
    const lon = num_(v[k], NaN);
    const lat = num_(v[k + 1], NaN);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const x = round(clamp(lon, -180, 180));
    const y = round(clamp(lat, -85, 85));
    const n = out.length;
    if (n >= 2 && out[n - 2] === x && out[n - 1] === y) continue;
    out.push(x, y);
  }
  // 점이 많으면 모양을 지키며 줄인다
  let tol = 0.02;
  let pts = out;
  while (pts.length / 2 > maxPts && tol < 5) {
    pts = simplifyFlat(out, tol);
    tol *= 1.6;
  }
  if (pts.length / 2 > maxPts) {
    // 그래도 많으면 고르게 덜어 낸다
    const keep: number[] = [];
    const step = pts.length / 2 / maxPts;
    for (let i = 0; i < maxPts; i++) {
      const k = Math.floor(i * step) * 2;
      keep.push(pts[k], pts[k + 1]);
    }
    pts = keep;
  }
  return pts;
}

/** 지도 보는 범위. 이상하면 그릴 것들을 감싸는 범위로 */
function viewOf(v: unknown, content: number[]): MapView | null {
  const r = isObj(v) ? v : {};
  let west = num_(r.west, NaN);
  let east = num_(r.east, NaN);
  let south = num_(r.south, NaN);
  let north = num_(r.north, NaN);
  const ok = [west, east, south, north].every(Number.isFinite) && east - west >= 0.2 && north - south >= 0.2;
  if (!ok) {
    if (content.length < 2) return null;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = 0; k + 1 < content.length; k += 2) {
      x0 = Math.min(x0, content[k]);
      x1 = Math.max(x1, content[k]);
      y0 = Math.min(y0, content[k + 1]);
      y1 = Math.max(y1, content[k + 1]);
    }
    const mx = Math.max(0.5, (x1 - x0) * 0.12);
    const my = Math.max(0.5, (y1 - y0) * 0.12);
    west = x0 - mx;
    east = x1 + mx;
    south = y0 - my;
    north = y1 + my;
  }
  west = clamp(west, -180, 179.5);
  east = clamp(east, west + 0.2, 180);
  south = clamp(south, -85, 84.5);
  north = clamp(north, south + 0.2, 85);
  return { west: round(west), east: round(east), south: round(south), north: round(north) };
}

function normalizeMap(r: Raw): MapArt | null {
  const areas: MapArea[] = list(r.areas)
    .map((a) => ({
      label: text(a.label, ART_LIMITS.label),
      tone: toneOf(a.tone),
      pts: lonLatPts(a.pts, ART_LIMITS.areaPts),
      style: pick(a.style, AREA_STYLES, 'fill'),
      clip: bool_(a.clip, true),
    }))
    .filter((a) => a.pts.length >= 6)
    .slice(0, ART_LIMITS.areas);
  const lines: MapLine[] = list(r.lines)
    .map((l) => ({
      label: text(l.label, ART_LIMITS.label),
      tone: toneOf(l.tone, 'red'),
      pts: lonLatPts(l.pts, ART_LIMITS.linePts),
      kind: pick(l.kind, LINE_KINDS, 'route'),
      arrow: bool_(l.arrow),
    }))
    .filter((l) => l.pts.length >= 4)
    .slice(0, ART_LIMITS.lines);
  const places: MapPlace[] = list(r.places)
    .map((p) => ({ label: text(p.label, ART_LIMITS.label), lon: num_(p.lon, NaN), lat: num_(p.lat, NaN), kind: pick(p.kind, PLACE_KINDS, 'city') }))
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
    .map((p) => ({ ...p, lon: round(clamp(p.lon, -180, 180)), lat: round(clamp(p.lat, -85, 85)) }))
    .slice(0, ART_LIMITS.places);
  const labels: MapLabel[] = list(r.labels)
    .map((l) => ({ text: text(l.text, ART_LIMITS.label), lon: num_(l.lon, NaN), lat: num_(l.lat, NaN), kind: pick(l.kind, MAP_LABEL_KINDS, 'region') }))
    .filter((l) => l.text && Number.isFinite(l.lon) && Number.isFinite(l.lat))
    .map((l) => ({ ...l, lon: round(clamp(l.lon, -180, 180)), lat: round(clamp(l.lat, -85, 85)) }))
    .slice(0, ART_LIMITS.labels);
  if (!areas.length && !lines.length && !places.length && !labels.length) return null;
  const content = [
    ...areas.flatMap((a) => a.pts),
    ...lines.flatMap((l) => l.pts),
    ...places.flatMap((p) => [p.lon, p.lat]),
    ...labels.flatMap((l) => [l.lon, l.lat]),
  ];
  const view = viewOf(r.view, content);
  if (!view) return null;
  return {
    v: 1,
    kind: 'map',
    title: text(r.title, ART_LIMITS.title),
    notes: text(r.notes, ART_LIMITS.notes),
    view,
    land: bool_(r.land, true),
    borders: bool_(r.borders, false),
    areas,
    lines,
    places,
    labels,
    legend: legendOf(r.legend),
  };
}

function normalizeChart(r: Raw): ChartArt | null {
  const type = pick(r.type, CHART_TYPES, 'bar');
  const categories = (Array.isArray(r.categories) ? r.categories : []).map((c) => text(c, ART_LIMITS.label)).slice(0, ART_LIMITS.categories);
  if (!categories.length) return null;
  const n = categories.length;
  const series: ChartSeries[] = list(r.series)
    .map((s, i) => {
      const raw = Array.isArray(s.values) ? s.values : [];
      const values = Array.from({ length: n }, (_, k) => round(clamp(num_(raw[k], 0), -1e9, 1e9), 4));
      const as = type === 'combo' ? pick(s.as, ['bar', 'line'] as const, 'bar') : type === 'line' ? 'line' : 'bar';
      const axis = type === 'combo' ? pick(s.axis, ['left', 'right'] as const, 'left') : 'left';
      return { name: text(s.name, ART_LIMITS.label), tone: toneOf(s.tone, TONE_CYCLE[i % TONE_CYCLE.length]), values, as, axis } as ChartSeries;
    })
    .filter((s) => s.values.some((v) => v !== 0) || s.name)
    .slice(0, type === 'pie' ? 1 : type === 'pyramid' ? 2 : ART_LIMITS.series);
  if (!series.length || !series.some((s) => s.values.some((v) => v !== 0))) return null;
  if (type === 'pie' && !series[0].values.some((v) => v > 0)) return null;
  let y_min = num_(r.y_min, 0);
  let y_max = num_(r.y_max, 0);
  if (!(y_max > y_min)) {
    y_min = 0;
    y_max = 0;
  }
  return {
    v: 1,
    kind: 'chart',
    title: text(r.title, ART_LIMITS.title),
    notes: text(r.notes, ART_LIMITS.notes),
    type,
    categories,
    series,
    x_label: text(r.x_label, ART_LIMITS.label),
    y_label: text(r.y_label, ART_LIMITS.label),
    unit: text(r.unit, 16),
    right_label: text(r.right_label, ART_LIMITS.label),
    right_unit: text(r.right_unit, 16),
    y_min: round(y_min, 4),
    y_max: round(y_max, 4),
    value_labels: bool_(r.value_labels),
    slice_tones:
      type === 'pie' && Array.isArray(r.slice_tones)
        ? categories.map((_, k) => toneOf((r.slice_tones as unknown[])[k], TONE_CYCLE[k % TONE_CYCLE.length]))
        : [],
  };
}

/** 색을 따로 주지 않은 줄의 색 차례 */
export const TONE_CYCLE: ArtTone[] = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'yellow', 'navy'];

function normalizeTable(r: Raw): TableArt | null {
  const columns = (Array.isArray(r.columns) ? r.columns : []).map((c) => text(c, ART_LIMITS.cell)).slice(0, ART_LIMITS.columns);
  const width = Math.max(
    columns.length,
    ...(Array.isArray(r.rows) ? r.rows : []).map((row) => (Array.isArray(row) ? Math.min(row.length, ART_LIMITS.columns) : 0)),
  );
  if (!width) return null;
  const rows = (Array.isArray(r.rows) ? r.rows : [])
    .filter(Array.isArray)
    .map((row) => Array.from({ length: width }, (_, k) => text((row as unknown[])[k], ART_LIMITS.cell)))
    .filter((row) => row.some(Boolean))
    .slice(0, ART_LIMITS.rows);
  const cols = columns.length === width ? columns : Array.from({ length: width }, (_, k) => columns[k] ?? '');
  if (!rows.length && !cols.some(Boolean)) return null;
  return {
    v: 1,
    kind: 'table',
    title: text(r.title, ART_LIMITS.title),
    notes: text(r.notes, ART_LIMITS.notes),
    columns: cols,
    rows,
    row_header: bool_(r.row_header),
  };
}

function normalizeTimeline(r: Raw): TimelineArt | null {
  const events: TimelineEvent[] = list(r.events)
    .map((e) => {
      const when = text(e.when, 24);
      let year = num_(e.year, NaN);
      if (!Number.isFinite(year)) year = yearFrom(when);
      return {
        when,
        year: round(clamp(year, -10000, 3000), 2),
        label: text(e.label, ART_LIMITS.label),
        detail: text(e.detail, ART_LIMITS.detail),
        tone: toneOf(e.tone, 'blue'),
      };
    })
    .filter((e) => (e.label || e.when) && Number.isFinite(e.year))
    .slice(0, ART_LIMITS.events)
    .sort((a, b) => a.year - b.year);
  const spans: TimelineSpan[] = list(r.spans)
    .map((s, i) => {
      let from = num_(s.from, NaN);
      let to = num_(s.to, NaN);
      if (Number.isFinite(from) && Number.isFinite(to) && to < from) [from, to] = [to, from];
      return {
        from: round(clamp(from, -10000, 3000), 2),
        to: round(clamp(to, -10000, 3000), 2),
        label: text(s.label, ART_LIMITS.label),
        tone: toneOf(s.tone, TONE_CYCLE[i % TONE_CYCLE.length]),
        lane: clamp(Math.round(num_(s.lane, 0)), 0, ART_LIMITS.lanes - 1),
      };
    })
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && (s.label || s.to > s.from))
    .slice(0, ART_LIMITS.spans);
  if (!events.length && !spans.length) return null;
  return { v: 1, kind: 'timeline', title: text(r.title, ART_LIMITS.title), notes: text(r.notes, ART_LIMITS.notes), events, spans, even: bool_(r.even) };
}

/** '기원전 2333' · 'BC 57' · '1392년' → 수 (못 읽으면 NaN) */
export function yearFrom(when: string): number {
  const m = /(-?\d+(?:\.\d+)?)/.exec(when.replace(/,/g, ''));
  if (!m) return NaN;
  const n = Number(m[1]);
  return /기원전|BC|B\.C\.|BCE/i.test(when) ? -Math.abs(n) : n;
}

function normalizeDiagram(r: Raw): DiagramArt | null {
  const seen = new Set<string>();
  const nodes: DiagramNode[] = [];
  for (const n of list(r.nodes)) {
    if (nodes.length >= ART_LIMITS.nodes) break;
    let id = text(n.id, 16) || `n${nodes.length + 1}`;
    while (seen.has(id)) id = `${id}'`;
    const label = text(n.label, ART_LIMITS.label);
    if (!label && pick(n.shape, NODE_SHAPES, 'box') === 'plain') continue;
    seen.add(id);
    nodes.push({
      id,
      label,
      col: clamp(Math.round(num_(n.col, 0)), 0, ART_LIMITS.gridCols - 1),
      row: clamp(Math.round(num_(n.row, 0)), 0, ART_LIMITS.gridRows - 1),
      span: clamp(Math.round(num_(n.span, 1)), 1, ART_LIMITS.gridCols),
      shape: pick(n.shape, NODE_SHAPES, 'box'),
      tone: toneOf(n.tone, 'gray'),
      strong: bool_(n.strong),
    });
  }
  if (!nodes.length) return null;
  const cols = clamp(Math.max(Math.round(num_(r.cols, 0)), ...nodes.map((n) => Math.min(ART_LIMITS.gridCols, n.col + n.span))), 1, ART_LIMITS.gridCols);
  const rows = clamp(Math.max(Math.round(num_(r.rows, 0)), ...nodes.map((n) => n.row + 1)), 1, ART_LIMITS.gridRows);
  for (const n of nodes) n.span = Math.min(n.span, cols - n.col);
  const links: DiagramLink[] = list(r.links)
    .map((l) => ({ from: text(l.from, 16), to: text(l.to, 16), label: text(l.label, 24), kind: pick(l.kind, LINK_KINDS, 'arrow') }))
    .filter((l) => seen.has(l.from) && seen.has(l.to) && l.from !== l.to)
    .slice(0, ART_LIMITS.links);
  const groups: DiagramGroup[] = list(r.groups)
    .map((g) => {
      const col = clamp(Math.round(num_(g.col, 0)), 0, cols - 1);
      const row = clamp(Math.round(num_(g.row, 0)), 0, rows - 1);
      return {
        label: text(g.label, ART_LIMITS.label),
        tone: toneOf(g.tone, 'gray'),
        col,
        row,
        cols: clamp(Math.round(num_(g.cols, 1)), 1, cols - col),
        rows: clamp(Math.round(num_(g.rows, 1)), 1, rows - row),
      };
    })
    .slice(0, ART_LIMITS.groups);
  return { v: 1, kind: 'diagram', title: text(r.title, ART_LIMITS.title), notes: text(r.notes, ART_LIMITS.notes), cols, rows, nodes, links, groups };
}

const NORMALIZERS: Record<ArtKind, (r: Raw) => Art | null> = {
  map: normalizeMap,
  chart: normalizeChart,
  table: normalizeTable,
  timeline: normalizeTimeline,
  diagram: normalizeDiagram,
};

const bytes = (a: Art) => new TextEncoder().encode(JSON.stringify(a)).length;

/** 너무 크면 줄인다: 지도는 선을 더 단순하게, 그다음 덜 중요한 것(글·점·선·영역 끝에서부터)을 뺀다. 다른 종류는 뒤에서부터 덜어 낸다 */
function fitSize(art: Art): Art | null {
  if (bytes(art) <= ART_MAX_BYTES) return art;
  if (art.kind === 'map') {
    let a: MapArt = art;
    for (const tol of [0.05, 0.1, 0.2, 0.4]) {
      a = {
        ...a,
        areas: a.areas.map((x) => ({ ...x, pts: shrinkRing(x.pts, tol) })).filter((x) => x.pts.length >= 6),
        lines: a.lines.map((x) => ({ ...x, pts: shrinkLine(x.pts, tol) })).filter((x) => x.pts.length >= 4),
      };
      if (bytes(a) <= ART_MAX_BYTES) return a;
    }
    while (bytes(a) > ART_MAX_BYTES) {
      if (a.labels.length > 4) a = { ...a, labels: a.labels.slice(0, -1) };
      else if (a.places.length > 8) a = { ...a, places: a.places.slice(0, -1) };
      else if (a.lines.length > 2) a = { ...a, lines: a.lines.slice(0, -1) };
      else if (a.areas.length > 2) a = { ...a, areas: a.areas.slice(0, -1) };
      else return null;
    }
    return a;
  }
  let a: Art = art;
  for (let guard = 0; guard < 200 && bytes(a) > ART_MAX_BYTES; guard++) {
    if (a.kind === 'table' && a.rows.length > 1) a = { ...a, rows: a.rows.slice(0, -1) };
    else if (a.kind === 'timeline' && a.events.length > 2) a = { ...a, events: a.events.slice(0, -1) };
    else if (a.kind === 'diagram' && a.links.length) a = { ...a, links: a.links.slice(0, -1) };
    else if (a.kind === 'diagram' && a.nodes.length > 2) {
      // 상자를 빼면 그 상자로 가는 선도 뺀다
      const nodes = a.nodes.slice(0, -1);
      const ids = new Set(nodes.map((x) => x.id));
      a = { ...a, nodes, links: a.links.filter((l) => ids.has(l.from) && ids.has(l.to)) };
    } else if (a.kind === 'chart' && a.categories.length > 2) {
      const n: number = a.categories.length - 1;
      a = { ...a, categories: a.categories.slice(0, n), series: a.series.map((s) => ({ ...s, values: s.values.slice(0, n) })) };
    } else return null;
  }
  return bytes(a) <= ART_MAX_BYTES ? a : null;
}

const shrinkRing = (pts: number[], tol: number) => {
  const s = simplifyFlat(pts, tol);
  return s.length >= 6 ? s : pts.slice(0, 6);
};
const shrinkLine = (pts: number[], tol: number) => {
  const s = simplifyFlat(pts, tol);
  return s.length >= 4 ? s : [pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]];
};

/** 받은 설계도가 쓸 만하면 Art, 아니면 null (그릴 것이 없거나 크기를 맞출 수 없을 때) */
export function normalizeArt(kind: ArtKind, raw: unknown): Art | null {
  if (!(ART_KINDS as readonly string[]).includes(kind) || !isObj(raw)) return null;
  const art = NORMALIZERS[kind](raw);
  return art ? fitSize(art) : null;
}

/** 저장해 둔 설계도 읽기 (kind 를 보고 다시 검사한다). 이상하면 null */
export function readArt(raw: unknown): Art | null {
  if (!isObj(raw)) return null;
  const kind = String(raw.kind ?? '') as ArtKind;
  return (ART_KINDS as readonly string[]).includes(kind) ? normalizeArt(kind, raw) : null;
}

const KIND_NAME: Record<ArtKind, string> = { map: '지도', chart: '그래프', table: '표', timeline: '연표', diagram: '도식' };

/** 화면 읽기용 한 문장 (예: '지도: 5세기 고구려 영토와 남진 방향') */
export function artAlt(art: Art): string {
  const name = KIND_NAME[art.kind];
  const join = (xs: string[], n = 4) => {
    const kept = [...new Set(xs.filter(Boolean))];
    return kept.slice(0, n).join(', ') + (kept.length > n ? ' 등' : '');
  };
  let about = '';
  switch (art.kind) {
    case 'map':
      about = join([...art.areas.map((a) => a.label), ...art.lines.map((l) => l.label), ...art.labels.map((l) => l.text), ...art.places.map((p) => p.label)]);
      break;
    case 'chart':
      about = join(
        [
          art.series
            .map((s) => s.name)
            .filter(Boolean)
            .join('·'),
          `${art.categories[0]} ~ ${art.categories[art.categories.length - 1]}`,
        ],
        2,
      );
      break;
    case 'table':
      about = `${join(art.columns.filter(Boolean), 5)}${art.rows.length ? ` · ${art.rows.length}줄` : ''}`;
      break;
    case 'timeline': {
      const ev = art.events;
      about = ev.length
        ? `${ev[0].when || ev[0].year} ~ ${ev[ev.length - 1].when || ev[ev.length - 1].year}, ${join(
            ev.map((e) => e.label),
            3,
          )}`
        : join(art.spans.map((s) => s.label));
      break;
    }
    case 'diagram':
      about = join(
        art.nodes.map((n) => n.label),
        5,
      );
      break;
  }
  const head = art.title ? `${art.title}` : '';
  return `${name}: ${[head, about].filter(Boolean).join(' — ') || '그림'}`;
}
