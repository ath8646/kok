import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '콕 · 준비는 AI가, 외우기는 내가',
    short_name: '콕',
    description: '공부 자료를 넣으면 AI가 정리·마인드맵·문제·복습 일정을 만들어 주는 공부 앱',
    lang: 'ko',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f2f5f9',
    theme_color: '#2456e8',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
