'use client';
// 도식 다시 그리기: 칸에 놓인 상자(네모·둥근 네모·타원·원·글만)와 잇는 선(화살표·양쪽 화살표·선·점선), 묶음 영역
import { memo, type ReactNode } from 'react';
import { DG, layoutDiagram, linkRoute, type NodeBox } from '@/lib/art/layout';
import { textWidth } from '@/lib/mindmap-layout';
import type { DiagramArt } from '@/lib/art/spec';
import { FONT, TONE_VAR, arrowHead, haloText, svgStyle } from './shared';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 상자 테두리에서 선이 닿는 점 (타원·원은 타원 둘레) */
function edgePoint(b: NodeBox, shape: string, toward: { x: number; y: number }): { x: number; y: number } {
  const dx = toward.x - b.cx;
  const dy = toward.y - b.cy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { x: b.cx, y: b.cy };
  if (shape === 'ellipse' || shape === 'circle') {
    const a = b.w / 2;
    const c = b.h / 2;
    const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (c * c));
    return { x: b.cx + dx * t, y: b.cy + dy * t };
  }
  const tx = Math.abs(dx) > 1e-9 ? b.w / 2 / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-9 ? b.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: b.cx + dx * t, y: b.cy + dy * t };
}

export const DiagramArtView = memo(function DiagramArtView({ art, label }: { art: DiagramArt; label: string }) {
  const L = layoutDiagram(art);
  const byId = new Map(art.nodes.map((n) => [n.id, n]));
  const back: ReactNode[] = [];
  const links: ReactNode[] = [];
  const nodes: ReactNode[] = [];
  const linkLabels: ReactNode[] = [];
  // 선 이름이 상자나 다른 선 이름에 겹치지 않게: 놓을 수 있는 자리를 차례로 보고 처음 빈 곳에 (상자 글 위에 얹히던 것)
  type Rect = { x: number; y: number; w: number; h: number };
  const hit = (a: Rect, b: Rect) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
  const solid: Rect[] = [...L.boxes.values()].map((b) => ({ x: b.cx, y: b.cy, w: b.w + 4, h: b.h + 4 }));
  const taken: Rect[] = [];

  art.groups.forEach((g, i) => {
    const r = L.groups[i];
    const c = TONE_VAR[g.tone];
    back.push(
      <g key={`g${i}`}>
        <rect
          x={r1(r.x)}
          y={r1(r.y)}
          width={r1(r.w)}
          height={r1(r.h)}
          rx={14}
          style={{ fill: c, fillOpacity: 0.07, stroke: c, strokeOpacity: 0.45, strokeDasharray: '4 3' }}
        />
        {g.label ? (
          <text x={r1(r.x + 10)} y={r1(r.y + 11)} dominantBaseline="central" style={{ fill: c, fontSize: 11.5, fontWeight: 800 }}>
            {g.label}
          </text>
        ) : null}
      </g>,
    );
  });

  art.links.forEach((l, i) => {
    const a = L.boxes.get(l.from);
    const b = L.boxes.get(l.to);
    if (!a || b === undefined) return;
    const route = linkRoute(a, b);
    // 끝점은 상자 모양 둘레로 (타원·원)
    const sa = byId.get(l.from)?.shape ?? 'box';
    const sb = byId.get(l.to)?.shape ?? 'box';
    if (route.length === 2 && (sa === 'ellipse' || sa === 'circle' || sb === 'ellipse' || sb === 'circle')) {
      route[0] = edgePoint(a, sa, { x: b.cx, y: b.cy });
      route[1] = edgePoint(b, sb, { x: a.cx, y: a.cy });
    }
    const head = l.kind === 'arrow' || l.kind === 'both';
    const tail = l.kind === 'both';
    const pts = [...route];
    // 화살촉 자리만큼 선을 줄인다
    if (head) pts[pts.length - 1] = shorten(pts[pts.length - 1], pts[pts.length - 2], 6);
    if (tail) pts[0] = shorten(pts[0], pts[1], 6);
    const d = `M${pts.map((p) => `${r1(p.x)} ${r1(p.y)}`).join('L')}`;
    links.push(
      <path
        key={`l${i}`}
        d={d}
        style={{ fill: 'none', stroke: 'var(--muted)', strokeWidth: 1.6, strokeDasharray: l.kind === 'dashed' ? '5 3' : undefined, strokeLinejoin: 'round' }}
      />,
    );
    if (head) links.push(<path key={`h${i}`} d={arrowHead(route[route.length - 2], route[route.length - 1], 8)} style={{ fill: 'var(--muted)' }} />);
    if (tail) links.push(<path key={`t${i}`} d={arrowHead(route[1], route[0], 8)} style={{ fill: 'var(--muted)' }} />);
    if (l.label) {
      // 긴 토막의 가운데부터: 상자·다른 선 이름과 겹치지 않는 첫 자리 (없으면 가장 긴 토막 옆으로 비켜서)
      const w = textWidth(l.label, 11) + 8;
      const h = 15;
      const segs = route
        .slice(1)
        .map((p, k) => ({ a: route[k], b: p, len: Math.hypot(p.x - route[k].x, p.y - route[k].y) }))
        .sort((s1, s2) => s2.len - s1.len);
      const spots = segs.flatMap(({ a, b }) => [0.5, 0.3, 0.7].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })));
      const clear = (p: { x: number; y: number }) => {
        const r = { x: p.x, y: p.y, w, h };
        return !solid.some((b) => hit(r, b)) && !taken.some((t) => hit(r, t));
      };
      let at = spots.find(clear);
      if (!at) {
        // 가장 긴 토막의 가운데에서 선에 수직으로 비켜 본다
        const { a, b, len } = segs[0];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const nx = len ? -(b.y - a.y) / len : 0;
        const ny = len ? (b.x - a.x) / len : 1;
        at = [12, -12, 22, -22].map((d) => ({ x: mid.x + nx * d, y: mid.y + ny * d })).find(clear) ?? mid;
      }
      taken.push({ x: at.x, y: at.y, w, h });
      linkLabels.push(
        <text
          key={`ll${i}`}
          x={r1(at.x)}
          y={r1(at.y)}
          textAnchor="middle"
          dominantBaseline="central"
          style={haloText({ size: 11, weight: 700, color: 'var(--muted)' })}
        >
          {l.label}
        </text>,
      );
    }
  });

  art.nodes.forEach((n) => {
    const b = L.boxes.get(n.id);
    if (!b) return;
    const c = TONE_VAR[n.tone];
    const gray = n.tone === 'gray';
    const fill = n.shape === 'plain' ? 'none' : gray ? 'var(--surface-2)' : c;
    const fillOpacity = n.shape === 'plain' ? 0 : gray ? 1 : n.strong ? 0.24 : 0.13;
    const stroke = n.shape === 'plain' ? 'none' : gray ? (n.strong ? 'var(--ink)' : 'var(--line)') : c;
    const shape: ReactNode =
      n.shape === 'ellipse' || n.shape === 'circle' ? (
        <ellipse cx={r1(b.cx)} cy={r1(b.cy)} rx={r1(b.w / 2)} ry={r1(b.h / 2)} style={{ fill, fillOpacity, stroke, strokeWidth: n.strong ? 2.2 : 1.3 }} />
      ) : n.shape === 'plain' ? null : (
        <rect
          x={r1(b.cx - b.w / 2)}
          y={r1(b.cy - b.h / 2)}
          width={r1(b.w)}
          height={r1(b.h)}
          rx={n.shape === 'round' ? r1(b.h / 2) : 8}
          style={{ fill, fillOpacity, stroke, strokeWidth: n.strong ? 2.2 : 1.3 }}
        />
      );
    const lh = DG.line;
    const y0 = b.cy - ((b.lines.length - 1) * lh) / 2;
    nodes.push(
      <g key={`n${n.id}`}>
        {n.shape === 'plain' || n.shape === 'ellipse' || n.shape === 'circle' ? null : (
          <rect
            x={r1(b.cx - b.w / 2)}
            y={r1(b.cy - b.h / 2)}
            width={r1(b.w)}
            height={r1(b.h)}
            rx={n.shape === 'round' ? r1(b.h / 2) : 8}
            style={{ fill: 'var(--surface)' }}
          />
        )}
        {n.shape === 'ellipse' || n.shape === 'circle' ? (
          <ellipse cx={r1(b.cx)} cy={r1(b.cy)} rx={r1(b.w / 2)} ry={r1(b.h / 2)} style={{ fill: 'var(--surface)' }} />
        ) : null}
        {shape}
        <text textAnchor="middle" style={{ fill: 'var(--ink)', fontSize: DG.size, fontWeight: n.strong || n.shape === 'plain' ? 800 : 650 }}>
          {b.lines.map((line, k) => (
            <tspan key={k} x={r1(b.cx)} y={r1(y0 + k * lh)} dominantBaseline="central">
              {line}
            </tspan>
          ))}
        </text>
      </g>,
    );
  });

  return (
    <svg viewBox={`0 0 ${L.W} ${L.H}`} role="img" aria-label={label} style={{ ...svgStyle(), fontFamily: FONT }}>
      {back}
      {links}
      {nodes}
      {linkLabels}
    </svg>
  );
});

function shorten(p: { x: number; y: number }, toward: { x: number; y: number }, by: number) {
  const len = Math.hypot(toward.x - p.x, toward.y - p.y);
  if (len <= by * 1.5) return p;
  return { x: p.x + ((toward.x - p.x) * by) / len, y: p.y + ((toward.y - p.y) * by) / len };
}
