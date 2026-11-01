'use client';
// 레슨의 소리·진동 (듀오링고처럼 맞으면 짧은 '띵', 틀리면 낮은 소리, 연속 정답·끝내기는 조금 더 길게).
// 처음에는 꺼 둔다 (독서실·도서관에서 갑자기 소리가 나지 않게): 레슨 위 띠의 스피커 단추로 켜고, 이 기기에만 기억한다.
// 소리는 파일 없이 Web Audio 로 만든다 (짧은 사인·삼각파, 0.3초 안). 진동은 틀렸을 때만 (지원하는 폰).
import { useCallback, useEffect, useRef, useState } from 'react';

const SOUND_KEY = 'kok.lesson.sound';

type Note = [freq: number, at: number, dur: number];

const TUNES: Record<'ok' | 'bad' | 'combo' | 'done', { notes: Note[]; type: OscillatorType; gain: number }> = {
  ok: { notes: [[880, 0, 0.09], [1318.5, 0.075, 0.16]], type: 'sine', gain: 0.07 },
  bad: { notes: [[220, 0, 0.16], [174.6, 0.11, 0.22]], type: 'triangle', gain: 0.08 },
  combo: { notes: [[659.3, 0, 0.08], [880, 0.07, 0.08], [1174.7, 0.14, 0.2]], type: 'sine', gain: 0.07 },
  done: { notes: [[523.3, 0, 0.12], [659.3, 0.1, 0.12], [784, 0.2, 0.12], [1046.5, 0.3, 0.32]], type: 'sine', gain: 0.07 },
};

function readOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

export function useLessonSound() {
  const [on, setOn] = useState(readOn);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(
    () => () => {
      void ctx.current?.close().catch(() => {});
      ctx.current = null;
    },
    [],
  );

  const play = useCallback(
    (name: keyof typeof TUNES, force = false) => {
      if (!on && !force) return;
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx.current ??= new Ctor();
        const ac = ctx.current;
        if (ac.state === 'suspended') void ac.resume();
        const tune = TUNES[name];
        const t0 = ac.currentTime + 0.01;
        for (const [freq, at, dur] of tune.notes) {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = tune.type;
          osc.frequency.setValueAtTime(freq, t0 + at);
          gain.gain.setValueAtTime(0.0001, t0 + at);
          gain.gain.exponentialRampToValueAtTime(tune.gain, t0 + at + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
          osc.connect(gain).connect(ac.destination);
          osc.start(t0 + at);
          osc.stop(t0 + at + dur + 0.03);
        }
      } catch {
        /* 소리를 못 내는 브라우저: 조용히 */
      }
    },
    [on],
  );

  const buzz = useCallback(
    (ms: number) => {
      if (!on) return;
      try {
        navigator.vibrate?.(ms);
      } catch {
        /* 진동 없음 */
      }
    },
    [on],
  );

  const toggle = useCallback(() => {
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(SOUND_KEY, next ? '1' : '0');
      } catch {
        /* 저장소를 못 쓰는 환경: 이번 레슨에만 */
      }
      return next;
    });
  }, []);

  return {
    on,
    toggle,
    /** 켤 때 들려주는 소리 (켜졌다는 것을 알게) */
    preview: () => play('ok', true),
    ok: () => play('ok'),
    bad: () => {
      play('bad');
      buzz(40);
    },
    combo: () => play('combo'),
    done: () => play('done'),
  };
}
