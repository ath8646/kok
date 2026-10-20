// 다시 그린 그림 미리보기: 예시를 HTML 로 그려 tools/art-lab/out/arts.html 에 쓴다 (밝은·어두운 화면 나란히. npm test 에는 안 들어간다)
// 실행: npx vitest run --config tools/art-lab/vitest.config.ts  → python3 tools/art-lab/shot.py (360px·1280px 화면 찍기)
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { it } from 'vitest';
import { ArtView } from '@/components/art/ArtView';
import { primeMapFile } from '@/components/art/useLand';
import { normalizeArt } from '@/lib/art/spec';
import { SAMPLES } from './samples';

it('그림 예시를 그린다', () => {
  const root = path.resolve(__dirname, '../..');
  const out = path.resolve(__dirname, 'out');
  mkdirSync(out, { recursive: true });
  // 지도 밑그림은 받지 않고 미리 넣어 둔다
  const maps = path.join(root, 'public/maps');
  for (const f of readdirSync(maps)) if (f.endsWith('.json')) primeMapFile(f.replace(/\.json$/, ''), JSON.parse(readFileSync(path.join(maps, f), 'utf8')));
  const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
  const light = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);
  const darkStart = css.indexOf(":root:not([data-mode='light']) {");
  const dark = css.slice(darkStart, css.indexOf('}', darkStart) + 1).replace(":root:not([data-mode='light'])", '.dark');
  const font = pathToFileURL(path.join(root, 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2')).href;
  // 한 번에 그린다 (그림마다 다른 id 를 받아 잘라 내기·무늬가 섞이지 않게: 앱에서도 한 화면은 한 나무다)
  const tree = h(
    'div',
    null,
    ...SAMPLES.map((s, i) => {
      const art = normalizeArt(s.kind, s.raw);
      const bytes = art ? new TextEncoder().encode(JSON.stringify(art)).length : 0;
      return h(
        'section',
        { key: i, className: 'card' },
        h('h3', null, s.name),
        h('p', { className: 'meta' }, `${s.kind} · ${bytes} 바이트`),
        art ? h(ArtView, { art }) : h('p', { className: 'none' }, '그릴 것 없음 (검사에서 빠짐)'),
      );
    }),
  );
  const light_ = renderToStaticMarkup(tree);
  const dark_ = renderToStaticMarkup(tree);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
@font-face{font-family:Pretendard;src:url(${font}) format('woff2');font-weight:45 920}
${light}
${dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);font-family:Pretendard,"Noto Sans KR",sans-serif;color:var(--ink)}
.wrap{display:grid;grid-template-columns:1fr 1fr}
.col{padding:16px;background:var(--bg);color:var(--ink);min-width:0}
.card{background:var(--surface);border-radius:22px;padding:16px;margin-bottom:14px}
.card h3{margin:0 0 2px;font-size:14px}
.meta{margin:0 0 10px;font-size:11px;color:var(--muted)}
.none{color:var(--muted);font-size:13px}
@media (max-width:700px){.wrap{grid-template-columns:1fr}}
</style></head><body><div class="wrap"><div class="col">${light_}</div><div class="col dark">${dark_}</div></div></body></html>`;
  writeFileSync(path.join(out, 'arts.html'), html);
});
