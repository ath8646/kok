'use client';
// 폰 키보드가 화면 아래를 가린 높이 (visualViewport). 화면 아래에 붙은 띠(꾸미기 줄·복습의 확인 띠)를 그만큼 올린다.
// iOS 는 키보드가 열려도 fixed 칸이 키보드 뒤에 남아서 직접 올려야 한다 (안드로이드처럼 화면이 줄면 0)
import { useEffect, useState } from 'react';

/** 가린 높이 (없거나 60px 아래면 0) */
export function useKeyboardCover(): number {
  const [cover, setCover] = useState(0);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => {
      const c = Math.round(window.innerHeight - (v.height + v.offsetTop));
      setCover(c > 60 ? c : 0);
    };
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, []);
  return cover;
}
