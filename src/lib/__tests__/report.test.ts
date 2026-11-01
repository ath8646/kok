import { describe, expect, it } from 'vitest';
import type { ChatSolution } from '@/lib/chat';
import type { CourseLesson } from '@/lib/course';
import type { CoverV2 } from '@/lib/cover';
import {
  REPORT_HARMFUL,
  REPORT_KINDS,
  REPORT_REASONS,
  REPORT_SNAPSHOT_MAX,
  chatSnapshot,
  coverSnapshot,
  legacyReportReason,
  lessonSnapshot,
  lessonStepSnapshot,
  questionSnapshot,
  reportReason,
  reportTextProblem,
  storedChatSolution,
} from '@/lib/report';

const solution: ChatSolution = {
  problem: '$x^2-5x+6=0$ 을 풀어라',
  steps: [
    { text: '인수분해하면 $(x-2)(x-3)=0$', add: [], focus: [] },
    { text: '그래서 $x=2$ 또는 $x=3$', add: [], focus: [] },
  ],
  figure: null,
  question: {
    type: 'mcq',
    prompt: '해는?',
    choices: ['1, 6', '2, 3', '-2, -3'],
    answer: 1,
    accepted: [],
    explanation: '',
    difficulty: 'easy',
    pages: [],
    key_point_id: '',
  },
  subject: '수학',
  unit: '',
};

