// 자료 종류: 고르기 규칙, 종류마다 더하는 지침(일반은 예전 그대로), 원래 문제 읽기, 단어장 카드, 예상 에너지
import { describe, expect, it } from 'vitest';
import { MATERIAL_LABEL, MATERIAL_PICKS, noteMaterialType, readMaterialPick, readMaterialType, readNoteMaterial, readPartTypes } from '@/lib/material-type';
import {
  addMissingTerms,
  bareTerm,
  cleanQuestionPrompt,
  forSaving,
  halveJob,
  mergeTerms,
  placeExamples,
  problemJobs,
  readJobs,
  readOriginals,
  stripChoiceLabels,
  vocabCards,
  VOCAB_CARDS_MAX,
} from '@/lib/material-questions';
import { appendMergePlanPrompt, checkPrompt, mergePlanPrompt, organizePrompt, problemsPrompt, quizPrompt, type QuizOptions } from '@/lib/ai/prompts';
import { organizeJsonSchema, problemsJsonSchema } from '@/lib/ai/schemas';
import { estimateEnergy } from '@/lib/ai/models';
import { problemPieces, problemsOutTokens, vocabHeadroom } from '@/lib/ai/scale';
import { autoGrade } from '@/lib/grading';

describe('material type', () => {
  it('reads unknown values as general / auto', () => {
    expect(readMaterialType('exam')).toBe('exam');
    expect(readMaterialType('poem')).toBe('general');
    expect(readMaterialType(undefined)).toBe('general');
    expect(readMaterialPick('vocab')).toBe('vocab');
    expect(readMaterialPick('auto')).toBe('auto');
    expect(readMaterialPick(42)).toBe('auto');
    expect(MATERIAL_PICKS[0]).toBe('auto');
    expect(Object.keys(MATERIAL_LABEL)).toEqual(['general', 'exam', 'vocab', 'math', 'reading']);
  });

  it('a note takes the type that covers more than half of the material, else general', () => {
    expect(noteMaterialType([])).toBe('general');
    expect(noteMaterialType([{ type: 'exam', w: 4 }])).toBe('exam');
    // 교과서 15쪽 + 단원 끝 문제 5쪽: 섞인 자료는 일반 (문제 조각의 원래 문제는 따로 꺼낸다)
    expect(
      noteMaterialType([
        { type: 'general', w: 15 },
        { type: 'exam', w: 5 },
      ]),
    ).toBe('general');
    expect(
      noteMaterialType([
        { type: 'exam', w: 15 },
        { type: 'general', w: 5 },
      ]),
    ).toBe('exam');
    // 딱 반은 넘지 않는다
    expect(
      noteMaterialType([
        { type: 'vocab', w: 2 },
        { type: 'math', w: 2 },
      ]),
    ).toBe('general');
    // 학생이 고른 것이 늘 이긴다
    expect(noteMaterialType([{ type: 'exam', w: 9 }], 'reading')).toBe('reading');
    expect(noteMaterialType([{ type: 'exam', w: 9 }], 'general')).toBe('general');
    expect(readPartTypes([{ type: 'exam', w: 2 }, { type: 'x', w: 1 }, { w: 0 }, null])).toEqual([
      { type: 'exam', w: 2 },
      { type: 'general', w: 1 },
    ]);
  });

  it('reads the note body mark', () => {
    expect(readNoteMaterial({ material: { type: 'vocab', by: 'student' } })).toEqual({ type: 'vocab', by: 'student' });
    expect(readNoteMaterial({ material: { type: 'math' } })).toEqual({ type: 'math', by: 'ai' });
    expect(readNoteMaterial({ material: { type: 'nope' } })).toBeNull();
    expect(readNoteMaterial({})).toBeNull();
    expect(readNoteMaterial(null)).toBeNull();
  });
});

