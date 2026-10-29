import type { Metadata, Viewport } from 'next';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import 'katex/dist/katex.min.css';
import './globals.css';
// 시그니처 테마의 모양 (<html data-skin>): globals.css 뒤에 실어서 같은 세기의 규칙이면 이쪽이 이긴다
import './skins.css';
import { Providers } from '@/components/Providers';
import { THEME_BOOT } from '@/lib/theme';

export const metadata: Metadata = {
  title: { default: 'KOK · 준비는 AI가, 외우기는 내가', template: '%s · KOK' },
  description: '공부 자료를 넣으면 AI가 정리 노트·마인드맵·핵심 문제·복습 일정을 만들어 주는 공부 앱',
  applicationName: 'KOK',
  appleWebApp: { capable: true, title: 'KOK', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // 테마(Pro)는 그리기 전에 <html> 에 속성을 붙이므로 그 속성 차이는 경고하지 않는다
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
