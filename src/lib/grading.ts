// 자동 채점 (AI 없이). 띄어쓰기·문장부호·대소문자 차이는 같은 답으로 본다.
// 다만 뜻을 바꾸는 기호(음수의 -, 소수점, 부등호, !=, ->, ++, -- …)가 다르면 같은 답이 아니다 (코드·수식 답).
// 기호만으로 된 답(->, //, <<)은 띄어쓰기만 빼고 글자 그대로 견준다. 답의 $수식$ 은 읽을 수 있는 글자로, `코드` 는 안의 글자로 본다.
import { plainMathText } from './richtext';

export type QuestionType = 'mcq' | 'ox' | 'cloze' | 'short';

export type GradableQuestion = {
  type: QuestionType;
  answer: unknown;
  accepted?: unknown;
};

export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s 　]+/g, '')
    .replace(/[.,!?;:'"`’“”‘()[\]{}<>·~\-_/\\。、！？「」『』]/g, '');
}

/** 띄어쓰기만 빼고 기호는 모두 남긴 것 (수식은 읽을 수 있는 글자로, 코드는 안의 글자로) */
function strictAnswer(s: string): string {
  return plainMathText(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/[\s 　]+/g, '');
}

/** 뜻을 바꾸는 기호들의 차례: 음수의 -, 소수점, 비교·대입·화살표·증감 연산 */
const MEANING = /(?<![\p{L}\p{N})\]])-(?=\d)|(?<=\d)\.(?=\d)|<=|>=|!=|==|->|=>|<<|>>|\+\+|--|[<>≤≥≠]/gu;
function meaningMarks(strict: string): string {
  return (strict.match(MEANING) ?? []).join(' ');
}

export type AutoGrade = {
  correct: boolean;
  /** 단답·빈칸에서 글자가 달라 AI에게 한 번 더 물어볼 만한 경우 */
  needsAi: boolean;
};

export function autoGrade(q: GradableQuestion, given: unknown): AutoGrade {
  if (q.type === 'mcq') {
    return { correct: typeof given === 'number' && given === Number(q.answer), needsAi: false };
  }
  if (q.type === 'ox') {
    return { correct: typeof given === 'boolean' && given === Boolean(q.answer), needsAi: false };
  }
  const text = typeof given === 'string' ? given : '';
  const gs = strictAnswer(text);
  if (!gs) return { correct: false, needsAi: false };
  const g = normalizeAnswer(plainMathText(text));
  const gm = meaningMarks(gs);
  const accepted = Array.isArray(q.accepted) ? q.accepted.filter((a): a is string => typeof a === 'string') : [];
  for (const a of [String(q.answer ?? ''), ...accepted]) {
    const as = strictAnswer(a);
    if (!as) continue;
    if (as === gs) return { correct: true, needsAi: false };
    // 기호만으로 된 답은 글자 그대로만, 나머지는 띄어쓰기·문장부호를 빼고 견주되 뜻을 바꾸는 기호는 같아야 한다
    const loose = normalizeAnswer(plainMathText(a));
    if (loose && loose === g && meaningMarks(as) === gm) return { correct: true, needsAi: false };
  }
  return { correct: false, needsAi: true };
}

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

/** 맞았는지와 걸린 시간으로 FSRS 평가를 자동으로 고른다 */
export function autoRating(type: QuestionType, correct: boolean, ms: number): Rating {
  if (!correct) return 1;
  const fast = type === 'mcq' || type === 'ox' ? 6000 : 10000;
  const slow = type === 'mcq' || type === 'ox' ? 20000 : 35000;
  if (ms <= fast) return 4;
  if (ms >= slow) return 2;
  return 3;
}