describe('prompts by material type', () => {
  const quiz: QuizOptions = { types: ['mcq', 'ox', 'cloze', 'short'], mix: { easy: 30, medium: 50, hard: 20 }, language: 'ko', perKeyPoint: 'auto' };

  it('organize: the AI decides the type first and gets every type rule; a student pick gets only its own', () => {
    const auto = organizePrompt({ title: '자료', kind: 'pdf', pageStart: 1, pageEnd: 3 });
    expect(auto).toContain('material_type: decide it first');
    for (const t of ['"exam"', '"vocab"', '"math"', '"reading"', '"general"']) expect(auto).toContain(t);
    expect(auto).toContain('whenever you are not sure');
    expect(auto).toContain('Extra rules by material_type');
    const vocab = organizePrompt({ title: '자료', kind: 'text', materialPick: 'vocab' });
    expect(vocab).toContain('the student says this material is "vocab"');
    expect(vocab).toContain('terms holds every entry of the list');
    // 예문은 낱말마다 하나, 모두 60개까지 (정리 답이 길어져 잘리지 않게)
    expect(vocab).toContain('at most one for each entry and at most 60 in total');
    expect(vocab).not.toContain('"exam": key_points');
    // 학생이 일반을 고르면 더하는 지침이 없다
    const general = organizePrompt({ title: '자료', kind: 'text', materialPick: 'general' });
    expect(general).toContain('set it to "general".');
    expect(general).not.toContain('Extra rules');
  });

  it('organize: everything the old prompt said is still there (the type rules only add)', () => {
    const p = organizePrompt({ title: '자료', kind: 'text', ownWriting: true, keyPoints: { min: 4, max: 6 } });
    for (const line of [
      '- title: a short title',
      '- key_points: 4 to 6 items',
      '- terms: { term, meaning } for every technical term.',
      '- formulas:',
      '- pitfalls:',
      '- examples:',
      "The material is the student's own writing.",
    ]) {
      expect(p).toContain(line);
    }
  });

  it('organize schema starts with material_type (the AI writes it before the note)', () => {
    for (const s of [organizeJsonSchema({ figures: false, pageNumbers: false }), organizeJsonSchema({ figures: true, pageNumbers: true })]) {
      const props = Object.keys((s as { properties: Record<string, unknown> }).properties);
      expect(props[0]).toBe('material_type');
      expect(props).toContain('key_points');
    }
    const items = (problemsJsonSchema({ figures: true }) as { properties: { questions: { items: { properties: Record<string, unknown> } } } }).properties
      .questions.items.properties;
    expect(Object.keys(items)).toEqual(expect.arrayContaining(['answer', 'answer_from', 'figure_id', 'pages']));
  });

  it('quiz: general stays as it was; each type adds its own rules', () => {
    const plain = quizPrompt(quiz);
    expect(quizPrompt(quiz, { material: 'general' })).toBe(plain);
    // 원래 문제가 없는 기출, 카드가 없는 단어장은 예전 그대로
    expect(quizPrompt(quiz, { material: 'exam', originals: 0 })).toBe(plain);
    expect(quizPrompt(quiz, { material: 'vocab', cards: 0 })).toBe(plain);
    // 기출: 원래 문제가 묻는 개념만 덜 만들고, 나머지 개념은 예전만큼 (원래 문제를 일부만 꺼냈어도 문제가 줄지 않게)
    const exam = quizPrompt(quiz, { material: 'exam', originals: 5, covered: ['k1', 'k3'] });
    expect(exam).toContain('they already test key points k1, k3');
    expect(exam).toContain('"high" gets 2 or 3');
    expect(exam).toContain('Give every other key point its usual number of questions');
    // 원래 문제가 어느 개념도 묻지 않으면 예전 그대로 (겹치지 않게만: <existing_questions>)
    expect(quizPrompt(quiz, { material: 'exam', originals: 5, covered: [] })).toBe(plain);
    expect(quizPrompt(quiz, { material: 'vocab', cards: 12 })).toContain('never ask the meaning of a single entry');
    const math = quizPrompt(quiz, { material: 'math' });
    expect(math).toContain('"high" gets 2 or 3');
    expect(math).toContain('Work out each answer twice');
    expect(quizPrompt(quiz, { material: 'reading' })).toContain('quoted exactly as in the note');
  });

  it('check: originals and calculations get their own rules only when needed', () => {
    const plain = checkPrompt();
    expect(checkPrompt({ originals: false, math: false })).toBe(plain);
    expect(checkPrompt({ originals: true })).toContain('origin "material"');
    expect(checkPrompt({ originals: true })).toContain('answer_from is "solved"');
    expect(checkPrompt({ math: true })).toContain('redo the calculation');
    expect(checkPrompt({ math: true })).not.toContain('other than one with origin');
    // 원래 문제: 그림은 문제의 그림으로 주어지니 빼지 않고, 계산을 다시 해 본다는 규칙과 부딪히지 않는다
    const both = checkPrompt({ originals: true, math: true, figures: true });
    expect(both).toContain('neither written in it nor given as its figure');
    expect(both).toContain('rules 1 to 4 and the picture rule above do not apply to it');
    expect(both).toContain('For a question that asks for a calculation (other than one with origin "material")');
  });

  it('merging: only a plan comes from the AI, so terms and examples never go through its answer', () => {
    // 합치기는 계획만 받는다: 용어·예문은 늘 앱이 옮긴다 (단어장도 AI 에 보내지 않는다)
    expect(mergePlanPrompt(2, { min: 4, max: 9 })).toContain('The app copies the key points and every term');
    expect(appendMergePlanPrompt(1, 12)).toContain('The app copies the key points and every term');
    expect(appendMergePlanPrompt(1, 12)).toContain('Use at most 12 items');
  });

  it('problems: copy, never invent; pages and pictures by material kind', () => {
    const pdf = problemsPrompt({ kind: 'pdf', pageStart: 16, pageEnd: 30, figures: true });
    expect(pdf).toContain('pages 16 to 30');
    expect(pdf).toContain('figure_id');
    expect(pdf).toContain('Do not write new questions');
    expect(pdf).toContain('longer than 900 characters, skip the question');
    expect(problemsPrompt({ kind: 'image', imageStart: 1, imageEnd: 3, figures: false })).not.toContain('figure_id');
    expect(problemsPrompt({ kind: 'text', figures: false })).toContain('<material>');
  });
});

