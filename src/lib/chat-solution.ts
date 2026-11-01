// 채팅에서 AI 가 풀어 준 문제 읽기 (서버·시험 공통, 화면 코드는 쓰지 않는다).
// 사진·파일에 문제가 여럿이면 문제마다(꼬리 문제도 하나씩) 풀이가 하나씩 온다: readChatAnswers
import { readChatQuestion, toQuestionRow, zChatFigure, type ChatSolutionRaw } from '@/lib/ai/schemas';
import { josa } from '@/lib/josa';
import {
  CHAT_SOLUTIONS_MAX,
  CIRCLED,
  solutionList,
  solvedLine,
  type ChatAttachmentMeta,
  type ChatQuestion,
  type ChatSolution,
  type StoredChatSolution,
} from '@/lib/chat';
import {
  claimedIndex,
  claimIn,
  compareText,
  copulaFor,
  finalClaim,
  judgeClaim,
  listedChoices,
  mentionsAnswer,
  readOx,
  readSolution,
  type AnswerClaim,
  type AnswerKey,
} from '@/lib/figure/solution';

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

/**
 * AI 가 준 풀이 → 저장·화면에 쓸 풀이 (풀지 않았거나 단계가 없으면 null).
 * 첫 호출의 풀이는 글로 된 단계뿐이다 (그림은 Pro 에서 두 번째 호출로: withChatFigure).
 * figures: 그림도 남기는지 (Pro). 노트에 넣을 문제는 쓸 수 있는 유형·모양일 때만 (아니면 null)
 */
export function readChatSolution(raw: ChatSolutionRaw | undefined, opts: { figures: boolean }): ChatSolution | null {
  if (!raw || raw.include === false) return null;
  const sol = readSolution(raw, { figures: opts.figures });
  if (!sol) return null;
  let question: ChatQuestion | null = null;
  const item = readChatQuestion(raw.question);
  const row = item ? toQuestionRow(item) : null;
  if (row) question = { ...row, pages: [] };
  return {
    label: clip(raw.label, 24),
    problem: clip(raw.problem, 2000),
    steps: sol.steps,
    figure: sol.figure,
    question,
    subject: clip(raw.subject, 20),
    unit: clip(raw.unit, 20),
  };
}

/**
 * 두 번째 호출이 준 그림(chatFigureJsonSchema)을 풀이에 붙인다: 단계 글은 그대로, 단계마다 add·focus 를 번호(index)로 맞춘다.
 * 그림이 없거나(include false) 그릴 것이 없으면 풀이를 그대로 돌려준다
 */
export function withChatFigure(sol: ChatSolution, raw: unknown): ChatSolution {
  const parsed = zChatFigure.safeParse(raw);
  if (!parsed.success) return sol;
  const byIndex = new Map(parsed.data.steps.map((s) => [s.index, s]));
  const steps = sol.steps.map((s, i) => ({ text: s.text, add: byIndex.get(i)?.add ?? [], focus: byIndex.get(i)?.focus ?? [] }));
  const read = readSolution({ steps, figure: parsed.data.figure }, { figures: true });
  if (!read || !read.figure || read.steps.length !== sol.steps.length) return sol;
  return { ...sol, steps: read.steps, figure: read.figure };
}

/** 답 글에서 '정답은 ②번'·'답은 3번'처럼 정답이라고 한 보기 번호 (1부터). '답은 1이에요' 같은 값은 보지 않는다 */
export function claimedChoice(reply: string): number | null {
  return claimIn(reply)?.choice ?? null;
}

/** 단계 풀이와 넣을 문제를 맞춰 본 결과. ref: 답 글이 말해야 할 답 (모르면 null) */
export type SettledSolution = { solution: ChatSolution; ref: AnswerKey | null; check: 'none' | 'fixed' | 'dropped' };

