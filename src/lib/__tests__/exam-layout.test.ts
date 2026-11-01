import { describe, expect, it } from 'vitest';
import { choiceMark, examLayout, examStyle, examSummary, explainLines, questionFormat, type ExamBlock } from '@/lib/exam-layout';

/** 덩이를 읽기 쉬운 글로: stem: …, box[p:…|①:…|#head|label: …], bogi[…], text: … */
const show = (blocks: ExamBlock[]) =>
  blocks.map((b) =>
    b.kind === 'stem'
      ? `stem: ${b.text}`
      : b.kind === 'text'
        ? `text: ${b.text}`
        : b.kind === 'bogi'
          ? `bogi[${b.items.join(' | ')}]`
          : `box[${b.lines.map((l) => (l.kind === 'p' ? `p:${l.text}` : l.kind === 'step' ? `${l.mark}:${l.text}` : l.kind === 'head' ? `#${l.text}` : `${l.label}: ${l.text}`)).join(' | ')}]`,
  );

describe('시험지 덩이 (examLayout)', () => {
  it('지문 뒤 묻는 문장: 지문은 상자, 발문은 아래 (물음표가 있는 지문 문장은 발문이 아니다)', () => {
    const p =
      '안녕? 산으로 체험학습을 가야 하는데, 무엇을 주의해야 할까? ㉠ 산을 오를 때에는 혈당량이 낮아질 수 있고, 산 정상에 오랜 시간 머무르면 체온이 낮아질 수 있습니다. 따라서 에너지를 보충할 수 있는 간식을 준비하거나 기온 변화에 대비해 여벌 옷을 챙겨가는 것이 좋습니다. ㉠의 상황에서 항상성을 유지하기 위해 사람의 몸에서 일어나는 혈당량 조절 과정과 체온 조절 과정을 각각 1가지씩 설명하시오.';
    const l = examLayout(p, 'science');
    expect(show(l.blocks)).toEqual([
      'box[p:안녕? 산으로 체험학습을 가야 하는데, 무엇을 주의해야 할까? ㉠ 산을 오를 때에는 혈당량이 낮아질 수 있고, 산 정상에 오랜 시간 머무르면 체온이 낮아질 수 있습니다. 따라서 에너지를 보충할 수 있는 간식을 준비하거나 기온 변화에 대비해 여벌 옷을 챙겨가는 것이 좋습니다.]',
      'stem: ㉠의 상황에서 항상성을 유지하기 위해 사람의 몸에서 일어나는 혈당량 조절 과정과 체온 조절 과정을 각각 1가지씩 설명하시오.',
    ]);
    expect(l.ask).toMatch(/^㉠의 상황에서/);
    expect(l.label).toBeNull();
  });

  it('실험 과정: 원래 번호, ①②… 한 줄씩 (빈칸 (가)는 칸 안에, 뒤의 "⑦에서"는 칸이 아니다), 실험 결과는 따로 문단', () => {
    const p =
      '1-가-1) 플랑크톤 P가 빛이 있는 환경에서 세포가 팽창하여 해수면으로 상승한다는 가설과 P의 광합성 여부를 함께 검증하는 실험이다. 실험 과정은 ① 수조 A와 B에 해수를 가득 채운 후 빨대로 숨을 불어 넣는다. ② 크기가 동일한 P를 각각 수조에 넣고 바닥에 위치하는지 확인한 후 각 수조에 충분한 시간 동안 어둠 상자를 씌운다. ③ (가) ④ 30분 후 수조 A와 B에 있는 P의 깊이 및 크기 변화를 확인한다. ⑤ 수조 A와 B에서 P를 덜어내어 에탄올에 넣고 물 중탕한다. ⑥ 각 수조의 P를 받침 유리 위에 올려놓고 (나) ⑦ 거름종이로 여분의 용액을 제거하고 덮개 유리를 덮어 각 수조의 P를 현미경으로 관찰한다. 실험 결과는 수조 A의 P만 떠올랐고 크기가 B보다 크며, ⑦에서 수조 A의 P만 청람색으로 변했다. 빈칸 (가), (나)에 알맞은 실험 과정을 각각 설명하시오.';
    const l = examLayout(p, 'science');
    expect(l.label).toBe('1-가-1)');
    const [box, stem] = l.blocks;
    expect(stem).toEqual({ kind: 'stem', text: '빈칸 (가), (나)에 알맞은 실험 과정을 각각 설명하시오.' });
    expect(box.kind).toBe('box');
    const lines = box.kind === 'box' ? box.lines : [];
    expect(lines.map((x) => (x.kind === 'step' ? x.mark : x.kind))).toEqual(['p', '①', '②', '③', '④', '⑤', '⑥', '⑦', 'p']);
    expect(lines[0]).toEqual({
      kind: 'p',
      text: '플랑크톤 P가 빛이 있는 환경에서 세포가 팽창하여 해수면으로 상승한다는 가설과 P의 광합성 여부를 함께 검증하는 실험이다. 실험 과정은',
    });
    expect(lines[3]).toEqual({ kind: 'step', mark: '③', text: '(가)' });
    expect(lines[6]).toEqual({ kind: 'step', mark: '⑥', text: '각 수조의 P를 받침 유리 위에 올려놓고 (나)' });
    expect(lines[7]).toEqual({ kind: 'step', mark: '⑦', text: '거름종이로 여분의 용액을 제거하고 덮개 유리를 덮어 각 수조의 P를 현미경으로 관찰한다.' });
    expect(lines[8]).toEqual({ kind: 'p', text: '실험 결과는 수조 A의 P만 떠올랐고 크기가 B보다 크며, ⑦에서 수조 A의 P만 청람색으로 변했다.' });
  });

  it("'다음은 …이다.'로 시작하면 실제 시험처럼 발문이 위, 자료 상자, <보기> 상자", () => {
    const p =
      '다음은 사람의 혈당량 조절 과정을 나타낸 것이다. (가)는 혈당량이 높을 때, (나)는 혈당량이 낮을 때 일어나는 과정이다. 이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?\n<보기>\nㄱ. (가)에서 인슐린이 분비된다.\nㄴ. (나)에서 글루카곤이 분비된다.\nㄷ. 이자는 내분비샘이다.';
    expect(show(examLayout(p).blocks)).toEqual([
      'stem: 다음은 사람의 혈당량 조절 과정을 나타낸 것이다. 이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?',
      'box[p:(가)는 혈당량이 높을 때, (나)는 혈당량이 낮을 때 일어나는 과정이다.]',
      'bogi[ㄱ. (가)에서 인슐린이 분비된다. | ㄴ. (나)에서 글루카곤이 분비된다. | ㄷ. 이자는 내분비샘이다.]',
    ]);
  });

  it('짧은 문제는 예전처럼 한 덩이 (상자 없이)', () => {
    expect(show(examLayout('광합성이 일어나는 세포 소기관은?').blocks)).toEqual(['stem: 광합성이 일어나는 세포 소기관은?']);
    expect(show(examLayout('광합성은 빛 에너지를 이용한다. 광합성이 일어나는 세포 소기관은?').blocks)).toEqual([
      'stem: 광합성은 빛 에너지를 이용한다. 광합성이 일어나는 세포 소기관은?',
    ]);
    expect(show(examLayout('광합성은 ____에서 일어난다.').blocks)).toEqual(['stem: 광합성은 ____에서 일어난다.']);
    // OX: 지시 뒤의 짧은 문장은 글 그대로
    expect(show(examLayout('다음 설명이 맞으면 O, 틀리면 X를 고르시오. 광합성은 밤에 잘 일어난다.').blocks)).toEqual([
      'stem: 다음 설명이 맞으면 O, 틀리면 X를 고르시오.',
      'text: 광합성은 밤에 잘 일어난다.',
    ]);
  });

  it('새 꼴 (자료 줄들 → 빈 줄 → 발문): 머리 [실험 과정], 줄마다 ① 칸, 이름 붙은 줄', () => {
    const p =
      '[실험 과정]\n① 시험관에 녹말 용액을 넣는다.\n② 아이오딘 용액을 떨어뜨린다.\n[실험 결과]\n학생 A: 청람색으로 변했어요.\n\n이 실험에서 확인한 영양소는?';
    expect(show(examLayout(p).blocks)).toEqual([
      'box[#[실험 과정] | ①:시험관에 녹말 용액을 넣는다. | ②:아이오딘 용액을 떨어뜨린다. | #[실험 결과] | 학생 A: 청람색으로 변했어요.]',
      'stem: 이 실험에서 확인한 영양소는?',
    ]);
  });

  it('지시 → 지문 → 하위 문제 (1)(2)는 한 줄씩', () => {
    const p =
      '다음 글을 읽고 물음에 답하시오. 철수는 실험에서 빛의 세기를 바꾸며 광합성량을 측정하였다. 빛이 셀수록 광합성량이 늘다가 어느 순간부터 일정해졌다. (1) 이 실험의 조작 변인을 쓰시오. (2) 광합성량이 일정해진 까닭을 설명하시오.';
    expect(show(examLayout(p).blocks)).toEqual([
      'stem: 다음 글을 읽고 물음에 답하시오.',
      'box[p:철수는 실험에서 빛의 세기를 바꾸며 광합성량을 측정하였다. 빛이 셀수록 광합성량이 늘다가 어느 순간부터 일정해졌다.]',
      'stem: (1) 이 실험의 조작 변인을 쓰시오.\n(2) 광합성량이 일정해진 까닭을 설명하시오.',
    ]);
  });

  it("줄 없이 이어 쓴 'ㄱ. ㄴ. ㄷ.'도 보기 상자 (묻는 문장 뒤일 때만)", () => {
    expect(show(examLayout('옳은 것만을 <보기>에서 있는 대로 고른 것은? ㄱ. 가는 크다. ㄴ. 나는 작다. ㄷ. 다는 같다.').blocks)).toEqual([
      'stem: 옳은 것만을 <보기>에서 있는 대로 고른 것은?',
      'bogi[ㄱ. 가는 크다. | ㄴ. 나는 작다. | ㄷ. 다는 같다.]',
    ]);
    // 묻는 문장 앞의 ㄱ. ㄴ. 은 보기가 아니다
    expect(examLayout('자료: ㄱ. 가 ㄴ. 나 이에 대한 설명으로 옳은 것은?').blocks.some((b) => b.kind === 'bogi')).toBe(false);
  });

  it('코드 블록은 한 덩이 그대로 (코드 안의 줄바꿈·마침표에서 나누지 않는다)', () => {
    const p = '다음 코드를 실행한 결과로 옳은 것은?\n```python\nfor i in range(3):\n    print(i. real)\n```';
    const l = examLayout(p, 'code');
    expect(show(l.blocks)).toEqual(['stem: 다음 코드를 실행한 결과로 옳은 것은?', 'box[p:```python\nfor i in range(3):\n    print(i. real)\n```]']);
  });

  it('수학: (가)(나) 조건은 한 줄씩, 수식 안의 마침표는 문장 끝이 아니다', () => {
    const p = "다음 조건을 만족시키는 함수 $f(x)$에 대하여 $f(2)$의 값은? (가) $f(0)=1$ 이다. (나) 모든 실수 $x$에 대하여 $f'(x)=2x$ 이다.";
    expect(show(examLayout(p, 'math').blocks)).toEqual([
      'stem: 다음 조건을 만족시키는 함수 $f(x)$에 대하여 $f(2)$의 값은?',
      "box[(가):$f(0)=1$ 이다. | (나):모든 실수 $x$에 대하여 $f'(x)=2x$ 이다.]",
    ]);
    // 소수점 3.14 · 번호 '1.' 에서 나누지 않는다
    expect(show(examLayout('원주율을 3.14로 계산한다. 반지름이 2인 원의 넓이는?').blocks)).toEqual([
      'stem: 원주율을 3.14로 계산한다. 반지름이 2인 원의 넓이는?',
    ]);
  });

  it('영어 지문: 묻는 문장(영어)만 아래로', () => {
    const p = 'Tom went to the park with his dog. It started to rain, so they ran home quickly. Which is true about Tom?';
    expect(show(examLayout(p, 'english').blocks)).toEqual([
      'box[p:Tom went to the park with his dog. It started to rain, so they ran home quickly.]',
      'stem: Which is true about Tom?',
    ]);
  });
});