describe('original questions', () => {
  const kps = [
    { id: 'k1', title: '광합성' },
    { id: 'k2', title: '세포 호흡' },
  ];

  it('cleans numbers and scores but keeps decimals and real text', () => {
    expect(cleanQuestionPrompt('3. 광합성이 일어나는 곳은? [2점]')).toBe('광합성이 일어나는 곳은?');
    expect(cleanQuestionPrompt('12) 다음 중 옳은 것은?')).toBe('다음 중 옳은 것은?');
    expect(cleanQuestionPrompt('[4] 빈칸에 알맞은 말은?')).toBe('빈칸에 알맞은 말은?');
    expect(cleanQuestionPrompt('문제 5. 다음을 읽고')).toBe('다음을 읽고');
    expect(cleanQuestionPrompt('이 현상을 무엇이라고 하는가? (단답형)')).toBe('이 현상을 무엇이라고 하는가?');
    expect(cleanQuestionPrompt('10.5 g의 물에 녹인 소금은?')).toBe('10.5 g의 물에 녹인 소금은?');
    expect(cleanQuestionPrompt('2x + 3 = 7일 때 x의 값은?')).toBe('2x + 3 = 7일 때 x의 값은?');
    // 글의 일부인 'N번'은 그대로, 번호로 쓴 'N번.'·'N번)'만 뗀다
    expect(cleanQuestionPrompt('21번 염색체가 3개인 경우 나타나는 증후군은?')).toBe('21번 염색체가 3개인 경우 나타나는 증후군은?');
    expect(cleanQuestionPrompt('100번 반복할 때 출력은?')).toBe('100번 반복할 때 출력은?');
    expect(cleanQuestionPrompt('3번. 다음 중 옳은 것은?')).toBe('다음 중 옳은 것은?');
    expect(cleanQuestionPrompt('4번) 빈칸에 알맞은 말은?')).toBe('빈칸에 알맞은 말은?');
  });

  it('strips choice labels only when every choice has them in order', () => {
    expect(stripChoiceLabels(['① 엽록체', '② 핵', '③ 리보솜', '④ 액포', '⑤ 세포막'])).toEqual(['엽록체', '핵', '리보솜', '액포', '세포막']);
    expect(stripChoiceLabels(['1) 2', '2) 4', '3) 6', '4) 8'])).toEqual(['2', '4', '6', '8']);
    expect(stripChoiceLabels(['A. apple', 'B. pear', 'C. plum', 'D. fig'])).toEqual(['apple', 'pear', 'plum', 'fig']);
    // 사람 이름처럼 글자로 시작하는 보기는 그대로
    expect(stripChoiceLabels(['A. Lincoln', 'G. Washington', 'T. Jefferson'])).toEqual(['A. Lincoln', 'G. Washington', 'T. Jefferson']);
    expect(stripChoiceLabels(['1.5 m', '2.5 m', '3.5 m'])).toEqual(['1.5 m', '2.5 m', '3.5 m']);
    expect(stripChoiceLabels(['ㄱ, ㄴ', 'ㄱ, ㄷ', 'ㄴ, ㄷ', 'ㄱ, ㄴ, ㄷ'])).toEqual(['ㄱ, ㄴ', 'ㄱ, ㄷ', 'ㄴ, ㄷ', 'ㄱ, ㄴ, ㄷ']);
  });

  it('reads originals: answer by choice text or number, five choices, drops broken ones', () => {
    const json = {
      questions: [
        {
          type: 'mcq',
          prompt: '1. 광합성이 일어나는 세포 소기관은? [2점]',
          choices: ['① 엽록체', '② 미토콘드리아', '③ 핵', '④ 리보솜', '⑤ 세포막'],
          answer: '①',
          accepted: [],
          explanation: '광합성은 엽록체에서 일어나요.',
          key_point_id: 'k1',
          difficulty: 'easy',
          pages: [2],
          answer_from: 'material',
          figure_id: '',
        },
        // 정답을 보기 글로
        {
          type: 'mcq',
          prompt: '세포 호흡이 일어나는 곳은?',
          choices: ['핵', '미토콘드리아', '엽록체', '골지체'],
          answer: '미토콘드리아',
          key_point_id: 'k2',
          answer_from: 'solved',
        },
        { type: 'ox', prompt: '광합성은 빛이 있어야 한다.', answer: 'O', key_point_id: 'k9', answer_from: 'material' },
        { type: 'cloze', prompt: '광합성의 산물은 포도당과 ( )이다.', answer: '산소', accepted: ['O2'], answer_from: 'material' },
        // 정답을 보기에서 찾을 수 없음
        { type: 'mcq', prompt: '다음 중 옳은 것은?', choices: ['가', '나', '다', '라'], answer: '마', answer_from: 'solved' },
        // 빈칸 없는 빈칸 문제
        { type: 'cloze', prompt: '광합성의 산물은?', answer: '포도당', answer_from: 'material' },
        // 없는 그림이 필요한 문제
        { type: 'short', prompt: '다음 그래프에서 A는?', answer: '산소', figure_id: 'f9', answer_from: 'material' },
        // 겹친 문제
        { type: 'ox', prompt: '광합성은 빛이 있어야 한다.', answer: 'O', answer_from: 'material' },
        { type: 'short', prompt: '그림의 기관 이름은?', answer: '잎', figure_id: 'f1', answer_from: 'material' },
      ],
    };
    const got = readOriginals(json, { kps, figureIds: new Set(['f1']) });
    expect(got.map((q) => q.prompt)).toEqual([
      '광합성이 일어나는 세포 소기관은?',
      '세포 호흡이 일어나는 곳은?',
      '광합성은 빛이 있어야 한다.',
      '광합성의 산물은 포도당과 ( )이다.',
      '그림의 기관 이름은?',
    ]);
    expect(got[0]).toMatchObject({
      type: 'mcq',
      choices: ['엽록체', '미토콘드리아', '핵', '리보솜', '세포막'],
      answer: 0,
      key_point_id: 'k1',
      kp_title: '광합성',
      origin: 'material',
      answer_from: 'material',
      pages: [2],
    });
    expect(got[1]).toMatchObject({ answer: 1, answer_from: 'solved', kp_title: '세포 호흡' });
    // 없는 개념 번호는 비운다
    expect(got[2]).toMatchObject({ type: 'ox', answer: true, key_point_id: '' });
    expect(got[2].kp_title).toBeUndefined();
    expect(got[3]).toMatchObject({ type: 'cloze', answer: '산소', accepted: ['O2'] });
    expect(got[4]).toMatchObject({ figure_id: 'f1' });
    expect(readOriginals({ questions: json.questions }, { kps, figureIds: new Set(), max: 2 })).toHaveLength(2);
    expect(readOriginals(null, { kps, figureIds: new Set() })).toEqual([]);
    // 앞서 꺼낸 문제(앞 쪽에서)와 같은 문제는 다시 넣지 않는다
    const again = readOriginals(json, { kps, figureIds: new Set(['f1']), before: got.slice(0, 2) });
    expect(again.map((q) => q.prompt)).toEqual(['광합성은 빛이 있어야 한다.', '광합성의 산물은 포도당과 ( )이다.', '그림의 기관 이름은?']);
    // 저장할 때는 파이프라인만 쓰는 칸을 뗀다
    const saved = forSaving(got[0]);
    expect(saved).not.toHaveProperty('origin');
    expect(saved).not.toHaveProperty('answer_from');
    expect(saved).not.toHaveProperty('kp_title');
    expect(saved).toMatchObject({ prompt: '광합성이 일어나는 세포 소기관은?', answer: 0 });
    expect(forSaving({ ...got[4], figure_crop: 'u/figs/s/f1.jpg' })).not.toHaveProperty('figure_crop');
  });

  it('takes the questions out a few pages at a time, and halves a part whose answer was cut off', () => {
    expect(problemPieces({ kind: 'pdf', pages: 15 }, 15)).toBe(3);
    expect(problemPieces({ kind: 'pdf', pages: 4 }, 4)).toBe(1);
    expect(problemPieces({ kind: 'image', images: 6 }, 6)).toBe(2);
    expect(problemPieces({ kind: 'text', chars: 40_000 })).toBe(6);
    // 쪽: 빈틈도 겹침도 없이
    const pdf = problemJobs(2, 15, 3);
    expect(pdf).toEqual([
      { chunk: 2, from: 0, to: 5 },
      { chunk: 2, from: 5, to: 10 },
      { chunk: 2, from: 10, to: 15 },
    ]);
    expect(problemJobs(0, 2, 5)).toEqual([
      { chunk: 0, from: 0, to: 1 },
      { chunk: 0, from: 1, to: 2 },
    ]);
    // 글: 빈 줄에서 자른다 (문제 하나가 둘로 나뉘지 않게)
    const qs = Array.from({ length: 300 }, (_, i) => `${i + 1}. 다음 중 옳은 것은?\n① 가 ② 나 ③ 다 ④ 라`).join('\n\n');
    const text = problemJobs(0, qs.length, 4, qs);
    expect(text).toHaveLength(4);
    expect(text[0].from).toBe(0);
    expect(text[3].to).toBe(qs.length);
    for (let k = 1; k < text.length; k++) {
      expect(text[k].from).toBe(text[k - 1].to);
      expect(qs.slice(text[k].from)).toMatch(/^\d+\. 다음/);
    }
    // 답이 잘리면 반으로: 쪽 하나·짧은 글은 더 나누지 않는다
    expect(halveJob({ chunk: 1, from: 4, to: 9 })).toEqual([
      { chunk: 1, from: 4, to: 6 },
      { chunk: 1, from: 6, to: 9 },
    ]);
    expect(halveJob({ chunk: 1, from: 4, to: 5 })).toBeNull();
    expect(halveJob({ chunk: 0, from: 0, to: 1500 }, qs)).toBeNull();
    const halves = halveJob(text[0], qs)!;
    expect(halves[0].from).toBe(text[0].from);
    expect(halves[1].to).toBe(text[0].to);
    expect(halves[0].to).toBe(halves[1].from);
    expect(qs.slice(halves[1].from)).toMatch(/^\d+\. 다음/);
    // 저장된 일 읽기 (이상한 값은 뺀다)
    expect(readJobs([{ chunk: 0, from: 0, to: 5 }, { chunk: 1, from: 3, to: 3 }, 7, null, { chunk: -1, from: 0, to: 2 }])).toEqual([
      { chunk: 0, from: 0, to: 5 },
    ]);
    expect(readJobs(undefined)).toEqual([]);
  });
});

