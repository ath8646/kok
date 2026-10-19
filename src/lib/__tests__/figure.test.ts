import { describe, expect, it } from 'vitest';
import { compileExpr } from '@/lib/figure/expr';
import { angleMark, niceStep, sampleFunction, ticks, wrapText } from '@/lib/figure/layout';
import { baseItemIds, hasBaseFigure, normalizeFigure, normalizeSteps, pruneFigure, readFigure, visibleAt, type FigItem } from '@/lib/figure/spec';

const item = (p: Partial<FigItem> & Pick<FigItem, 'id' | 'type'>): Record<string, unknown> => ({
  refs: [],
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  r: 0,
  expr: '',
  from: 0,
  to: 0,
  label: '',
  style: 'given',
  marks: 0,
  ...p,
});

describe('그래프 수식', () => {
  it('보통 식과 곱하기 생략', () => {
    expect(compileExpr('x^2 - 3x + 2')!(1)).toBe(0);
    expect(compileExpr('2(x+1)')!(2)).toBe(6);
    expect(compileExpr('x(x-1)')!(3)).toBe(6);
    expect(compileExpr('y = 2sin(x)')!(Math.PI / 2)).toBeCloseTo(2);
    expect(compileExpr('f(x) = sqrt(x) + |x - 4|')!(9)).toBe(8);
    expect(compileExpr('-x^2')!(3)).toBe(-9);
    expect(compileExpr('2^-1')!(0)).toBe(0.5);
    expect(compileExpr('1/x')!(4)).toBe(0.25);
    expect(compileExpr('x**3')!(2)).toBe(8);
    expect(compileExpr('pi*x')!(1)).toBeCloseTo(Math.PI);
    expect(compileExpr('e^x')!(0)).toBe(1);
    expect(compileExpr('log(x)')!(100)).toBe(2);
    expect(compileExpr('2 × x − 1')!(3)).toBe(5);
  });
  it('모르는 글자·코드는 받지 않는다', () => {
    expect(compileExpr('alert(1)')).toBeNull();
    expect(compileExpr('x + y')).toBeNull();
    expect(compileExpr('constructor')).toBeNull();
    expect(compileExpr('(x+1')).toBeNull();
    expect(compileExpr('')).toBeNull();
    expect(compileExpr('x'.repeat(200))).toBeNull();
  });
});

