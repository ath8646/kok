'use client';
// 앱 전체에 깔리는 것: 알림(토스트), 확인 창(브라우저 confirm 대신), 서비스 워커 등록
import { useEffect, type ReactNode } from 'react';
import { ToastProvider } from './ui';
import { ConfirmProvider } from './Confirm';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  }, []);
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
