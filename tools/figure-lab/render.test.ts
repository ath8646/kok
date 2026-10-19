// 그림 설계도 미리보기: 예시 그림을 HTML 로 그려 tools/figure-lab/out 에 쓴다 (화면 확인용, npm test 에는 안 들어간다)
// 실행: npx vitest run --config tools/figure-lab/vitest.config.ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { FigureView } from '@/components/figure/FigureView';
import { StepPlayer } from '@/components/figure/StepPlayer';
import { normalizeFigure, normalizeSteps, visibleAt } from '@/lib/figure/spec';
import { SAMPLES } from './samples';

it('그림 예시를 그린다', () => {
  const out = path.resolve(__dirname, 'out');
  mkdirSync(out, { recursive: true });
  const css = readFileSync(path.resolve(__dirname, '../../src/app/globals.css'), 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);
  const darkStart = css.indexOf(":root:not([data-mode='light']) {");
  const dark = css.slice(darkStart, css.indexOf('}', darkStart) + 1).replace(":root:not([data-mode='light'])", '.dark');
  const cards: string[] = [];
  for (const s of SAMPLES) {
    const fig = normalizeFigure(s.figure);
    if (!fig) {
      cards.push(`<div class="card"><h3>${s.name}</h3><p>그림 없음 (검사에서 빠짐)</p></div>`);
      continue;
    }
    const steps = normalizeSteps(s.steps ?? [], fig);
    const base = renderToStaticMarkup(h(FigureView, { figure: fig, visible: visibleAt(fig, steps, -1) }));
    const last = steps.length ? renderToStaticMarkup(h(FigureView, { figure: fig, visible: visibleAt(fig, steps, steps.length - 1), focus: new Set([...steps[steps.length - 1].focus, ...steps[steps.length - 1].add]) })) : '';
    const player = steps.length ? renderToStaticMarkup(h(StepPlayer, { figure: fig, steps })) : '';
    cards.push(
      `<div class="card"><h3>${s.name}</h3><div class="row"><div class="cell"><p>문제 그림</p>${base}</div>${last ? `<div class="cell"><p>마지막 단계</p>${last}</div>` : ''}</div>${player ? `<div class="player">${player}</div>` : ''}</div>`,
    );
  }
  const body = cards.join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${root}
${dark}
body{margin:0;background:var(--bg);font-family:Pretendard,"Noto Sans KR",sans-serif;color:var(--ink)}
.wrap{display:grid;grid-template-columns:1fr 1fr;gap:0}
.col{padding:16px;background:var(--bg);color:var(--ink)}
.card{background:var(--surface);border-radius:20px;padding:14px;margin-bottom:14px}
.card h3{margin:0 0 8px;font-size:15px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cell p{margin:0 0 4px;font-size:11px;color:var(--muted)}
.player{margin-top:10px}
/* 앱의 Tailwind 대신 꼭 필요한 것만 */
.grid{display:grid}.gap-3{gap:12px}.gap-1{gap:4px}.gap-2{gap:8px}.flex{display:flex}.items-center{align-items:center}.flex-1{flex:1}
.rounded-\\[24px\\]{border-radius:24px}.bg-surface{background:var(--surface)}.ring-1{box-shadow:0 0 0 1px var(--line)}.p-4{padding:16px}
.text-accent{color:var(--accent)}.text-muted{color:var(--muted)}.font-bold{font-weight:700}.text-xs{font-size:12px}
.bg-accent{background:var(--accent);color:var(--accent-ink)}.bg-surface-2{background:var(--surface-2)}.rounded-full{border-radius:999px}
.h-1{height:4px}.block{display:block}.px-2{padding-left:8px;padding-right:8px}.py-3{padding-top:12px;padding-bottom:12px}
button{border:0;font:inherit;background:none;color:inherit}
</style></head><body><div class="wrap"><div class="col">${body}</div><div class="col dark">${body}</div></div></body></html>`;
  writeFileSync(path.join(out, 'figures.html'), html);
});
