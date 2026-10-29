'use client';
// 그림 설계도(Figure)를 SVG 로 그린다. 색은 화면 색(밝은·어두운, 테마)을 따른다.
// visible: 보이는 요소 (없으면 모두), focus: 이 단계에서 형광펜으로 칠할 요소, fresh: 방금 나타난 요소(살짝 나타난다)
// 글자는 다른 글자·점·상자와 겹치지 않는 자리를 골라 둔다 (placeLabels).
import { memo, useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import { pruneFigure, type FigItem, type Figure } from '@/lib/figure/spec';
import {
  BOX_FONT,
  angleMark,
  boxEdge,
  centerOf,
  extendLine,
  f2,
  figureLayout,
  placeLabels,
  sampleFunction,
  textWidth,
  tickLabel,
  ticks,
  type LabelReq,
  type Pt,
  type Rect,
} from '@/lib/figure/layout';
import { previewText } from '@/lib/richtext';

/** 그림 글도 설정의 글꼴을 따른다 (글 자리는 textWidth 가 한글을 1em 으로 넉넉히 잡아서 다른 글꼴도 넘치지 않는다. 변수가 없는 곳 = 그림 파일로 저장할 때는 뒤의 글꼴) */
const FONT = 'var(--font-sans, Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif)';
/** 여러 함수 그래프의 색 (가지 색에서 고른다) */
const CURVE = ['var(--b1)', 'var(--b3)', 'var(--b5)', 'var(--b2)', 'var(--b6)'];

type LabelDraw = LabelReq & { text: string; size: number; color: string; bold: boolean; cls?: string };

function strokeOf(i: FigItem, curveIndex: number): string {
  if (i.style === 'answer') return 'var(--accent)';
  if (i.style === 'muted' || i.style === 'aux') return 'var(--muted)';
  if (i.type === 'function') return CURVE[curveIndex % CURVE.length];
  return 'var(--ink)';
}

function widthOf(i: FigItem): number {
  if (i.style === 'answer') return 2.6;
  if (i.style === 'aux' || i.style === 'muted') return 1.6;
  return 2;
}

const textColor = (i: FigItem) => (i.style === 'answer' ? 'var(--accent)' : i.style === 'muted' ? 'var(--muted)' : 'var(--ink)');

export const FigureView = memo(function FigureView({
  figure: given,
  visible,
  focus,
  fresh,
  className,
  title,
}: {
  figure: Figure;
  visible?: Set<string>;
  focus?: Set<string>;
  fresh?: Set<string>;
  className?: string;
  /** 화면 읽기용 설명 */
  title?: string;
}) {
  const uid = useId().replace(/:/g, '');
  // 없는 점을 가리키는 선 같은 것은 그리지 않는다 (그리다가 멈추지 않게)
  const figure = useMemo(() => pruneFigure(given), [given]);
  // 자리 잡기: 상자 그림은 칸·줄로 고르게 벌리고, 나머지는 좌표 비율대로 (상자·글 크기도 같이)
  const layout = useMemo(() => figureLayout(figure, (i) => previewText(i.label)), [figure]);
  const m = layout.m;
  const boxes = layout.boxes;
  const byId = useMemo(() => new Map(figure.items.map((i) => [i.id, i])), [figure]);
  const center = useMemo(() => centerOf(figure.items, m), [figure, m]);
  const P = (id: string): Pt => {
    const p = byId.get(id)!;
    return { x: m.px(p.x), y: m.py(p.y) };
  };
  const shown = (i: FigItem) => !visible || visible.has(i.id);
  const isFocus = (i: FigItem) => !!focus?.has(i.id);
  const anim = (i: FigItem): string | undefined => (fresh?.has(i.id) ? 'kok-fig-in' : undefined);

  const under: ReactNode[] = []; // 형광펜 (맨 아래)
  const fills: ReactNode[] = []; // 다각형·원 칠
  const strokes: ReactNode[] = []; // 선
  const marks: ReactNode[] = []; // 각·같은 길이 표시
  const tops: ReactNode[] = []; // 상자·점
  const reqs: LabelDraw[] = []; // 글자 (자리를 고른 뒤 맨 위에)
  const obstacles: Rect[] = [];
  /** 글자가 피해 갈 선 (선분·다각형 변·화살표·원·그래프를 잘게 나눈 것) */
  const segs: Array<[Pt, Pt]> = [];
  const polyline = (pts: Pt[]) => {
    for (let k = 1; k < pts.length; k++) segs.push([pts[k - 1], pts[k]]);
  };

  const clip = `url(#${uid}-clip)`;
  const hl = (key: string, el: ReactNode) => under.push(<g key={`hl-${key}`}>{el}</g>);
  const HL: CSSProperties = { stroke: 'var(--hl)', strokeOpacity: 0.55, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };

  const label = (key: string, at: Pt, raw: string, o: { dir?: Pt; dist?: number; size?: number; color?: string; bold?: boolean; cls?: string }) => {
    const text = previewText(raw);
    if (!text) return;
    const size = o.size ?? 13.5;
    reqs.push({
      key,
      at,
      dir: o.dir,
      dist: o.dist ?? 5,
      w: textWidth(text, size) + 4,
      h: size + 4,
      text,
      size,
      color: o.color ?? 'var(--ink)',
      bold: !!o.bold,
      cls: o.cls,
    });
  };

  let curve = 0;
  for (const i of figure.items) {
    if (!shown(i)) continue;
    const color = strokeOf(i, i.type === 'function' ? curve : 0);
    const w = widthOf(i);
    const dash = i.style === 'aux' ? '6 5' : undefined;
    const cls = anim(i);
    const lineStyle: CSSProperties = { stroke: color, strokeWidth: w, strokeDasharray: dash, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };
    const focused = isFocus(i);
    switch (i.type) {
      case 'segment':
      case 'vector':
      case 'line':
      case 'ray': {
        const a = P(i.refs[0]);
        const b = P(i.refs[1]);
        const infinite = i.type === 'line' || i.type === 'ray';
        const [A, B] = infinite ? extendLine(a, b, m, i.type === 'line') : [a, b];
        const d = `M${f2(A.x)} ${f2(A.y)}L${f2(B.x)} ${f2(B.y)}`;
        if (focused) hl(i.id, <path d={d} style={{ ...HL, strokeWidth: 10 }} clipPath={infinite ? clip : undefined} />);
        strokes.push(<path key={i.id} d={d} style={lineStyle} className={cls} clipPath={infinite ? clip : undefined} />);
        segs.push([A, B]);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        if (i.type === 'vector') {
          const s = 9 + w;
          const ang = Math.atan2(uy, ux);
          const p1 = { x: b.x - Math.cos(ang - 0.42) * s, y: b.y - Math.sin(ang - 0.42) * s };
          const p2 = { x: b.x - Math.cos(ang + 0.42) * s, y: b.y - Math.sin(ang + 0.42) * s };
          strokes.push(
            <path
              key={`${i.id}-h`}
              d={`M${f2(p1.x)} ${f2(p1.y)}L${f2(b.x)} ${f2(b.y)}L${f2(p2.x)} ${f2(p2.y)}Z`}
              style={{ fill: color, stroke: color, strokeWidth: 1, strokeLinejoin: 'round' }}
              className={cls}
            />,
          );
        }
        if (i.type === 'segment' && i.marks > 0) {
          for (let k = 0; k < i.marks; k++) {
            const off = (k - (i.marks - 1) / 2) * 5;
            const cx = (a.x + b.x) / 2 + ux * off;
            const cy = (a.y + b.y) / 2 + uy * off;
            marks.push(
              <path
                key={`${i.id}-m${k}`}
                d={`M${f2(cx - uy * 6)} ${f2(cy + ux * 6)}L${f2(cx + uy * 6)} ${f2(cy - ux * 6)}`}
                style={{ stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' }}
                className={cls}
              />,
            );
          }
        }
        if (i.label) {
          if (i.type === 'vector') {
            // 힘·벡터 이름은 화살표 끝에
            label(i.id, b, i.label, { dir: { x: ux, y: uy }, dist: 6, color: textColor(i), bold: i.style === 'answer', cls });
          } else {
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            // 선분 가운데에서 그림 가운데의 반대쪽으로
            let nx = -uy;
            let ny = ux;
            if ((mid.x + nx - center.x) ** 2 + (mid.y + ny - center.y) ** 2 < (mid.x - nx - center.x) ** 2 + (mid.y - ny - center.y) ** 2) {
              nx = -nx;
              ny = -ny;
            }
            label(i.id, mid, i.label, { dir: { x: nx, y: ny }, dist: 5, color: textColor(i), bold: i.style === 'answer', cls });
          }
        }
        break;
      }
      case 'polygon': {
        const pts = i.refs.map(P);
        polyline([...pts, pts[0]]);
        const d = `M${pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L')}Z`;
        if (focused) hl(i.id, <path d={d} style={{ ...HL, fill: 'var(--hl)', fillOpacity: 0.3, strokeWidth: 9 }} />);
        fills.push(
          <path
            key={`${i.id}-f`}
            d={d}
            style={{ fill: i.style === 'answer' ? 'var(--accent)' : 'var(--ink)', fillOpacity: i.style === 'answer' ? 0.12 : 0.045, stroke: 'none' }}
            className={cls}
          />,
        );
        strokes.push(<path key={i.id} d={d} style={lineStyle} className={cls} />);
        if (i.label) {
          const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
          label(i.id, c, i.label, { color: textColor(i), bold: true, cls });
        }
        break;
      }
      case 'circle': {
        const c = P(i.refs[0]);
        const through = i.refs[1] ? byId.get(i.refs[1]) : undefined;
        const cw = byId.get(i.refs[0])!;
        const rWorld = through ? Math.hypot(through.x - cw.x, through.y - cw.y) : i.r;
        const rx = rWorld * m.sx;
        const ry = rWorld * m.sy;
        polyline(Array.from({ length: 33 }, (_, k) => ({ x: c.x + Math.cos((k / 32) * Math.PI * 2) * rx, y: c.y + Math.sin((k / 32) * Math.PI * 2) * ry })));
        if (focused) hl(i.id, <ellipse cx={f2(c.x)} cy={f2(c.y)} rx={f2(rx)} ry={f2(ry)} style={{ ...HL, strokeWidth: 9 }} />);
        fills.push(
          <ellipse
            key={`${i.id}-f`}
            cx={f2(c.x)}
            cy={f2(c.y)}
            rx={f2(rx)}
            ry={f2(ry)}
            style={{ fill: i.style === 'answer' ? 'var(--accent)' : 'var(--ink)', fillOpacity: i.style === 'answer' ? 0.1 : 0.03 }}
            className={cls}
          />,
        );
        strokes.push(<ellipse key={i.id} cx={f2(c.x)} cy={f2(c.y)} rx={f2(rx)} ry={f2(ry)} style={lineStyle} className={cls} />);
        if (i.label) label(i.id, { x: c.x + rx * 0.71, y: c.y - ry * 0.71 }, i.label, { dir: { x: 0.7, y: -0.7 }, dist: 4, color: textColor(i), cls });
        break;
      }
      case 'arc': {
        const o = byId.get(i.refs[0])!;
        const a = byId.get(i.refs[1])!;
        const b = byId.get(i.refs[2])!;
        const r = Math.hypot(a.x - o.x, a.y - o.y);
        const t1 = Math.atan2(a.y - o.y, a.x - o.x);
        let d = Math.atan2(b.y - o.y, b.x - o.x) - t1;
        while (d <= 0) d += Math.PI * 2;
        const n = Math.max(8, Math.round((d / (Math.PI * 2)) * 72));
        const pts: string[] = [];
        for (let k = 0; k <= n; k++) {
          const t = t1 + (d * k) / n;
          pts.push(`${f2(m.px(o.x + Math.cos(t) * r))} ${f2(m.py(o.y + Math.sin(t) * r))}`);
        }
        const path = `M${pts.join('L')}`;
        if (focused) hl(i.id, <path d={path} style={{ ...HL, strokeWidth: 10 }} />);
        strokes.push(<path key={i.id} d={path} style={lineStyle} className={cls} />);
        if (i.label) {
          const t = t1 + d / 2;
          const at = { x: m.px(o.x + Math.cos(t) * r), y: m.py(o.y + Math.sin(t) * r) };
          label(i.id, at, i.label, { dir: { x: Math.cos(t), y: -Math.sin(t) }, dist: 5, color: textColor(i), cls });
        }
        break;
      }
      case 'angle': {
        const [p, v, q] = [P(i.refs[0]), P(i.refs[1]), P(i.refs[2])];
        const radius = 17 + Math.max(0, i.marks - 1) * 4;
        const is90 = /^90\s*°?$/.test(previewText(i.label));
        // 그림이 정확히 직각이 아니어도 '90°' 라고 적었으면 네모로
        const a = angleMark(v, p, q, radius, is90);
        const color2 = i.style === 'answer' ? 'var(--accent)' : 'var(--ink)';
        if (focused) hl(i.id, <path d={a.path} style={{ ...HL, strokeWidth: 9 }} />);
        marks.push(
          <path
            key={i.id}
            d={a.path}
            style={{ stroke: color2, strokeWidth: 1.6, fill: a.right ? 'none' : color2, fillOpacity: a.right ? 0 : 0.08 }}
            className={cls}
          />,
        );
        for (let k = 1; k < i.marks && !a.right; k++) {
          const b2 = angleMark(v, p, q, radius - k * 4);
          marks.push(<path key={`${i.id}-${k}`} d={b2.path} style={{ stroke: color2, strokeWidth: 1.4, fill: 'none' }} className={cls} />);
        }
        if (i.label && !is90) {
          const dir = { x: a.labelAt.x - v.x, y: a.labelAt.y - v.y };
          label(i.id, v, i.label, { dir, dist: radius + 3, size: 12.5, color: color2, bold: i.style === 'answer', cls });
        }
        break;
      }
      case 'function': {
        const lines = sampleFunction(i.expr, i.from, i.to, figure.view);
        const d = lines.map((l) => `M${l.map((pt) => `${f2(m.px(pt.x))} ${f2(m.py(pt.y))}`).join('L')}`).join('');
        if (!d) break;
        for (const l of lines) polyline(l.filter((_, k) => k % 6 === 0 || k === l.length - 1).map((pt) => ({ x: m.px(pt.x), y: m.py(pt.y) })));
        if (focused) hl(i.id, <path d={d} style={{ ...HL, strokeWidth: 10 }} clipPath={clip} />);
        strokes.push(<path key={i.id} d={d} style={{ ...lineStyle, strokeWidth: i.style === 'answer' ? 3 : 2.4 }} clipPath={clip} className={cls} />);
        if (i.label) {
          // 그래프 오른쪽 끝 가까이 (보이는 칸 안에 있는 점)
          const inside = lines.flat().filter((pt) => pt.y <= figure.view.y_max && pt.y >= figure.view.y_min);
          const last = inside[Math.max(0, inside.length - Math.ceil(inside.length * 0.1) - 1)];
          if (last) label(i.id, { x: m.px(last.x), y: m.py(last.y) }, i.label, { dir: { x: -0.4, y: -1 }, dist: 6, color, bold: true, cls });
        }
        curve++;
        break;
      }
      case 'box': {
        const b = boxes.get(i.id)!;
        const answer = i.style === 'answer';
        obstacles.push({ x: b.c.x - b.hw, y: b.c.y - b.hh, w: b.hw * 2, h: b.hh * 2 });
        if (focused)
          hl(
            i.id,
            <rect
              x={f2(b.c.x - b.hw - 4)}
              y={f2(b.c.y - b.hh - 4)}
              width={f2(b.hw * 2 + 8)}
              height={f2(b.hh * 2 + 8)}
              rx={16}
              style={{ ...HL, strokeWidth: 6 }}
            />,
          );
        tops.push(
          <g key={i.id} className={cls}>
            <rect
              x={f2(b.c.x - b.hw)}
              y={f2(b.c.y - b.hh)}
              width={f2(b.hw * 2)}
              height={f2(b.hh * 2)}
              rx={12}
              style={{
                fill: answer ? 'var(--accent-soft)' : 'var(--surface)',
                stroke: answer ? 'var(--accent)' : i.style === 'muted' ? 'var(--line)' : 'var(--ink)',
                strokeOpacity: answer ? 1 : 0.5,
                strokeWidth: answer ? 2 : 1.4,
                strokeDasharray: i.style === 'aux' ? '5 4' : undefined,
              }}
            />
            {b.lines.map((l, k) => (
              <text
                key={k}
                x={f2(b.c.x)}
                y={f2(b.c.y + (k - (b.lines.length - 1) / 2) * 16)}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ fill: answer ? 'var(--accent)' : 'var(--ink)', fontSize: BOX_FONT, fontWeight: 700 }}
              >
                {l}
              </text>
            ))}
          </g>,
        );
        break;
      }
      case 'arrow': {
        const [ia, ib] = [byId.get(i.refs[0])!, byId.get(i.refs[1])!];
        const ba = boxes.get(ia.id);
        const bb = boxes.get(ib.id);
        const ca = ba?.c ?? P(ia.id);
        const cb = bb?.c ?? P(ib.id);
        const s = ba ? boxEdge(ba.c, ba.hw + 3, ba.hh + 3, cb) : shorten(ca, cb, 7);
        const e = bb ? boxEdge(bb.c, bb.hw + 5, bb.hh + 5, ca) : shorten(cb, ca, 9);
        const d = `M${f2(s.x)} ${f2(s.y)}L${f2(e.x)} ${f2(e.y)}`;
        segs.push([s, e]);
        if (focused) hl(i.id, <path d={d} style={{ ...HL, strokeWidth: 10 }} />);
        const ang = Math.atan2(e.y - s.y, e.x - s.x);
        const hs = 9;
        const p1 = { x: e.x - Math.cos(ang - 0.45) * hs, y: e.y - Math.sin(ang - 0.45) * hs };
        const p2 = { x: e.x - Math.cos(ang + 0.45) * hs, y: e.y - Math.sin(ang + 0.45) * hs };
        strokes.push(
          <g key={i.id} className={cls}>
            <path d={d} style={{ ...lineStyle, strokeWidth: Math.max(1.8, w - 0.2) }} />
            <path
              d={`M${f2(p1.x)} ${f2(p1.y)}L${f2(e.x)} ${f2(e.y)}L${f2(p2.x)} ${f2(p2.y)}Z`}
              style={{ fill: color, stroke: color, strokeWidth: 1, strokeLinejoin: 'round' }}
            />
          </g>,
        );
        if (i.label) {
          const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
          // 화살표 옆 (위쪽 먼저)
          const nx = Math.sin(ang);
          const ny = -Math.cos(ang);
          label(i.id, mid, i.label, { dir: ny <= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny }, dist: 3, size: 12, color: 'var(--muted)', cls });
        }
        break;
      }
      case 'text': {
        const b = boxes.get(i.id)!;
        label(i.id, b.c, i.label, { color: textColor(i), bold: i.style === 'answer', cls });
        if (focused)
          hl(i.id, <rect x={f2(b.c.x - b.hw)} y={f2(b.c.y - 11)} width={f2(b.hw * 2)} height={22} rx={6} style={{ fill: 'var(--hl)', fillOpacity: 0.45 }} />);
        break;
      }
      case 'point': {
        const pt = P(i.id);
        const hidden = i.style === 'muted' && !i.label;
        if (focused) hl(i.id, <circle cx={f2(pt.x)} cy={f2(pt.y)} r={10} style={{ fill: 'var(--hl)', fillOpacity: 0.6 }} />);
        if (!hidden) {
          obstacles.push({ x: pt.x - 5, y: pt.y - 5, w: 10, h: 10 });
          tops.push(
            <circle
              key={i.id}
              cx={f2(pt.x)}
              cy={f2(pt.y)}
              r={i.style === 'answer' ? 4.6 : 3.8}
              style={{ fill: i.style === 'answer' ? 'var(--accent)' : 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 1.6 }}
              className={cls ? `${cls} kok-fig-pop` : undefined}
            />,
          );
        }
        if (i.label) {
          let dir = { x: pt.x - center.x, y: pt.y - center.y };
          if (Math.hypot(dir.x, dir.y) < 1) dir = { x: 0.7, y: -0.7 };
          label(i.id, pt, i.label, { dir, dist: 5, size: 14, color: textColor(i), bold: true, cls });
        }
        break;
      }
    }
  }

  // 글자 자리: 자리가 정해진 것(상자 안·다각형 가운데·글)부터, 그다음 점 이름 → 각 → 선분·화살표 순서로 고른다
  const rank = (r: LabelDraw) => {
    if (!r.dir) return 0;
    const it = byId.get(r.key);
    return it?.type === 'point' ? 1 : it?.type === 'angle' ? 2 : 3;
  };
  const ordered = [...reqs].sort((a, b) => rank(a) - rank(b));
  const spots = placeLabels(ordered, obstacles, { x: 2, y: 2, w: m.W - 4, h: m.H - 4 }, segs);
  const labels = ordered.map((r) => {
    const c = spots.get(r.key) ?? r.at;
    return (
      <text
        key={`l-${r.key}`}
        x={f2(c.x)}
        y={f2(c.y)}
        textAnchor="middle"
        dominantBaseline="central"
        className={r.cls}
        style={{
          fill: r.color,
          fontSize: r.size,
          fontWeight: r.bold ? 700 : 600,
          stroke: 'var(--surface)',
          strokeWidth: 4,
          strokeLinejoin: 'round',
          paintOrder: 'stroke',
        }}
      >
        {r.text}
      </text>
    );
  });

  // 축과 모눈
  const axis: ReactNode[] = [];
  if (figure.grid || figure.axes) {
    const v = figure.view;
    const xs = ticks(v.x_min, v.x_max, 10);
    const ys = ticks(v.y_min, v.y_max, 8);
    if (figure.grid) {
      for (const x of xs)
        axis.push(<line key={`gx${x}`} x1={f2(m.px(x))} x2={f2(m.px(x))} y1={f2(m.top)} y2={f2(m.bottom)} style={{ stroke: 'var(--line)', strokeWidth: 1 }} />);
      for (const y of ys)
        axis.push(<line key={`gy${y}`} y1={f2(m.py(y))} y2={f2(m.py(y))} x1={f2(m.left)} x2={f2(m.right)} style={{ stroke: 'var(--line)', strokeWidth: 1 }} />);
    }
    if (figure.axes) {
      const ax = v.y_min <= 0 && v.y_max >= 0 ? m.py(0) : m.bottom;
      const ay = v.x_min <= 0 && v.x_max >= 0 ? m.px(0) : m.left;
      const axisStyle: CSSProperties = { stroke: 'var(--muted)', strokeWidth: 1.4 };
      axis.push(<line key="ax" x1={f2(m.left - 6)} x2={f2(m.right + 8)} y1={f2(ax)} y2={f2(ax)} style={axisStyle} />);
      axis.push(<line key="ay" y1={f2(m.bottom + 6)} y2={f2(m.top - 8)} x1={f2(ay)} x2={f2(ay)} style={axisStyle} />);
      axis.push(
        <path
          key="axh"
          d={`M${f2(m.right + 2)} ${f2(ax - 4)}L${f2(m.right + 9)} ${f2(ax)}L${f2(m.right + 2)} ${f2(ax + 4)}`}
          style={{ ...axisStyle, fill: 'none' }}
        />,
      );
      axis.push(
        <path
          key="ayh"
          d={`M${f2(ay - 4)} ${f2(m.top - 2)}L${f2(ay)} ${f2(m.top - 9)}L${f2(ay + 4)} ${f2(m.top - 2)}`}
          style={{ ...axisStyle, fill: 'none' }}
        />,
      );
      const tickStyle: CSSProperties = { fill: 'var(--muted)', fontSize: 10.5, fontWeight: 500 };
      const skipEvery = xs.length > 10 ? 2 : 1;
      xs.forEach((x, k) => {
        if (Math.abs(x) < 1e-9 || k % skipEvery) return;
        axis.push(<line key={`tx${x}`} x1={f2(m.px(x))} x2={f2(m.px(x))} y1={f2(ax - 3)} y2={f2(ax + 3)} style={axisStyle} />);
        axis.push(
          <text key={`txl${x}`} x={f2(m.px(x))} y={f2(ax + 15)} textAnchor="middle" style={tickStyle}>
            {tickLabel(x)}
          </text>,
        );
      });
      ys.forEach((y) => {
        if (Math.abs(y) < 1e-9) return;
        axis.push(<line key={`ty${y}`} y1={f2(m.py(y))} y2={f2(m.py(y))} x1={f2(ay - 3)} x2={f2(ay + 3)} style={axisStyle} />);
        axis.push(
          <text key={`tyl${y}`} x={f2(ay - 6)} y={f2(m.py(y) + 3.6)} textAnchor="end" style={tickStyle}>
            {tickLabel(y)}
          </text>,
        );
      });
      if (v.x_min <= 0 && v.x_max >= 0 && v.y_min <= 0 && v.y_max >= 0) {
        axis.push(
          <text key="o" x={f2(ay - 6)} y={f2(ax + 14)} textAnchor="end" style={{ ...tickStyle, fontStyle: 'italic' }}>
            O
          </text>,
        );
      }
      axis.push(
        <text key="xl" x={f2(m.right + 8)} y={f2(ax - 8)} textAnchor="end" style={{ ...tickStyle, fontSize: 12, fontStyle: 'italic' }}>
          x
        </text>,
      );
      axis.push(
        <text key="yl" x={f2(ay + 8)} y={f2(m.top - 4)} textAnchor="start" style={{ ...tickStyle, fontSize: 12, fontStyle: 'italic' }}>
          y
        </text>,
      );
    }
  }

  const names = figure.items.filter((i) => shown(i) && i.label).map((i) => previewText(i.label));
  return (
    <svg
      viewBox={`0 0 ${f2(m.W)} ${f2(m.H)}`}
      className={className}
      role="img"
      aria-label={title ?? (names.length ? `그림: ${names.slice(0, 8).join(', ')}` : '그림')}
      style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 380, fontFamily: FONT }}
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect x={f2(m.left - 2)} y={f2(m.top - 2)} width={f2(m.right - m.left + 4)} height={f2(m.bottom - m.top + 4)} />
        </clipPath>
      </defs>
      <g>{axis}</g>
      <g>{under}</g>
      <g>{fills}</g>
      <g>{strokes}</g>
      <g>{marks}</g>
      <g>{tops}</g>
      <g>{labels}</g>
    </svg>
  );
});

/** a 에서 b 쪽으로 by 만큼 간 점 (화살표 끝이 점에 박히지 않게) */
function shorten(a: Pt, b: Pt, by: number): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + ((b.x - a.x) * by) / len, y: a.y + ((b.y - a.y) * by) / len };
}
