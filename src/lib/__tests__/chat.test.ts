import { describe, expect, it } from 'vitest';
import { chatChoiceIndex, homeChatJsonSchema, noteChatJsonSchema, readChatQuestion, zChat, zHomeChat, zSolve } from '@/lib/ai/schemas';
import { ANSWER_UNSURE, claimedChoice, finishReply, historyLine, readChatAnswer, readChatSolution, withChatFigure } from '@/lib/chat-solution';
import { solutionAnswer, type ChatSolution } from '@/lib/chat';
import { claimIn, compareText, copulaFor, finalClaim, mentionsAnswer } from '@/lib/figure/solution';
import { chatKindOf } from '@/lib/chat-files';

const question = {
  type: 'short',
  prompt: '빗변의 길이는? (cm)',
  choices: [],
  answer: '5',
  accepted: ['5cm'],
  explanation: '피타고라스 정리로 5 cm 예요.',
  key_point_id: '',
  difficulty: 'easy',
};
const fig = {
  include: true,
  view: { x_min: -1, x_max: 5, y_min: -1, y_max: 4 },
  axes: false,
  grid: false,
  items: [
    { id: 'A', type: 'point', refs: [], x: 0, y: 0, w: 0, h: 0, r: 0, expr: '', from: 0, to: 0, label: 'A', style: 'given', marks: 0 },
    { id: 'B', type: 'point', refs: [], x: 4, y: 0, w: 0, h: 0, r: 0, expr: '', from: 0, to: 0, label: 'B', style: 'given', marks: 0 },
    { id: 'AB', type: 'segment', refs: ['A', 'B'], x: 0, y: 0, w: 0, h: 0, r: 0, expr: '', from: 0, to: 0, label: '4', style: 'given', marks: 0 },
  ],
};

