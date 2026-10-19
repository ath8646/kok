// AI 가 준 풀이(문제 그림·단계 풀이)를 검사해 저장할 모양으로 만든다 (서버·화면 공통)
import { normalizeFigure, normalizeSteps, readFigure, readSteps, type Figure, type Step } from './spec';

export type Solution = { figure: Figure | null; steps: Step[] };

/**
 * DB 칸 크기 한도(schema.sql: figure 32KB, steps 16KB)보다 넉넉히 작게.
 * jsonb 는 JSON 글보다 커진다 (그림처럼 칸 이름과 숫자가 많으면 1.8배쯤, 글이 대부분인 단계는 거의 같다)
 */
const FIGURE_BYTES = 14_000;
const STEPS_BYTES = 11_000;

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * 받은 풀이 → 저장할 풀이. 단계가 없으면 null.
 * figures 가 false 면 그림은 버리고 글 단계만 (무료 채팅). 그림이 너무 크면 그림만 빼고, 단계 글이 너무 길면 줄인다
 */
export function readSolution(raw: unknown, opts: { figures?: boolean } = {}): Solution | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { steps?: unknown; figure?: unknown };
  let figure = opts.figures === false ? null : normalizeFigure(r.figure);
  if (figure && bytes(figure) > FIGURE_BYTES) figure = null;
  let steps = normalizeSteps(r.steps, figure);
  if (!steps.length) return null;
  if (bytes(steps) > STEPS_BYTES) steps = steps.map((s) => ({ ...s, text: s.text.slice(0, 220) }));
  if (bytes(steps) > STEPS_BYTES) return null;
  return { figure, steps };
}

/** DB 에서 읽은 문제의 풀이 (없으면 null) */
export function solutionOf(q: { figure?: unknown; steps?: unknown }): Solution | null {
  const figure = readFigure(q.figure);
  const steps = readSteps(q.steps, figure);
  if (!steps.length && !figure) return null;
  return { figure, steps };
}

/** AI 에게 보여 줄 정답 (객관식은 번호와 보기) */
export function answerForPrompt(q: { type: string; choices: string[] | null; answer: unknown }): string {
  if (q.type === 'mcq') {
    const i = Number(q.answer);
    return `${i + 1}. ${q.choices?.[i] ?? ''}`;
  }
  if (q.type === 'ox') return q.answer ? 'O (true)' : 'X (false)';
  return String(q.answer ?? '');
}

/** 풀이를 만들 문제 목록 (AI 에게 보내는 모양) */
export function questionsForSolve(
  qs: Array<{ type: string; prompt: string; choices: string[] | null; answer: unknown; explanation: string }>,
  indexes?: number[],
): Array<{ index: number; type: string; prompt: string; choices: string[]; answer: string; explanation: string }> {
  const pick = indexes ?? qs.map((_, i) => i);
  return pick
    .filter((i) => i >= 0 && i < qs.length)
    .map((i) => {
      const q = qs[i];
      return { index: i, type: q.type, prompt: q.prompt, choices: q.choices ?? [], answer: answerForPrompt(q), explanation: q.explanation };
    });
}
