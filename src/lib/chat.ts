// 채팅(노트 채팅·홈 AI 채팅)에서 주고받는 모양 (화면·서버 공통)
import type { Figure, Step } from './figure/spec';
import type { QuestionType } from './types';

/** 문제로 넣자고 할 때의 문제 (questions 표의 칸과 같은 모양) */
export type ChatQuestion = {
  type: QuestionType;
  prompt: string;
  choices: string[] | null;
  answer: number | boolean | string;
  accepted: string[];
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  pages: number[];
  key_point_id: string;
};

/** 객관식 보기 번호 표시 (①부터) */
export const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** 풀이의 정답 한 줄 (객관식은 '④ 1', OX 는 'O'·'X', 나머지는 답 그대로). 넣을 문제가 없으면 '' */
export function solutionAnswer(q: ChatQuestion | null | undefined): string {
  if (!q) return '';
  if (q.type === 'mcq') {
    const i = Number(q.answer);
    const c = q.choices?.[i];
    return c === undefined ? '' : `${CIRCLED[i] ?? `${i + 1}.`} ${c}`;
  }
  if (q.type === 'ox') return q.answer ? 'O' : 'X';
  return String(q.answer ?? '').trim();
}

export type ProposalStatus = 'pending' | 'applied' | 'cancelled';

/** AI 답에 붙는 것: 노트 밖 지식을 썼는지, 넣자고 한 것 (넣기 전에는 늘 학생에게 묻는다) */
export type ChatProposal =
  | { kind: 'none'; outside: boolean }
  | { kind: 'questions'; outside: boolean; status: ProposalStatus; questions: ChatQuestion[] }
  | { kind: 'note'; outside: boolean; status: ProposalStatus; addition: { key_point_id: string; title: string; text: string } }
  | { kind: 'terms'; outside: boolean; status: ProposalStatus; terms: ChatTerm[] };

/** 용어로 넣자고 할 때의 용어 하나 (노트 body.terms 의 모양) */
export type ChatTerm = { term: string; meaning: string };
/** 한 번에 넣자고 할 수 있는 용어 수·길이 */
export const CHAT_TERM_LIMITS = { count: 10, term: 40, meaning: 300 } as const;

/** 채팅에 붙인 사진·파일 (path: Pro 노트 채팅에서 보관한 파일. 없으면 이름만 남는다) */
export type ChatAttachmentMeta = { kind: 'image' | 'pdf' | 'text'; name: string; path?: string };

/**
 * AI 가 문제를 풀어 준 것 (문제 하나·꼬리 문제 하나마다 하나): 문제 번호, 읽은 문제, 단계 풀이(Pro 는 그림도),
 * 노트에 넣을 수 있는 문제 모양, 과목·단원 짐작.
 * unsure: 단계 끝의 답과 넣을 문제의 정답이 엇갈려 넣을 문제를 뺐다. saved: 노트 문제로 넣었는지 (노트 채팅)
 */
export type ChatSolution = {
  /** 문제 번호 ('3번', '3번 (1)'). 번호 없는 문제 하나면 '' (예전 풀이에는 없다) */
  label?: string;
  problem: string;
  steps: Step[];
  figure: Figure | null;
  question: ChatQuestion | null;
  subject: string;
  unit: string;
  unsure?: boolean;
  saved?: boolean;
};

/** 한 답에서 푸는 문제 수 (사진에 문제가 여럿이면 문제마다, 꼬리 문제((1)(2)(3))도 하나씩) */
export const CHAT_SOLUTIONS_MAX = 5;

/**
 * 저장하는 모양 (chat_messages.solution): 첫 풀이 + 나머지(more). 예전 화면·예전 기록은 첫 풀이만 읽는다.
 * rev: 넣었다는 표시를 바꿀 때마다 올리는 번호 (두 창에서 같이 눌러도 한 번만 넣게: chat/apply)
 */