describe('그림 설계도 검사', () => {
  const tri = {
    include: true,
    view: { x_min: -1, x_max: 5, y_min: -1, y_max: 4 },
    axes: false,
    grid: false,
    items: [
      item({ id: 'A', type: 'point', x: 0, y: 0, label: 'A' }),
      item({ id: 'B', type: 'point', x: 4, y: 0, label: 'B' }),
      item({ id: 'C', type: 'point', x: 0, y: 3, label: 'C' }),
      item({ id: 't', type: 'polygon', refs: ['A', 'B', 'C'] }),
      item({ id: 'h', type: 'segment', refs: ['A', 'Z'] }), // 없는 점
      item({ id: 'r', type: 'angle', refs: ['B', 'A', 'C'], label: '90°' }),
      item({ id: 'f', type: 'function', expr: 'import(x)' }), // 읽을 수 없는 식
      item({ id: 'A', type: 'text', x: 2, y: 3, label: '넓이?' }), // 겹치는 번호
    ],
  };
  it('없는 점을 쓰는 것·읽을 수 없는 식은 빼고, 겹치는 번호는 바꾼다', () => {
    const f = normalizeFigure(tri)!;
    expect(f.items.map((i) => i.id)).toEqual(['A', 'B', 'C', 't', 'r', "A'"]);
  });
  it('include 가 false 거나 그릴 것이 없으면 null', () => {
    expect(normalizeFigure({ ...tri, include: false })).toBeNull();
    expect(normalizeFigure({ include: true, items: [item({ id: 'P', type: 'point' })] })).toBeNull();
    expect(normalizeFigure(null)).toBeNull();
  });
  it('이상한 범위는 점들을 담는 범위로, 점이 범위 밖이면 넓힌다', () => {
    const f = normalizeFigure({ ...tri, view: { x_min: 3, x_max: 3, y_min: 0, y_max: 0 } })!;
    expect(f.view.x_min).toBeLessThan(0);
    expect(f.view.x_max).toBeGreaterThan(4);
    const g = normalizeFigure({ ...tri, view: { x_min: 0, x_max: 2, y_min: 0, y_max: 2 } })!;
    expect(g.view.x_max).toBeGreaterThanOrEqual(4);
    expect(g.view.y_max).toBeGreaterThanOrEqual(3);
  });
  it('개수를 줄이다가 잘린 점을 가리키는 선은 남기지 않는다', () => {
    const many = {
      include: true,
      view: { x_min: 0, x_max: 40, y_min: -1, y_max: 1 },
      axes: false,
      grid: false,
      items: [
        item({ id: 's', type: 'segment', refs: ['P0', 'P31'] }), // 31번 점은 30개 안에 들지 못한다
        ...Array.from({ length: 32 }, (_, k) => item({ id: `P${k}`, type: 'point', x: k, y: 0, label: `P${k}` })),
      ],
    };
    const f = normalizeFigure(many)!;
    expect(f.items.length).toBeLessThanOrEqual(30);
    const ids = new Set(f.items.map((i) => i.id));
    for (const i of f.items) for (const r of i.refs) expect(ids.has(r)).toBe(true);
    expect(ids.has('s')).toBe(false);
  });
  it('그리기 전에 없는 점을 가리키는 것을 한 번 더 뺀다 (예전에 저장한 그림)', () => {
    const f = normalizeFigure(tri)!;
    const broken = { ...f, items: [...f.items, { ...f.items[3], id: 'bad', refs: ['A', 'B', 'Q'] }] };
    expect(pruneFigure(broken).items.map((i) => i.id)).toEqual(f.items.map((i) => i.id));
    expect(pruneFigure(f)).toBe(f);
  });
  it('저장한 그림을 다시 읽는다', () => {
    const f = normalizeFigure(tri)!;
    expect(readFigure(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(readFigure({ items: [] })).toBeNull();
  });
});

describe('단계 풀이', () => {
  const fig = normalizeFigure({
    include: true,
    view: { x_min: -1, x_max: 5, y_min: -1, y_max: 4 },
    axes: false,
    grid: false,
    items: [
      item({ id: 'A', type: 'point', x: 0, y: 0, label: 'A' }),
      item({ id: 'B', type: 'point', x: 4, y: 0, label: 'B' }),
      item({ id: 'C', type: 'point', x: 0, y: 3, label: 'C' }),
      item({ id: 'AB', type: 'segment', refs: ['A', 'B'], label: '4' }),
      item({ id: 'AC', type: 'segment', refs: ['A', 'C'], label: '3' }),
      item({ id: 'BC', type: 'segment', refs: ['B', 'C'], label: '5', style: 'answer' }),
    ],
  })!;
  it('있는 요소만, 한 요소는 한 단계에서만 나타난다', () => {
    const steps = normalizeSteps(
      [
        { text: '두 변을 봐요', add: [], focus: ['AB', 'AC', 'zz'] },
        { text: '피타고라스 정리로 $\\sqrt{3^2+4^2}$', add: ['BC', 'BC'], focus: ['BC'] },
        { text: '   ', add: [], focus: [] },
        { text: '다시', add: ['BC'], focus: [] },
      ],
      fig,
    );
    expect(steps).toHaveLength(3);
    expect(steps[0].focus).toEqual(['AB', 'AC']);
    expect(steps[1].add).toEqual(['BC']);
    expect(steps[2].add).toEqual([]);
  });
  it('문제 그림에는 단계에서 나타나는 것이 빠지고, 단계를 넘기면 더해진다', () => {
    const steps = normalizeSteps(
      [
        { text: '1', add: [], focus: [] },
        { text: '2', add: ['BC'], focus: ['BC'] },
      ],
      fig,
    );
    expect(baseItemIds(fig, steps).has('BC')).toBe(false);
    expect(visibleAt(fig, steps, -1).has('BC')).toBe(false);
    expect(visibleAt(fig, steps, 1).has('BC')).toBe(true);
    expect(hasBaseFigure(fig, steps)).toBe(true);
  });
  it('그림 없이 글로만 된 단계', () => {
    expect(normalizeSteps([{ text: '먼저 식을 정리해요', add: ['x'], focus: ['x'] }], null)).toEqual([{ text: '먼저 식을 정리해요', add: [], focus: [] }]);
  });
});

describe('그림 계산', () => {
  it('직각이면 네모 표시', () => {
    expect(angleMark({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 }, 16).right).toBe(true);
    expect(angleMark({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -10 }, 16).right).toBe(false);
    expect(angleMark({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -10 }, 16, true).right).toBe(true);
  });
  it('점근선에서는 선을 끊는다', () => {
    const lines = sampleFunction('1/x', 0, 0, { x_min: -4, x_max: 4, y_min: -4, y_max: 4 }, 200);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.every((l) => l.every((p) => Number.isFinite(p.y)))).toBe(true);
  });
  it('보기 좋은 눈금', () => {
    expect(niceStep(10, 10)).toBe(1);
    expect(niceStep(100, 8)).toBe(20);
    expect(ticks(-2, 2, 4)).toEqual([-2, -1, 0, 1, 2]);
  });
  it('상자 글 줄바꿈', () => {
    const lines = wrapText('엽록체에서 빛 에너지를 흡수한다', 13, 70);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe('그림 풀이 받기 (readSolution)', () => {
  const fig = {
    include: true,
    view: { x_min: -1, x_max: 5, y_min: -1, y_max: 4 },
    axes: false,
    grid: false,
    items: [
      item({ id: 'A', type: 'point', x: 0, y: 0, label: 'A' }),
      item({ id: 'B', type: 'point', x: 4, y: 0, label: 'B' }),
      item({ id: 'C', type: 'point', x: 0, y: 3, label: 'C' }),
      item({ id: 'BC', type: 'segment', refs: ['B', 'C'], label: '5', style: 'answer' }),
    ],
  };
  it('단계가 있으면 그림과 같이, 무료(figures false)는 글 단계만', async () => {
    const { readSolution } = await import('@/lib/figure/solution');
    const s = readSolution({ steps: [{ text: '빗변을 구해요', add: ['BC'], focus: ['BC'] }], figure: fig })!;
    expect(s.figure?.items).toHaveLength(4);
    expect(s.steps[0].add).toEqual(['BC']);
    const free = readSolution({ steps: [{ text: '빗변을 구해요', add: ['BC'], focus: ['BC'] }], figure: fig }, { figures: false })!;
    expect(free.figure).toBeNull();
    expect(free.steps[0]).toEqual({ text: '빗변을 구해요', add: [], focus: [] });
  });
  it('단계가 없으면 null, 그림이 없어도 단계만 있으면 된다', async () => {
    const { readSolution } = await import('@/lib/figure/solution');
    expect(readSolution({ steps: [], figure: fig })).toBeNull();
    expect(readSolution(null)).toBeNull();
    expect(readSolution({ steps: [{ text: '식을 세워요', add: [], focus: [] }], figure: { include: false } })).toEqual({
      figure: null,
      steps: [{ text: '식을 세워요', add: [], focus: [] }],
    });
  });
  it('DB 칸 한도를 넘지 않게: 긴 단계 글은 줄인다', async () => {
    const { readSolution } = await import('@/lib/figure/solution');
    const long = Array.from({ length: 8 }, (_, i) => ({ text: `${i}단계 `.padEnd(400, '가'), add: [], focus: [] }));
    const s = readSolution({ steps: long, figure: null })!;
    expect(new TextEncoder().encode(JSON.stringify(s.steps)).length).toBeLessThanOrEqual(11_000);
    expect(s.steps).toHaveLength(8);
  });
  it('AI 에게 보낼 문제와 정답', async () => {
    const { questionsForSolve, answerForPrompt } = await import('@/lib/figure/solution');
    expect(answerForPrompt({ type: 'mcq', choices: ['가', '나', '다', '라'], answer: 2 })).toBe('3. 다');
    expect(answerForPrompt({ type: 'ox', choices: null, answer: false })).toBe('X (false)');
    const qs = [
      { type: 'short', prompt: 'p0', choices: null, answer: '5', explanation: 'e0' },
      { type: 'ox', prompt: 'p1', choices: null, answer: true, explanation: 'e1' },
    ];
    expect(questionsForSolve(qs, [1, 9]).map((q) => q.index)).toEqual([1]);
    expect(questionsForSolve(qs)[0]).toEqual({ index: 0, type: 'short', prompt: 'p0', choices: [], answer: '5', explanation: 'e0' });
  });
  it('저장된 문제의 풀이 읽기 (예전 문제는 null)', async () => {
    const { solutionOf, readSolution } = await import('@/lib/figure/solution');
    expect(solutionOf({})).toBeNull();
    const s = readSolution({ steps: [{ text: '빗변', add: ['BC'], focus: [] }], figure: fig })!;
    const back = solutionOf(JSON.parse(JSON.stringify({ figure: s.figure, steps: s.steps })))!;
    expect(back.steps).toEqual(s.steps);
    expect(back.figure?.items.map((i) => i.id)).toEqual(['A', 'B', 'C', 'BC']);
  });
});

describe('그림 풀이의 마지막 단계가 정답에 닿는지 (stepsReachAnswer)', () => {
  const steps = (...texts: string[]) => texts.map((text) => ({ text, add: [], focus: [] }));
  const mcq = (answer: number) => ({ type: 'mcq', choices: ['3 cm', '4 cm', '5 cm', '6 cm'], answer });

  it('객관식: 마지막 단계가 다른 번호·다른 보기의 값을 말하면 false', async () => {
    const { stepsReachAnswer } = await import('@/lib/figure/solution');
    const s = steps('피타고라스 정리를 써요.', '$\\sqrt{3^2 + 4^2} = 5$예요. 정답은 ③ 5 cm예요.');
    expect(stepsReachAnswer(s, mcq(2))).toBe(true);
    expect(stepsReachAnswer(s, mcq(3))).toBe(false);
    // 번호 없이 값만: 그 값이 다른 보기와 같으면 다른 답
    expect(stepsReachAnswer(steps('식을 세워요.', '따라서 빗변은 $5$ cm예요.'), mcq(2))).toBe(true);
    expect(stepsReachAnswer(steps('식을 세워요.', '따라서 빗변은 $5$ cm예요.'), mcq(1))).toBe(false);
    // 번호와 값이 서로 다른 보기를 가리키면 (③ 6 cm) 믿을 수 없다
    expect(stepsReachAnswer(steps('식을 세워요.', '정답은 ③ 6 cm예요.'), mcq(2))).toBe(false);
  });

  it('O/X·단답: 반대·다른 수를 분명히 말할 때만 false', async () => {
    const { stepsReachAnswer } = await import('@/lib/figure/solution');
    const ox = (answer: boolean) => ({ type: 'ox', choices: null, answer });
    expect(stepsReachAnswer(steps('엽록체에서 일어나요.', '정답은 O예요.'), ox(true))).toBe(true);
    expect(stepsReachAnswer(steps('엽록체에서 일어나요.', '정답은 O예요.'), ox(false))).toBe(false);
    // '옳아요'·'틀려요' 만으로는 O/X 를 정하지 않는다
    expect(stepsReachAnswer(steps('엽록체에서 일어나요.', '그래서 이 설명은 옳아요.'), ox(false))).toBe(true);
    const short = (answer: string, accepted: string[] = []) => ({ type: 'short', choices: null, answer, accepted });
    const x3 = steps('식을 정리해요.', '따라서 $x = 3$이에요.');
    expect(stepsReachAnswer(x3, short('3'))).toBe(true);
    expect(stepsReachAnswer(x3, short('x = 3'))).toBe(true);
    expect(stepsReachAnswer(x3, short('4'))).toBe(false);
    expect(stepsReachAnswer(x3, short('4', ['3']))).toBe(true);
    // 말로 된 답은 같은 뜻인지 알 수 없어서 버리지 않는다
    expect(stepsReachAnswer(steps('세포 호흡이 일어나요.', '따라서 정답은 미토콘드리아예요.'), short('사립체'))).toBe(true);
  });

  it('앞 단계의 중간 값은 보지 않고, 마지막 단계가 답을 분명히 말하지 않으면 그대로 둔다', async () => {
    const { stepsReachAnswer } = await import('@/lib/figure/solution');
    const key = { type: 'mcq', choices: ['0', '$\\frac{1}{6}$', '$\\frac{1}{3}$', '1', '발산'], answer: 3 };
    expect(stepsReachAnswer(steps('$\\frac{1}{6}$ 과 $\\frac{1}{3}$ 이 나와요.', '따라서 극한값은 $1$이에요.'), key)).toBe(true);
    expect(stepsReachAnswer(steps('분모를 전개해요.', '분자와 분모의 최고차항 계수가 같아요.'), key)).toBe(true);
    // 다른 보기를 설명하는 문장, 값을 여럿 말한 문장, 서로 다른 답을 말한 단계는 읽지 않는다
    expect(stepsReachAnswer(steps('계산해요.', '②는 분자를 잘못 나눈 값이라 틀려요.'), key)).toBe(true);
    expect(stepsReachAnswer(steps('계산해요.', '따라서 $a = 2$, $b = 3$이에요.'), { type: 'short', choices: null, answer: '5' })).toBe(true);
    expect(stepsReachAnswer(steps('계산해요.', '정답은 ②번이에요. 정답은 ④번이에요.'), key)).toBe(true);
    expect(stepsReachAnswer([], key)).toBe(true);
    expect(stepsReachAnswer(null, key)).toBe(true);
  });

  it('AI 가 준 그대로의 단계를 본다: 화면에서 잘리는 9번째 단계가 다른 답을 말해도 false', async () => {
    const { stepsReachAnswer, readSolution } = await import('@/lib/figure/solution');
    const raw = steps(...Array.from({ length: 8 }, (_, i) => `${i + 1}단계 계산이에요.`), '따라서 정답은 ② $\\frac{1}{6}$이에요.');
    expect(readSolution({ steps: raw, figure: null })!.steps).toHaveLength(8);
    expect(stepsReachAnswer(raw, { type: 'mcq', choices: ['0', '$\\frac{1}{6}$', '$\\frac{1}{3}$', '1'], answer: 3 })).toBe(false);
  });

  it('읽은 문제에 ①부터 적힌 보기', async () => {
    const { listedChoices } = await import('@/lib/figure/solution');
    expect([...listedChoices('값은? ① 0 ② 1/6 ③ 1/3 ④ 1 ⑤ 발산\n(단, n은 자연수)')]).toEqual([
      [1, '0'],
      [2, '1/6'],
      [3, '1/3'],
      [4, '1'],
      [5, '발산'],
    ]);
    // 차례대로 적혀 있지 않으면 보기 목록으로 보지 않는다
    expect(listedChoices('조건 ③ 을 쓰면 ① 이 돼요').size).toBe(0);
  });
});
