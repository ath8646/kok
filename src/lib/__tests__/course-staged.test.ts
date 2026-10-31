import { describe, expect, it } from 'vitest';
import {
  assembleCourse,
  courseCost,
  courseOut,
  courseStaged,
  courseUnitOut,
  fallbackLessons,
  fallbackOutline,
  noteForStage,
  settleCourse,
  settleOutline,
  COURSE_LIMITS,
} from '@/lib/course';
import { zNote, zCourseOutline, zCourseUnit, courseOutlineJsonSchema, courseUnitJsonSchema } from '@/lib/ai/schemas';
import { schemaProps, SCHEMA_PROPS_MAX } from '@/lib/ai/schema-registry';
import { courseOutlinePrompt, coursePrompt, courseUnitPrompt } from '@/lib/ai/prompts';

const big = zNote.parse({
  title: '세포와 생명',
  unit: '2단원',
  summary: '요약',
  key_points: Array.from({ length: 24 }, (_, i) => ({
    id: `k${i + 1}`,
    title: `개념 ${i + 1}`,
    explanation: `개념 ${i + 1}의 설명`,
    why: '시험에 나와요',
    importance: 'medium',
    pages: [],
  })),
  terms: [{ term: '세포', meaning: '생물의 단위' }],
  formulas: [],
  pitfalls: [{ text: '개념 3 함정', key_point_id: 'k3' }],
  examples: [{ text: '개념 3 예시', key_point_id: 'k3' }],
  checks: [],
  changes: [],
});

