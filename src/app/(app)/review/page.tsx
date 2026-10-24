'use client';
// 복습: 주소(?subject= · ?mode=wrong · ?kp= · 예전 ?note=)로 고른 방법의 세션. 세션은 ReviewSession 이 맡는다. ?start=1 이면 바로 시작(홈의 N분 KOK)
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ReviewSession } from '@/components/ReviewSession';
import { reviewModeFrom, reviewModeKey } from '@/lib/review-mode';

function ReviewFromAddress() {
  // 다른 화면에서 눌러 들어오면 그리는 동안 window.location 은 아직 앞 화면 주소라서 useSearchParams 로 읽는다
  const params = useSearchParams();
  const mode = reviewModeFrom(params);
  // ?start=1 (홈의 'N분 KOK 시작'): 고르는 화면 없이 지난번 시간만큼의 오늘 복습 문제로 바로 시작
  const autoStart = params.get('start') === '1';
  // 주소가 바뀌면(예: 오답 다시 풀기 끝 화면에서 아래 '복습' 탭) 새 세션
  return <ReviewSession key={reviewModeKey(mode) + (autoStart ? ':start' : '')} mode={mode} autoStart={autoStart} />;
}

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewFromAddress />
    </Suspense>
  );
}
