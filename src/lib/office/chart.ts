// 워드·PPT 의 차트(그래프) → 값 표. 차트는 그림 파일이 아니라 숫자가 든 XML(c:chartSpace)이라, 제목과 계열·항목·값을 글 표로 꺼낸다
// (AI 가 그래프의 값을 읽고 문제를 만들 수 있게)
import { findAll, first, kids, local, parseXml, type XmlNode } from './xml';

/** 표의 가장 많은 줄·칸 (아주 큰 차트는 앞부분만) */
const MAX_ROWS = 60;
const MAX_SERIES = 12;

/** 노드 아래 글자 모두 (a:t·c:v) */
function textOf(n: XmlNode | null | undefined): string {
  if (!n) return '';
  const out: string[] = [];
  const walk = (x: XmlNode) => {
    for (const c of x.children) {
      if (typeof c === 'string') continue;
      const l = local(c.name);
      if (l === 't' || l === 'v') out.push(c.children.filter((y): y is string => typeof y === 'string').join(''));
      else walk(c);
    }
  };
  walk(n);
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** 캐시된 값들: 차례(idx) → 글 */
function points(n: XmlNode | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (!n) return out;
  for (const pt of findAll(n, 'pt')) {
    const idx = Number(pt.attrs.idx ?? Object.entries(pt.attrs).find(([k]) => local(k) === 'idx')?.[1]);
    // 표에 넣는 줄까지만 (아주 큰 차트에서 멈추지 않게)
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ROWS || out.has(idx)) continue;
    const v = kids(pt, 'v')[0];
    out.set(
      idx,
      v
        ? v.children
            .filter((y): y is string => typeof y === 'string')
            .join('')
            .trim()
        : '',
    );
  }
  return out;
}

/** 소수가 길면 줄인다 (12.300000000000001 → 12.3) */
function num(v: string): string {
  const x = Number(v);
  if (!v || !Number.isFinite(x)) return v;
  return String(Math.round(x * 1e6) / 1e6);
}

/** 차트 XML → 제목과 표 (첫 줄: 항목, 계열 이름들). 값이 없거나 읽지 못하면 null (차트 때문에 문서를 못 읽는 일이 없게) */
export function chartTable(xml: string): { title: string; rows: string[][] } | null {
  try {
    return readChart(xml);
  } catch {
    return null;
  }
}

function readChart(xml: string): { title: string; rows: string[][] } | null {
  const root = parseXml(xml);
  const chart = first(root, 'chart') ?? root;
  const titleNode = kids(chart, 'title')[0];
  const title = textOf(titleNode ? (kids(titleNode, 'tx')[0] ?? titleNode) : null).slice(0, 80);
  const plot = first(chart, 'plotArea');
  if (!plot) return null;
  const series = findAll(plot, 'ser').slice(0, MAX_SERIES);
  if (!series.length) return null;
  const cols = series.map((s, i) => {
    const name = textOf(kids(s, 'tx')[0]) || `계열 ${i + 1}`;
    const cats = points(kids(s, 'cat')[0] ?? kids(s, 'xVal')[0]);
    const vals = points(kids(s, 'val')[0] ?? kids(s, 'yVal')[0]);
    return { name, cats, vals };
  });
  let n = 0;
  for (const c of cols) for (const k of [...c.vals.keys(), ...c.cats.keys()]) n = Math.max(n, k + 1);
  n = Math.min(MAX_ROWS, n);
  if (!n) return null;
  const rows: string[][] = [['항목', ...cols.map((c) => c.name)]];
  for (let i = 0; i < n; i++) {
    const cat = cols.map((c) => c.cats.get(i)).find((x) => x) ?? String(i + 1);
    rows.push([cat, ...cols.map((c) => num(c.vals.get(i) ?? ''))]);
  }
  return rows.slice(1).some((r) => r.slice(1).some(Boolean)) ? { title, rows } : null;
}
