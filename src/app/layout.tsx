import type { Metadata, Viewport } from 'next';
import '@fontsource/jua/400.css';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import 'katex/dist/katex.min.css';
import './globals.css';
import { Providers } from '@/components/Providers';
import { THEME_BOOT } from '@/lib/theme';

export const metadata: Metadata = {
  title: { default: '콕 · 준비는 AI가, 외우기는 내가', template: '%s · 콕' },
  description: '공부 자료를 넣으면 AI가 정리 노트·마인드맵·핵심 문제·복습 일정을 만들어 주는 공부 앱',
  applicationName: '콕',
  appleWebApp: { capable: true, title: '콕', statusBarStyle: 'default' },
  icons: { icon: '/favicon.ico', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f3f6' },
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