describe('정답·해설 줄 (explainLines)', () => {
  it("'이름: 내용'이 둘 넘으면 이름마다 한 줄", () => {
    expect(
      explainLines(
        '혈당량 조절: 혈당량이 낮아지면 이자에서 글루카곤이 분비되어 간에서 글리코젠이 포도당으로 분해되어 혈당량이 높아진다. 체온 조절: 체온이 낮아지면 근육이 떨려 열 발생량이 늘고 피부 근처 혈관이 수축해 열 방출량이 줄어 체온이 올라간다.',
      ),
    ).toEqual([
      { label: '혈당량 조절', text: '혈당량이 낮아지면 이자에서 글루카곤이 분비되어 간에서 글리코젠이 포도당으로 분해되어 혈당량이 높아진다.' },
      { label: '체온 조절', text: '체온이 낮아지면 근육이 떨려 열 발생량이 늘고 피부 근처 혈관이 수축해 열 방출량이 줄어 체온이 올라간다.' },
    ]);
  });

  it('(가)(나)·(1)(2)로 시작하는 문장, 이름 없는 문장은 앞 줄에 이어서', () => {
    expect(explainLines('(가) 빛을 비춘다. 30분 둔다. (나) 아이오딘 용액을 떨어뜨린다.')).toEqual([
      { label: '(가)', text: '빛을 비춘다. 30분 둔다.' },
      { label: '(나)', text: '아이오딘 용액을 떨어뜨린다.' },
    ]);
    expect(explainLines('(1) 빛의 세기 (2) 이산화 탄소 농도가 부족해서').length).toBe(1);
  });

  it('보통 해설은 그대로 한 문단, 이미 나뉜 줄은 줄마다, ①② 차례는 칸마다', () => {
    expect(explainLines('잎의 엽록체에서 광합성이 일어나요. 그래서 정답은 ③이에요.')).toEqual([
      { label: null, text: '잎의 엽록체에서 광합성이 일어나요. 그래서 정답은 ③이에요.' },
    ]);
    expect(explainLines('첫 줄\n\n둘째 줄')).toEqual([
      { label: null, text: '첫 줄' },
      { label: null, text: '둘째 줄' },
    ]);
    expect(explainLines('풀이 순서: ① 양변에 2를 더한다. ② 3으로 나눈다.').map((l) => l.label)).toEqual([null, '①', '②']);
  });
});

