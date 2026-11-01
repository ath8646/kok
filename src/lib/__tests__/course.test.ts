import { describe, expect, it } from 'vitest';
import { zCourseAi } from '@/lib/ai/schemas';
import { clozeBlank } from '@/lib/cloze';
import {
  COURSE_LIMITS,
  COURSE_PLAN_BYTES,
  MISTAKES_MAX,
  applyResult,
  checkAnswerText,
  checkKey,
  choiceOrder,
  courseNodes,
  courseSections,
  courseStats,
  finalChecks,
  fitPlanSize,
  lessonKey,
  lessonMinutes,
  lessonSteps,
  matchColumns,
  mistakeChecks,
  mistakeCount,
  orderCorrect,
  pickChecks,
  readCoursePlan,
  readProgress,
  recapChecks,
  sectionOfUnit,
  settleCheck,
  settleCourse,
  shuffled,
  skippedBefore,
  starsFor,
  termMatch,
  unitTerms,
  type CoursePlan,
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
    const pool = (lesson: number, prompts: string[]) =>
      prompts.map((p, i) => ({
        key: checkKey(0, lesson, i),
        unit: 0,
        lesson,
        check: { type: 'ox' as const, prompt: p, choices: null, answer: true, accepted: [], explanation: '' },
      }));
    const pools = [pool(0, ['a1', 'a2', 'a3']), pool(1, ['b1'])];
    const picked = pickChecks(pools, 3, 'seed');
    expect(picked).toHaveLength(3);
    expect(picked.filter((c) => c.check.prompt.startsWith('b'))).toHaveLength(1);
    expect(pickChecks(pools, 3, 'seed')).toEqual(picked);
    expect(pickChecks(pools, 10, 'seed')).toHaveLength(4);
    // 틀렸던 문제를 먼저 넣고 나머지를 고루 (같은 문제를 두 번 넣지 않는다)
    const first = pickChecks(pools, 3, 'seed', [pools[0][2], pools[0][2]]);
    expect(first[0].key).toBe('0-0-2');
    expect(new Set(first.map((c) => c.key)).size).toBe(3);
    expect(recapChecks(plan, 0, 's')).toHaveLength(3);
    expect(recapChecks(plan, 0, 's')[0]).toMatchObject({ unit: 0, lesson: 0 });
    expect(recapChecks(plan, 5, 's')).toEqual([]);
    expect(finalChecks(plan, 's')).toHaveLength(3);
  });

  it('틀린 문제: 처음에 틀리면 모으고, 처음에 맞히면 빼고, 복습·총정리에 먼저 나온다', () => {
    const at1 = '2026-11-01T10:00:00.000Z';
    const at2 = '2026-11-01T11:00:00.000Z';
    let p = applyResult(
      readProgress({}),
      { kind: 'lesson', unit: 0, lesson: 0 },
      { stars: 2, correct: 2, total: 3, rightFirst: ['0-0-0', '0-0-2'], wrongFirst: ['0-0-1'] },
      at1,
    );
    expect(p.lessons['0-0']).toEqual({ stars: 2, at: at1 });
    expect(p.mistakes).toEqual({ '0-0-1': { at: at1, n: 1 } });
    expect(mistakeCount(plan, p)).toBe(1);
    // 단계 복습은 그 단계에서 틀린 문제부터
    expect(recapChecks(plan, 0, 's', p.mistakes)[0].key).toBe('0-0-1');
    expect(finalChecks(plan, 's', p.mistakes)[0].key).toBe('0-0-1');
    // 다시 틀리면 수가 늘고, 별은 더 높은 것만 남는다
    p = applyResult(p, { kind: 'lesson', unit: 0, lesson: 0 }, { stars: 1, correct: 0, total: 3, rightFirst: [], wrongFirst: ['0-0-1', '0-0-0'] }, at2);
    expect(p.lessons['0-0'].stars).toBe(2);
    expect(p.mistakes?.['0-0-1']).toEqual({ at: at2, n: 2 });
    expect(mistakeChecks(plan, p).map((k) => k.key)).toEqual(['0-0-0', '0-0-1']);
    // '틀린 문제 복습'에서 맞히면 빠진다 (별은 없다), 모두 빠지면 칸도 없다
    p = applyResult(p, { kind: 'mistakes' }, { stars: 3, correct: 2, total: 2, rightFirst: ['0-0-0', '0-0-1'], wrongFirst: [] }, at2);
    expect(p.mistakes).toBeUndefined();
    expect(p.lessons['0-0'].stars).toBe(2);
    expect(readProgress(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('틀린 문제는 최근 것만 남기고, 지금 길에 없는 번호는 세지 않는다', () => {
    const many = Object.fromEntries(Array.from({ length: MISTAKES_MAX + 5 }, (_, i) => [`9-9-${i}`, { at: `2026-11-01T00:00:${String(i).padStart(2, '0')}.000Z`, n: 1 }]));
    const p = applyResult(readProgress({ mistakes: many }), { kind: 'final' }, { stars: 3, correct: 1, total: 1, rightFirst: [], wrongFirst: ['0-0-0'] }, '2026-11-02T00:00:00.000Z');
    expect(Object.keys(p.mistakes ?? {})).toHaveLength(MISTAKES_MAX);
    expect(p.mistakes?.['0-0-0']).toBeDefined();
    expect(p.mistakes?.['9-9-0']).toBeUndefined();
    expect(mistakeCount(plan, p)).toBe(1);
    expect(p.final).toEqual({ stars: 3, at: '2026-11-02T00:00:00.000Z' });
  });

  it('예전 진도(틀린 문제 없음)·깨진 칸은 그 칸만 비운다', () => {
    expect(readProgress({ lessons: { '0-0': { stars: 3, at: 'x' } }, final: 'broken', mistakes: 'x' })).toEqual({ lessons: { '0-0': { stars: 3, at: 'x' } }, recaps: {} });
    expect(readProgress({ lessons: {}, recaps: {}, mistakes: { '0-0-1': { at: 'a', n: 'two' } } }).mistakes).toEqual({ '0-0-1': { at: 'a', n: 1 } });
  });

  it('건너뛰는 칸 수: 앞에 끝내지 않은 칸', () => {
    const nodes = courseNodes(plan, readProgress({}));
    expect(skippedBefore(nodes, 'l-0-0')).toBe(0);
    expect(skippedBefore(nodes, 'l-1-0')).toBe(2);
    expect(skippedBefore(nodes, 'final')).toBe(4);
    expect(skippedBefore(nodes, 'nope')).toBe(0);
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

describe('듀오링고식 레슨: 새 문제 종류와 검사', () => {
  const lessonOf = (cards: unknown[], checks: unknown[]) =>
    zCourseAi.parse({ title: '길', intro: '', units: [{ title: '단계', summary: '', lessons: [{ title: '레슨', goal: '', key_point_ids: [], cards, checks }] }] });
  const card = (text: string, figure_id = '') => ({ kind: 'concept', heading: '', text, tip: '', figure_id });
  const settle = (cards: unknown[], checks: unknown[], extra = {}) => settleCourse(lessonOf(cards, checks), [], extra)!.units[0].lessons[0];

  it('문제의 자리(after)는 남은 카드 번호로 옮기고, 힌트는 남기고, 노트에 없는 그림 번호는 지운다', () => {
    const l = settle(
      [card('하나', 'f1'), card('   '), card('셋', 'f9')],
      [
        { type: 'ox', after: 0, prompt: '하나는 맞나요?', choices: [], answer: 'O', accepted: [], pairs: [], explanation: '', hint: '첫 카드를 떠올려 봐요' },
        { type: 'ox', after: 2, prompt: '셋은 맞나요?', choices: [], answer: 'X', accepted: [], pairs: [], explanation: '', hint: '' },
        { type: 'ox', after: 9, prompt: '끝은?', choices: [], answer: 'O', accepted: [], pairs: [], explanation: '', hint: '' },
      ],
      { figureIds: ['f1'] },
    );
    expect(l.cards.map((c) => [c.text, c.figure_id])).toEqual([
      ['하나', 'f1'],
      ['셋', undefined],
    ]);
    expect(l.checks.map((c) => c.after)).toEqual([0, 1, 1]);
    expect(l.checks[0].hint).toBe('첫 카드를 떠올려 봐요');
    expect(l.checks[1].hint).toBeUndefined();
  });

  it('짝 맞추기: 3~5쌍, 겹치거나 너무 긴 짝은 빼고, 3쌍이 안 되면 문제를 뺀다', () => {
    const pairs = [
      { left: '엽록체', right: '광합성이 일어나는 곳' },
      { left: '기공', right: '기체가 드나드는 구멍' },
      { left: '엽록체', right: '겹친 왼쪽' },
      { left: '엽록소', right: '빛을 흡수하는 색소' },
      { left: '너무 긴 왼쪽'.repeat(10), right: '빼요' },
    ];
    const l = settle(
      [card('카드')],
      [
        { type: 'match', after: 0, prompt: '', choices: [], answer: '', accepted: [], pairs, explanation: '', hint: '' },
        { type: 'match', after: 0, prompt: '짝', choices: [], answer: '', accepted: [], pairs: pairs.slice(0, 2), explanation: '', hint: '' },
      ],
    );
    expect(l.checks).toHaveLength(1);
    expect(l.checks[0]).toMatchObject({ type: 'match', prompt: '짝을 맞춰 보세요', answer: '', choices: null });
    expect(l.checks[0].pairs?.map((p) => p.left)).toEqual(['엽록체', '기공', '엽록소']);
    expect(checkAnswerText(l.checks[0])).toBe('엽록체 = 광합성이 일어나는 곳, 기공 = 기체가 드나드는 구멍, 엽록소 = 빛을 흡수하는 색소');
  });

  it('순서 맞추기: 번호를 떼고 3~6칸, 놓은 차례가 같으면 맞다', () => {
    const l = settle(
      [card('카드')],
      [
        { type: 'order', after: 0, prompt: '광합성 차례대로 놓아 보세요', choices: ['1. 빛을 받는다', '2. 물을 나눈다', '3. 포도당을 만든다'], answer: '', accepted: [], pairs: [], explanation: '', hint: '' },
        { type: 'order', after: 0, prompt: '두 칸뿐', choices: ['가', '나'], answer: '', accepted: [], pairs: [], explanation: '', hint: '' },
      ],
    );
    expect(l.checks).toHaveLength(1);
    expect(l.checks[0].choices).toEqual(['빛을 받는다', '물을 나눈다', '포도당을 만든다']);
    expect(orderCorrect(l.checks[0], ['빛을 받는다', '물을 나눈다', '포도당을 만든다'])).toBe(true);
    expect(orderCorrect(l.checks[0], ['빛을 받는다', '포도당을 만든다', '물을 나눈다'])).toBe(false);
    expect(orderCorrect(l.checks[0], ['빛을 받는다'])).toBe(false);
    expect(checkAnswerText(l.checks[0])).toBe('빛을 받는다 → 물을 나눈다 → 포도당을 만든다');
  });

  it('낱말 고르기 빈칸: 정답을 꼭 칩에 넣고, 같이 인정하는 답은 칩에서 빼고, 칩이 모자라면 적어서 답한다', () => {
    const l = settle(
      [card('카드')],
      [
        { type: 'cloze', after: 0, prompt: '잎의 작은 구멍은 ____이에요.', choices: ['엽록체', 'stoma', '엽록체', '세포벽'], answer: '기공', accepted: ['stoma'], pairs: [], explanation: '', hint: '' },
        { type: 'cloze', after: 0, prompt: '빛을 받는 색소는 ____예요.', choices: ['엽록소'], answer: '엽록소', accepted: [], pairs: [], explanation: '', hint: '' },
      ],
    );
    expect(l.checks[0].choices).toEqual(['기공', '엽록체', '세포벽']);
    expect(l.checks[1].choices).toBeNull();
  });

  it('답이 문제 글에 보이는 빈칸·단답, 다른 보기 자리를 가리키는 객관식은 뺀다. 객관식 보기 번호는 뗀다', () => {
    const l = settle(
      [card('카드')],
      [
        { type: 'cloze', after: 0, prompt: '광합성은 ____에서 일어나요. 엽록체가 중요해요.', choices: [], answer: '엽록체', accepted: [], pairs: [], explanation: '', hint: '' },
        { type: 'short', after: 0, prompt: '물이 끓는 온도는 몇 도예요? 100도 가까이…', choices: [], answer: '100', accepted: [], pairs: [], explanation: '', hint: '' },
        { type: 'mcq', after: 0, prompt: '옳은 것은?', choices: ['잎', '뿌리', '줄기', '위의 것 모두'], answer: '잎', accepted: [], pairs: [], explanation: '', hint: '' },
        { type: 'mcq', after: 0, prompt: '광합성이 일어나는 곳은?', choices: ['① 잎', '② 뿌리', '③ 줄기', '④ 꽃'], answer: '① 잎', accepted: [], pairs: [], explanation: '', hint: '' },
        { type: 'mcq', after: 0, prompt: '광합성이 일어나는 곳은?', choices: ['① 잎', '② 뿌리', '③ 줄기', '④ 꽃'], answer: '① 잎', accepted: [], pairs: [], explanation: '', hint: '' },
      ],
    );
    expect(l.checks.map((c) => c.type)).toEqual(['short', 'mcq']);
    expect(l.checks[1]).toMatchObject({ choices: ['잎', '뿌리', '줄기', '꽃'], answer: 0 });
    expect(settleCheck({ type: 'essay', prompt: '설명하세요', answer: 'x' })).toBeNull();
  });

  it('짝 맞추기가 없는 레슨에 카드에 나온 노트 용어로 짝 맞추기를 더한다 (짧은 것만, 뜻에 용어가 든 것은 빼고)', () => {
    const terms = [
      { term: '엽록체', meaning: '광합성이 일어나는 세포 소기관' },
      { term: '기공', meaning: '기체가 드나드는 잎의 구멍' },
      { term: '엽록소', meaning: '빛을 흡수하는 초록 색소' },
      { term: '포도당', meaning: '포도당은 양분이에요' },
      { term: '미토콘드리아', meaning: '호흡이 일어나는 곳' },
    ];
    const cards = [card('엽록체 안의 엽록소가 빛을 받고, 기공으로 이산화탄소가 들어와 포도당을 만들어요.')];
    const l = settle(cards, [{ type: 'ox', after: 0, prompt: '맞나요?', choices: [], answer: 'O', accepted: [], pairs: [], explanation: '', hint: '' }], { terms });
    expect(l.checks).toHaveLength(2);
    expect(l.checks[1]).toMatchObject({ type: 'match', after: 0 });
    expect(l.checks[1].pairs?.map((p) => p.left)).toEqual(['엽록체', '기공', '엽록소']);
    // 카드에 용어가 셋보다 적게 나오면 더하지 않는다
    expect(termMatch(terms, [{ kind: 'concept', heading: '', text: '엽록체만 나와요', tip: '' }])).toBeNull();
    // 이미 짝 맞추기가 있으면 더하지 않는다
    const pairs = [
      { left: 'a', right: '가' },
      { left: 'b', right: '나' },
      { left: 'c', right: '다' },
    ];
    const l2 = settle(cards, [{ type: 'match', after: 0, prompt: '짝', choices: [], answer: '', accepted: [], pairs, explanation: '', hint: '' }], { terms });
    expect(l2.checks).toHaveLength(1);
  });

  it('저장된 레슨: 깨진 문제 하나만 빼고 나머지는 남긴다 (예전 레슨·모르는 종류도)', () => {
    const plan = readCoursePlan({
      title: '길',
      intro: '',
      units: [
        {
          title: '단계',
          summary: '',
          lessons: [
            {
              title: '레슨',
              goal: '',
              key_point_ids: [],
              cards: [{ kind: 'concept', heading: '', text: '카드', tip: '' }, 'broken'],
              checks: [
                { type: 'ox', prompt: '예전 문제', choices: null, answer: true, accepted: [], explanation: '' },
                { type: 'essay', prompt: '모르는 종류', choices: null, answer: '', accepted: [], explanation: '' },
                { type: 'mcq', prompt: '정답 번호가 없음', choices: ['가', '나'], answer: 5, accepted: [], explanation: '' },
                { type: 'match', prompt: '짝 하나뿐', choices: null, answer: '', accepted: [], explanation: '', pairs: [{ left: 'a', right: 'b' }] },
                { type: 'order', prompt: '차례', choices: ['가', '나', '다'], answer: '', accepted: [], explanation: '', after: 0 },
              ],
            },
          ],
        },
      ],
    });
    const l = plan!.units[0].lessons[0];
    expect(l.cards).toHaveLength(1);
    expect(l.checks.map((c) => c.prompt)).toEqual(['예전 문제', '차례']);
  });

  it('레슨 차례: 자리가 있으면 카드 한 장 → 그 카드 문제, 없으면(예전 레슨) 카드를 다 본 뒤 문제', () => {
    const s = (steps: ReturnType<typeof lessonSteps>) => steps.map((x) => `${x.kind[1]}${x.index}`).join(' ');
    expect(s(lessonSteps(3, [{}, {}]))).toBe('a0 a1 a2 h0 h1');
    expect(s(lessonSteps(3, [{ after: 0 }, { after: 0 }, { after: 2 }, { after: 7 }]))).toBe('a0 h0 h1 a1 a2 h2 h3');
    // 자리가 없는 문제는 카드를 다 본 뒤에 (용어 짝 맞추기 등)
    expect(s(lessonSteps(2, [{ after: 0 }, {}]))).toBe('a0 h0 a1 h1');
    // 카드가 없으면(복습) 문제만
    expect(s(lessonSteps(0, [{ after: 1 }, {}]))).toBe('h0 h1');
  });

  it('보기 섞기는 seed 가 같으면 같고, moved 면 처음 차례 그대로 내지 않는다. 걸리는 시간 어림', () => {
    expect(shuffled(5, 'a')).toEqual(shuffled(5, 'a'));
    expect([...shuffled(5, 'a')].sort()).toEqual([0, 1, 2, 3, 4]);
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) expect(shuffled(2, seed, true)).toEqual([1, 0]);
    expect(lessonMinutes(4, [{ type: 'mcq', choices: [] }, { type: 'match', choices: null }, { type: 'order', choices: [] }, { type: 'cloze', choices: null }])).toBe(3);
    expect(lessonMinutes(0, [])).toBe(1);
  });

  it('핵심 정리의 용어: 그 단계 카드에 나온 것만', () => {
    const unit = { title: '단계', summary: '', lessons: [{ title: 'l', goal: '', key_point_ids: [], cards: [{ kind: 'concept' as const, heading: '엽록체', text: '빛을 받아요', tip: '' }], checks: [] }] };
    expect(
      unitTerms(unit, [
        { term: '엽록체', meaning: '곳' },
        { term: '기공', meaning: '구멍' },
        { term: '엽 록 체', meaning: '같은 낱말' },
      ]),
    ).toEqual([{ term: '엽록체', meaning: '곳' }]);
  });

  it('저장 칸보다 큰 길은 힌트·문제·카드를 줄여 넣는다', () => {
    const big = '가'.repeat(200);
    const check = { type: 'ox' as const, prompt: big, choices: null, answer: true, accepted: [], explanation: big, after: 0, hint: big };
    const lesson = { title: 'l', goal: '', key_point_ids: [], cards: Array.from({ length: 8 }, () => ({ kind: 'concept' as const, heading: '', text: big, tip: '' })), checks: Array.from({ length: 7 }, () => check) };
    const plan: CoursePlan = { title: 't', intro: '', units: Array.from({ length: 6 }, () => ({ title: 'u', summary: '', lessons: Array.from({ length: 6 }, () => lesson) })) };
    const fit = fitPlanSize(plan);
    expect(new TextEncoder().encode(JSON.stringify(fit)).length).toBeLessThanOrEqual(COURSE_PLAN_BYTES);
    expect(fit.units[0].lessons[0].checks[0].hint).toBeUndefined();
    expect(fit.units[0].lessons[0].checks.length).toBeGreaterThanOrEqual(3);
    // 작은 길은 그대로
    const small = settleCourse(zCourseAi.parse(aiRaw), ['k1'])!;
    expect(fitPlanSize(small)).toBe(small);
  });
});

describe('레슨 화면의 규칙 (검토에서 찾은 것)', () => {
  it('짝 맞추기 판: 같은 줄에 제 짝이 둘 넘게 나란히 놓이지 않는다 (처음부터 맞춰진 판이 없다)', () => {
    for (const n of [2, 3, 4, 5]) {
      for (let s = 0; s < 1500; s++) {
        const { lefts, rights } = matchColumns(n, `0-${s % 7}-${s}:0`);
        expect([...lefts].sort()).toEqual([...rights].sort());
        expect(new Set(lefts).size).toBe(n);
        const aligned = rights.filter((r, k) => r === lefts[k]).length;
        expect(aligned).toBeLessThanOrEqual(n === 2 ? 0 : 1);
      }
    }
    // 같은 씨앗이면 같은 판 (다시 그려도 칸이 움직이지 않게)
    expect(matchColumns(4, 'x')).toEqual(matchColumns(4, 'x'));
  });

  it('보기 차례: 섞되, 다른 보기 자리를 가리키는 보기가 있으면(예전 레슨) 그대로', () => {
    const mcq = { type: 'mcq' as const, choices: ['잎', '뿌리', '줄기', '꽃'] };
    expect([...choiceOrder(mcq, 's')].sort()).toEqual([0, 1, 2, 3]);
    expect(choiceOrder(mcq, 's')).toEqual(shuffled(4, 's'));
    expect(choiceOrder({ type: 'mcq', choices: ['잎', '뿌리', '줄기', '①과 ② 모두'] }, 's')).toEqual([0, 1, 2, 3]);
    expect(choiceOrder({ type: 'mcq', choices: ['잎', '뿌리', '위의 것 모두'] }, 's')).toEqual([0, 1, 2]);
    // 낱말 칩은 늘 섞는다
    expect(choiceOrder({ type: 'cloze', choices: ['①', '②', '③'] }, 's')).toEqual(shuffled(3, 's'));
  });

  it('예전 레슨의 객관식: 보기 번호를 떼고 읽는다 (화면이 번호를 따로 단다)', () => {
    const old = readCoursePlan({
      title: 't',
      intro: '',
      units: [
        {
          title: 'u',
          summary: '',
          lessons: [
            {
              title: 'l',
              goal: '',
              key_point_ids: [],
              cards: [{ kind: 'concept', heading: '', text: 'x', tip: '' }],
              checks: [
                { type: 'mcq', prompt: 'q', choices: ['① 잎', '② 뿌리', '③ 줄기', '④ ①과 ② 모두'], answer: 3, accepted: [], explanation: '' },
                { type: 'mcq', prompt: 'q2', choices: ['A. Lincoln', 'B. Obama', 'Carter'], answer: 0, accepted: [], explanation: '' },
              ],
            },
          ],
        },
      ],
    })!;
    const [labeled, names] = old.units[0].lessons[0].checks;
    expect(labeled.choices).toEqual(['잎', '뿌리', '줄기', '①과 ② 모두']);
    expect(labeled.answer).toBe(3);
    // '①과 ② 모두'가 있으니 섞지 않는다: 화면 번호 1·2 가 ①·② 그대로
    expect(choiceOrder(labeled, '0-0-0:0')).toEqual([0, 1, 2, 3]);
    // 번호가 모든 보기에 차례대로 붙지 않았으면 그대로 ('A. Lincoln' 지키기)
    expect(names.choices).toEqual(['A. Lincoln', 'B. Obama', 'Carter']);
  });

  it('빈칸 자리: 코드 밖의 첫 빈칸 (print()·__init__·snake_case 는 빈칸이 아니다)', () => {
    // [빈칸 앞 글, 빈칸]
    const at = (p: string) => {
      const b = clozeBlank(p);
      return b ? [p.slice(0, b.start), p.slice(b.start, b.end)] : null;
    };
    expect(at('`print()` 함수는 값을 화면에 ____ 해요.')).toEqual(['`print()` 함수는 값을 화면에 ', '____']);
    expect(at('`__init__` 메서드는 객체를 만들 때 ____ 돼요.')).toEqual(['`__init__` 메서드는 객체를 만들 때 ', '____']);
    expect(at('__init__ 메서드는 객체를 만들 때 ____ 돼요.')).toEqual(['__init__ 메서드는 객체를 만들 때 ', '____']);
    expect(at('my_var__x 와 __ 중에서')).toEqual(['my_var__x 와 ', '__']);
    expect(at('광합성은 ____에서 일어나요')).toEqual(['광합성은 ', '____']);
    expect(at('광합성은 ( )에서 일어나요')).toEqual(['광합성은 ', '( )']);
    expect(at('print() 로 ( ) 를 출력해요')).toEqual(['print() 로 ', '( )']);
    // 밑줄 셋 이상이 먼저 (두 개짜리는 그다음)
    expect(at('__ 와 ___')).toEqual(['__ 와 ', '___']);
    // 코드 블록 안의 빈칸은 코드 그대로 (고른 낱말은 문제 아래 칸에)
    expect(at('다음 코드의 빈칸은?\n```python\nfor i in ____(3):\n    print(i)\n```')).toBeNull();
    expect(at('빈칸이 없는 문장')).toBeNull();
  });
});
