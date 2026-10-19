// 채팅에서 AI 가 풀어 준 문제 읽기 (서버·시험 공통, 화면 코드는 쓰지 않는다)
import { toQuestionRow, zQuizItem, type ChatSolutionRaw } from '@/lib/ai/schemas';
import { CIRCLED, type ChatAttachmentMeta, type ChatQuestion, type ChatSolution } from '@/lib/chat';
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

/** 답 글에서 '정답은 ②번'·'답은 3번'처럼 정답이라고 한 보기 번호 (1부터). '답은 1이에요' 같은 값은 보지 않는다 */
export function claimedChoice(reply: string): number | null {
  const m = reply.match(/(?:정답|답)\s*(?:은|는|이|:)?\s*(?:바로\s*)?(?:([①-⑩])|(\d{1,2})\s*번)/);
  if (!m) return null;
  return m[1] ? CIRCLED.indexOf(m[1]) + 1 : Number(m[2]);
}

/**
 * AI 답 글 마무리: 꾸밈 기호(굵게·제목)를 걷어 내고, 비었으면 알려 준다. 풀이(노트에 넣을 객관식 문제)의 정답과 다른 보기를
 * 정답이라고 하면 단계를 끝까지 푼 풀이를 믿고 답 글을 고친다 (답 글과 단계가 서로 다른 답을 말하지 않게)
 */
export function finishReply(raw: string, solution: ChatSolution | null): string {
  const reply =
    raw
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .trim()
      .slice(0, 8000) || (solution ? '풀이를 정리했어요.' : '답을 만들지 못했어요. 다시 물어봐 주세요.');
  const q = solution?.question;
  if (!q || q.type !== 'mcq' || typeof q.answer !== 'number' || !q.choices?.[q.answer]) return reply;
  const claimed = claimedChoice(reply);
  if (claimed === null || claimed === q.answer + 1) return reply;
  const mark = CIRCLED[q.answer] ?? String(q.answer + 1);
  return `정답은 ${mark}번이에요 (${q.choices[q.answer]}). 아래 단계별 풀이를 확인해 보세요.`;
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
