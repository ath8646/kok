'use client';
// 색 고르기: 브라우저의 색 창(<input type="color">) 대신 앱 디자인의 칸. 누른 자리 바로 아래에 펼쳐진다
// (테마 만들기 같은 전체 화면 창 위에 창을 하나 더 띄우지 않게, 바꾸는 동안 미리보기가 바로 따라오게).
// - 위: 채도·밝기 네모 (끌기, 화살표 ←→ 채도·↑↓ 밝기, Shift 는 10씩) / 가운데: 색상 띠 (끌기, ←→) / 아래: #코드 칸, 처음 색, 완료
// - 바꿀 때마다 onChange. 끄는 동안에는 바깥에서 고친 값(글자가 잘 보이게 맞춘 색)으로 손잡이를 옮기지 않고, 놓은 뒤에 맞춘 자리로 간다
// - Esc 는 이 칸만 닫는다 (둘러싼 창은 defaultPrevented 인 Esc 를 받지 않는다)
import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fromHsv, normalizeHex, toHsv } from '@/lib/themes/colors';
import { Button, cx, inputClass } from './ui';

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const HUE_TRACK = 'linear-gradient(to right, #f00 0%, #ff0 16.7%, #0f0 33.3%, #0ff 50%, #00f 66.7%, #f0f 83.3%, #f00 100%)';

export function ColorPicker({
  label,
  value,
  onChange,
  onClose,
  className,
}: {
  /** 무슨 색인지 ('포인트 색'): 화면 읽기와 칸 이름 */
  label: string;
  /** '#rrggbb' */
  value: string;
  onChange: (hex: string) => void;
  /** 완료·Esc */
  onClose: () => void;
  className?: string;
}) {
  const hexId = useId();
  const [hsv, setHsv] = useState(() => toHsv(value));
  const [hexText, setHexText] = useState(value);
  // 열 때의 색 (처음 색으로 되돌리기)
  const [start] = useState(value);
  // 마지막으로 보낸 색과 마지막으로 본 바깥 값: 바깥에서 다르게 바뀌면 (되돌리기·명암비 맞춤) 손잡이를 그 색으로
  const [sent, setSent] = useState(value);
  const [seen, setSeen] = useState(value);
  const [drag, setDrag] = useState(false);
  if (value !== seen && !drag) {
    setSeen(value);
    if (value !== sent) {
      // 회색(채도 0)은 색상이 없다: 띠의 자리는 그대로
      const [nh, ns, nv] = toHsv(value);
      setHsv([ns === 0 ? hsv[0] : nh, ns, nv]);
      setHexText(value);
      setSent(value);
    }
  }
  const [h, s, v] = hsv;
  const current = fromHsv(h, s, v);

  const emit = (nh: number, ns: number, nv: number) => {
    const hex = fromHsv(nh, ns, nv);
    setHsv([nh, ns, nv]);
    setHexText(hex);
    setSent(hex);
    if (hex !== sent) onChange(hex);
  };

  // 누른 칸(currentTarget)의 자리로 계산한다
  const pickArea = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    emit(h, clamp((e.clientX - r.left) / r.width), 1 - clamp((e.clientY - r.top) / r.height));
  };
  const pickHue = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    emit(clamp((e.clientX - r.left) / r.width) * 359.9, s, v);
  };
  const dragProps = (pick: (e: PointerEvent<HTMLDivElement>) => void) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus();
      setDrag(true);
      pick(e);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e);
    },
    onPointerUp: () => setDrag(false),
    onPointerCancel: () => setDrag(false),
  });

  const onAreaKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const k = e.key;
    if (k === 'ArrowLeft') emit(h, clamp(s - step), v);
    else if (k === 'ArrowRight') emit(h, clamp(s + step), v);
    else if (k === 'ArrowUp') emit(h, s, clamp(v + step));
    else if (k === 'ArrowDown') emit(h, s, clamp(v - step));
    else return;
    e.preventDefault();
  };
  const onHueKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowDown') emit(Math.max(0, h - step), s, v);
    else if (k === 'ArrowRight' || k === 'ArrowUp') emit(Math.min(359.9, h + step), s, v);
    else if (k === 'Home') emit(0, s, v);
    else if (k === 'End') emit(359.9, s, v);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={cx('kok-unfold grid gap-3 rounded-2xl bg-surface-2 p-3', className)}
      role="group"
      aria-label={`${label} 고르기`}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        onClose();
      }}
    >
      {/* 채도(가로)·밝기(세로) */}
      <div
        tabIndex={0}
        role="slider"
        aria-label={`${label}의 채도와 밝기`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s * 100)}
        aria-valuetext={`채도 ${Math.round(s * 100)}%, 밝기 ${Math.round(v * 100)}%`}
        onKeyDown={onAreaKey}
        className="relative h-40 cursor-crosshair touch-none select-none rounded-xl outline-none ring-accent ring-offset-2 ring-offset-surface-2 focus-visible:ring-2"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${h} 100% 50%)` }}
        {...dragProps(pickArea)}
      >
        <span
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.35)]"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: current }}
          aria-hidden="true"
        />
      </div>
      {/* 색상 */}
      <div
        tabIndex={0}
        role="slider"
        aria-label={`${label}의 색상`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(h)}
        aria-valuetext={`${Math.round(h)}도`}
        onKeyDown={onHueKey}
        className="relative mx-3 h-4 cursor-pointer touch-none select-none rounded-full outline-none ring-accent ring-offset-2 ring-offset-surface-2 focus-visible:ring-2"
        style={{ background: HUE_TRACK }}
        {...dragProps(pickHue)}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.35)]"
          style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h} 100% 50%)` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* 처음 색 | 지금 색 */}
        <span className="flex h-10 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-line" aria-hidden="true">
          <span className="h-full flex-1" style={{ background: start }} />
          <span className="h-full flex-1" style={{ background: current }} />
        </span>
        <label htmlFor={hexId} className="sr-only">
          {label} 코드
        </label>
        <input
          id={hexId}
          className={cx(inputClass, 'w-[7.5rem] py-2 font-mono text-sm uppercase')}
          value={hexText}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            const t = e.target.value;
            setHexText(t);
            const n = /^#?[0-9a-f]{6}$/i.test(t.trim()) ? normalizeHex(t) : null;
            if (n) {
              const [nh, ns, nv] = toHsv(n);
              // 회색(채도 0)은 색상이 없다: 띠의 자리는 그대로
              emit(ns === 0 ? h : nh, ns, nv);
            }
          }}
          onBlur={() => setHexText(current)}
        />
        <span className="flex-1" />
        {current !== start ? (
          <button
            type="button"
            className="press rounded-full px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-3 hover:text-ink"
            onClick={() => {
              const [nh, ns, nv] = toHsv(start);
              emit(ns === 0 ? h : nh, ns, nv);
            }}
          >
            처음 색
          </button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={onClose}>
          완료
        </Button>
      </div>
    </div>
  );
}