describe('과목마다 시험지 모양 (examStyle)', () => {
  it('과목 이름', () => {
    expect(examStyle({ subject: '생명과학' })).toBe('science');
    expect(examStyle({ subject: '통합과학' })).toBe('science');
    expect(examStyle({ subject: '국어' })).toBe('korean');
    expect(examStyle({ subject: '문법' })).toBe('korean');
    expect(examStyle({ subject: '영문법' })).toBe('english');
    expect(examStyle({ subject: '수학Ⅱ' })).toBe('math');
    expect(examStyle({ subject: '한국사' })).toBe('social');
    expect(examStyle({ subject: '정치와 법' })).toBe('social');
    expect(examStyle({ subject: '파이썬' })).toBe('code');
    expect(examStyle({ subject: '정보' })).toBe('code');
  });

  it('모르는 이름이면 노트의 자료 종류, 그다음 문제 글', () => {
    expect(examStyle({ subject: '소집면접', material: 'math' })).toBe('math');
    expect(
      examStyle({ subject: '기타', material: 'reading', text: '다음 시를 읽고 물음에 답하시오. 나 보기가 역겨워 가실 때에는 말없이 고이 보내 드리우리다.' }),
    ).toBe('korean');
    expect(examStyle({ text: 'Read the passage below and choose the best title for it. The passage is about trees.' })).toBe('english');
    expect(examStyle({ text: '```python\nprint(1)\n```' })).toBe('code');
    expect(examStyle({ text: '$x^2$ 와 $y^2$ 의 합은?' })).toBe('math');
    expect(examStyle({ text: '광합성이 일어나는 곳은?' })).toBe('general');
  });
});

