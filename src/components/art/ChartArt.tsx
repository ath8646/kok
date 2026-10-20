'use client';
// 그래프 다시 그리기: 막대(세로·가로·쌓은), 꺾은선, 막대+꺾은선(두 축, 기후 그래프), 인구 피라미드, 원(도넛)
import { memo, type ReactNode } from 'react';
import { textWidth } from '@/lib/figure/layout';
import { fmtNum, niceRange } from '@/lib/art/layout';
import { TONE_CYCLE, type ArtTone, type ChartArt, type ChartSeries } from '@/lib/art/spec';
import { FONT, TONE_VAR, haloText, svgStyle } from './shared';

const W = 360;
const TICK = 10.5;
const CAT = 11.5;
const r1 = (n: number) => Math.round(n * 10) / 10;
const tickStyle = { fill: 'var(--muted)', fontSize: TICK, fontWeight: 500 } as const;
const catStyle = { fill: 'var(--ink)', fontSize: CAT, fontWeight: 600 } as const;

/** 위쪽만 둥근 막대 (아래로 자라는 막대는 아래쪽이 둥글다) */
function barPath(x: number, y0: number, w: number, y1: number, r = 3): string {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const h = bottom - top;
  if (h < 0.5) return '';
  const rr = Math.min(r, w / 2, h);
  if (y1 <= y0) {
    // 위로 자란다
    return `M${r1(x)} ${r1(bottom)}V${r1(top + rr)}Q${r1(x)} ${r1(top)} ${r1(x + rr)} ${r1(top)}H${r1(x + w - rr)}Q${r1(x + w)} ${r1(top)} ${r1(x + w)} ${r1(top + rr)}V${r1(bottom)}Z`;
  }
  return `M${r1(x)} ${r1(top)}V${r1(bottom - rr)}Q${r1(x)} ${r1(bottom)} ${r1(x + rr)} ${r1(bottom)}H${r1(x + w - rr)}Q${r1(x + w)} ${r1(bottom)} ${r1(x + w)} ${r1(bottom - rr)}V${r1(top)}Z`;
}

/** 오른쪽만 둥근 가로 막대 (왼쪽으로 자라면 왼쪽이 둥글다) */
function hbarPath(x0: number, y: number, x1: number, h: number, r = 3): string {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const w = right - left;
  if (w < 0.5) return '';
  const rr = Math.min(r, h / 2, w);
  if (x1 >= x0)
    return `M${r1(left)} ${r1(y)}H${r1(right - rr)}Q${r1(right)} ${r1(y)} ${r1(right)} ${r1(y + rr)}V${r1(y + h - rr)}Q${r1(right)} ${r1(y + h)} ${r1(right - rr)} ${r1(y + h)}H${r1(left)}Z`;
  return `M${r1(right)} ${r1(y)}H${r1(left + rr)}Q${r1(left)} ${r1(y)} ${r1(left)} ${r1(y + rr)}V${r1(y + h - rr)}Q${r1(left)} ${r1(y + h)} ${r1(left + rr)} ${r1(y + h)}H${r1(right)}Z`;
}

const axisTitle = (label: string, unit: string) => [label, unit ? `(${unit})` : ''].filter(Boolean).join(' ');
const clipText = (s: string, size: number, maxW: number) => {
  if (textWidth(s, size) <= maxW) return s;
  let out = '';
  for (const ch of s) {
    if (textWidth(`${out}${ch}…`, size) > maxW) break;
    out += ch;
  }
  return `${out}…`;
};

export const ChartArtView = memo(function ChartArtView({ art, label }: { art: ChartArt; label: string }) {
  if (art.type === 'pie') return <PieChart art={art} label={label} />;
  if (art.type === 'hbar') return <HBarChart art={art} label={label} />;
  if (art.type === 'pyramid') return <PyramidChart art={art} label={label} />;
  return <ColumnChart art={art} label={label} />;
});

