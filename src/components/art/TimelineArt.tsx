'use client';
// 연표 다시 그리기 (세로): 왼쪽에 날짜, 가운데 기간 막대(세로쓰기)와 줄, 오른쪽에 사건. 폰에서도 글이 작아지지 않는다
import { memo, type ReactNode } from 'react';
import { layoutTimeline, TL } from '@/lib/art/layout';
import type { TimelineArt } from '@/lib/art/spec';
import { FONT, TONE_VAR, haloText, svgStyle } from './shared';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 세로쓰기: 글자를 하나씩 위에서 아래로 (괄호는 세로 모양으로) */
const VERTICAL: Record<string, string> = { '(': '︵', ')': '︶', '[': '﹇', ']': '﹈', '〈': '︿', '〉': '﹀', '-': '|', '~': '≀', '·': '·' };

export const TimelineArtView = memo(function TimelineArtView({ art, label }: { art: TimelineArt; label: string }) {
  const L = layoutTimeline(art);
  const out: ReactNode[] = [];
  const top = Math.min(...L.events.map((e) => e.y), ...L.spans.map((s) => s.y0), L.H - TL.bottom);
  const bottom = Math.max(...L.events.map((e) => e.y), ...L.spans.map((s) => s.y1), TL.top);
  out.push(
    <line
      key="axis"
      x1={r1(L.axisX)}
      x2={r1(L.axisX)}
      y1={r1(top - 6)}
      y2={r1(bottom + 6)}
      style={{ stroke: 'var(--line)', strokeWidth: 2.4, strokeLinecap: 'round' }}
    />,
  );

  // 기간 막대 (뒤에서부터 그려 앞 줄이 위에 온다)
  art.spans.forEach((s, i) => {
    const { y0, y1 } = L.spans[i];
    const x = L.laneX[s.lane] ?? L.laneX[0];
    const c = TONE_VAR[s.tone];
    out.push(
      <rect
        key={`s${i}`}
        x={r1(x - TL.bar / 2)}
        y={r1(y0)}
        width={TL.bar}
        height={r1(y1 - y0)}
        rx={TL.bar / 2}
        style={{ fill: c, fillOpacity: 0.22, stroke: c, strokeWidth: 1.3 }}
      />,
    );
    const chars = Array.from(s.label.replace(/\s+/g, '')).map((ch) => VERTICAL[ch] ?? ch);
    if (!chars.length) return;
    if (chars.length * 12.5 + 8 <= y1 - y0) {
      // 막대 안에 세로쓰기
      const startY = (y0 + y1) / 2 - ((chars.length - 1) * 12.5) / 2;
      out.push(
        <text key={`sl${i}`} textAnchor="middle" style={{ fill: 'var(--ink)', fontSize: 11, fontWeight: 700 }}>
          {chars.map((ch, k) => (
            <tspan key={k} x={r1(x)} y={r1(startY + k * 12.5)} dominantBaseline="central">
              {ch}
            </tspan>
          ))}
        </text>,
      );
    } else {
      // 막대가 짧으면 막대 가운데에 가로로 (바탕색 테두리로 줄·날짜 위에서도 읽힌다)
      out.push(
        <text
          key={`sl${i}`}
          x={r1(x)}
          y={r1((y0 + y1) / 2)}
          textAnchor="middle"
          dominantBaseline="central"
          style={haloText({ size: 11.5, weight: 800, color: c })}
        >
          {s.label}
        </text>,
      );
    }
  });

  // 사건: 점 · 날짜 · 이름 · 설명
  art.events.forEach((e, i) => {
    const pos = L.events[i];
    const c = TONE_VAR[e.tone];
    out.push(<circle key={`d${i}`} cx={r1(L.axisX)} cy={r1(pos.y)} r={5.2} style={{ fill: 'var(--surface)', stroke: c, strokeWidth: 2.6 }} />);
    out.push(
      <text key={`y${i}`} x={r1(L.yearRight)} y={r1(pos.y)} textAnchor="end" dominantBaseline="central" style={{ fill: c, fontSize: TL.year, fontWeight: 800 }}>
        {e.when || String(e.year)}
      </text>,
    );
    pos.lines.forEach((line, k) =>
      out.push(
        <text
          key={`l${i}-${k}`}
          x={r1(L.labelX)}
          y={r1(pos.y + k * 17)}
          dominantBaseline="central"
          style={{ fill: 'var(--ink)', fontSize: TL.size, fontWeight: 650 }}
        >
          {line}
        </text>,
      ),
    );
    pos.detail.forEach((line, k) =>
      out.push(
        <text
          key={`t${i}-${k}`}
          x={r1(L.labelX)}
          y={r1(pos.y + pos.lines.length * 17 + k * 15 - 2)}
          dominantBaseline="central"
          style={{ fill: 'var(--muted)', fontSize: TL.detail, fontWeight: 500 }}
        >
          {line}
        </text>,
      ),
    );
  });

  return (
    <svg viewBox={`0 0 ${L.W} ${L.H}`} role="img" aria-label={label} style={{ ...svgStyle(), fontFamily: FONT }}>
      {out}
    </svg>
  );
});