describe('형식 이름 (questionFormat)', () => {
  it('단답은 답이 길거나 설명하라는 문제면 서술형', () => {
    expect(questionFormat({ type: 'short', prompt: '광합성이 일어나는 곳은?', answer: '엽록체' })).toEqual({ label: '단답형', descriptive: false });
    expect(
      questionFormat({ type: 'short', prompt: '혈당량 조절 과정을 설명하시오.', answer: '혈당량이 낮아지면 글루카곤이 분비되어 혈당량이 높아진다.' }),
    ).toEqual({ label: '서술형', descriptive: true });
    expect(questionFormat({ type: 'mcq', prompt: '', answer: 0 }).label).toBe('객관식');
    expect(questionFormat({ type: 'ox', prompt: '', answer: true }).label).toBe('OX');
    expect(questionFormat({ type: 'cloze', prompt: '', answer: 'a' }).label).toBe('빈칸');
    expect(choiceMark(0)).toBe('①');
    expect(choiceMark(4)).toBe('⑤');
  });
});

describe('접힌 목록 (examSummary)', () => {
  it('짧은 자료와 한 덩이인 발문은 그 덩이째 (흔한 발문만 보이지 않게)', () => {
    const s = examSummary(
      '그림은 식물 세포를 나타낸 것이다. 옳은 것만을 <보기>에서 있는 대로 고른 것은?\n\n<보기>\nㄱ. 엽록체에서 광합성이 일어난다.\nㄴ. 핵에는 유전 물질이 있다.',
      'science',
    );
    expect(s.ask).toBe('그림은 식물 세포를 나타낸 것이다. 옳은 것만을 <보기>에서 있는 대로 고른 것은?');
    expect(s.hint).toBe('ㄱ. 엽록체에서 광합성이 일어난다.');
  });

  it('자료 상자가 있으면 발문 뒤에 자료 첫머리 (길면 줄임)', () => {
    const s = examSummary(
      `학생 A: 광합성은 빛이 있어야 일어나요.\n학생 B: ${'그래서 밤에는 '.repeat(12)}일어나지 않아요.\n\n이에 대한 설명으로 옳은 것은?`,
      'science',
    );
    expect(s.ask).toBe('이에 대한 설명으로 옳은 것은?');
    expect(s.hint.startsWith('학생 A: 광합성은 빛이 있어야 일어나요. 학생 B: 그래서')).toBe(true);
    expect(s.hint.length).toBeLessThanOrEqual(80);
    expect(s.hint.endsWith('…')).toBe(true);
  });

  it('자료가 없는 한 줄 문제는 발문만, 하위 문제는 한 줄로', () => {
    expect(examSummary('광합성이 일어나는 세포 소기관은?')).toEqual({ ask: '광합성이 일어나는 세포 소기관은?', hint: '' });
    const sub = examSummary('다음 실험을 보고 물음에 답하시오. 수조 A에만 빛을 비추었다. (1) 기포가 나온 수조를 쓰시오. (2) 그 까닭을 설명하시오.', 'science');
    expect(sub.ask).not.toContain('\n');
    expect(sub.ask).toContain('(2) 그 까닭을 설명하시오.');
  });
});

