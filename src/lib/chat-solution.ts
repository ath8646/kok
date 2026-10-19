// 채팅에서 AI 가 풀어 준 문제 읽기 (서버·시험 공통, 화면 코드는 쓰지 않는다)
import { toQuestionRow, zQuizItem, type ChatSolutionRaw } from '@/lib/ai/schemas';
import type { ChatAttachmentMeta, ChatQuestion, ChatSolution } from '@/lib/chat';
import { readSolution } from '@/lib/figure/solution';

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

/**
 * AI 가 준 풀이 → 저장·화면에 쓸 풀이 (풀지 않았거나 단계가 없으면 null).
 * figures: 그림도 남기는지 (Pro). 노트에 넣을 문제는 쓸 수 있는 유형·모양일 때만 (아니면 null)
 */
export function readChatSolution(raw: ChatSolutionRaw | undefined, opts: { figures: boolean }): ChatSolution | null {
  if (!raw || !raw.include) return null;
  const sol = readSolution(raw, { figures: opts.figures });
  if (!sol) return null;
  let question: ChatQuestion | null = null;
  const item = zQuizItem.safeParse(raw.question);
  const row = item.success ? toQuestionRow(item.data) : null;
  if (row) question = { ...row, pages: [] };
  return {
    problem: clip(raw.problem, 2000),
    steps: sol.steps,
    figure: sol.figure,
    question,
    subject: clip(raw.subject, 20),
    unit: clip(raw.unit, 20),
  };
}

/** 대화 기록 한 줄 (AI 에 보낼 때): 붙인 파일은 이름만, 푼 문제는 읽은 문제를 덧붙여 다음 질문이 이어지게 */
export function historyLine(
  m: { role: string; content: string; attachments?: ChatAttachmentMeta[] | null; solution?: ChatSolution | null },
  max = 1500,
): string {
  const files = (m.attachments ?? []).map((a) => `[${a.kind === 'image' ? '사진' : a.kind === 'pdf' ? 'PDF' : '글 파일'}: ${a.name}]`).join(' ');
  const problem = m.solution?.problem ? `\n(풀이한 문제: ${m.solution.problem.slice(0, 600)})` : '';
  return `${files ? `${files} ` : ''}${m.content}`.slice(0, max) + problem;
}
