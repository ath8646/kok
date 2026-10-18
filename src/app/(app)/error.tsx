'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid place-items-center gap-3 py-16 text-center">
      <p className="font-display text-2xl">화면을 그리다가 문제가 생겼어요</p>
      <p className="text-sm text-muted">잠시 뒤에 다시 해 주세요. 계속되면 관리자에게 알려 주세요.</p>
      <Button onClick={() => reset()}>다시 하기</Button>
    </div>
  );
}
