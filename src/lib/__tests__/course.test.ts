import { describe, expect, it } from 'vitest';
import { zCourseAi } from '@/lib/ai/schemas';
import {
  COURSE_LIMITS,
  courseNodes,
  courseSections,
  courseStats,
  finalChecks,
  lessonKey,
  pickChecks,
  readCoursePlan,
  readProgress,
  recapChecks,
  sectionOfUnit,
  settleCourse,
  starsFor,
} from '@/lib/course';

const aiRaw = {
  title: '광합성 학습 길',
  intro: '잎이 양분을 만드는 과정을 설명할 수 있어요.',
  units: [
    {
      title: '기본 개념',
      summary: '뜻을 배웠어요',
      lessons: [
        {
          title: '광합성의 뜻',
          goal: '광합성을 설명할 수 있어요',
          key_point_ids: ['k1', 'k9'],
          cards: [
            { kind: 'concept', heading: '뜻', text: '잎이 빛으로 양분을 만들어요.', tip: '잎 = 공장' },
            { kind: 'EXAMPLE', heading: '', text: '   ', tip: '' },
            { kind: 'weird', heading: '예', text: '나무도 광합성을 해요.', tip: '' },
          ],
          checks: [
            {
              type: 'mcq',
              prompt: '광합성이 일어나는 곳은?',
              choices: ['잎', '뿌리', '줄기', '꽃'],
              answer: '잎',
              accepted: [],
              explanation: '잎의 엽록체에서요.',
            },
            { type: 'ox', prompt: '광합성은 밤에 잘 된다.', choices: [], answer: 'X', accepted: [], explanation: '빛이 필요해요.' },
            { type: 'cloze', prompt: '잎의 작은 구멍은 ____이다.', choices: [], answer: '기공', accepted: ['stoma'], explanation: '' },
            { type: 'mcq', prompt: '답을 읽을 수 없는 문제', choices: ['가', '나', '다', '라'], answer: '마', accepted: [], explanation: '' },
          ],
        },
        { title: '빈 레슨', goal: '', key_point_ids: [], cards: [], checks: [] },
      ],
    },
    { title: '빈 단계', summary: '', lessons: [] },
    {
      title: '적용',
      summary: '',
      lessons: [{ title: '', goal: '', key_point_ids: ['k2'], cards: [{ kind: 'tip', heading: '팁', text: '밤에는 호흡만 해요.', tip: '' }], checks: [] }],
    },
  ],
};