/**
 * 단계 풀이와 넣을 문제(solution.question)의 정답 맞춰 보기. 마지막 단계가 분명히 말한 답만 본다 (finalClaim).
 * - 마지막 단계에서 답을 읽을 수 없거나 정답과 같으면(또는 같은지 알 수 없으면) 그대로 둔다.
 * - 객관식에서 마지막 단계가 있는 보기 하나를 가리키면(번호를 말했고 같이 말한 값이 그 보기와 맞거나, '정답은 값'이 보기 하나와 같으면)
 *   단계를 끝까지 푼 쪽을 믿고 넣을 문제의 정답을 그 보기로 고친다 ('fixed'). 단 원래 정답을 받쳐 주는 것이 있으면 고치지 않는다:
 *   답 글이 원래 정답을 말할 때, 해설이 다른 답을 말하거나 고칠 보기가 아닌 원래 보기의 값만 말할 때,
 *   읽은 문제(problem)에 ①부터 적힌 그 번호의 보기가 넣을 문제의 보기와 다를 때(번호가 어긋났을 수 있다).
 * - 그 밖에 정답과 분명히 다르면(O/X·단답·빈칸, 번호 없이 마무리 문장의 값만 다를 때, 어느 보기인지 하나로 정할 수 없을 때)
 *   넣을 문제를 뺀다 ('dropped'): 틀린 정답이 노트에 들어가지 않게. 답 글은 단계 끝의 답에 맞추고 한 번 더 확인해 보라고 덧붙인다 (finishReply).
 * rawSteps: AI 가 준 그대로의 단계 (길어서 잘리기 전의 마지막 단계를 보려고. 없으면 solution.steps). reply: AI 답 글
 */
export function settleSolution(sol: ChatSolution, rawSteps: unknown = sol.steps, reply = ''): SettledSolution {
  const claim = finalClaim(rawSteps);
  const q = sol.question;
  if (!claim) return { solution: sol, ref: q, check: 'none' };
  if (!q) return { solution: sol, ref: stepKey(claim, null), check: 'none' };
  if (judgeClaim(claim, q) !== 'differ') return { solution: sol, ref: q, check: 'none' };
  if (q.type === 'mcq' && q.choices && (claim.choice !== null || claim.explicit)) {
    const i = claimedIndex(claim, q.choices);
    if (i !== null && canFix(sol, q, i, reply)) {
      const question = { ...q, answer: i };
      return { solution: { ...sol, question }, ref: question, check: 'fixed' };
    }
  }
  return { solution: { ...sol, question: null, unsure: true }, ref: stepKey(claim, q), check: 'dropped' };
}

/** 넣을 문제(객관식)의 정답을 i 번 보기로 고쳐도 되는지: 원래 정답을 받쳐 주는 것이 없을 때만 */
function canFix(sol: ChatSolution, q: ChatQuestion, i: number, reply: string): boolean {
  const choices = q.choices ?? [];
  // 답 글도 원래 정답을 말하면 단계만 믿을 수 없다
  const told = claimIn(reply);
  if (told && judgeClaim(told, q) === 'same') return false;
  // 해설이 다른 답을 말하거나, 고칠 보기가 아닌 원래 보기의 값만 말하면 해설도 원래 정답으로 쓴 것이다 (넣은 문제의 해설과 정답이 어긋나지 않게)
  const said = claimIn(q.explanation);
  if (said && judgeClaim(said, { ...q, answer: i }) === 'differ') return false;
  const before = choices[Number(q.answer)] ?? '';
  if (!said && mentionsAnswer(q.explanation, before) && !mentionsAnswer(q.explanation, choices[i])) return false;
  // 읽은 문제에 보기가 ①부터 적혀 있으면 그 번호의 보기가 넣을 문제의 보기와 같아야 한다
  const shown = listedChoices(sol.problem).get(i + 1);
  return shown === undefined || compareText(shown, choices[i]) === 'same';
}

/** 마지막 단계가 말한 답 → 답 글이 말해야 할 답 (넣을 문제를 뺐거나 없을 때). 모르면 null */
function stepKey(c: AnswerClaim, q: ChatQuestion | null): AnswerKey | null {
  if (q?.type === 'mcq' && q.choices) {
    const i = claimedIndex(c, q.choices);
    return i === null ? null : { type: 'mcq', choices: q.choices, answer: i };
  }
  if (!q && c.choice !== null) return { type: 'mcq', choices: null, answer: c.choice - 1 };
  if (c.ox !== null) return { type: 'ox', choices: null, answer: c.ox };
  // 말로 된 답은 견줄 수 없어서(judgeClaim 이 다르다고 하지 않는다) 답 글을 바꾸지 않는다
  const said = c.value || c.phrase;
  return said ? { type: 'short', choices: null, answer: said } : null;
}

