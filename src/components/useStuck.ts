'use client';
import { useEffect, useState } from 'react';

/**
 * sticky 띠가 화면 위에 '붙었는지'. 붙기 전에는 바탕을 칠하지 않아서 테마 배경(그림·무늬)이 그대로 보이고,
 * 붙은 뒤에만 아래로 지나가는 글을 가리게 바탕을 칠한다 (globals.css 의 .is-stuck).
 * 띠가 나중에 그려질 수도 있어서 요소는 ref 콜백으로 받은 값(useState)을 넘긴다.
 */
export function useStuck(el: HTMLElement | null): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      setStuck(window.scrollY > 0 && el.getBoundingClientRect().top <= top + 0.5);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [el]);
  return stuck;
}
