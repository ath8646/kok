// 테마 만들기의 미리보기 (설정 > 테마의 테마 만들기 화면이 iframe 으로 띄운다). 예시 글로 그린 홈·노트 화면이라 내 자료는 읽지 않는다
import type { Metadata } from 'next';
import { PreviewScreen } from '@/components/theme/PreviewScreen';

export const metadata: Metadata = { title: '테마 미리보기', robots: { index: false, follow: false } };

export default function ThemePreviewPage() {
  return <PreviewScreen />;
}
