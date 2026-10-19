import { describe, expect, it } from 'vitest';
import { homeChatJsonSchema, noteChatJsonSchema, zChat, zHomeChat, zSolve } from '@/lib/ai/schemas';
import { claimedChoice, finishReply, historyLine, readChatSolution } from '@/lib/chat-solution';
import { solutionAnswer, type ChatSolution } from '@/lib/chat';
import { chatKindOf } from '@/lib/chat-files';

const question = {
  type: 'short',
  prompt: '빗변의 길이는? (cm)',
  choices: [],
  answer_index: -1,
  answer_bool: false,
  answer_text: '5',
  accepted: ['5cm'],
  explanation: '피타고라스 정리로 5 cm 예요.',
  key_point_id: '',
  difficulty: 'easy',
  pages: [],
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
  it('Pro 는 그림도, 무료로 받으면 그림을 버린다', () => {
    const raw = { include: true, problem: '문제', steps: [{ text: '변 AB', add: [], focus: ['AB'] }], figure: fig, question, subject: '', unit: '' };
    const pro = readChatSolution(zHomeChat.parse({ reply: '', solution: raw }).solution, { figures: true })!;
    expect(pro.figure?.items).toHaveLength(3);
    expect(pro.steps[0].focus).toEqual(['AB']);
    const free = readChatSolution(zHomeChat.parse({ reply: '', solution: raw }).solution, { figures: false })!;
    expect(free.figure).toBeNull();
    expect(free.steps[0].focus).toEqual([]);
  });
  it('풀지 않았거나 단계가 없으면 없음, 문제 모양이 이상하면 넣을 문제만 없음', () => {
    expect(readChatSolution(zHomeChat.parse({ reply: 'x', solution: { include: false } }).solution, { figures: true })).toBeNull();
    expect(readChatSolution(zHomeChat.parse({ reply: 'x', solution: { include: true, steps: [] } }).solution, { figures: true })).toBeNull();
    expect(readChatSolution(zHomeChat.parse({ reply: 'x' }).solution, { figures: true })).toBeNull();
    const sol = readChatSolution(
      zHomeChat.parse({ reply: '', solution: { include: true, steps: [{ text: '풀이' }], question: { ...question, answer_text: '' } } }).solution,
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
    const sol = (homeChatJsonSchema(false) as { properties: { solution: { properties: Record<string, unknown> } } }).properties.solution;
    expect(Object.keys(sol.properties)).not.toContain('figure');
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
