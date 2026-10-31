'use client';
// 꾹 누르기 (손가락·펜·마우스 모두 0.45초). 누른 채 움직이면(스크롤·끌기) 취소한다.
// 꾹 누른 다음에 오는 click 은 막는다 (링크로 넘어가지 않게). 손가락으로 꾹 누를 때 뜨는 기본 메뉴(링크 미리보기·복사)도 막는다.
// 키보드는 메뉴 키·Shift+F10 이 같은 일을 한다 (컴퓨터에서 오른쪽 단추 메뉴를 여는 키).
// 쓰는 곳: 자료함·홈 최근 노트·오답노트·PDF 요약 목록 카드, 과목 서랍 (꾹 누르면 여러 개 고르기)
import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

/** 꾹 눌렀다고 보는 시간 (삼성 노트처럼 0.5초쯤) */
export const LONG_PRESS_MS = 450;
/** 이만큼 움직이면 누르기가 아니라 스크롤이다 */
const MOVE_TOLERANCE = 8;

export function useLongPress(onLong: () => void, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** 방금 꾹 누르기로 끝났는지 (뒤따르는 click 을 한 번 막는다) */
  const fired = useRef(false);
  /** 손가락·펜으로 누르는 중인지 (기본 메뉴는 이때만 막는다: 마우스 오른쪽 단추 메뉴는 그대로) */
  const touchy = useRef(false);
  /** 방금 메뉴 키로 열었는지 (뒤따르는 브라우저 기본 메뉴를 막는다) */
  const keyMenu = useRef(0);
  const latest = useRef(onLong);
  useEffect(() => {
    latest.current = onLong;
  }, [onLong]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      fired.current = false;
      touchy.current = e.pointerType !== 'mouse';
      start.current = { x: e.clientX, y: e.clientY };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        start.current = null;
        fired.current = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          /* 진동이 없는 기기 */
        }
        latest.current();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: MouseEvent) => {
      if (enabled && (touchy.current || fired.current || Date.now() - keyMenu.current < 600)) e.preventDefault();
    },
    /** 키보드: 메뉴 키·Shift+F10 = 꾹 누르기 */
    onKeyDown: (e: KeyboardEvent) => {
      if (!enabled || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
      e.preventDefault();
      keyMenu.current = Date.now();
      latest.current();
    },
    /** 꾹 누른 뒤 손을 떼면 오는 click: 링크로 넘어가지 않게 막는다 */
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
