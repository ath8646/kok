import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ArtView } from '@/components/art/ArtView';
import { normalizeArt } from '@/lib/art/spec';
import { SAMPLES } from './samples';

it('해안선을 받기 전에는 바다만 그린다', () => {
  const s = SAMPLES.find((x) => x.kind === 'map')!;
  const art = normalizeArt('map', s.raw)!;
  if (art.kind !== 'map') throw new Error('map');
  const html = renderToStaticMarkup(h(ArtView, { art }));
  expect(html).toContain('var(--bg)');
  expect(html).not.toContain('kok-fig-in');
  expect(html).not.toMatch(/<text/);
  const noLand = renderToStaticMarkup(h(ArtView, { art: { ...art, land: false } }));
  expect(noLand).toMatch(/<text/);
});
