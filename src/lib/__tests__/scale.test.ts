import { describe, expect, it } from 'vitest';
import {
  KEY_POINTS_MAX,
  KEY_POINTS_PER_PART_MAX,
  appendKeyPointMax,
  coursePlanRange,
  keyPointRange,
  mergedKeyPointRange,
  noteOutTokens,
  aiWaitMs,
  NOTE_OUT_MAX,
  quizOutTokens,
} from '@/lib/ai/scale';
import { maxNodesFor, visualOutTokens } from '@/lib/mindmap-clean';
import { courseOut } from '@/lib/course';

describe('자료 양에 따라 만드는 양이 늘어난다', () => {
  it('한 조각의 개념 수: 한 쪽은 3~5개, 쪽이 늘수록 늘어 15쪽이면 13~16개', () => {
    expect(keyPointRange({ kind: 'pdf', pages: 1 })).toEqual({ min: 3, max: 5 });
    expect(keyPointRange({ kind: 'pdf', pages: 4 })).toEqual({ min: 5, max: 8 });
    expect(keyPointRange({ kind: 'pdf', pages: 15 })).toEqual({ min: 13, max: 16 });
    expect(keyPointRange({ kind: 'image', images: 1 })).toEqual({ min: 3, max: 5 });
    expect(keyPointRange({ kind: 'image', images: 6 })).toEqual({ min: 7, max: 9 });
    expect(keyPointRange({ kind: 'text', chars: 300 })).toEqual({ min: 3, max: 5 });
    expect(keyPointRange({ kind: 'text', chars: 6000 })).toEqual({ min: 5, max: 8 });
    expect(keyPointRange({ kind: 'text', chars: 40000 })).toEqual({ min: 13, max: 16 });
    // 늘 min < max, 조각 끝 안
    for (let w = 1; w <= 60; w++) {
      const r = keyPointRange({ kind: 'pdf', pages: w });
      expect(r.min).toBeLessThan(r.max);
      expect(r.max).toBeLessThanOrEqual(KEY_POINTS_PER_PART_MAX);
    }
  });

  it('조각을 합치면 개념 수를 더하고 노트 끝(24)에서 멈춘다', () => {
    const one = keyPointRange({ kind: 'pdf', pages: 15 });
    expect(mergedKeyPointRange([one])).toEqual({ min: 9, max: 16 });
    expect(mergedKeyPointRange([one, one, keyPointRange({ kind: 'pdf', pages: 10 })])).toEqual({ min: 20, max: KEY_POINTS_MAX });
    expect(mergedKeyPointRange([])).toEqual({ min: 3, max: 7 });
  });

  it('노트에 더할 때는 지금 개념을 모두 지키고 새 자료만큼 늘어난다', () => {
    expect(appendKeyPointMax(5, [keyPointRange({ kind: 'text', chars: 1000 })])).toBe(10);
    expect(appendKeyPointMax(22, [keyPointRange({ kind: 'pdf', pages: 15 })])).toBe(KEY_POINTS_MAX);
    // 이미 끝을 넘은 노트(예전 합치기)는 줄이지 않는다
    expect(appendKeyPointMax(30, [])).toBe(30);
  });

  it('답 길이·마인드맵·문제·레슨 수가 개념 수를 따라간다', () => {
    expect(noteOutTokens(7)).toBeLessThan(noteOutTokens(16));
    expect(noteOutTokens(24, 6)).toBeLessThanOrEqual(NOTE_OUT_MAX);
    // 개념 하나에 500토큰 넘게 (예전 400: 개념 24개 합치기가 12600토큰에서 잘렸다)
    expect(noteOutTokens(16) - noteOutTokens(15)).toBeGreaterThanOrEqual(500);
    // 기다리는 시간은 답 길이를 따라 60초 ~ 240초
    expect(aiWaitMs(2000)).toBe(60_000);
    expect(aiWaitMs(NOTE_OUT_MAX)).toBe(240_000);
    expect(aiWaitMs(9000)).toBeGreaterThan(aiWaitMs(4000));
    expect(quizOutTokens(5)).toBeLessThan(quizOutTokens(24));
    expect(maxNodesFor(3)).toBe(42);
    expect(maxNodesFor(3, 7)).toBe(42);
    expect(maxNodesFor(3, 24)).toBe(144);
    expect(maxNodesFor(4, 40)).toBe(150);
    expect(visualOutTokens(42)).toBeLessThan(visualOutTokens(147));
    expect(coursePlanRange(5)).toEqual({ units: { min: 2, max: 2 }, lessons: { min: 3, max: 5 } });
    expect(coursePlanRange(12)).toEqual({ units: { min: 3, max: 4 }, lessons: { min: 8, max: 12 } });
    expect(coursePlanRange(24)).toEqual({ units: { min: 5, max: 6 }, lessons: { min: 15, max: 24 } });
    expect(courseOut(5).max).toBeLessThan(courseOut(24).max);
    expect(courseOut(24).max).toBeLessThanOrEqual(24_000);
  });
});
