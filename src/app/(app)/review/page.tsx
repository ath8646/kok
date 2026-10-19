'use client';
// 복습: 주소(?subject= · ?mode=wrong · ?kp= · 예전 ?note=)로 고른 방법의 세션. 세션은 ReviewSession 이 맡는다
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ReviewSession } from '@/components/ReviewSession';
import { reviewModeFrom, reviewModeKey } from '@/lib/review-mode';

function ReviewFromAddress() {
  // 다른 화면에서 눌러 들어오면 그리는 동안 window.location 은 아직 앞 화면 주소라서 useSearchParams 로 읽는다
  const mode = reviewModeFrom(useSearchParams());
  // 주소가 바뀌면(예: 오답 다시 풀기 끝 화면에서 아래 '복습' 탭) 새 세션
  return <ReviewSession key={reviewModeKey(mode)} mode={mode} />;
}

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewFromAddress />
    </Suspense>
  );
}
