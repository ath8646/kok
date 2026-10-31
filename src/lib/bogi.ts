// 문제 글의 <보기> 상자 (실제 시험처럼): '<보기>' 한 줄 다음의 줄들(빈 줄 전까지)을 상자 안에 그린다 (시험 bogi.test.ts).
// AI 문제(quizPrompt 의 <보기> 꼴)와 자료에서 꺼낸 원래 문제가 같이 쓴다. 상자 뒤에 글이 더 있으면 상자 아래에 이어서
export type BogiParts = { before: string; items: string[]; after: string };

/** '<보기>'·'〈보기〉'·'[보기]'·'(보기)' 한 줄 */
const MARK = /^\s*[<〈［[(（]\s*보\s*기\s*[>〉］\])）]\s*$/;

export function splitBogi(prompt: string): BogiParts | null {
  const lines = prompt.split('\n');
  const at = lines.findIndex((l) => MARK.test(l));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && lines[end].trim()) end++;
  const items = lines.slice(at + 1, end).map((l) => l.trim());
  if (!items.length) return null;
  return { before: lines.slice(0, at).join('\n').trimEnd(), items, after: lines.slice(end).join('\n').trim() };
}