describe('채팅 풀이 받기', () => {
  it('무료(그림 칸 없음)도 글 단계 풀이를 받는다', () => {
    const out = zHomeChat.parse({
      reply: '5 cm 예요.',
      solution: { include: true, problem: '문제', steps: [{ text: '식을 세워요' }, { text: '5 cm' }], question, subject: '수학', unit: '피타고라스' },
    });
    const sol = readChatSolution(out.solution, { figures: false })!;
    expect(sol.figure).toBeNull();
    expect(sol.steps.map((s) => s.text)).toEqual(['식을 세워요', '5 cm']);
    expect(sol.question).toMatchObject({ type: 'short', answer: '5', accepted: ['5cm'] });
    expect(sol.subject).toBe('수학');
  });
  it('Pro 그림은 두 번째 호출로: 단계 번호에 맞춰 add·focus 를 붙이고, 그릴 것이 없으면 풀이 그대로', () => {
    const raw = { include: true, problem: '문제', steps: [{ text: '변 AB' }, { text: '답 4' }], needs_figure: true, question, subject: '', unit: '' };
    const out = zHomeChat.parse({ reply: '', solution: raw });
    expect(out.solution?.needs_figure).toBe(true);
    const sol = readChatSolution(out.solution, { figures: false })!;
    expect(sol.figure).toBeNull();
    const drawn = withChatFigure(sol, {
      figure: fig,
      steps: [
        { index: 1, add: ['AB'], focus: ['AB'] },
        { index: 7, add: ['A'], focus: [] },
      ],
    });
    expect(drawn.figure?.items).toHaveLength(3);
    expect(drawn.steps.map((s) => s.text)).toEqual(['변 AB', '답 4']);
    expect(drawn.steps[0]).toMatchObject({ add: [], focus: [] });
    expect(drawn.steps[1]).toMatchObject({ add: ['AB'], focus: ['AB'] });
    expect(withChatFigure(sol, { figure: { ...fig, include: false }, steps: [] })).toBe(sol);
    expect(withChatFigure(sol, 'broken')).toBe(sol);
  });
  it('채팅 문제는 답을 글 하나로 받는다: 객관식은 보기 글·번호, O/X, 단답', () => {
    const choices = ['3 cm', '4 cm', '5 cm', '6 cm'];
    expect(chatChoiceIndex('5 cm', choices)).toBe(2);
    expect(chatChoiceIndex('③ 5 cm', choices)).toBe(2);
    expect(chatChoiceIndex('③', choices)).toBe(2);
    expect(chatChoiceIndex('3번', choices)).toBe(2);
    expect(chatChoiceIndex('7 cm', choices)).toBe(-1);
    // 보기가 수이면 글이 같은 보기가 먼저다
    expect(chatChoiceIndex('4', ['3', '4', '5', '6'])).toBe(1);
    const mcq = readChatQuestion({ ...question, type: 'mcq', choices, answer: '5 cm' });
    expect(mcq).toMatchObject({ type: 'mcq', answer_index: 2 });
    expect(readChatQuestion({ ...question, type: 'mcq', choices, answer: '없는 답' })).toBeNull();
    expect(readChatQuestion({ ...question, type: 'ox', answer: 'X' })).toMatchObject({ type: 'ox', answer_bool: false });
    expect(readChatQuestion({ ...question, type: 'ox', answer: '모름' })).toBeNull();
    expect(readChatQuestion(question)).toMatchObject({ type: 'short', answer_text: '5', accepted: ['5cm'] });
    expect(readChatQuestion({ prompt: 'x' })).toBeNull();
  });
  it('풀지 않았거나 단계가 없으면 없음, 문제 모양이 이상하면 넣을 문제만 없음', () => {
    expect(readChatSolution(zHomeChat.parse({ reply: 'x', solution: { include: false } }).solution, { figures: true })).toBeNull();
    expect(readChatSolution(zHomeChat.parse({ reply: 'x', solution: { include: true, steps: [] } }).solution, { figures: true })).toBeNull();
    expect(readChatSolution(zHomeChat.parse({ reply: 'x' }).solution, { figures: true })).toBeNull();
    const sol = readChatSolution(
      zHomeChat.parse({ reply: '', solution: { include: true, steps: [{ text: '풀이' }], question: { ...question, answer: '' } } }).solution,
      {
        figures: false,
      },
    )!;
    expect(sol.question).toBeNull();
    expect(sol.problem).toBe('');
  });
  it('노트 채팅 답의 풀이 칸 (예전 DB 는 풀이 칸 없이)', () => {
    const out = zChat.parse({
      reply: 'r',
      outside_note: false,
      proposal: { kind: 'none', questions: [], note_addition: { key_point_id: '', title: '', text: '' } },
    });
    expect(out.solution).toBeUndefined();
    const props = (s: Record<string, unknown>) => Object.keys((s as { properties: Record<string, unknown> }).properties);
    expect(props(noteChatJsonSchema({ solve: false, figures: false }))).not.toContain('solution');
    expect(props(noteChatJsonSchema({ solve: true, figures: true }))).toContain('solution');
    const sol = (s: Record<string, unknown>) =>
      Object.keys((s as { properties: { solution: { properties: Record<string, unknown> } } }).properties.solution.properties);
    // 그림 설계도는 첫 호출에 넣지 않는다 (답 모양이 크면 Claude 가 거절한다): Pro 는 그림이 도움이 되는지만
    expect(sol(homeChatJsonSchema(true))).toContain('needs_figure');
    expect(sol(homeChatJsonSchema(true))).not.toContain('figure');
    expect(sol(homeChatJsonSchema(false))).not.toContain('needs_figure');
  });
  it('노트 그림 풀이 답: 빈 칸이 있어도 받는다', () => {
    expect(zSolve.parse({ solutions: [{ index: 2, steps: [{ text: 'a' }] }] }).solutions[0].index).toBe(2);
  });
  it('대화 기록 한 줄: 붙인 파일 이름과 푼 문제를 덧붙인다', () => {
    const line = historyLine({
      role: 'user',
      content: '이 문제 풀어 줘',
      attachments: [{ kind: 'image', name: '숙제.jpg' }],
    });
    expect(line).toBe('[사진: 숙제.jpg] 이 문제 풀어 줘');
    const answer = historyLine({
      role: 'assistant',
      content: '5 cm',
      solution: { problem: '빗변은?', steps: [], figure: null, question: null, subject: '', unit: '' },
    });
    expect(answer).toContain('(풀이한 문제: 빗변은?)');
  });
});

