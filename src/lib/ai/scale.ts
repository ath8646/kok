// 자료 양에 따라 AI 가 만드는 양을 정한다 (정리의 개념 수 → 마인드맵 가지·문제·레슨은 개념 수를 따라간다).
// 한 조각(정리를 한 번에 하는 단위)의 양을 '쪽'으로 어림한다: PDF 는 쪽 수, 사진은 한 장을 한 쪽으로, 글은 약 1500자를 한 쪽으로.
// 서버(pipeline)와 화면(예상 에너지)이 같은 계산을 쓴다. 숫자를 바꾸면 scale.test.ts 도 같이.

export type PartSize = { kind: 'text' | 'pdf' | 'image'; pages?: number; images?: number; chars?: number };
export type Range = { min: number; max: number };

/** 노트 하나의 개념 수 끝 (normalizeNote·합치기·더하기 모두) */
export const KEY_POINTS_MAX = 24;
/** 한 조각에서 뽑는 개념 수 끝 (조각은 PDF 15쪽·사진 6장·글 4만 자까지) */
export const KEY_POINTS_PER_PART_MAX = 16;
/** 글 몇 자를 한 쪽으로 볼지 */
export const CHARS_PER_PAGE = 1500;
/** 노트에 남길 문제 수 끝 (개념마다 두세 개까지) */
export const QUESTIONS_MAX = 80;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 조각의 양을 쪽 수로 (글 자료에 문서 속 그림이 있으면 그림 하나를 반 쪽으로 더한다) */
export function pageWeight(p: PartSize): number {
  if (p.kind === 'pdf') return Math.max(1, p.pages ?? 1);
  if (p.kind === 'image') return Math.max(1, p.images ?? 1);
  return Math.max(0.5, (p.chars ?? 0) / CHARS_PER_PAGE + (p.images ?? 0) * 0.5);
}

/**
 * 한 조각에서 뽑을 개념 수: 한 쪽 3~5개부터 쪽마다 늘어 15쪽이면 13~16개.
 * (w=1: 3~5, 2: 4~6, 4: 5~8, 6: 7~9, 8: 8~11, 10: 10~13, 15: 13~16)
 */
export function keyPointRange(p: PartSize): Range {
  const w = pageWeight(p);
  const min = clamp(Math.round(2.5 + 0.7 * w), 3, KEY_POINTS_PER_PART_MAX - 3);
  const max = clamp(Math.round(4.5 + 0.8 * w), min + 2, KEY_POINTS_PER_PART_MAX);
  return { min, max };
}

/** 조각 여러 개를 합친 노트의 개념 수: 조각들의 합(겹치는 것을 묶으니 아래는 조금 적게), 노트 끝까지 */
export function mergedKeyPointRange(parts: Range[]): Range {
  if (!parts.length) return { min: 3, max: 7 };
  const min = clamp(Math.round(parts.reduce((a, r) => a + r.min, 0) * 0.7), 3, KEY_POINTS_MAX - 4);
  const max = clamp(
    parts.reduce((a, r) => a + r.max, 0),
    min + 2,
    KEY_POINTS_MAX,
  );
  return { min, max };
}

/** 노트에 자료를 더할 때 개념 수의 끝: 지금 개념은 모두 지키고 새 자료만큼 늘어날 수 있다 */
export function appendKeyPointMax(current: number, parts: Range[]): number {
  const grow = parts.reduce((a, r) => a + r.max, 0);
  return clamp(current + grow, Math.max(9, current), Math.max(current, KEY_POINTS_MAX));
}

/** 정리 답 길이의 끝 (토큰): 이보다 길면 한 번에 끝나지 않을 수 있어 개념을 줄여 다시 정리한다 (pipeline stepOrganize) */
export const NOTE_OUT_MAX = 20_000;

/**
 * 정리 답의 길이(토큰): 개념 하나에 약 520토큰(설명·왜 중요한지·용어·함정·예시 몫, 한국어 JSON 은 생각보다 길다), 바탕 3500, 그림마다 400.
 * 답은 쓴 만큼만 낸다 (한도일 뿐이라 요금은 그대로)
 */
export function noteOutTokens(maxKeyPoints: number, figures = 0): number {
  return Math.min(NOTE_OUT_MAX, 3500 + maxKeyPoints * 520 + figures * 400);
}

/**
 * AI 한 번을 기다리는 시간 (ms): 답이 길수록 길게 (느린 모델은 초당 약 70~80토큰 + 자료를 읽는 시간), 60초 ~ 240초.
 * 부르는 쪽은 남은 시간(서버 함수 300초)보다 짧게 자른다
 */
export function aiWaitMs(maxTokens: number): number {
  return Math.round(Math.min(240_000, Math.max(60_000, 30_000 + maxTokens * 13)));
}

/**
 * 정리 답에 더하는 길이(토큰): 단어장이면 용어가 자료의 낱말 수만큼 늘어난다 (한 쪽에 약 800토큰, 6000까지).
 * 학생이 단어장이 아닌 종류를 골랐으면 0. 답 길이는 한도일 뿐이라(쓴 만큼만 낸다) 다른 자료의 요금은 그대로다
 */
export function vocabHeadroom(p: PartSize, pick: string): number {
  if (pick !== 'auto' && pick !== 'vocab') return 0;
  return Math.min(6000, Math.round(pageWeight(p) * 800));
}

/**
 * 원래 문제를 한 번에 꺼내는 양(쪽): 기출 조각을 이만큼씩 나눠 꺼낸다 (지문을 문제마다 옮겨 적어 답이 길어지니,
 * 한 번에 다 꺼내면 답이 잘리거나 오래 걸린다). 그래도 잘리면 그 부분을 반으로 나눠 다시 (pipeline stepProblems)
 */
export const PROBLEM_PAGES_PER_CALL = 5;

/** 조각 하나를 몇 번에 나눠 꺼낼지 (units: 그 조각의 쪽·사진 수. 글은 제한 없음) */
export function problemPieces(p: PartSize, units = Infinity): number {
  return clamp(Math.ceil(pageWeight(p) / PROBLEM_PAGES_PER_CALL), 1, Math.max(1, units));
}

/** 원래 문제 꺼내기 답의 길이(토큰): 한 쪽에 문제 너덧 개 (지문을 옮겨 적은 문제는 길다) */
export function problemsOutTokens(p: PartSize): number {
  return clamp(Math.round(2000 + pageWeight(p) * 1500), 3500, 12_000);
}

/** 문제 답의 길이(토큰): 개념 하나에 문제 두세 개, 문제 하나에 약 160토큰 */
export function quizOutTokens(keyPoints: number, figures = 0): number {
  return Math.min(16_000, 2500 + keyPoints * 480 + figures * 200);
}

/** 레슨 수: 개념 하나나 둘에 레슨 하나, 단계는 레슨 3개쯤마다 (개념 5개: 2~3단계·4~6레슨, 12개: 3~5단계·8~12레슨, 24개: 5~6단계·14~24레슨) */
export function coursePlanRange(keyPoints: number): { units: Range; lessons: Range } {
  const k = Math.max(1, keyPoints);
  const lessons = { min: clamp(Math.ceil(k * 0.6), 2, 24), max: clamp(k, 3, 24) };
  const units = { min: clamp(Math.ceil(lessons.min / 3), 2, 6), max: clamp(Math.ceil(lessons.max / 3), 2, 6) };
  return { units, lessons };
}