describe('검토에서 찾은 것 (글을 잘못 나누지 않게)', () => {
  it('해설의 코드 블록·여러 줄 수식은 나누지 않고, 수식·코드·꾸미기가 든 말은 이름이 아니다', () => {
    const code = '다음과 같이 고친다.\n```python\nfor i in range(3):\n    print(i)\n```';
    expect(explainLines(code)).toEqual([{ label: null, text: code }]);
    const math = '식을 정리하면\n$$\nx = 1\n$$';
    expect(explainLines(math)).toEqual([{ label: null, text: math }]);
    expect(explainLines('$f: \\mathbb{R} \\to \\mathbb{R}$ 는 실수 함수다.')).toEqual([
      { label: null, text: '$f: \\mathbb{R} \\to \\mathbb{R}$ 는 실수 함수다.' },
    ]);
    expect(explainLines('`x: int = 3` 은 타입을 적은 것이다.')[0].label).toBeNull();
    expect(explainLines('**혈당량 조절**: 글루카곤이 나온다. **체온 조절**: 근육이 떨린다.').every((l) => l.label === null)).toBe(true);
  });

  it('영어: 의문사로 시작한 평서문은 묻는 문장이 아니고, 발문이 먼저인 지문 문제는 발문이 위에', () => {
    const p = '다음 글의 주제로 가장 적절한 것은?\n\nWhen people sleep, the brain sorts the memories of the day. What we learn is kept.';
    expect(show(examLayout(p, 'english').blocks)).toEqual([
      'stem: 다음 글의 주제로 가장 적절한 것은?',
      'box[p:When people sleep, the brain sorts the memories of the day. What we learn is kept.]',
    ]);
    // 이어 쓴 꼴도 같다
    const run = '다음 글의 주제로 가장 적절한 것은? When people sleep, the brain sorts the memories of the day. What we learn is kept.';
    expect(show(examLayout(run, 'english').blocks)[0]).toBe('stem: 다음 글의 주제로 가장 적절한 것은?');
    // 지문 속 물음표 문장보다 한국어 발문이 먼저
    const q = '다음 글의 요지로 가장 적절한 것은?\n\nWhy do we dream? Scientists think dreams help us remember.';
    expect(show(examLayout(q, 'english').blocks)[0]).toBe('stem: 다음 글의 요지로 가장 적절한 것은?');
    // 줄임말에서 문장을 끊지 않는다
    expect(examLayout('What time does Mr. Smith start work?', 'english').blocks).toEqual([{ kind: 'stem', text: 'What time does Mr. Smith start work?' }]);
  });

  it('보기를 가리키는 ①②, 밑줄 친 말의 번호, 빈칸 (가)는 칸으로 나누지 않는다', () => {
    expect(explainLines('광합성은 엽록체에서 일어난다. ①, ②는 세포 호흡에 대한 설명이다.')).toHaveLength(1);
    expect(explainLines('①과 ②는 옳고 ③은 틀렸다.')).toHaveLength(1);
    const underline = 'The book ① that I read ② were ③ very interesting to ④ me and ⑤ my friends.\n\n밑줄 친 부분 중 어법상 틀린 것은?';
    expect(show(examLayout(underline, 'english').blocks)[0]).toBe('box[p:The book ① that I read ② were ③ very interesting to ④ me and ⑤ my friends.]');
    const proof = '$n=k$일 때 성립한다고 가정하면 (가) 이므로 $n=k+1$일 때 (나) 이다.\n\n(가), (나)에 알맞은 것은?';
    expect(show(examLayout(proof, 'math').blocks)[0]).toBe('box[p:$n=k$일 때 성립한다고 가정하면 (가) 이므로 $n=k+1$일 때 (나) 이다.]');
    expect(show(examLayout('(가) 이므로 성립한다.\n\n(가)에 알맞은 식은?', 'math').blocks)[0]).toBe('box[p:(가) 이므로 성립한다.]');
    // 실험 과정·풀이 단계는 그대로 칸
    expect(explainLines('① 엽록체는 식물 세포에만 있다. ② 미토콘드리아는 두 세포 모두에 있다.').map((l) => l.label)).toEqual(['①', '②']);
  });

  it('줄 앞 괄호는 짝이 맞는 한글 이름일 때만 머리 (구간·태그는 글 그대로)', () => {
    expect(show(examLayout('[0, 1]에서 연속인 함수 $f$가 있다.\n\n$f(1)$의 값은?', 'math').blocks)[0]).toBe('box[p:[0, 1]에서 연속인 함수 $f$가 있다.]');
    expect(show(examLayout('<p>안녕</p> 을 화면에 그린다.\n\n무엇이 보이는가?', 'code').blocks)[0]).toBe('box[p:<p>안녕</p> 을 화면에 그린다.]');
    expect(show(examLayout('【자료】 기온이 오른다.\n\n이에 대한 설명으로 옳은 것은?').blocks)[0]).toBe('box[#【자료】 | p:기온이 오른다.]');
  });

  it('자료 → <보기> → 발문 꼴은 쓴 차례 그대로, 하위 문제 문단은 모두 발문, 이어 쓴 <보기>의 표시는 그대로', () => {
    const p =
      '다음은 사람의 혈당량 조절 과정을 나타낸 것이다.\n<보기>\nㄱ. 인슐린이 분비된다.\nㄴ. 글루카곤이 분비된다.\n\n이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?';
    const l = examLayout(p, 'science');
    expect(show(l.blocks)).toEqual([
      'text: 다음은 사람의 혈당량 조절 과정을 나타낸 것이다.',
      'bogi[ㄱ. 인슐린이 분비된다. | ㄴ. 글루카곤이 분비된다.]',
      'stem: 이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?',
    ]);
    expect(l.ask).toMatch(/^이에 대한 설명으로/);
    const sub = '철수는 빛의 세기를 바꾸며 광합성량을 측정하였다.\n\n(1) 조작 변인을 쓰시오.\n\n(2) 광합성량이 일정해진 까닭을 설명하시오.';
    expect(show(examLayout(sub, 'science').blocks)).toEqual([
      'box[p:철수는 빛의 세기를 바꾸며 광합성량을 측정하였다.]',
      'stem: (1) 조작 변인을 쓰시오.\n(2) 광합성량이 일정해진 까닭을 설명하시오.',
    ]);
    expect(show(examLayout('(1) 조작 변인을 쓰시오.\n\n(2) 까닭을 설명하시오.', 'science').blocks)).toEqual([
      'stem: (1) 조작 변인을 쓰시오.\n(2) 까닭을 설명하시오.',
    ]);
    const inline = '옳은 것만을 고른 것은? ㄱ) 인슐린은 혈당을 낮춘다. ㄴ) 글루카곤은 혈당을 높인다.';
    expect(examLayout(inline).blocks.find((b) => b.kind === 'bogi')).toEqual({
      kind: 'bogi',
      items: ['ㄱ) 인슐린은 혈당을 낮춘다.', 'ㄴ) 글루카곤은 혈당을 높인다.'],
    });
  });

  it('과목 모양은 글이 아닌 값에도 멈추지 않는다', () => {
    expect(examStyle({ subject: 3 as unknown as string, text: null })).toBe('general');
    expect(examStyle({ text: 12 as unknown as string })).toBe('general');
  });
});