/** 정답 한 문장 ('정답은 ④번이에요 (1).', '정답은 O예요.', '정답은 5 cm예요.'). 만들 수 없으면 null */
function answerLine(key: AnswerKey): string | null {
  if (key.type === 'mcq') {
    const i = Number(key.answer);
    if (!Number.isInteger(i) || i < 0) return null;
    const mark = CIRCLED[i] ?? String(i + 1);
    const c = key.choices?.[i];
    return c ? `정답은 ${mark}번이에요 (${c}).` : `정답은 ${mark}번이에요.`;
  }
  if (key.type === 'ox') return `정답은 ${key.answer ? 'O' : 'X'}예요.`;
  const a = String(key.answer ?? '')
    .trim()
    .replace(/[.。!?]+$/, '');
  if (!a) return null;
  const ox = readOx(a);
  if (ox !== null) return `정답은 ${ox ? 'O' : 'X'}예요.`;
  const end = copulaFor(a);
  return end ? `정답은 ${a}${end}.` : `정답: ${a}.`;
}

/** 넣을 문제를 뺐을 때 덧붙이는 말 (탓하지 않고, 한 번 더 확인해 보게) */
export const ANSWER_UNSURE = '풀이 중에 답이 한 번 엇갈렸으니, 답이 맞는지 한 번 더 확인해 보세요.';
/** 답 글을 정답 한 문장으로 바꿀 때 덧붙이는 말 (넣을 문제를 뺐을 때는 한 번 더 확인해 보게) */
const SEE_STEPS = '아래 단계별 풀이를 확인해 보세요.';
const RECHECK_STEPS = '풀이 중에 답이 한 번 엇갈렸으니, 아래 단계별 풀이로 한 번 더 확인해 보세요.';

/**
 * AI 답 글 마무리: 꾸밈 기호(굵게·제목)를 걷어 내고, 비었으면 알려 준다.
 * 답 글이 정답이라고 밝힌 답(claimIn: '정답은 ②번', '정답은 X', '답은 5 cm', 'x = 3이에요')이 맞춰 볼 답(opts.ref, 없으면 넣을 문제)과
 * 분명히 다르면 단계를 끝까지 푼 풀이를 믿고 답 글을 정답 한 문장으로 바꾼다. 다른 보기를 설명하는 말('③은 틀려요')은 고치지 않는다.
 * opts.unsure: 단계와 넣을 문제가 어긋나 문제를 뺐을 때 (한 번 더 확인해 보라고 덧붙인다)
 */
export function finishReply(raw: string, solution: ChatSolution | null, opts: { ref?: AnswerKey | null; unsure?: boolean } = {}): string {
  const cleaned = raw
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
    .slice(0, 8000);
  if (!solution) return cleaned || '답을 만들지 못했어요. 다시 물어봐 주세요.';
  const ref = opts.ref !== undefined ? opts.ref : solution.question;
  const claim = cleaned && ref ? claimIn(cleaned) : null;
  const line = claim && ref && judgeClaim(claim, ref) === 'differ' ? answerLine(ref) : null;
  if (line) return `${line} ${opts.unsure ? RECHECK_STEPS : SEE_STEPS}`;
  const reply = cleaned || '풀이를 정리했어요.';
  return opts.unsure ? `${reply} ${ANSWER_UNSURE}` : reply;
}

/**
 * AI 채팅 답 → 저장·화면에 쓸 풀이와 답 글. 풀이를 읽고(readChatSolution), 마지막 단계·넣을 문제의 정답·답 글이
 * 같은 답을 말하게 맞춘다 (settleSolution → finishReply). check: 넣을 문제를 고쳤는지·뺐는지 (기록용)
 */
export function readChatAnswer(
  rawReply: string,
  raw: ChatSolutionRaw | undefined,
  opts: { figures: boolean },
): { solution: ChatSolution | null; reply: string; check: SettledSolution['check'] } {
  const read = readChatSolution(raw, opts);
  if (!read) return { solution: null, reply: finishReply(rawReply, null), check: 'none' };
  const s = settleSolution(read, raw?.steps, rawReply);
  return { solution: s.solution, reply: finishReply(rawReply, s.solution, { ref: s.ref, unsure: s.check === 'dropped' }), check: s.check };
}