describe('신고 (lib/report.ts)', () => {
  it('종류마다 고를 이유가 있고, 해로운 내용은 늘 맨 끝에 있다', () => {
    for (const k of REPORT_KINDS) {
      expect(REPORT_REASONS[k].length).toBeGreaterThanOrEqual(3);
      expect(REPORT_REASONS[k].at(-1)).toBe(REPORT_HARMFUL);
    }
  });

  it('고른 이유와 적은 말을 한 줄로 (1000자 안)', () => {
    expect(reportReason('틀린 내용이 있어요', '')).toBe('틀린 내용이 있어요');
    expect(reportReason('틀린 내용이 있어요', ' 3단계 ')).toBe('틀린 내용이 있어요: 3단계');
    expect(reportReason(null, '그냥 이상해요')).toBe('그냥 이상해요');
    expect(reportReason(null, '   ')).toBe('');
    expect(reportReason('a', 'x'.repeat(2000)).length).toBe(1000);
  });

  it('채팅 답: 물어본 말·답·풀이 단계·정답', () => {
    const s = chatSnapshot({ question: '이거 풀어 줘', reply: '정답은 ② 2, 3이에요.', solution });
    expect(s).toContain('학생: 이거 풀어 줘');
    expect(s).toContain('AI: 정답은');
    expect(s).toContain('1단계: 인수분해하면');
    expect(s).toContain('정답: ② 2, 3');
    expect(chatSnapshot({ reply: 'x'.repeat(9000) }).length).toBe(REPORT_SNAPSHOT_MAX);
  });

  it('저장된 풀이는 모양이 맞을 때만 읽는다', () => {
    expect(storedChatSolution(null)).toBeNull();
    expect(storedChatSolution({ steps: 'no' })).toBeNull();
    const read = storedChatSolution({ problem: 'p', steps: [{ text: 'a' }, { nope: 1 }, null], question: { type: 'ox', prompt: 'q', answer: false } });
    expect(read?.steps.map((s) => s.text)).toEqual(['a']);
    expect(chatSnapshot({ reply: 'r', solution: read })).toContain('정답: X');
    expect(storedChatSolution({ steps: [], question: { bad: true } })?.question).toBeNull();
  });

  it('표지 그림: 모양과 글 (비교는 쪽 이름도)', () => {
    const c: CoverV2 = {
      v: 2,
      kind: 'compare',
      title: '',
      left: '동물 세포',
      right: '식물 세포',
      items: [
        { text: '세포벽 없음', sub: '', key: false, side: 'left' },
        { text: '엽록체', sub: '광합성', key: true, side: 'right' },
      ],
      figure: null,
      alt: '동물 세포와 식물 세포 비교',
    };
    const s = coverSnapshot('세포', c);
    expect(s).toContain('모양: compare');
    expect(s).toContain('- [동물 세포] 세포벽 없음');
    expect(s).toContain('- [식물 세포] 엽록체 (광합성) ★');
    expect(coverSnapshot('세포', null)).toContain('표지가 없어요');
  });

  it('레슨: 카드·문제를 다 담고, 보던 칸은 따로', () => {
    const lesson: CourseLesson = {
      title: '명반응',
      goal: '빛으로 무엇을 만드는지 안다',
      key_point_ids: ['k1'],
      cards: [{ kind: 'concept', heading: '틸라코이드', text: '빛을 받아요', tip: '' }],
      checks: [{ type: 'mcq', prompt: '어디서?', choices: ['틸라코이드', '스트로마'], answer: 0, accepted: [], explanation: '빛을 받는 곳' }],
    };
    const s = lessonSnapshot(lesson);
    expect(s).toContain('레슨: 명반응');
    expect(s).toContain('카드 1: 틸라코이드 / 빛을 받아요');
    expect(s).toContain('문제 1: 어디서? 보기: 1) 틸라코이드 2) 스트로마 → 정답 1번');
    expect(lessonStepSnapshot({ kind: 'check', check: lesson.checks[0] }, 1)).toMatch(/^보던 칸 2 \(문제\)/);
    // 레슨 화면은 보기를 섞는다: 보던 칸의 번호는 화면에 보인 차례 (학생이 '2번'이라고 쓰면 그 보기)
    expect(lessonStepSnapshot({ kind: 'check', check: lesson.checks[0], order: [1, 0] }, 1)).toContain('보기(화면 차례): 1) 스트로마 2) 틸라코이드 → 정답 2번');
    expect(lessonStepSnapshot(null, 0)).toBe('');
    const long = lessonSnapshot({ ...lesson, cards: Array.from({ length: 40 }, () => ({ ...lesson.cards[0], text: '가'.repeat(400) })) });
    expect(long.length).toBeLessThanOrEqual(REPORT_SNAPSHOT_MAX);
    // 짝 맞추기·순서 맞추기·낱말 고르기 빈칸
    const more = lessonSnapshot({
      ...lesson,
      checks: [
        { type: 'match', prompt: '짝지어요', choices: null, answer: '', accepted: [], explanation: '', pairs: [{ left: '틸라코이드', right: '명반응' }] },
        { type: 'order', prompt: '차례대로', choices: ['빛', '물 분해', 'ATP'], answer: '', accepted: [], explanation: '' },
        { type: 'cloze', prompt: '____에서 빛을 받아요', choices: ['틸라코이드', '스트로마', '기공'], answer: '틸라코이드', accepted: [], explanation: '' },
      ],
    });
    expect(more).toContain('문제 1: 짝지어요 짝: 틸라코이드 = 명반응');
    expect(more).toContain('문제 2: 차례대로 바른 차례: 빛 → 물 분해 → ATP');
    expect(more).toContain('고를 낱말: 1) 틸라코이드 2) 스트로마 3) 기공 → 정답 틸라코이드');
  });

  it('예전 DB 에 넣는 이유 글은 종류·결과를 붙여도 1000자 안', () => {
    const r = legacyReportReason('cover', '노트와 맞지 않아요', 'x'.repeat(3000));
    expect(r.startsWith('[표지 그림] 노트와 맞지 않아요')).toBe(true);
    expect(r).toContain('--- 신고한 결과 ---');
    expect(r.length).toBe(1000);
    expect(legacyReportReason('chat', '틀려요', null)).toBe('[채팅 답] 틀려요');
  });
});

