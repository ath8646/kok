'use client';
// 앱 전체에 깔리는 것: 알림(토스트), 서비스 워커 등록
import { useEffect, type ReactNode } from 'react';
import { ToastProvider } from './ui';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  }, []);
  return <ToastProvider>{children}</ToastProvider>;
}