describe('settleCourse', () => {
  it('빈 카드·레슨·단계는 빼고, 모르는 개념 번호는 빼고, 답을 읽을 수 없는 문제는 뺀다', () => {
    const plan = settleCourse(zCourseAi.parse(aiRaw), ['k1', 'k2']);
    expect(plan).not.toBeNull();
    expect(plan!.units.map((u) => u.title)).toEqual(['기본 개념', '적용']);
    const l = plan!.units[0].lessons;
    expect(l).toHaveLength(1);
    expect(l[0].key_point_ids).toEqual(['k1']);
    expect(l[0].cards.map((c) => c.kind)).toEqual(['concept', 'concept']);
    expect(l[0].checks).toHaveLength(3);
    expect(l[0].checks[0]).toMatchObject({ type: 'mcq', answer: 0, choices: ['잎', '뿌리', '줄기', '꽃'] });
    expect(l[0].checks[1]).toMatchObject({ type: 'ox', answer: false });
    expect(l[0].checks[2]).toMatchObject({ type: 'cloze', answer: '기공', accepted: ['stoma'] });
    // 이름이 비면 자리 이름
    expect(plan!.units[1].lessons[0].title).toBe('레슨 1');
  });

  it('레슨이 하나도 없으면 null', () => {
    expect(settleCourse(zCourseAi.parse({ title: 'x', intro: '', units: [] }), ['k1'])).toBeNull();
    expect(
      settleCourse(
        zCourseAi.parse({
          title: 'x',
          intro: '',
          units: [{ title: 'u', summary: '', lessons: [{ title: 'l', goal: '', key_point_ids: [], cards: [], checks: [] }] }],
        }),
        [],
      ),
    ).toBeNull();
  });

  it('수를 줄인다 (단계·레슨·카드·문제)', () => {
    const lesson = {
      title: 'l',
      goal: '',
      key_point_ids: [],
      cards: Array.from({ length: 20 }, (_, i) => ({ kind: 'concept', heading: '', text: `카드 ${i}`, tip: '' })),
      checks: Array.from({ length: 20 }, (_, i) => ({ type: 'ox', prompt: `문제 ${i}`, choices: [], answer: 'O', accepted: [], explanation: '' })),
    };
    const unit = { title: 'u', summary: '', lessons: Array.from({ length: 10 }, () => lesson) };
    const plan = settleCourse(zCourseAi.parse({ title: 't', intro: '', units: Array.from({ length: 10 }, () => unit) }), []);
    expect(plan!.units).toHaveLength(COURSE_LIMITS.units);
    expect(plan!.units[0].lessons).toHaveLength(COURSE_LIMITS.lessons);
    expect(plan!.units[0].lessons[0].cards).toHaveLength(COURSE_LIMITS.cards);
    expect(plan!.units[0].lessons[0].checks).toHaveLength(COURSE_LIMITS.checks);
    // 저장된 모양으로 다시 읽힌다
    expect(readCoursePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });
});

describe('길과 진도', () => {
  const plan = settleCourse(zCourseAi.parse(aiRaw), ['k1', 'k2'])!;

  it('끝낸 칸 다음 하나만 지금 할 것, 그 뒤는 잠김. 단계마다 복습, 끝에 총정리', () => {
    const empty = readProgress(null);
    const nodes = courseNodes(plan, empty);
    expect(nodes.map((n) => n.kind)).toEqual(['lesson', 'recap', 'lesson', 'recap', 'final']);
    expect(nodes.map((n) => n.state)).toEqual(['current', 'locked', 'locked', 'locked', 'locked']);
    const p = readProgress({ lessons: { [lessonKey(0, 0)]: { stars: 2, at: 'x' } } });
    const n2 = courseNodes(plan, p);
    expect(n2.map((n) => n.state)).toEqual(['done', 'current', 'locked', 'locked', 'locked']);
    expect(n2[0].stars).toBe(2);
    expect(courseStats(plan, p)).toEqual({ total: 5, done: 1, lessons: 2, checks: 3 });
  });

  it('단계가 하나면 총정리는 없다', () => {
    const one = { ...plan, units: [plan.units[0]] };
    expect(courseNodes(one, readProgress({})).map((n) => n.kind)).toEqual(['lesson', 'recap']);
  });

  it('깨진 진도는 비어 있는 것으로 읽는다', () => {
    expect(readProgress('x')).toEqual({ lessons: {}, recaps: {} });
    expect(readProgress({ lessons: { a: { stars: 9, at: 1 } } }).lessons.a).toEqual({ stars: 1, at: '' });
  });

  it('별: 다 맞으면 3, 70% 이상 2, 아니면 1, 문제가 없으면 3', () => {
    expect(starsFor(3, 3)).toBe(3);
    expect(starsFor(2, 3)).toBe(1);
    expect(starsFor(3, 4)).toBe(2);
    expect(starsFor(0, 2)).toBe(1);
    expect(starsFor(0, 0)).toBe(3);
  });

  it('복습·총정리 문제는 레슨들에서 고루 뽑고, 같은 seed 면 같다', () => {
    const lessons = [
      {
        title: 'a',
        goal: '',
        key_point_ids: [],
        cards: [],
        checks: ['a1', 'a2', 'a3'].map((p) => ({ type: 'ox' as const, prompt: p, choices: null, answer: true, accepted: [], explanation: '' })),
      },
      {
        title: 'b',
        goal: '',
        key_point_ids: [],
        cards: [],
        checks: ['b1'].map((p) => ({ type: 'ox' as const, prompt: p, choices: null, answer: true, accepted: [], explanation: '' })),
      },
    ];
    const picked = pickChecks(lessons, 3, 'seed');
    expect(picked).toHaveLength(3);
    expect(picked.filter((c) => c.prompt.startsWith('b'))).toHaveLength(1);
    expect(pickChecks(lessons, 3, 'seed')).toEqual(picked);
    expect(pickChecks(lessons, 10, 'seed')).toHaveLength(4);
    expect(recapChecks(plan, 0, 's')).toHaveLength(3);
    expect(recapChecks(plan, 5, 's')).toEqual([]);
    expect(finalChecks(plan, 's')).toHaveLength(3);
  });
});

describe('긴 길은 섹션으로', () => {
  // 단계 n개, 단계마다 레슨 per개인 길
  const planOf = (n: number, per = 3) => ({
    title: '길',
    intro: '',
    units: Array.from({ length: n }, (_, ui) => ({
      title: `단계 ${ui + 1}`,
      summary: '',
      lessons: Array.from({ length: per }, (_, li) => ({
        title: `레슨 ${ui + 1}-${li + 1}`,
        goal: '',
        key_point_ids: [],
        cards: [{ kind: 'concept' as const, heading: '', text: '글', tip: '' }],
        checks: [],
      })),
    })),
  });

  it('단계가 적고 칸도 많지 않으면 나누지 않는다', () => {
    const p = planOf(3);
    expect(courseSections(p, courseNodes(p, readProgress({})))).toBeNull();
    const one = planOf(1, 4);
    expect(courseSections(one, courseNodes(one, readProgress({})))).toBeNull();
  });

  it('4단계부터 고르게 나누고 단계 번호는 이어지며, 총정리는 마지막 섹션에', () => {
    const sizes = (n: number) => {
      const p = planOf(n);
      return courseSections(p, courseNodes(p, readProgress({})))!.map((x) => x.units.length);
    };
    expect(sizes(4)).toEqual([2, 2]);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(7)).toEqual([3, 2, 2]);
    expect(sizes(8)).toEqual([3, 3, 2]);
    const p = planOf(5);
    const nodes = courseNodes(p, readProgress({}));
    const secs = courseSections(p, nodes)!;
    expect(secs.map((x) => x.units)).toEqual([
      [0, 1, 2],
      [3, 4],
    ]);
    // 모든 칸이 꼭 한 섹션에
    expect(secs.flatMap((x) => x.nodes.map((n) => n.id))).toEqual(nodes.map((n) => n.id));
    expect(secs[1].nodes.at(-1)?.kind).toBe('final');
    expect(sectionOfUnit(secs, 3)).toBe(1);
    expect(sectionOfUnit(null, 3)).toBeNull();
  });

  it('단계는 적어도 레슨이 많으면 나눈다 (단계보다 잘게는 나누지 않는다)', () => {
    const p = planOf(3, 6);
    const secs = courseSections(p, courseNodes(p, readProgress({})))!;
    expect(secs.map((x) => x.units)).toEqual([[0, 1], [2]]);
    const two = planOf(2, 20);
    expect(courseSections(two, courseNodes(two, readProgress({})))!.map((x) => x.units)).toEqual([[0], [1]]);
  });

  it('섹션의 상태: 모두 끝냄·지금 할 칸이 있는 섹션·아직', () => {
    const p = planOf(4, 2);
    // 1단계 레슨 둘과 복습을 끝냈다: 지금 할 칸은 2단계 첫 레슨 (섹션 1)
    const progress = readProgress({ lessons: { [lessonKey(0, 0)]: { stars: 3 }, [lessonKey(0, 1)]: { stars: 2 } }, recaps: { '0': { stars: 3 } } });
    let secs = courseSections(p, courseNodes(p, progress))!;
    expect(secs.map((x) => `${x.state} ${x.done}/${x.total}`)).toEqual(['current 3/6', 'later 0/7']);
    // 섹션 1을 다 끝내면 섹션 2가 지금 섹션
    const all = readProgress({
      lessons: Object.fromEntries([0, 1].flatMap((u) => [0, 1].map((l) => [lessonKey(u, l), { stars: 3 }]))),
      recaps: { '0': { stars: 3 }, '1': { stars: 3 } },
    });
    secs = courseSections(p, courseNodes(p, all))!;
    expect(secs.map((x) => x.state)).toEqual(['done', 'current']);
  });
});
