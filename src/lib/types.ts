// 화면과 서버가 같이 쓰는 모양
import type { UserSettings } from './settings';
import type { PlanInfo } from './plans';

export type MeResponse = {
  userId: string;
  email: string;
  nickname: string | null;
  isAdmin: boolean;
  /** 지금 적용되는 플랜이 Pro 인지 (테스트 플랜이 켜져 있으면 false) */
  isPro: boolean;
  proUntil: string | null;
  /** 지금 적용되는 플랜 (관리자·테스트 플랜·Pro·무료)과 이름, 끝나는 날 */
  planInfo: PlanInfo;
  /** 꼼꼼 모델을 쓸 수 있는지 */
  canCareful: boolean;
  consented: boolean;
  settings: UserSettings;
  energy: {
    unlimited: boolean;
    remaining: number | null;
    limit: number | null;
    /** day: 무료(오늘), month: Pro(이번 달), plan: 테스트 플랜(기간 전체) */
    period: 'day' | 'month' | 'plan';
    /** 오늘 쓴 에너지 (테스트 플랜이면 플랜을 켠 뒤 오늘 쓴 것만) */
    usedToday: number;
    usedMonth: number;
    proDaily: number | null;
    /** 테스트 플랜: 켠 뒤 쓴 번개, 하루 최대 */
    usedPlan: number | null;
    planDaily: number | null;
  };
  notice: { active: boolean; text: string };
  aiEnabled: boolean;
  plan: { pdfPages: number; images: number; textChars: number; fileMb: number; fileDays: number | null };
  usdPerEnergy: number;
  models: { fast: string; careful: string; adminTest: string };
  multipliers: { fast: number; careful: number; adminTest: number };
};

export type SubjectRow = {
  id: string;
  name: string;
  color: string;
  exam_date: string | null;
  position: number;
  created_at: string;
};

export type SourceListRow = {
  id: string;
  subject_id: string;
  kind: 'text' | 'pdf' | 'image';
  title: string;
  status: 'queued' | 'processing' | 'ready' | 'error';
  step: string;
  progress: number;
  chunk_index: number;
  chunk_total: number;
  error: string | null;
  locked_until: string | null;
  page_count: number | null;
  file_paths: string[];
  files_expire_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QuestionRow = {
  id: string;
  note_id: string | null;
  subject_id: string;
  key_point_id: string | null;
  type: 'mcq' | 'ox' | 'cloze' | 'short';
  prompt: string;
  choices: string[] | null;
  answer: number | boolean | string;
  accepted: string[];
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  pages: number[];
  created_by: 'ai' | 'user';
  locked: boolean;
  edited: boolean;
  status: 'active' | 'suspended';
  created_at: string;
};

export type CardRow = {
  question_id: string;
  subject_id: string;
  due: string;
  state: number;
  fsrs: Record<string, unknown>;
  reps: number;
  lapses: number;
  last_review: string | null;
  last_correct: boolean | null;
  correct_streak: number;
  /** 틀린 횟수 (FSRS lapses 와 달리 새 문제에서 틀려도 센다) */
  wrong_count: number;
  in_wrong_note: boolean;
};
