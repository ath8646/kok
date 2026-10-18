// 자동 채점 (AI 없이). 띄어쓰기·문장부호·대소문자 차이는 같은 답으로 본다.

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
  const g = normalizeAnswer(text);
  if (!g) return { correct: false, needsAi: false };
  const accepted = Array.isArray(q.accepted) ? q.accepted.filter((a): a is string => typeof a === 'string') : [];
  const answers = [String(q.answer ?? ''), ...accepted].map(normalizeAnswer).filter(Boolean);
  if (answers.includes(g)) return { correct: true, needsAi: false };
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