export type StoredChatSolution = ChatSolution & { more?: ChatSolution[]; rev?: number };

/** 풀이 하나만 (저장 모양의 more·rev 를 뗀다) */
function oneSolution(s: ChatSolution): ChatSolution {
  const one = { ...s } as StoredChatSolution;
  delete one.more;
  delete one.rev;
  return one;
}

/** 저장된 풀이 → 풀이 목록 (없으면 []) */
export function solutionList(s: StoredChatSolution | null | undefined): ChatSolution[] {
  if (!s || typeof s !== 'object' || !Array.isArray(s.steps)) return [];
  const rest = Array.isArray(s.more) ? s.more.filter((x): x is ChatSolution => !!x && typeof x === 'object' && Array.isArray(x.steps)) : [];
  return [oneSolution(s), ...rest.map(oneSolution)];
}

/** 풀이 목록 → 저장하는 모양 (없으면 null) */
export function packSolutions(list: ChatSolution[], rev?: number): StoredChatSolution | null {
  if (!list.length) return null;
  const [first, ...rest] = list.map(oneSolution);
  return { ...first, ...(rest.length ? { more: rest } : {}), ...(rev !== undefined ? { rev } : {}) };
}

/** 문제 고르기·카드에 보일 번호: AI 가 읽은 번호, 없으면 차례 ('1번'). 문제가 하나면 번호가 없을 수 있다 ('') */
export function solutionLabel(s: ChatSolution, i: number, count: number): string {
  const l = (s.label ?? '').trim();
  return l || (count > 1 ? `${i + 1}번` : '');
}

/** 대화 기록에 덧붙이는 푼 문제 (다음 물음이 이어지게: '2번은 왜 그래?', '다음 문제도 풀어 줘'). 없으면 '' */
export function solvedLine(list: ChatSolution[]): string {
  const shown = list.filter((s) => s.problem);
  if (!shown.length) return '';
  const each = shown.length === 1 ? 600 : Math.max(150, Math.floor(900 / shown.length));
  return `\n(풀이한 문제: ${shown.map((s) => `${s.label ? `[${s.label}] ` : ''}${s.problem.slice(0, each)}`).join(' / ')})`;
}

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  energy: number;
  proposal: ChatProposal | null;
  created_at: string;
  /** schema.sql 을 다시 실행하기 전에는 없다 */
  attachments?: ChatAttachmentMeta[] | null;
  /** 푼 문제들 (첫 풀이 + more: solutionList 로 읽는다) */
  solution?: StoredChatSolution | null;
};

/**
 * 채팅에 붙이는 파일 한도. 요청 한 번은 Vercel 한도(4.5MB) 안이어야 해서 사진은 줄여 보내고(긴 변 1568px, AI 도 그 크기로 본다),
 * base64 로 4/3 배가 되는 것까지 생각해 모두 3.2MB 까지
 */
export const CHAT_FILE_LIMITS = {
  files: 4,
  imageSide: 1568,
  imageBytes: 1_500_000,
  pdfBytes: 2_800_000,
  totalBytes: 3_200_000,
  pdfPages: 30,
  textChars: 20_000,
} as const;

/** 글 없이 파일만 보낸 말의 기록 (화면은 이 글 대신 붙인 파일만 보여 준다) */
export const FILE_ONLY_CONTENT = '(파일만 보냈어요)';

/** 보낼 때의 파일 (data: 사진·PDF 는 base64, 글은 그대로) */
export type ChatFileInput = { kind: 'image' | 'pdf' | 'text'; name: string; data: string };

/** 홈 AI 채팅의 대화 기록 한 줄 (서버에 저장하지 않고 화면이 들고 있다) */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** 홈 AI 채팅: 서버가 돌려주는 답 (solution: 첫 풀이, 예전 화면이 읽는다) */
export type HomeChatReply = { reply: string; solutions: ChatSolution[]; solution: ChatSolution | null; energy: number; model: string };
