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

export type ProposalStatus = 'pending' | 'applied' | 'cancelled';

/** AI 답에 붙는 것: 노트 밖 지식을 썼는지, 넣자고 한 것 (넣기 전에는 늘 학생에게 묻는다) */
export type ChatProposal =
  | { kind: 'none'; outside: boolean }
  | { kind: 'questions'; outside: boolean; status: ProposalStatus; questions: ChatQuestion[] }
  | { kind: 'note'; outside: boolean; status: ProposalStatus; addition: { key_point_id: string; title: string; text: string } };

/** 채팅에 붙인 사진·파일 (path: Pro 노트 채팅에서 보관한 파일. 없으면 이름만 남는다) */
export type ChatAttachmentMeta = { kind: 'image' | 'pdf' | 'text'; name: string; path?: string };

/**
 * AI 가 문제를 풀어 준 것: 읽은 문제, 단계 풀이(Pro 는 그림도), 노트에 넣을 수 있는 문제 모양, 과목·단원 짐작.
 * saved: 노트 문제로 넣었는지 (노트 채팅)
 */
export type ChatSolution = {
  problem: string;
  steps: Step[];
  figure: Figure | null;
  question: ChatQuestion | null;
  subject: string;
  unit: string;
  saved?: boolean;
};

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
  solution?: ChatSolution | null;
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

/** 홈 AI 채팅: 서버가 돌려주는 답 */
export type HomeChatReply = { reply: string; solution: ChatSolution | null; energy: number; model: string };