function Svg({ H, label, children }: { H: number; label: string; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${r1(H)}`} role="img" aria-label={label} style={{ ...svgStyle(), fontFamily: FONT }}>
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------- 세로 막대·쌓은 막대·꺾은선·막대+꺾은선
function ColumnChart({ art, label }: { art: ChartArt; label: string }) {
  const n = art.categories.length;
  const left = art.series.filter((s) => s.axis !== 'right');
  const right = art.series.filter((s) => s.axis === 'right');
  const stacked = art.type === 'stacked';
  const bars = art.series.filter((s) => s.as === 'bar');
  const lines = art.series.filter((s) => s.as === 'line');
  const ext = (list: ChartSeries[]) => {
    let lo = Infinity;
    let hi = -Infinity;
    if (stacked) {
      for (let k = 0; k < n; k++) {
        let pos = 0;
        let neg = 0;
        for (const s of list) {
          if (s.values[k] >= 0) pos += s.values[k];
          else neg += s.values[k];
        }
        lo = Math.min(lo, neg);
        hi = Math.max(hi, pos);
      }
    } else for (const s of list) for (const v of s.values) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
    return Number.isFinite(lo) ? [lo, hi] : [0, 1];
  };
  const [ll, lh] = ext(left);
  const L = niceRange(ll, lh, 5, art.y_max > art.y_min ? { min: art.y_min, max: art.y_max } : undefined);
  const R = right.length ? niceRange(...(ext(right) as [number, number]), 5) : null;
  const lw = Math.max(18, ...L.ticks.map((t) => textWidth(fmtNum(t), TICK)));
  const rw = R ? Math.max(18, ...R.ticks.map((t) => textWidth(fmtNum(t), TICK))) : 0;
  const x0 = lw + 12;
  const x1 = W - (R ? rw + 12 : 10);
  const plotW = x1 - x0;
  const band = plotW / n;
  // 이름이 길어 다 안 들어가면 비스듬히 눕힌다
  const widths = art.categories.map((c) => textWidth(c, CAT));
  const rotate = widths.some((w) => w > band - 4);
  const every = rotate && n > 14 ? 2 : 1;
  const catH = rotate ? Math.min(78, Math.max(...widths.map((w) => Math.min(w, 110))) * 0.64 + 14) : 22;
  const top = 26;
  const plotH = 176;
  const yb = top + plotH;
  const H = yb + catH + (art.x_label ? 18 : 4);
  const yL = (v: number) => yb - ((v - L.min) / (L.max - L.min)) * plotH;
  const yR = (v: number) => (R ? yb - ((v - R.min) / (R.max - R.min)) * plotH : yb);
  const cx = (k: number) => x0 + band * (k + 0.5);
  const yOf = (s: ChartSeries) => (s.axis === 'right' ? yR : yL);

  const grid: ReactNode[] = L.ticks.map((t) => (
    <g key={`g${t}`}>
      <line
        x1={x0}
        x2={x1}
        y1={r1(yL(t))}
        y2={r1(yL(t))}
        style={{ stroke: Math.abs(t) < 1e-9 ? 'var(--muted)' : 'var(--line)', strokeWidth: 1, strokeOpacity: Math.abs(t) < 1e-9 ? 0.7 : 1 }}
      />
      <text x={x0 - 6} y={r1(yL(t))} textAnchor="end" dominantBaseline="central" style={tickStyle}>
        {fmtNum(t)}
      </text>
    </g>
  ));
  if (R)
    R.ticks.forEach((t) =>
      grid.push(
        <text key={`r${t}`} x={x1 + 6} y={r1(yR(t))} textAnchor="start" dominantBaseline="central" style={tickStyle}>
          {fmtNum(t)}
        </text>,
      ),
    );

  const marks: ReactNode[] = [];
  const values: ReactNode[] = [];
  if (stacked) {
    const bw = Math.min(38, band * 0.58);
    for (let k = 0; k < n; k++) {
      let pos = 0;
      let neg = 0;
      bars.forEach((s, j) => {
        const v = s.values[k];
        const from = v >= 0 ? pos : neg;
        const to = from + v;
        if (v >= 0) pos = to;
        else neg = to;
        const isTop = j === bars.length - 1 || bars.slice(j + 1).every((t) => t.values[k] === 0);
        const d = isTop ? barPath(cx(k) - bw / 2, yL(from), bw, yL(to)) : rectPath(cx(k) - bw / 2, yL(from), bw, yL(to));
        if (d) marks.push(<path key={`s${j}-${k}`} d={d} style={{ fill: TONE_VAR[s.tone], fillOpacity: 0.88, stroke: 'var(--surface)', strokeWidth: 0.8 }} />);
        if (art.value_labels && v !== 0 && Math.abs(yL(to) - yL(from)) > 14)
          values.push(
            <text
              key={`sv${j}-${k}`}
              x={r1(cx(k))}
              y={r1((yL(from) + yL(to)) / 2)}
              textAnchor="middle"
              dominantBaseline="central"
              style={haloText({ size: 10, weight: 700, halo: 'var(--surface)' })}
            >
              {fmtNum(v)}
            </text>,
          );
      });
    }
  } else if (bars.length) {
    const gw = band * 0.74;
    const bw = Math.min(28, gw / bars.length);
    const start = (k: number) => cx(k) - (bw * bars.length) / 2;
    bars.forEach((s, j) => {
      const y = yOf(s);
      const base = y(Math.max(s.axis === 'right' && R ? R.min : L.min, Math.min(0, s.axis === 'right' && R ? R.max : L.max)));
      s.values.forEach((v, k) => {
        const d = barPath(start(k) + j * bw + 0.6, base, bw - 1.2, y(v));
        if (d) marks.push(<path key={`b${j}-${k}`} d={d} style={{ fill: TONE_VAR[s.tone], fillOpacity: 0.88 }} />);
        if (art.value_labels)
          values.push(
            <text
              key={`bv${j}-${k}`}
              x={r1(start(k) + (j + 0.5) * bw)}
              y={r1(v >= 0 ? y(v) - 7 : y(v) + 8)}
              textAnchor="middle"
              dominantBaseline="central"
              style={haloText({ size: 10, weight: 700 })}
            >
              {fmtNum(v)}
            </text>,
          );
      });
    });
  }
  lines.forEach((s, j) => {
    const y = yOf(s);
    const pts = s.values.map((v, k) => ({ x: cx(k), y: y(v) }));
    const c = TONE_VAR[s.tone];
    marks.push(
      <path
        key={`ln${j}`}
        d={`M${pts.map((p) => `${r1(p.x)} ${r1(p.y)}`).join('L')}`}
        style={{ fill: 'none', stroke: c, strokeWidth: 2.4, strokeLinejoin: 'round', strokeLinecap: 'round' }}
      />,
    );
    pts.forEach((p, k) => {
      marks.push(<circle key={`lp${j}-${k}`} cx={r1(p.x)} cy={r1(p.y)} r={3.2} style={{ fill: 'var(--surface)', stroke: c, strokeWidth: 2 }} />);
      if (art.value_labels)
        values.push(
          <text
            key={`lv${j}-${k}`}
            x={r1(p.x)}
            y={r1(p.y - 10)}
            textAnchor="middle"
            dominantBaseline="central"
            style={haloText({ size: 10, weight: 700, color: c })}
          >
            {fmtNum(s.values[k])}
          </text>,
        );
    });
  });

  const cats = art.categories.map((c, k) =>
    k % every ? null : rotate ? (
      <text key={`c${k}`} transform={`translate(${r1(cx(k))} ${r1(yb + 10)}) rotate(-40)`} textAnchor="end" dominantBaseline="central" style={catStyle}>
        {clipText(c, CAT, 110)}
      </text>
    ) : (
      <text key={`c${k}`} x={r1(cx(k))} y={r1(yb + 13)} textAnchor="middle" dominantBaseline="central" style={catStyle}>
        {c}
      </text>
    ),
  );

  return (
    <Svg H={H} label={label}>
      <text x={4} y={12} style={{ ...tickStyle, fontSize: 11, fontWeight: 600 }}>
        {axisTitle(art.y_label, art.unit)}
      </text>
      {R ? (
        <text x={W - 4} y={12} textAnchor="end" style={{ ...tickStyle, fontSize: 11, fontWeight: 600 }}>
          {axisTitle(art.right_label, art.right_unit)}
        </text>
      ) : null}
      {grid}
      {marks}
      {values}
      {cats}
      {art.x_label ? (
        <text x={r1((x0 + x1) / 2)} y={r1(H - 6)} textAnchor="middle" style={{ ...tickStyle, fontSize: 11, fontWeight: 600 }}>
          {art.x_label}
        </text>
      ) : null}
    </Svg>
  );
}

function rectPath(x: number, y0: number, w: number, y1: number): string {
  const top = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return '';
  return `M${r1(x)} ${r1(top)}H${r1(x + w)}V${r1(top + h)}H${r1(x)}Z`;
}

// ---------------------------------------------------------------- 가로 막대
function HBarChart({ art, label }: { art: ChartArt; label: string }) {
  const n = art.categories.length;
  const series = art.series;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) for (const v of s.values) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  const R = niceRange(lo, hi, 4, art.y_max > art.y_min ? { min: art.y_min, max: art.y_max } : undefined);
  const labelW = Math.min(120, Math.max(...art.categories.map((c) => textWidth(c, CAT))) + 4);
  const x0 = labelW + 12;
  const x1 = W - 18;
  const per = Math.min(16, 34 / series.length);
  const band = Math.max(26, per * series.length + 12);
  const top = 22;
  const yb = top + band * n;
  const H = yb + 24 + (art.y_label || art.unit ? 4 : 0);
  const xv = (v: number) => x0 + ((v - R.min) / (R.max - R.min)) * (x1 - x0);
  const zero = xv(Math.max(R.min, Math.min(0, R.max)));
  const out: ReactNode[] = [];
  R.ticks.forEach((t) => {
    out.push(
      <line
        key={`g${t}`}
        x1={r1(xv(t))}
        x2={r1(xv(t))}
        y1={top - 4}
        y2={r1(yb)}
        style={{ stroke: Math.abs(t) < 1e-9 ? 'var(--muted)' : 'var(--line)', strokeOpacity: Math.abs(t) < 1e-9 ? 0.7 : 1 }}
      />,
    );
    out.push(
      <text key={`t${t}`} x={r1(xv(t))} y={r1(yb + 12)} textAnchor="middle" dominantBaseline="central" style={tickStyle}>
        {fmtNum(t)}
      </text>,
    );
  });
  art.categories.forEach((c, k) => {
    const yc = top + band * (k + 0.5);
    out.push(
      <text key={`c${k}`} x={x0 - 8} y={r1(yc)} textAnchor="end" dominantBaseline="central" style={catStyle}>
        {clipText(c, CAT, labelW)}
      </text>,
    );
    series.forEach((s, j) => {
      const y = yc - (per * series.length) / 2 + j * per;
      const v = s.values[k];
      const d = hbarPath(zero, y + 0.6, xv(v), per - 1.2);
      if (d) out.push(<path key={`b${j}-${k}`} d={d} style={{ fill: TONE_VAR[s.tone], fillOpacity: 0.88 }} />);
      if (art.value_labels)
        out.push(
          <text
            key={`v${j}-${k}`}
            x={r1(xv(v) + (v >= 0 ? 5 : -5))}
            y={r1(y + per / 2)}
            textAnchor={v >= 0 ? 'start' : 'end'}
            dominantBaseline="central"
            style={haloText({ size: 10, weight: 700 })}
          >
            {fmtNum(v)}
          </text>,
        );
    });
  });
  return (
    <Svg H={H} label={label}>
      <text x={W - 4} y={11} textAnchor="end" style={{ ...tickStyle, fontSize: 11, fontWeight: 600 }}>
        {axisTitle(art.y_label, art.unit)}
      </text>
      {out}
    </Svg>
  );
}

// ---------------------------------------------------------------- 인구 피라미드 (아래가 어린 나이)
function PyramidChart({ art, label }: { art: ChartArt; label: string }) {
  const n = art.categories.length;
  const [a, b] = [art.series[0], art.series[1] ?? { ...art.series[0], name: '', values: art.categories.map(() => 0), tone: 'pink' as ArtTone }];
  const max = Math.max(1e-9, ...a.values.map(Math.abs), ...b.values.map(Math.abs));
  const R = niceRange(0, max, 3, art.y_max > 0 ? { min: 0, max: art.y_max } : undefined);
  const gutter = Math.min(70, Math.max(...art.categories.map((c) => textWidth(c, 11))) + 12);
  const mid = W / 2;
  const gl = mid - gutter / 2;
  const gr = mid + gutter / 2;
  const side = gl - 12;
  const band = Math.max(12, Math.min(22, 220 / n));
  const top = 30;
  const yb = top + band * n;
  const H = yb + (art.unit ? 40 : 24);
  const len = (v: number) => (Math.abs(v) / R.max) * side;
  const out: ReactNode[] = [];
  R.ticks.forEach((t) => {
    for (const x of [gl - len(t), gr + len(t)]) {
      out.push(<line key={`g${x}`} x1={r1(x)} x2={r1(x)} y1={top - 2} y2={r1(yb)} style={{ stroke: 'var(--line)' }} />);
      out.push(
        <text key={`t${x}`} x={r1(x)} y={r1(yb + 12)} textAnchor="middle" dominantBaseline="central" style={tickStyle}>
          {fmtNum(t)}
        </text>,
      );
    }
  });
  art.categories.forEach((c, k) => {
    // 첫 나이대가 맨 아래
    const y = yb - band * (k + 1);
    const h = band - 2;
    const dl = hbarPath(gl, y + 1, gl - len(a.values[k]), h, 2);
    const dr = hbarPath(gr, y + 1, gr + len(b.values[k]), h, 2);
    if (dl) out.push(<path key={`l${k}`} d={dl} style={{ fill: TONE_VAR[a.tone], fillOpacity: 0.85 }} />);
    if (dr) out.push(<path key={`r${k}`} d={dr} style={{ fill: TONE_VAR[b.tone], fillOpacity: 0.85 }} />);
    if (n <= 12 || k % 2 === 0)
      out.push(
        <text key={`c${k}`} x={mid} y={r1(y + band / 2)} textAnchor="middle" dominantBaseline="central" style={{ ...catStyle, fontSize: 11, fontWeight: 500 }}>
          {c}
        </text>,
      );
  });
  return (
    <Svg H={H} label={label}>
      <text x={r1(gl - side / 2)} y={14} textAnchor="middle" style={{ fill: TONE_VAR[a.tone], fontSize: 12, fontWeight: 700 }}>
        {a.name}
      </text>
      <text x={r1(gr + side / 2)} y={14} textAnchor="middle" style={{ fill: TONE_VAR[b.tone], fontSize: 12, fontWeight: 700 }}>
        {b.name}
      </text>
      {art.unit ? (
        <text x={mid} y={r1(yb + 30)} textAnchor="middle" style={{ ...tickStyle, fontSize: 10.5 }}>
          ({art.unit})
        </text>
      ) : null}
      {out}
    </Svg>
  );
}

// ---------------------------------------------------------------- 원 (도넛) + 오른쪽에 조각 이름·비율
function PieChart({ art, label }: { art: ChartArt; label: string }) {
  const s = art.series[0];
  const vals = s.values.map((v) => Math.max(0, v));
  const total = vals.reduce((x, y) => x + y, 0) || 1;
  const tones = art.categories.map((_, k) => art.slice_tones[k] ?? TONE_CYCLE[k % TONE_CYCLE.length]);
  const n = art.categories.length;
  const rowH = n > 8 ? 17 : 21;
  const H = Math.max(184, n * rowH + 24);
  const cx = 96;
  const cy = H / 2;
  const ro = 78;
  const ri = 46;
  const out: ReactNode[] = [];
  let a0 = -Math.PI / 2;
  vals.forEach((v, k) => {
    if (v <= 0) return;
    const a1 = a0 + (v / total) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${r1(cx + Math.cos(a) * r)} ${r1(cy + Math.sin(a) * r)}`;
    const d =
      vals.filter((x) => x > 0).length === 1
        ? `M${cx - ro} ${r1(cy)}A${ro} ${ro} 0 1 1 ${cx + ro} ${r1(cy)}A${ro} ${ro} 0 1 1 ${cx - ro} ${r1(cy)}ZM${cx - ri} ${r1(cy)}A${ri} ${ri} 0 1 0 ${cx + ri} ${r1(cy)}A${ri} ${ri} 0 1 0 ${cx - ri} ${r1(cy)}Z`
        : `M${p(ro, a0)}A${ro} ${ro} 0 ${big} 1 ${p(ro, a1)}L${p(ri, a1)}A${ri} ${ri} 0 ${big} 0 ${p(ri, a0)}Z`;
    out.push(
      <path key={`s${k}`} d={d} style={{ fill: TONE_VAR[tones[k]], fillOpacity: 0.9, stroke: 'var(--surface)', strokeWidth: 1.6, fillRule: 'evenodd' }} />,
    );
    const share = v / total;
    if (share >= 0.07) {
      const am = (a0 + a1) / 2;
      const rm = (ro + ri) / 2;
      out.push(
        <text
          key={`p${k}`}
          x={r1(cx + Math.cos(am) * rm)}
          y={r1(cy + Math.sin(am) * rm)}
          textAnchor="middle"
          dominantBaseline="central"
          style={haloText({ size: 10.5, weight: 800, halo: 'var(--surface)' })}
        >
          {pct(share)}
        </text>,
      );
    }
    a0 = a1;
  });
  const lx = 196;
  const ly0 = cy - (n * rowH) / 2 + rowH / 2;
  art.categories.forEach((c, k) => {
    const y = ly0 + k * rowH;
    out.push(<rect key={`k${k}`} x={lx} y={r1(y - 5)} width={10} height={10} rx={3} style={{ fill: TONE_VAR[tones[k]] }} />);
    out.push(
      <text key={`n${k}`} x={lx + 16} y={r1(y)} dominantBaseline="central" style={{ ...catStyle, fontSize: 11.5 }}>
        {clipText(c, 11.5, 104)}
      </text>,
    );
    out.push(
      <text key={`v${k}`} x={W - 6} y={r1(y)} textAnchor="end" dominantBaseline="central" style={{ ...tickStyle, fontSize: 11 }}>
        {art.value_labels ? `${fmtNum(s.values[k])}${art.unit === '%' ? '%' : ''}` : pct(vals[k] / total)}
      </text>,
    );
  });
  return (
    <Svg H={H} label={label}>
      {out}
      {s.name || art.unit ? (
        <text x={cx} y={r1(cy)} textAnchor="middle" dominantBaseline="central" style={{ ...tickStyle, fontSize: 11, fontWeight: 600 }}>
          {clipText(s.name || `(${art.unit})`, 11, ri * 1.8)}
        </text>
      ) : null}
    </Svg>
  );
}

function pct(share: number): string {
  const p = share * 100;
  return `${p >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`;
}