describe('채팅에 붙이는 파일', () => {
  it('사진·PDF·글 파일만', () => {
    const f = (name: string, type: string) => new File(['x'], name, { type });
    expect(chatKindOf(f('a.jpg', 'image/jpeg'))).toBe('image');
    expect(chatKindOf(f('IMG_0001.HEIC', ''))).toBe('image');
    expect(chatKindOf(f('b.pdf', 'application/pdf'))).toBe('pdf');
    expect(chatKindOf(f('c.md', ''))).toBe('text');
    expect(chatKindOf(f('d.txt', 'text/plain'))).toBe('text');
    expect(chatKindOf(f('e.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBeNull();
  });
});

describe('개념마다 기억 상태', () => {
  it('틀린 문제 → 헷갈려요, 복습할 때 → 복습, 안 푼 것만 → 아직, 나머지 → 잘 기억', async () => {
    const { keyPointMemory } = await import('@/lib/memory');
    const now = Date.parse('2026-10-19T00:00:00Z');
    const qs = [
      { id: 'a', key_point_id: 'k1', status: 'active' },
      { id: 'b', key_point_id: 'k1', status: 'active' },
      { id: 'c', key_point_id: 'k2', status: 'active' },
      { id: 'd', key_point_id: 'k3', status: 'active' },
      { id: 'e', key_point_id: 'k4', status: 'active' },
      { id: 'f', key_point_id: 'k4', status: 'suspended' },
      { id: 'g', key_point_id: null, status: 'active' },
    ];
    const later = '2026-10-25T00:00:00Z';
    const cards = new Map([
      ['a', { in_wrong_note: true, due: later, reps: 2 }],
      ['b', { in_wrong_note: false, due: later, reps: 1 }],
      ['c', { in_wrong_note: false, due: '2026-10-18T00:00:00Z', reps: 3 }],
      ['d', { in_wrong_note: false, due: later, reps: 0 }],
      ['e', { in_wrong_note: false, due: later, reps: 4 }],
    ]);
    const m = keyPointMemory(qs, cards, now);
    expect(m.get('k1')).toMatchObject({ status: 'weak', total: 2, wrong: 1 });
    expect(m.get('k2')?.status).toBe('due');
    expect(m.get('k3')?.status).toBe('new');
    expect(m.get('k4')).toMatchObject({ status: 'good', total: 1 });
    expect(m.size).toBe(4);
  });
});

describe('답 글과 단계 풀이가 같은 답을 말한다', () => {
  it('풀이 칸이 답 글보다 먼저다 (AI 는 칸 순서대로 쓴다: 단계를 풀고 나서 답을 말하게)', () => {
    expect(Object.keys(homeChatJsonSchema(true).properties as object)).toEqual(['solution', 'reply']);
    expect(Object.keys(homeChatJsonSchema(false).properties as object)).toEqual(['solution', 'reply']);
    expect(Object.keys(noteChatJsonSchema({ solve: true, figures: true }).properties as object)).toEqual(['solution', 'reply', 'outside_note', 'proposal']);
    expect(Object.keys(noteChatJsonSchema({ solve: false, figures: false }).properties as object)).toEqual(['reply', 'outside_note', 'proposal']);
  });

  const limit: ChatSolution = {
    problem: 'lim (6^n-5^n+1)/((3^n-2^n)(2^n-1)) 의 값은?',
    steps: [
      { text: '분모를 전개해요', add: [], focus: [] },
      { text: '그래서 극한값은 1이에요.', add: [], focus: [] },
    ],
    figure: null,
    question: {
      type: 'mcq',
      prompt: '극한값은?',
      choices: ['0', '$\\frac{1}{6}$', '$\\frac{1}{3}$', '1', '발산'],
      answer: 3,
      accepted: [],
      explanation: '',
      difficulty: 'medium',
      pages: [],
      key_point_id: '',
    },
    subject: '수학',
    unit: '수열의 극한',
  };

  it("답 글에서 '정답은 ②번'·'답은 3번'을 읽는다 (값은 보지 않는다)", () => {
    expect(claimedChoice('정답은 ②번 1/6이에요.')).toBe(2);
    expect(claimedChoice('답은 3번이에요')).toBe(3);
    expect(claimedChoice('정답: ④')).toBe(4);
    expect(claimedChoice('답은 1이에요')).toBeNull();
    expect(claimedChoice('광합성은 엽록체에서 일어나요.')).toBeNull();
  });

  it('객관식 정답과 다른 번호를 말하면 풀이를 믿고 답 글을 고친다', () => {
    const wrong =
      '사진 속 문제를 풀어 봤어요. 정답은 ②번 $\\frac{1}{6}$이에요. 그런데 화면의 5단계 풀이에는 극한값이 1이라고 적혀 있는데, 이건 틀린 설명이에요.';
    expect(finishReply(wrong, limit)).toBe('정답은 ④번이에요 (1). 아래 단계별 풀이를 확인해 보세요.');
    expect(finishReply('정답은 **④번** 1이에요.', limit)).toBe('정답은 ④번 1이에요.');
    expect(finishReply('극한값은 1이에요.', limit)).toBe('극한값은 1이에요.');
    // 객관식이 아니거나 풀이가 없으면 꾸밈 기호만 걷어 낸다
    expect(finishReply('## 답\n**5 cm** 예요.', null)).toBe('답\n5 cm 예요.');
    expect(finishReply('  ', limit)).toBe('풀이를 정리했어요.');
    expect(finishReply('', null)).toBe('답을 만들지 못했어요. 다시 물어봐 주세요.');
  });

  it('카드에 보여 줄 정답 한 줄', () => {
    expect(solutionAnswer(limit.question)).toBe('④ 1');
    expect(solutionAnswer({ ...limit.question!, type: 'ox', choices: null, answer: false })).toBe('X');
    expect(solutionAnswer({ ...limit.question!, type: 'short', choices: null, answer: ' 5 ' })).toBe('5');
    expect(solutionAnswer(null)).toBe('');
  });
});

// 실제 사례: lim (6^n−5^n+1)/((3^n−2^n)(2^n−1)) — 단계 풀이는 1(④)에 닿았는데 답 글은 '정답은 ②번 1/6'이라고 했다
const LIMIT_PROBLEM = 'lim (6^n−5^n+1)/((3^n−2^n)(2^n−1)) 의 값은? ① 0 ② 1/6 ③ 1/3 ④ 1 ⑤ 발산';
const limitSteps = (last: string) => [
  { text: '분모를 전개하면 $(3^n-2^n)(2^n-1) = 6^n - 3^n - 4^n + 2^n$이에요.' },
  { text: '분자와 분모에서 가장 빠르게 커지는 항은 $6^n$이에요.' },
  { text: '분자와 분모를 $6^n$으로 나누면 $\\frac{1 - (5/6)^n + (1/6)^n}{1 - (1/2)^n - (2/3)^n + (1/3)^n}$이 돼요.' },
  { text: '$n \\to \\infty$일 때 $(5/6)^n$, $(1/6)^n$, $(1/2)^n$, $(2/3)^n$, $(1/3)^n$은 모두 0으로 가요.' },
  { text: last },
];
const LIMIT_CHOICES = ['0', '$\\frac{1}{6}$', '$\\frac{1}{3}$', '1', '발산'];
const limitRaw = (o: { last: string; answer: number; explanation?: string; problem?: string }) => ({
  include: true,
  problem: o.problem ?? LIMIT_PROBLEM,
  steps: limitSteps(o.last),
  question: {
    type: 'mcq',
    prompt: '극한값은?',
    choices: LIMIT_CHOICES,
    answer: LIMIT_CHOICES[o.answer],
    accepted: [],
    explanation: o.explanation ?? '분자와 분모를 $6^n$으로 나누면 남는 항의 비가 1이에요.',
    key_point_id: '',
    difficulty: 'medium',
  },
  subject: '수학',
  unit: '수열의 극한',
});
const REPLY_SAYS_2 = '사진 속 문제를 풀어 봤어요. 정답은 ②번 $\\frac{1}{6}$이에요.';
const FIXED_REPLY = '정답은 ④번이에요 (1). 아래 단계별 풀이를 확인해 보세요.';
const DROPPED_REPLY = '정답은 ④번이에요 (1). 풀이 중에 답이 한 번 엇갈렸으니, 아래 단계별 풀이로 한 번 더 확인해 보세요.';

describe('마지막 단계·넣을 문제·답 글이 같은 답을 말한다', () => {
  it('실제 사례: 단계와 넣을 문제는 ④ 인데 답 글이 ②번 1/6 이라고 하면 답 글을 ④ 로 고친다', () => {
    for (const last of ['따라서 극한값은 $\\frac{1-0+0}{1-0-0+0} = 1$이에요. 정답은 ④ 1이에요.', '따라서 극한값은 $1$이에요.']) {
      const out = readChatAnswer(REPLY_SAYS_2, limitRaw({ last, answer: 3 }), { figures: false });
      expect(out).toMatchObject({ check: 'none', reply: FIXED_REPLY });
      expect(out.solution?.question?.answer).toBe(3);
    }
  });

  it('넣을 문제의 정답이 ② 로 잘못 들어가도 마지막 단계가 ④ 를 분명히 말하면 단계를 믿고 ④ 로 고친다', () => {
    for (const last of ['따라서 정답은 ④ 1이에요.', '따라서 ④ 1이에요.', '따라서 정답은 1이에요.']) {
      for (const reply of ['사진 속 문제를 풀어 봤어요.', '정답은 ④번 1이에요.']) {
        const out = readChatAnswer(reply, limitRaw({ last, answer: 1 }), { figures: false });
        expect(out.check).toBe('fixed');
        expect(out.solution?.question?.answer).toBe(3);
        expect(out.reply).toBe(reply);
      }
    }
  });

  it('답 글이나 해설이 원래 정답(②)을 받쳐 주면 고치지 않고 넣을 문제를 뺀다', () => {
    // 답 글도 ② 라고 하면 단계만 믿을 수 없다 (답 글은 단계에 맞추고 한 번 더 확인해 보라고)
    const backed = readChatAnswer(REPLY_SAYS_2, limitRaw({ last: '따라서 정답은 ④ 1이에요.', answer: 1 }), { figures: false });
    expect(backed).toMatchObject({ check: 'dropped', reply: DROPPED_REPLY });
    expect(backed.solution?.question).toBeNull();
    // 해설이 ② 의 값(1/6)만 말하면 해설도 ② 로 쓴 것이다
    const explained = readChatAnswer(
      '사진 속 문제를 풀어 봤어요.',
      limitRaw({ last: '따라서 정답은 ④ 1이에요.', answer: 1, explanation: '분자와 분모를 $6^n$으로 나누면 극한값은 $\\frac{1}{6}$이에요.' }),
      { figures: false },
    );
    expect(explained.check).toBe('dropped');
  });

  it('번호 없이 값만 말한 마무리 문장이면 고치지 않고 넣을 문제를 뺀다 (답 글은 단계에 맞추고 한 번 더 확인해 보라고)', () => {
    const out = readChatAnswer(REPLY_SAYS_2, limitRaw({ last: '그래서 극한값은 1이에요.', answer: 1 }), { figures: false });
    expect(out.check).toBe('dropped');
    expect(out.solution?.question).toBeNull();
    // 단계·그림은 그대로 남는다
    expect(out.solution?.steps).toHaveLength(5);
    expect(out.reply).toBe(DROPPED_REPLY);
    // 답 글이 이미 단계와 같은 답이면 그대로 두고 덧붙이기만
    const agree = readChatAnswer('정답은 ④번 1이에요.', limitRaw({ last: '그래서 극한값은 1이에요.', answer: 1 }), { figures: false });
    expect(agree.reply).toBe(`정답은 ④번 1이에요. ${ANSWER_UNSURE}`);
  });

  it('해설이 다른 답을 말하거나, 읽은 문제의 그 번호 보기가 넣을 문제의 보기와 다르면 고치지 않고 뺀다', () => {
    const quiet = '사진 속 문제를 풀어 봤어요.';
    const explained = readChatAnswer(quiet, limitRaw({ last: '따라서 정답은 ④ 1이에요.', answer: 1, explanation: '정답은 ②번이에요.' }), { figures: false });
    expect(explained.check).toBe('dropped');
    expect(explained.solution?.question).toBeNull();
    expect(explained.reply).toBe(`${quiet} ${ANSWER_UNSURE}`);
    // 읽은 문제에서는 ④ 가 1/3 (넣을 문제의 보기 번호와 어긋났다)
    const shifted = readChatAnswer(quiet, limitRaw({ last: '따라서 정답은 ④번이에요.', answer: 1, problem: '극한값은? ① 0 ② 1/6 ③ 1 ④ 1/3 ⑤ 발산' }), {
      figures: false,
    });
    expect(shifted.check).toBe('dropped');
  });

  it('마지막 단계가 번호와 다른 보기의 값을 같이 말하면(④ 1/3) 어느 쪽인지 몰라 고치지 않는다', () => {
    const out = readChatAnswer('정답은 ④번이에요.', limitRaw({ last: '따라서 정답은 ④ $\\frac{1}{3}$이에요.', answer: 3 }), { figures: false });
    expect(out.check).toBe('dropped');
    // 단계의 답을 하나로 정할 수 없어서 답 글은 바꾸지 않는다
    expect(out.reply).toBe(`정답은 ④번이에요. ${ANSWER_UNSURE}`);
  });

  it('앞 단계의 중간 값(1/6)은 보지 않는다: 마지막 단계만', () => {
    expect(finalClaim(limitSteps('$(1/6)^n$과 $(5/6)^n$은 0으로 가니까 극한값은 1이에요.'))).toMatchObject({ choice: null, value: '1' });
    expect(finalClaim(limitSteps('따라서 극한값은 $\\frac{1-0+0}{1-0-0+0} = 1$이에요.'))).toMatchObject({ value: '1' });
    // 마지막 단계가 답을 말하지 않으면 아무것도 고치지 않는다
    expect(finalClaim(limitSteps('$\\frac{1}{6}$이 아니라 1이 돼요.'))).toBeNull();
    const out = readChatAnswer('정답은 ④번이에요.', limitRaw({ last: '분자와 분모의 최고차항 계수가 같아요.', answer: 3 }), { figures: false });
    expect(out).toMatchObject({ check: 'none', reply: '정답은 ④번이에요.' });
  });

  it('다른 보기를 설명하거나 가정하는 답 글은 고치지 않는다', () => {
    const raw = limitRaw({ last: '따라서 정답은 ④ 1이에요.', answer: 3 });
    for (const reply of [
      '③ $\\frac{1}{3}$은 분모를 $3^n$으로 잘못 나눴을 때 나오는 값이라 틀려요. 정답은 ④번이에요.',
      '많은 학생이 ③을 고르는데, 그건 함정이에요.',
      '정답이 ③번이라고 생각하기 쉽지만 아니에요.',
      '③번이 정답처럼 보이지만 실제로는 ④번이 정답이에요.',
      '정답은 ③이 아니라 ④예요.',
      '오답은 ②번이에요.',
      '만약 분모가 $3^n$이었다면 정답은 ③번이에요.',
      '답지에는 정답이 ②번이라고 되어 있지만, 실제 정답은 ④번이에요.',
      '극한값은 1이에요. ②번 1/6은 분자를 잘못 나눴을 때 나와요.',
    ]) {
      expect(readChatAnswer(reply, raw, { figures: false }).reply).toBe(reply);
    }
  });
});

describe('O/X·단답 답 글 맞추기', () => {
  const steps = [{ text: '식을 세워요.' }, { text: '따라서 정답은 5 cm예요.' }];
  const short = (answer: string, accepted: string[] = []) => ({
    include: true,
    problem: '빗변의 길이는?',
    steps,
    question: { ...question, answer, accepted },
    subject: '수학',
    unit: '피타고라스',
  });

  it('O/X 는 "정답은 X" 처럼 분명히 말할 때만 고친다 ("틀려요" 는 고치지 않는다)', () => {
    const ox = {
      include: true,
      problem: '광합성은 엽록체에서 일어난다. (O/X)',
      steps: [{ text: '광합성은 엽록체에서 일어나요.' }, { text: '따라서 정답은 O예요.' }],
      question: { ...question, type: 'ox', answer: 'O' },
      subject: '과학',
      unit: '광합성',
    };
    expect(readChatAnswer('정답은 X예요.', ox, { figures: false }).reply).toBe('정답은 O예요. 아래 단계별 풀이를 확인해 보세요.');
    expect(readChatAnswer('정답: ×', ox, { figures: false }).reply).toBe('정답은 O예요. 아래 단계별 풀이를 확인해 보세요.');
    expect(readChatAnswer('정답은 O예요.', ox, { figures: false }).reply).toBe('정답은 O예요.');
    expect(readChatAnswer('이 문장은 틀려요.', ox, { figures: false }).reply).toBe('이 문장은 틀려요.');
    // 마지막 단계가 반대로 말하면 넣을 문제를 뺀다
    const flipped = readChatAnswer('정답은 O예요.', { ...ox, steps: [{ text: '확인해요.' }, { text: '따라서 X예요.' }] }, { figures: false });
    expect(flipped.check).toBe('dropped');
    expect(flipped.reply).toBe('정답은 X예요. 풀이 중에 답이 한 번 엇갈렸으니, 아래 단계별 풀이로 한 번 더 확인해 보세요.');
  });

  it('단답의 수는 단위·LaTeX·전각 숫자를 맞춰 보고, 분명히 다를 때만 고친다', () => {
    const fix = '정답은 5예요. 아래 단계별 풀이를 확인해 보세요.';
    const keep = ['정답은 5 cm예요.', '답은 $\\frac{10}{2}$이에요.', '정답은 ５ｃｍ예요.', '정답은 $\\sqrt{25} = 5$ cm예요.', '정답은 50 mm예요.'];
    for (const reply of keep) expect(readChatAnswer(reply, short('5', ['5cm']), { figures: false }).reply).toBe(reply);
    expect(readChatAnswer('정답은 6 cm예요.', short('5', ['5cm']), { figures: false }).reply).toBe(fix);
    expect(readChatAnswer('$x = 6$이에요.', short('5'), { figures: false }).reply).toBe(fix);
    // 'x = …' 는 '=' 가 하나뿐이고 그것으로 끝맺을 때만 답으로 본다
    expect(readChatAnswer('$x = 2$일 때 넓이가 6이에요.', short('5'), { figures: false }).reply).toBe('$x = 2$일 때 넓이가 6이에요.');
    expect(readChatAnswer('$a = 2$, $b = 3$이에요.', short('5'), { figures: false }).reply).toBe('$a = 2$, $b = 3$이에요.');
    // 말로 된 답은 같은 뜻인지 알 수 없어서 고치지 않는다
    const word = { ...short('광합성'), steps: [{ text: '빛으로 양분을 만들어요.' }, { text: '따라서 정답은 광합성이에요.' }] };
    expect(readChatAnswer('정답은 탄소 동화 작용이에요.', word, { figures: false }).reply).toBe('정답은 탄소 동화 작용이에요.');
  });

  it('마지막 단계의 값이 단답 정답과 다르면 넣을 문제를 빼고, 답 글은 단계의 답으로', () => {
    const out = readChatAnswer(
      '정답은 5 cm예요.',
      { ...short('5', ['5cm']), steps: [{ text: '식을 세워요.' }, { text: '따라서 빗변은 $6$ cm예요.' }] },
      { figures: false },
    );
    expect(out.check).toBe('dropped');
    expect(out.solution?.question).toBeNull();
    expect(out.reply).toBe('정답은 6 cm예요. 풀이 중에 답이 한 번 엇갈렸으니, 아래 단계별 풀이로 한 번 더 확인해 보세요.');
  });

  it('넣을 문제가 없으면 답 글을 마지막 단계의 답에 맞춘다', () => {
    const noQuestion = { ...limitRaw({ last: '따라서 정답은 ④ 1이에요.', answer: 3 }), question: undefined };
    expect(readChatAnswer(REPLY_SAYS_2, noQuestion, { figures: false })).toMatchObject({
      check: 'none',
      reply: '정답은 ④번이에요. 아래 단계별 풀이를 확인해 보세요.',
    });
  });
});

describe('정답이라고 밝힌 말 읽기·값 견주기', () => {
  it('정답이라고 밝힌 답 (claimIn)', () => {
    expect(claimIn('④번이 정답이에요.')?.choice).toBe(4);
    expect(claimIn('정답은 ④번이에요(1).')?.choice).toBe(4);
    expect(claimIn('정답: X')).toMatchObject({ ox: false });
    expect(claimIn('O가 정답이에요.')).toMatchObject({ ox: true });
    expect(claimIn('정답은 ②번이에요. 정답은 ④번이에요.')).toBeNull();
    expect(claimIn('답이 나와요.')).toBeNull();
    expect(claimIn('정답은 다음과 같아요.')).toBeNull();
    // 보기 글이 길면 번호만 본다
    expect(claimIn('정답은 ③ 광합성은 엽록체에서 빛에너지를 써서 이산화 탄소와 물로 포도당과 산소를 만드는 과정이에요.')).toMatchObject({
      choice: 3,
      value: '',
    });
  });

  it('같은 답·다른 답 (분명히 다를 때만 differ)', () => {
    const same: Array<[string, string]> = [
      ['$\\frac{1}{6}$', '1/6'],
      ['0.17', '1/6'],
      ['3.14', 'π'],
      ['５', '5'],
      ['−3', '-3'],
      ['5 cm', '5'],
      ['6 cm²', '$6\\text{ cm}^2$'],
      ['6㎠', '6 cm^2'],
      ['60°', '$\\frac{\\pi}{3}$'],
      ['50%', '1/2'],
      ['3, -1', '-1 또는 3'],
      ['x = 3', '3'],
      ['$2\\sqrt{3}$', '2√3'],
      ['2x+1', '1+2x'],
      ['1,000원', '1000원'],
      ['$\\theta = 30^\\circ$', '30°'],
      ['$\\boxed{1}$', '1'],
      ['O', '○'],
    ];
    for (const [a, b] of same) expect([a, b, compareText(a, b)]).toEqual([a, b, 'same']);
    const differ: Array<[string, string]> = [
      ['1', '1/6'],
      ['0.4', '1/3'],
      ['3', 'π'],
      ['6 cm', '5'],
      ['(2, 3)', '(3, 2)'],
      ['3', '3, -1'],
      ['2x+1', '2x-1'],
      ['X', 'O'],
      ['100, 200', '100200'],
    ];
    for (const [a, b] of differ) expect([a, b, compareText(a, b)]).toEqual([a, b, 'differ']);
    // 단위가 서로 다르면 모른다, 말로 된 답은 견줄 수 없다
    expect(compareText('5 cm', '50 mm')).toBe('unsure');
    expect(compareText('광합성', '호흡')).toBe('na');
    expect(compareText('발산', '1')).toBe('na');
  });

  it('해설이 그 답을 말하는지 (수는 수끼리, 말은 들어 있는지)', () => {
    expect(mentionsAnswer('극한값은 $\\frac{1}{6}$이에요.', '1/6')).toBe(true);
    expect(mentionsAnswer('극한값은 $\\frac{1}{6}$이에요.', '1')).toBe(false);
    expect(mentionsAnswer('6^n으로 나누면 남는 비가 1이에요.', '$1$')).toBe(true);
    expect(mentionsAnswer('$\\lim a_n = 1$이에요.', '1')).toBe(true);
    expect(mentionsAnswer('광합성은 엽록체에서 일어나요.', '엽록체')).toBe(true);
  });

  it('정답 문장의 끝맺음 (받침에 따라 이에요·예요)', () => {
    const cases: Array<[string, string | null]> = [
      ['5', '예요'],
      ['3', '이에요'],
      ['10', '이에요'],
      ['1/6', '이에요'],
      ['$\\frac{2}{3}$', '예요'],
      ['5 cm', '예요'],
      ['3 kg', '이에요'],
      ['광합성', '이에요'],
      ['엽록체', '예요'],
      ['3번', '이에요'],
      ['x^2', '이에요'],
      ['π', null],
    ];
    for (const [a, end] of cases) expect([a, copulaFor(a)]).toEqual([a, end]);
  });
});