/**
 * AI 채팅 답 (풀이 여럿) → 저장·화면에 쓸 풀이들과 답 글. 풀이마다 따로 맞춘다 (settleSolution: 단계 끝의 답 ↔ 넣을 문제의 정답).
 * - 풀이가 하나면 예전과 같다 (readChatAnswer: 답 글이 밝힌 답도 맞춘다).
 * - 여럿이면 답 글은 무엇을 풀었는지만 말한다 (답은 카드마다): 꾸밈 기호를 걷고, 그래도 '2번: ③'처럼 번호로 시작하는 줄이
 *   그 풀이와 분명히 다른 답을 말하면 그 줄을 맞는 답으로 바꾼다. 넣을 문제를 뺀 풀이가 있으면 번호를 들어 한 번 더 확인해 보라고 덧붙인다.
 * 번호(label)는 비면 차례로 ('1번'), 겹치면 뒤에 차례를 붙인다. needsFigure: 그림이 도움이 된다고 한 풀이 (Pro 두 번째 호출)
 */
export function readChatAnswers(
  rawReply: string,
  raws: ChatSolutionRaw[],
  opts: { figures: boolean },
): { solutions: ChatSolution[]; needsFigure: boolean[]; reply: string; checks: Array<SettledSolution['check']> } {
  const read = raws.slice(0, CHAT_SOLUTIONS_MAX).flatMap((raw) => {
    const sol = readChatSolution(raw, opts);
    return sol ? [{ raw, sol }] : [];
  });
  if (read.length <= 1) {
    const one = read[0];
    if (!one) return { solutions: [], needsFigure: [], reply: finishReply(rawReply, null), checks: [] };
    const s = settleSolution(one.sol, one.raw.steps, rawReply);
    return {
      solutions: [s.solution],
      needsFigure: [!!one.raw.needs_figure],
      reply: finishReply(rawReply, s.solution, { ref: s.ref, unsure: s.check === 'dropped' }),
      checks: [s.check],
    };
  }
  const seen = new Map<string, number>();
  const settled = read.map(({ raw, sol }, i) => {
    const s = settleSolution(sol, raw.steps, '');
    const base = (s.solution.label ?? '').trim() || `${i + 1}번`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...s, solution: { ...s.solution, label: n > 1 ? `${base} · ${n}` : base } };
  });
  const solutions = settled.map((s) => s.solution);
  const cleaned = finishReply(rawReply, solutions[0], { ref: null });
  let reply = rawReply.trim() ? fixAnswerLines(cleaned, settled) : `문제 ${solutions.length}개를 풀었어요. 번호를 눌러 하나씩 확인해 보세요.`;
  const unsure = settled.filter((s) => s.check === 'dropped').map((s) => s.solution.label ?? '');
  if (unsure.length) reply += ` ${josa(unsure.join('·'), '은')} 풀이 중에 답이 한 번 엇갈렸으니, 한 번 더 확인해 보세요.`;
  return { solutions, needsFigure: read.map(({ raw }) => !!raw.needs_figure), reply, checks: settled.map((s) => s.check) };
}

/**
 * 풀이가 여럿일 때 답 글에서 '2번: ③ 5 cm'·'3번 (1)은 O예요'처럼 번호로 시작하는 줄을 그 풀이의 답(ref)과 맞춰 본다.
 * 분명히 다르면 그 줄을 '2번: 정답은 ④번이에요 (1).'로 바꾼다. 번호로 시작하지 않는 줄·같거나 모르는 줄은 그대로
 */
