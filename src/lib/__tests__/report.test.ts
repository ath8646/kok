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
  reportReason,
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
    expect(lessonStepSnapshot(null, 0)).toBe('');
    const long = lessonSnapshot({ ...lesson, cards: Array.from({ length: 40 }, () => ({ ...lesson.cards[0], text: '가'.repeat(400) })) });
    expect(long.length).toBeLessThanOrEqual(REPORT_SNAPSHOT_MAX);
  });

  it('예전 DB 에 넣는 이유 글은 종류·결과를 붙여도 1000자 안', () => {
    const r = legacyReportReason('cover', '노트와 맞지 않아요', 'x'.repeat(3000));
    expect(r.startsWith('[표지 그림] 노트와 맞지 않아요')).toBe(true);
    expect(r).toContain('--- 신고한 결과 ---');
    expect(r.length).toBe(1000);
    expect(legacyReportReason('chat', '틀려요', null)).toBe('[채팅 답] 틀려요');
  });
});
