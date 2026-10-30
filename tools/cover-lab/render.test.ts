// 표지 그림 미리보기: 예시를 자료함 카드 크기(폰 2칸·넓은 화면 4칸)와 표지 그림 창 크기로 그려 tools/cover-lab/out/covers.html 에 쓴다
// (밝은·어두운 화면. npm test 에는 안 들어간다)
// 실행: npx vitest run --config tools/cover-lab/vitest.config.ts  → python3 tools/cover-lab/shot.py
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { it } from 'vitest';
import { CoverArt, fitCoverTex } from '@/components/CoverArt';
import { subjectVar } from '@/lib/colors';
import { normalizeCover, packCover, readCover } from '@/lib/cover';
import { SAMPLES } from './samples';

/** 카드: 너비, 제목 줄 수 (제목이 두 줄이면 표지 칸이 낮다) */
const CARDS = [
  { name: '폰 · 제목 한 줄', w: 173, lines: 1 },
  { name: '폰 · 제목 두 줄', w: 173, lines: 2 },
  { name: '넓은 화면', w: 236, lines: 1 },
] as const;
const CARD_H = 196;
/** 아래 칸 높이 (제목 15px·1.375 줄 + 날짜 줄 + 여백: LibraryView 와 같게) */
const footH = (lines: number) => 10 + lines * 20.6 + 4 + 16 + 14;

function rows(): ReactNode[] {
  return SAMPLES.map((s, si) => {
    const c = normalizeCover(s.raw);
    // 저장했다가 다시 읽은 것으로 그린다 (앱과 같은 길)
    const cover = c ? readCover(JSON.parse(JSON.stringify(packCover(c)))) : null;
    const bytes = c ? JSON.stringify(packCover(c)).length : 0;
    const tint = subjectVar(s.tint);
    const cells: ReactNode[] = cover
      ? [
          ...CARDS.map((k, ki) => {
            const region = CARD_H - footH(k.lines);
            const size = { w: k.w - 12, h: Math.round(region - 6) };
            const title = k.lines === 2 ? `${s.name} 정리 노트 두 줄 제목` : s.name;
            return h(
              'div',
              { className: 'cell', key: ki },
              h('p', { className: 'tag' }, `${k.name} · ${size.w}×${size.h}`),
              h(
                'div',
                { className: 'card', style: { width: k.w, height: CARD_H } },
                h(
                  'div',
                  { className: 'region', style: { height: region, background: `color-mix(in srgb, ${tint} 8%, transparent)` } },
                  h('div', { className: 'art' }, h(CoverArt, { cover, tint: s.tint, size, reserve: { w: 70, h: 36 } })),
                ),
                h('div', { className: 'btns' }, h('span', null, '★'), h('span', null, '⋯')),
                h(
                  'div',
                  { className: 'foot' },
                  h('p', { className: 't' }, title),
                  h('p', { className: 'm' }, h('i', { style: { background: tint } }), 'PDF 12쪽 · 10월 30일'),
                ),
              ),
            );
          }),
          h(
            'div',
            { className: 'cell', key: 'sheet' },
            h('p', { className: 'tag' }, '표지 그림 창 · 330×220'),
            h(
              'div',
              { className: 'sheet', style: { background: `color-mix(in srgb, ${tint} 8%, var(--surface))` } },
              h(CoverArt, { cover, tint: s.tint, size: { w: 330, h: 220 }, reserve: { w: 0, h: 0 }, describe: true }),
            ),
          ),
        ]
      : [h('p', { className: 'none', key: 'none' }, '그릴 것 없음 (검사에서 빠짐)')];
    return h(
      'section',
      { key: si },
      h('h3', null, s.name, ' ', h('small', null, `${c?.kind ?? ''} · ${bytes} 바이트`)),
      h('div', { className: 'row' }, ...cells),
    );
  });
}

it('표지 예시를 그린다', () => {
  const root = path.resolve(__dirname, '../..');
  const out = path.resolve(__dirname, 'out');
  mkdirSync(out, { recursive: true });
  const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
  const light = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);
  const darkStart = css.indexOf(":root:not([data-mode='light']) {");
  const dark = css.slice(darkStart, css.indexOf('}', darkStart) + 1).replace(":root:not([data-mode='light'])", '.dark');
  const font = pathToFileURL(path.join(root, 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2')).href;
  const katexCss = pathToFileURL(path.join(root, 'node_modules/katex/dist/katex.min.css')).href;
  // 한 번에 그린다 (그림마다 다른 id 를 받아 잘라 내기가 섞이지 않게: 앱에서도 한 화면은 한 나무다)
  const body = renderToStaticMarkup(h('div', null, h('div', { className: 'col' }, ...rows()), h('div', { className: 'col dark' }, ...rows())));
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${katexCss}"><style>
@font-face{font-family:Pretendard;src:url(${font}) format('woff2');font-weight:45 920}
${light}
${dark}
*{box-sizing:border-box}
body{margin:0;font-family:Pretendard,"Noto Sans KR",sans-serif}
.col{padding:16px 20px;background:var(--bg);color:var(--ink)}
section{margin-bottom:18px}
h3{margin:0 0 6px;font-size:13px}
h3 small{font-weight:500;color:var(--muted)}
.row{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.tag{margin:0 0 4px;font-size:10px;color:var(--muted)}
.card{position:relative;background:var(--surface);border-radius:22px;box-shadow:0 1px 2px var(--shadow),0 4px 16px var(--shadow);display:flex;flex-direction:column;overflow:hidden}
.region{position:relative;flex:none;border-radius:22px 22px 0 0}
.art{position:absolute;left:6px;top:6px;right:6px;bottom:0}
.btns{position:absolute;right:6px;top:6px;display:flex;color:var(--muted);font-size:15px}
.btns span{width:32px;height:32px;display:grid;place-items:center}
.foot{padding:10px 16px 14px}
.t{margin:0;font-size:15px;font-weight:700;line-height:1.375;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.m{margin:4px 0 0;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
.m i{width:8px;height:8px;border-radius:9px;display:inline-block}
.sheet{width:330px;height:220px;border-radius:16px;overflow:hidden}
.none{color:var(--muted);font-size:13px}
</style></head><body>${body}
<script>const fitCoverTex = ${fitCoverTex.toString()};
const run = () => document.querySelectorAll('[data-roomw]').forEach((el) => fitCoverTex(el));
run(); document.fonts.ready.then(run);</script></body></html>`;
  writeFileSync(path.join(out, 'covers.html'), html);
});
