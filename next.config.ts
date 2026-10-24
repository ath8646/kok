import type { NextConfig } from 'next';

// KOK은 거의 모든 화면이 사용자마다 달라서 cacheComponents 를 끈다.
// (끄면 partialPrefetching 도 같이 빼야 한다)
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

// 자료 처리(그림 자르기)를 돌리는 라우트: PDF 쪽을 그리는 pdf.js 가 실행할 때 파일로 읽는 글꼴·CMap·wasm·색 프로필을 같이 싣는다.
// (pdf.js 일꾼 파일과 @napi-rs/canvas 의 네이티브 파일은 src/lib/server/figure-image.ts 가 바로 읽어서 따라 실린다)
// 키는 라우트 경로 패턴이라 [ ] 를 \\ 로 막는다.
const PIPELINE_ROUTES = ['/api/sources', '/api/sources/\\[id\\]/process', '/api/sources/\\[id\\]/retry', '/api/internal/process', '/api/admin/test-figures'];
const PDFJS_RUNTIME_FILES = [
  './node_modules/pdfjs-dist/cmaps/**/*',
  './node_modules/pdfjs-dist/standard_fonts/**/*',
  './node_modules/pdfjs-dist/wasm/**/*',
  './node_modules/pdfjs-dist/iccs/**/*',
];
// pdf.js 꾸러미 가운데 서버가 쓰지 않는 것 (보기 화면, 브라우저용·줄인 빌드, 타입, 소스 맵): 함수 크기를 줄인다.
// 쓰는 것은 legacy/build/pdf.mjs·pdf.worker.mjs 와 위의 파일들뿐이다
const PDFJS_UNUSED_FILES = [
  './node_modules/pdfjs-dist/build/**/*',
  './node_modules/pdfjs-dist/web/**/*',
  './node_modules/pdfjs-dist/image_decoders/**/*',
  './node_modules/pdfjs-dist/types/**/*',
  './node_modules/pdfjs-dist/legacy/web/**/*',
  './node_modules/pdfjs-dist/legacy/image_decoders/**/*',
  './node_modules/pdfjs-dist/**/webpack.mjs',
  './node_modules/pdfjs-dist/**/*.min.mjs',
  './node_modules/pdfjs-dist/**/pdf.sandbox.*',
  './node_modules/pdfjs-dist/**/*.d.mts',
  './node_modules/pdfjs-dist/**/*.map',
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 네이티브 그림 라이브러리와 pdf.js 는 묶지 않고 node_modules 에서 그대로 읽는다
  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    ...Object.fromEntries(PIPELINE_ROUTES.map((route) => [route, PDFJS_RUNTIME_FILES])),
    // PDF 요약 정리: 한글 글꼴 파일을 함수에 같이 싣는다 (src/lib/server/note-pdf.ts 가 파일로 읽는다)
    '/api/notes/\\[id\\]/pdf': ['./src/lib/server/pdf-fonts/**/*'],
  },
  outputFileTracingExcludes: Object.fromEntries(PIPELINE_ROUTES.map((route) => [route, PDFJS_UNUSED_FILES])),
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // 다시 그린 지도의 바탕 지도 (Natural Earth): 내용을 바꾸면 파일 이름도 바꾼다 (오래 기억해 두어서)
      { source: '/maps/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