function fixAnswerLines(reply: string, items: SettledSolution[]): string {
  // 긴 번호부터 ('3번 (1)' 줄이 '3번' 풀이에 걸리지 않게)
  const byLabel = items.filter((s) => s.solution.label && s.ref).sort((a, b) => (b.solution.label ?? '').length - (a.solution.label ?? '').length);
  if (!byLabel.length) return reply;
  return reply
    .split('\n')
    .map((line) => {
      const m = /^(\s*(?:[-•·*]\s*)?)([\s\S]*)$/.exec(line);
      const lead = m?.[1] ?? '';
      const body = m?.[2] ?? line;
      // 번호 바로 뒤는 끝·빈칸·문장 부호·조사만 ('2번째'·'2번지'는 그 번호가 아니다)
      const hit = byLabel.find((s) => {
        const label = s.solution.label ?? '';
        const after = body.slice(label.length);
        return body.startsWith(label) && (!after || /^(?:[\s:：.,)\-–—]|(?:은|는|의|이|가|도)(?=[\s:：,]))/.test(after));
      });
      if (!hit?.ref) return line;
      const label = hit.solution.label ?? '';
      const rest = body
        .slice(label.length)
        .replace(/^\s*(?:[:：)\-–—]\s*|(?:의\s*)?(?:정답|답)?\s*(?:은|는)\s+)/, '')
        .trim();
      // '정답은 …'처럼 밝힌 답, 아니면 번호 바로 뒤의 짧은 답 ('③ 5 cm', 'O예요'). 긴 설명은 답으로 읽지 않는다
      const claim = claimIn(rest) ?? (rest.length <= 16 ? claimIn(`정답: ${rest}`) : null);
      if (!claim || judgeClaim(claim, hit.ref) !== 'differ') return line;
      const fixed = answerLine(hit.ref);
      return fixed ? `${lead}${label}: ${fixed}` : line;
    })
    .join('\n');
}

/** 저장 칸(chat_messages.solution: jsonb 64KB) 안에 들게 잡는 크기. jsonb 는 글보다 크다 (글 1.1배, 그림 설계도 1.8배쯤) */
const STORE_BYTES = 60_000;
const byteLen = (v: unknown) => new TextEncoder().encode(JSON.stringify(v ?? null)).length;
const storeSize = (list: ChatSolution[]) =>
  list.reduce((a, s) => a + Math.ceil(byteLen({ ...s, figure: null }) * 1.1) + (s.figure ? Math.ceil(byteLen(s.figure) * 1.8) : 0), 0);

/**
 * 풀이 여럿을 저장 칸에 맞춘다. 덜 아까운 것부터 뒤 풀이에서 앞으로: 둘째부터의 그림 → 읽은 문제 글(400자까지) →
 * 첫 풀이의 그림 → 단계 글(220자까지) → 마지막으로 뒤 풀이를 뺀다 (첫 풀이는 남긴다). 그림을 빼면 단계의 add·focus 도 비운다
 */
export function fitSolutions(list: ChatSolution[]): ChatSolution[] {
  let out = list.slice();
  const pass = (from: number, to: number, change: (s: ChatSolution) => ChatSolution) => {
    for (let i = from; i >= to && storeSize(out) > STORE_BYTES; i--) out[i] = change(out[i]);
  };
  const noFigure = (s: ChatSolution): ChatSolution => (s.figure ? { ...s, figure: null, steps: s.steps.map((st) => ({ ...st, add: [], focus: [] })) } : s);
  pass(out.length - 1, 1, noFigure);
  pass(out.length - 1, 0, (s) => (s.problem.length > 400 ? { ...s, problem: `${s.problem.slice(0, 400)}…` } : s));
  pass(0, 0, noFigure);
  pass(out.length - 1, 0, (s) => ({ ...s, steps: s.steps.map((st) => ({ ...st, text: st.text.slice(0, 220) })) }));
  while (out.length > 1 && storeSize(out) > STORE_BYTES) out = out.slice(0, -1);
  return out;
}

/** 대화 기록 한 줄 (AI 에 보낼 때): 붙인 파일은 이름만, 푼 문제는 읽은 문제(번호와 함께)를 덧붙여 다음 질문이 이어지게 */
export function historyLine(
  m: { role: string; content: string; attachments?: ChatAttachmentMeta[] | null; solution?: StoredChatSolution | null },
  max = 1500,
): string {
  const files = (m.attachments ?? []).map((a) => `[${a.kind === 'image' ? '사진' : a.kind === 'pdf' ? 'PDF' : '글 파일'}: ${a.name}]`).join(' ');
  return `${files ? `${files} ` : ''}${m.content}`.slice(0, max) + solvedLine(solutionList(m.solution));
}
