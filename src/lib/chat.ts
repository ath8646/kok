// 노트 채팅에서 주고받는 모양 (화면·서버 공통)
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

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  energy: number;
  proposal: ChatProposal | null;
  created_at: string;
};