describe('vocabulary cards', () => {
  const terms = [
    { term: 'abandon (v.)', meaning: '버리다, 포기하다' },
    { term: 'brave', meaning: '용감한' },
    { term: 'calm', meaning: '차분한, 고요한' },
    { term: 'delay', meaning: '미루다, 지연시키다' },
    { term: 'eager', meaning: '열망하는' },
    { term: 'fragile', meaning: '깨지기 쉬운' },
    { term: 'courageous', meaning: '용감한' },
    { term: 'huge', meaning: '거대한, 큰' },
    { term: 'big', meaning: '큰' },
  ];
  const keyPoints = [
    { id: 'k1', title: 'Day 1', explanation: 'abandon, brave, calm, delay 를 배워요.', pages: [1] },
    { id: 'k2', title: 'Day 2', explanation: 'eager, fragile, courageous, huge, big 을 배워요.', pages: [2] },
  ];
  const all = { types: ['mcq', 'ox', 'cloze', 'short'], keyPoints, seed: 'source-1' };

  it('one card per entry, alternating word → meaning (mcq) and meaning → word (short)', () => {
    const cards = vocabCards(terms, all);
    expect(cards).toHaveLength(terms.length);
    expect(cards.every((c) => c.origin === 'vocab')).toBe(true);
    expect(cards[0]).toMatchObject({ type: 'mcq', prompt: '‘abandon (v.)’의 뜻으로 알맞은 것은?', key_point_id: 'k1', pages: [1] });
    expect(cards[0].choices).toContain('버리다, 포기하다');
    expect(cards[0].choices![cards[0].answer as number]).toBe('버리다, 포기하다');
    // 같은 시드면 같은 카드
    expect(vocabCards(terms, all)).toEqual(cards);
    // 'brave'(용감한)는 'courageous'(용감한)와 뜻이 같아서 단답이면 둘 다 인정
    const brave = cards[1];
    expect(brave).toMatchObject({ type: 'short', prompt: '다음 뜻을 가진 낱말을 쓰세요.\n용감한', answer: 'brave' });
    expect(brave.accepted).toContain('courageous');
    expect(autoGrade(brave as never, 'Brave').correct).toBe(true);
  });

  it('never gives two right answers: overlapping meanings are not used as wrong choices', () => {
    const cards = vocabCards(terms, all);
    const big = cards.find((c) => c.prompt.includes('‘big’'));
    if (big?.type === 'mcq') expect(big.choices).not.toContain('거대한, 큰');
    // 'huge'(거대한, 큰)와 'big'(큰)은 뜻이 겹쳐서 단답으로 내지 않는다
    for (const c of cards) {
      if (c.type === 'short') expect(['거대한, 큰', '큰']).not.toContain(c.prompt.split('\n')[1]);
      if (c.type === 'mcq') expect(new Set(c.choices).size).toBe(4);
    }
  });

  it('words a pitfall calls confusable are never each other’s wrong choice, and get no short answer', () => {
    const list = [
      { term: 'huge (adj.)', meaning: '거대한, 막대한' },
      { term: 'large (adj.)', meaning: '큰, 많은' },
      { term: 'abandon (v.)', meaning: '버리다' },
      { term: 'benefit (n.)', meaning: '이익' },
      { term: 'justify (v.)', meaning: '정당화하다' },
      { term: 'modest (adj.)', meaning: '겸손한' },
    ];
    const pitfalls = [{ text: 'huge와 large는 둘 다 크다는 뜻이라 헷갈리기 쉬워요.' }];
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const cards = vocabCards(list, { types: ['mcq', 'short'], keyPoints: [], pitfalls, seed });
      const huge = cards.find((c) => c.prompt.includes('huge') || c.answer === 'huge');
      const large = cards.find((c) => c.prompt.includes('large') || c.answer === 'large');
      expect(huge?.type).toBe('mcq');
      expect(large?.type).toBe('mcq');
      expect(huge?.choices).not.toContain('큰, 많은');
      expect(large?.choices).not.toContain('거대한, 막대한');
    }
  });

  it('follows the question types that are on', () => {
    expect(vocabCards(terms, { ...all, types: ['short'] }).every((c) => c.type === 'short')).toBe(true);
    const ox = vocabCards(terms, { ...all, types: ['ox'] });
    expect(ox.every((c) => c.type === 'ox')).toBe(true);
    expect(ox.some((c) => c.answer === false)).toBe(true);
    expect(vocabCards(terms, { ...all, types: ['cloze'] })).toEqual([]);
    // 낱말이 셋이면 객관식 보기를 만들 수 없다 → 단답
    expect(vocabCards(terms.slice(0, 3), { ...all, types: ['mcq', 'short'] }).every((c) => c.type === 'short')).toBe(true);
    expect(vocabCards(terms.slice(0, 3), { ...all, types: ['mcq'] })).toEqual([]);
  });

  it('a word with two meanings never makes a card with two right answers', () => {
    const list = [
      { term: 'bank', meaning: '은행' },
      { term: 'bank', meaning: '둑' },
      { term: 'brave', meaning: '용감한' },
      { term: 'run', meaning: '운영하다' },
      { term: 'fragile', meaning: '깨지기 쉬운' },
      { term: 'eager', meaning: '열망하는' },
    ];
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      // 객관식만: 'bank' 의 다른 뜻은 보기에 들어가지 않는다
      for (const c of vocabCards(list, { types: ['mcq'], keyPoints: [], seed }).filter((c) => c.prompt.includes('‘bank’'))) {
        expect(c.choices!.filter((x) => x === '은행' || x === '둑')).toHaveLength(1);
      }
      // 단답을 켰으면 뜻이 여럿인 낱말은 뜻 → 낱말로 (뜻마다 문제 글이 다르다)
      const both = vocabCards(list, { types: ['mcq', 'short'], keyPoints: [], seed }).filter((c) => c.answer === 'bank');
      expect(both.map((c) => c.prompt).sort()).toEqual(['다음 뜻을 가진 낱말을 쓰세요.\n둑', '다음 뜻을 가진 낱말을 쓰세요.\n은행']);
      // 다른 낱말의 보기로는 쓸 수 있다 (뜻이 겹치지 않으면)
      for (const c of vocabCards(list, { types: ['ox'], keyPoints: [], seed })) {
        if (c.prompt.startsWith('‘bank’') && c.answer === false) expect(c.prompt).not.toMatch(/‘(은행|둑)’이다/);
      }
    }
  });

  it('caps the number of cards and skips broken entries', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ term: `word${i}`, meaning: `뜻 ${i}번` }));
    expect(vocabCards(many, all)).toHaveLength(VOCAB_CARDS_MAX);
    expect(vocabCards(many.slice(0, 120), all)).toHaveLength(120);
    expect(
      vocabCards(
        [
          { term: '$x$', meaning: '수식' },
          { term: '', meaning: '빈 낱말' },
        ],
        all,
      ),
    ).toEqual([]);
    expect(bareTerm('abandon (v.)')).toBe('abandon');
    expect(bareTerm('take off')).toBe('take off');
  });

  it('merges vocabulary lists without losing or doubling entries', () => {
    const a = [
      { term: 'brave', meaning: '용감한' },
      { term: 'bank', meaning: '은행' },
    ];
    const b = [
      { term: 'Brave', meaning: '용감한' },
      { term: 'bank', meaning: '둑' },
      { term: 'calm', meaning: '차분한' },
    ];
    expect(mergeTerms(a, b).map((t) => `${t.term}:${t.meaning}`)).toEqual(['brave:용감한', 'bank:은행', 'bank:둑', 'calm:차분한']);
    // 노트에 더할 때는 있던 낱말은 그대로, 새 낱말만
    expect(addMissingTerms(a, b).map((t) => t.term)).toEqual(['brave', 'bank', 'calm']);
  });

  it('puts word-list examples back under the merged key points (AI never rewrites them)', () => {
    // 합친 노트: 조각 두 개의 'Day 1'·'Day 2' 가 이름을 조금 바꿔 남았고, 다른 조각의 개념이 끼었다
    const merged = {
      key_points: [
        { id: 'k1', title: 'Day 1 감정 낱말', explanation: 'brave, calm 을 배워요.' },
        { id: 'k2', title: '시제', explanation: '과거와 현재.' },
        { id: 'k3', title: 'Day 2', explanation: 'eager, fragile 을 배워요.' },
      ],
    };
    const partA = {
      key_points: [{ id: 'k1', title: 'Day 1' }],
      examples: [
        { text: 'She was brave.', key_point_id: 'k1' },
        { text: 'Stay calm.', key_point_id: 'k1' },
      ],
    };
    const partB = {
      // 조각마다 번호가 처음부터라 같은 'k1' 이 다른 개념이다
      key_points: [{ id: 'k1', title: '단원 2' }],
      examples: [
        { text: 'He is eager to learn.', key_point_id: 'k1' },
        { text: 'Stay calm.', key_point_id: 'k1' },
        { text: 'Nobody knows.', key_point_id: 'k7' },
      ],
    };
    const terms = [
      { term: 'brave', meaning: '용감한' },
      { term: 'calm', meaning: '차분한' },
      { term: 'eager', meaning: '열망하는' },
    ];
    const aiExamples = { key_points: merged.key_points, examples: [{ text: '어제 갔다 (과거)', key_point_id: 'k2' }], sameIds: true };
    const out = placeExamples([aiExamples, partA, partB], merged, terms);
    expect(out).toEqual([
      { text: '어제 갔다 (과거)', key_point_id: 'k2' },
      // 이름이 비슷한 개념으로
      { text: 'She was brave.', key_point_id: 'k1' },
      { text: 'Stay calm.', key_point_id: 'k1' },
      // 이름이 맞는 개념이 없으면 예문에 나온 낱말을 설명에 적은 개념으로
      { text: 'He is eager to learn.', key_point_id: 'k3' },
      // 붙일 곳이 없으면 '' (카드의 예문으로만)
      { text: 'Nobody knows.', key_point_id: '' },
    ]);
    // 지금 노트의 예문은 번호가 남아 있으면 그대로
    expect(placeExamples([{ key_points: [], examples: [{ text: 'x', key_point_id: 'k3', edited: true }], sameIds: true }], merged, [])).toEqual([
      { text: 'x', key_point_id: 'k3', edited: true },
    ]);
  });
});

describe('energy and answer length', () => {
  it('picking exam adds taking out the original questions; other types cost the same', () => {
    const m = { kind: 'pdf' as const, pages: 10 };
    const base = estimateEnergy(m, 'claude-haiku-5-5', 0.001);
    expect(estimateEnergy(m, 'claude-haiku-5-5', 0.001, { exam: true })).toBeGreaterThan(base);
    expect(estimateEnergy(m, 'claude-haiku-5-5', 0.001, { exam: false })).toBe(base);
  });

  it('room for long vocabulary lists only when vocab is possible', () => {
    expect(vocabHeadroom({ kind: 'pdf', pages: 2 }, 'auto')).toBe(1600);
    expect(vocabHeadroom({ kind: 'pdf', pages: 20 }, 'vocab')).toBe(6000);
    expect(vocabHeadroom({ kind: 'pdf', pages: 2 }, 'exam')).toBe(0);
    expect(problemsOutTokens({ kind: 'pdf', pages: 1 })).toBe(3500);
    expect(problemsOutTokens({ kind: 'pdf', pages: 5 })).toBe(9500);
    expect(problemsOutTokens({ kind: 'pdf', pages: 15 })).toBe(12000);
  });
});