describe('문제 신고: 보낼 글 검사·문제 모습', () => {
  it('이유 칩만·보통 글은 보낸다 (공부 글의 비슷한 말은 막지 않는다)', () => {
    for (const ok of [
      '정답이 틀렸어요',
      '정답이 틀렸어요: ②가 아니라 ③이에요',
      '해설이 틀렸어요: 씨 발아 실험에서 빛은 필요 없어요',
      '문제나 보기가 이상해요: 전쟁이 영향을 미친 년도가 틀려요',
      '불이 꺼져요가 아니라 꺼지지 않아요',
      'ㄱ, ㄴ, ㄷ, ㄹ, ㅁ, ㅂ, ㅅ 순서가 틀렸어요',
      '시발점이 틀렸어요',
      'this hit is wrong',
      'ㄱㄴ',
      // 검토에서 찾은 것: 국어·과학·코딩 공부 글, 기호·숫자 정답
      '겹받침 ㅄ은 [ㅂ]으로 발음해요',
      '초성이 ㅈㄹ 이면 지리예요',
      '씨발아 실험에서 온도가 틀렸어요',
      '씨(발아 조건)이 빠졌어요',
      '씨-발아에 필요한 조건이 틀렸어요',
      '정답이 틀렸어요: ->',
      '정답이 틀렸어요: !=',
      '정답이 틀렸어요: ≥',
      '정답이 틀렸어요: 1111',
      '정답이 틀렸어요: ㄱ, ㄴ, ㄷ, ㄹ',
      'ㄱ, ㄴ, ㄷ, ㄹ',
      '0000 이 아니라 0001 이에요',
      'java.io 패키지가 아니라 java.nio 예요',
      'android.app 을 import 해야 해요',
      'System.Net 이 아니라 System.IO 예요',
      'ASP.NET 버전이 틀렸어요',
      'A@B.T 는 행렬 곱이에요',
      '정답은 1000000000 이에요',
    ])
      expect(reportTextProblem(ok), ok).toBeNull();
  });

  it('흔한 우회도 막는다 (+82·띄어 쓴 번호·별표 욕설·비슷한 소리)', () => {
    expect(reportTextProblem('+82 10-1234-5678 로 연락 주세요')).toMatch(/개인정보/);
    expect(reportTextProblem('010 - 1234 - 5678')).toMatch(/개인정보/);
    expect(reportTextProblem('f*ck 이게 뭐야')).toMatch(/고운 말/);
    expect(reportTextProblem('씌발 틀렸네')).toMatch(/고운 말/);
    expect(reportTextProblem('naver.com 에 정답 있어요')).toMatch(/링크/);
    expect(reportTextProblem('?!?!?!')).toMatch(/글로/);
    expect(reportTextProblem('XXXX')).toMatch(/알아볼 수 있게/);
  });

  it('링크·개인정보·욕설·알아볼 수 없는 글은 막고 고칠 말을 준다', () => {
    expect(reportTextProblem('정답이 틀렸어요: https://example.com 참고')).toMatch(/링크/);
    expect(reportTextProblem('www.naver.com 보세요')).toMatch(/링크/);
    expect(reportTextProblem('010-1234-5678로 연락 주세요')).toMatch(/개인정보/);
    expect(reportTextProblem('me@example.com')).toMatch(/개인정보/);
    expect(reportTextProblem('이거 씨1발 뭐야')).toMatch(/고운 말/);
    expect(reportTextProblem('ㅅㅂ 틀렸네')).toMatch(/고운 말/);
    expect(reportTextProblem('what the fuck')).toMatch(/고운 말/);
    expect(reportTextProblem('정답이 틀렸어요: ?!?!?!')).toMatch(/글로/);
    expect(reportTextProblem('->')).toMatch(/글로/);
    expect(reportTextProblem('ㅋㅋㅋㅋㅋㅋ')).toMatch(/알아볼 수 있게/);
    expect(reportTextProblem('ㅁㄴㅇㄹ')).toMatch(/알아볼 수 있게/);
    expect(reportTextProblem('aaaaaa')).toMatch(/알아볼 수 있게/);
  });

  it('문제 신고의 이유와 문제 모습 (운영자가 읽는다)', () => {
    expect(REPORT_KINDS).toContain('question');
    expect(REPORT_REASONS.question.at(-1)).toBe(REPORT_HARMFUL);
    const s = questionSnapshot({ type: 'mcq', prompt: '광합성이 일어나는 곳은?', choices: ['뿌리', '잎'], answer: 1, explanation: '잎의 엽록체' });
    expect(s).toBe('문제(mcq): 광합성이 일어나는 곳은?\n보기: 1) 뿌리 2) 잎\n정답: 2번 (잎)\n해설: 잎의 엽록체');
    expect(questionSnapshot({ type: 'ox', prompt: 'p', choices: null, answer: false })).toContain('정답: X');
    expect(questionSnapshot({ type: 'short', prompt: 'x'.repeat(5000), choices: null, answer: 'a' }).length).toBeLessThanOrEqual(REPORT_SNAPSHOT_MAX);
  });
});
