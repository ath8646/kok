import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'KOK · 준비는 AI가, 외우기는 내가',
    short_name: 'KOK',
    description: '공부 자료를 넣으면 AI가 정리·마인드맵·문제·복습 일정을 만들어 주는 공부 앱',
    lang: 'ko',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f2f2f7',
    theme_color: '#f2f2f7',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // 앱 아이콘을 길게 누르면 나오는 바로 가기
    shortcuts: [
      { name: '자료 넣기', short_name: '자료 넣기', url: '/library?compose=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: '오늘 복습', short_name: '복습', url: '/review', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