describe('큰 노트의 학습 길: 나눠 만들기', () => {
  it('개념이 많은 노트(레슨 9개부터)만 나눠 만들고, 작은 노트는 예전처럼 한 번에', () => {
    expect(courseStaged(5)).toBe(false);
    expect(courseStaged(8)).toBe(false);
    expect(courseStaged(9)).toBe(true);
    expect(courseStaged(24)).toBe(true);
  });

  it('답 모양은 문법 한도 안이고, 한 단계의 답은 그 단계의 레슨 수만큼 (예전 한 번에: 24개념이면 2만 토큰 가까이)', () => {
    expect(schemaProps(courseOutlineJsonSchema)).toBeLessThanOrEqual(SCHEMA_PROPS_MAX);
    expect(schemaProps(courseUnitJsonSchema)).toBeLessThanOrEqual(SCHEMA_PROPS_MAX);
    expect(courseUnitOut(COURSE_LIMITS.lessons)).toBeLessThan(courseOut(24).max / 2);
  });

  it('예상 에너지: 나눠 만들어도 개념이 많을수록 늘고, 노트가 길수록 는다 (화면과 서버가 같은 계산)', () => {
    const a = courseCost(12, 8000);
    const b = courseCost(24, 8000);
    const c = courseCost(24, 30000);
    expect(b.outTokens).toBeGreaterThan(a.outTokens);
    expect(c.inputTokens).toBeGreaterThan(b.inputTokens);
    expect(courseCost(5, 4000).outTokens).toBe(courseOut(5).estimate);
  });

  it('지시: 뼈대는 카드·문제를 쓰지 않고, 한 단계는 그 단계의 레슨 수만큼 차례대로', () => {
    const plan = { units: { min: 5, max: 6 }, lessons: { min: 15, max: 24 } };
    const outline = courseOutlinePrompt('high', plan);
    expect(outline).toContain('write only the plan of the path');
    expect(outline).not.toContain('- cards:');
    expect(outline).toContain('15 to 24 lessons in total');
    const unit = courseUnitPrompt('high', { index: 1, title: '세포 소기관', lessons: 4 });
    expect(unit).toContain('stage 2, "세포 소기관": exactly 4 items in "lessons"');
    expect(unit).toContain('- cards:');
    // 한 번에 만드는 지시는 예전과 같은 규칙
    expect(coursePrompt('high', plan)).toContain('- cards:');
    expect(coursePrompt('high', plan)).toContain('- units: 5 to 6 stages');
  });

  it('뼈대: 노트에 없는 개념 번호·빈 레슨은 빼고 수를 줄인다', () => {
    const o = settleOutline(
      zCourseOutline.parse({
        title: '길',
        intro: '',
        units: [
          {
            title: 'A',
            summary: '',
            lessons: [
              { title: '하나', goal: '', key_point_ids: ['k1', 'k99', 'k1'] },
              { title: '', goal: '', key_point_ids: [] },
            ],
          },
          { title: 'B', summary: '', lessons: [] },
        ],
      }),
      big.key_points.map((k) => k.id),
    );
    expect(o?.units).toHaveLength(1);
    expect(o?.units[0].lessons).toEqual([{ title: '하나', goal: '', key_point_ids: ['k1'] }]);
    expect(settleOutline(zCourseOutline.parse({ units: [] }), [])).toBeNull();
  });

  it('AI 가 뼈대를 못 만들면 개념 차례대로 레슨·단계를 만든다 (모든 개념이 들어간다)', () => {
    const o = settleOutline(
      fallbackOutline(big),
      big.key_points.map((k) => k.id),
    )!;
    expect(o.units.length).toBeGreaterThanOrEqual(2);
    expect(o.units.length).toBeLessThanOrEqual(COURSE_LIMITS.units);
    expect(o.units.every((u) => u.lessons.length <= COURSE_LIMITS.lessons)).toBe(true);
    expect(o.units.flatMap((u) => u.lessons.flatMap((l) => l.key_point_ids))).toEqual(big.key_points.map((k) => k.id));
  });

  it('한 단계를 끝내 못 받으면 노트의 설명·예시·함정을 카드로, 노트의 문제를 확인 문제로', () => {
    const lessons = fallbackLessons([{ title: '개념 3', goal: '개념 3을 설명할 수 있어요', key_point_ids: ['k3'] }], big, [
      { type: 'mcq', prompt: '개념 3은?', choices: ['가', '나', '다', '라'], answer: 1, key_point_id: 'k3', explanation: '나예요' },
      { type: 'ox', prompt: '개념 4는 O?', choices: null, answer: true, key_point_id: 'k4' },
    ]);
    expect(lessons[0].cards.map((c) => c.kind)).toEqual(['concept', 'example', 'tip']);
    expect(lessons[0].checks).toEqual([
      { type: 'mcq', prompt: '개념 3은?', choices: ['가', '나', '다', '라'], answer: '나', accepted: [], explanation: '나예요' },
    ]);
  });

  it('뼈대 + 단계마다 받은 레슨을 합치면 한 번에 만든 것과 같은 모양 (settleCourse 가 읽는다)', () => {
    const outline = settleOutline(
      fallbackOutline(big),
      big.key_points.map((k) => k.id),
    )!;
    const units = outline.units.map(
      (u) =>
        zCourseUnit.parse({
          lessons: u.lessons.map(() => ({
            cards: [{ kind: 'concept', heading: '카드', text: '설명이에요', tip: '' }],
            checks: [{ type: 'ox', prompt: '맞나요?', choices: [], answer: 'O', accepted: [], explanation: '' }],
          })),
        }).lessons,
    );
    const plan = settleCourse(
      assembleCourse(outline, units),
      big.key_points.map((k) => k.id),
    );
    expect(plan?.units).toHaveLength(outline.units.length);
    expect(plan?.units[0].lessons[0].checks[0]).toMatchObject({ type: 'ox', answer: true });
  });

  it('한 단계에는 그 단계의 개념과 그 개념의 함정·예시만 보낸다', () => {
    const n = noteForStage(big, ['k3', 'k4']);
    expect(n.key_points.map((k) => k.id)).toEqual(['k3', 'k4']);
    expect(n.pitfalls).toHaveLength(1);
    expect(n.terms).toHaveLength(1);
    expect(noteForStage(big, ['k99']).key_points).toHaveLength(24);
  });
});
