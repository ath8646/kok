'use client';
// 노트 문제 풀기: 노트의 '이 노트 문제 풀기'. 그 노트의 문제로 바로 시작하고(시간 제한 없음), 끝나면 노트로 돌아간다
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ReviewSession } from '@/components/ReviewSession';

function Practice() {
  const { sourceId } = useParams<{ sourceId: string }>();
  // 노트 화면에서 왔으면(?from=note) 돌아갈 때 뒤로 가기
  const fromNote = useSearchParams().get('from') === 'note';
  return <ReviewSession key={sourceId} mode={{ kind: 'practice', by: 'source', id: sourceId }} fromNote={fromNote} />;
}

export default function NotePracticePage() {
  return (
    <Suspense fallback={null}>
      <Practice />
    </Suspense>
  );
}
