// AI가 돌려줄 JSON 모양.
// 1) JSON 스키마: Claude API 의 structured outputs(output_config.format)에 넣는다.
//    규칙: 모든 객체 additionalProperties:false, 재귀 금지, min/max 길이 금지.
// 2) zod 스키마: 받은 JSON 을 한 번 더 검사하고 빈 값을 채운다.
import { z } from 'zod';
import { figureJsonSchema, stepsJsonSchema, textStepsJsonSchema } from '@/lib/figure/spec';

type JsonSchema = Record<string, unknown>;

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;
const strArr = { type: 'array', items: str } as const;
const intArr = { type: 'array', items: int } as const;

function obj(properties: Record<string, unknown>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

// ---------------------------------------------------------------- 정리 노트
export const noteJsonSchema: JsonSchema = obj({
  title: str,
  unit: str,
  summary: str,
  key_points: {
    type: 'array',
    items: obj({
      id: str,
      title: str,
      explanation: str,
      why: str,
      importance: { type: 'string', enum: ['high', 'medium', 'low'] },
      pages: intArr,
    }),
  },
  terms: { type: 'array', items: obj({ term: str, meaning: str }) },
  formulas: { type: 'array', items: obj({ latex: str, label: str }) },
  pitfalls: { type: 'array', items: obj({ text: str, key_point_id: str }) },
  examples: { type: 'array', items: obj({ text: str, key_point_id: str }) },
  checks: { type: 'array', items: obj({ text: str }) },
  changes: { type: 'array', items: obj({ text: str }) },
});

const zImportance = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['high', 'medium', 'low']))
  .catch('medium');

const zPages = z.array(z.number().int()).catch([]);

export const zKeyPoint = z.object({
  id: z.string().catch(''),
  title: z.string().catch(''),
  explanation: z.string().catch(''),
  why: z.string().catch(''),
  importance: zImportance,
  pages: zPages,
  starred: z.boolean().optional(),
  edited: z.boolean().optional(),
});

export const zNote = z.object({
  title: z.string().catch(''),
  unit: z.string().catch(''),
  summary: z.string().catch(''),
  key_points: z.array(zKeyPoint).catch([]),
  terms: z.array(z.object({ term: z.string(), meaning: z.string(), edited: z.boolean().optional() })).catch([]),
  formulas: z.array(z.object({ latex: z.string(), label: z.string().catch(''), edited: z.boolean().optional() })).catch([]),
  pitfalls: z.array(z.object({ text: z.string(), key_point_id: z.string().catch(''), edited: z.boolean().optional() })).catch([]),
  examples: z.array(z.object({ text: z.string(), key_point_id: z.string().catch(''), edited: z.boolean().optional() })).catch([]),
  checks: z.array(z.object({ text: z.string() })).catch([]),
  changes: z.array(z.object({ text: z.string() })).catch([]),
  summary_edited: z.boolean().optional(),
  /** AI 없이 직접 만든 노트 (빈 노트로 시작) */
  manual: z.boolean().optional(),
});

export type Note = z.infer<typeof zNote>;
export type KeyPoint = z.infer<typeof zKeyPoint>;

// ---------------------------------------------------------------- 그림 (마인드맵·표·연표)
export const visualJsonSchema: JsonSchema = obj({
  recommended: { type: 'string', enum: ['mindmap', 'table', 'timeline'] },
  mindmap: obj({
    root_label: str,
    nodes: {
      type: 'array',
      items: obj({ id: str, parent_id: str, label: str, icon: str, key_point_id: str, pages: intArr, hint: str }),
    },
  }),
  table: obj({
    include: { type: 'boolean' },
    title: str,
    columns: strArr,
    rows: { type: 'array', items: strArr },
  }),
  timeline: obj({
    include: { type: 'boolean' },
    title: str,
    events: { type: 'array', items: obj({ date: str, label: str, detail: str }) },
  }),
});

export const zMindNode = z.object({
  id: z.string(),
  parent_id: z.string().catch(''),
  label: z.string(),
  icon: z.string().catch(''),
  key_point_id: z.string().catch(''),
  pages: zPages,
  /** 1단계 가지의 외우기 한 줄 (예전 그림에는 없다) */
  hint: z.string().optional().catch(undefined),
  edited: z.boolean().optional(),
});
export type MindNode = z.infer<typeof zMindNode>;

export const zMindmap = z.object({
  root_label: z.string().catch('주제'),
  root_edited: z.boolean().optional(),
  nodes: z.array(zMindNode).catch([]),
});
export type Mindmap = z.infer<typeof zMindmap>;

export const zTable = z.object({
  title: z.string().catch(''),
  columns: z.array(z.string()).catch([]),
  rows: z.array(z.array(z.string())).catch([]),
});
export type TableSpec = z.infer<typeof zTable>;

export const zTimeline = z.object({
  title: z.string().catch(''),
  events: z.array(z.object({ date: z.string(), label: z.string(), detail: z.string().catch('') })).catch([]),
});
export type TimelineSpec = z.infer<typeof zTimeline>;

export const zVisualResult = z.object({
  recommended: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['mindmap', 'table', 'timeline']))
    .catch('mindmap'),
  mindmap: zMindmap,
  table: zTable.extend({ include: z.boolean().catch(false) }),
  timeline: zTimeline.extend({ include: z.boolean().catch(false) }),
});
export type VisualResult = z.infer<typeof zVisualResult>;

// ---------------------------------------------------------------- 문제
export const quizJsonSchema: JsonSchema = obj({
  questions: {
    type: 'array',
    items: obj({
      type: { type: 'string', enum: ['mcq', 'ox', 'cloze', 'short'] },
      prompt: str,
      choices: strArr,
      answer_index: int,
      answer_bool: { type: 'boolean' },
      answer_text: str,
      accepted: strArr,
      explanation: str,
      key_point_id: str,
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      pages: intArr,
    }),
  },
});

export const zQuizItem = z.object({
  type: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['mcq', 'ox', 'cloze', 'short'])),
  prompt: z.string(),
  choices: z.array(z.string()).catch([]),
  answer_index: z.number().int().catch(-1),
  answer_bool: z.boolean().catch(false),
  answer_text: z.string().catch(''),
  accepted: z.array(z.string()).catch([]),
  explanation: z.string().catch(''),
  key_point_id: z.string().catch(''),
  difficulty: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['easy', 'medium', 'hard']))
    .catch('medium'),
  pages: zPages,
});
export type QuizItem = z.infer<typeof zQuizItem>;

export const zQuiz = z.object({ questions: z.array(z.unknown()).catch([]) });

// ---------------------------------------------------------------- 그림 풀이 (Pro): 문제 그림과 단계 풀이
export const solveJsonSchema: JsonSchema = obj({
  solutions: { type: 'array', items: obj({ index: int, steps: stepsJsonSchema, figure: figureJsonSchema }) },
});
export const zSolve = z.object({
  // 빈 칸이 있어도 받는다 (zod 4 는 z.unknown() 칸도 빠지면 오류라 optional)
  solutions: z.array(z.object({ index: z.number().int(), steps: z.unknown().optional(), figure: z.unknown().optional() })).catch([]),
});

// ---------------------------------------------------------------- 채팅 (노트 채팅·홈 AI 채팅)
const quizItemSchema = (quizJsonSchema.properties as Record<string, { items: JsonSchema }>).questions.items;

/** 채팅에서 푼 문제: 읽은 문제, 단계 풀이 (figures: Pro 는 그림도), 노트에 넣을 문제 모양, 과목·단원 짐작 */
export function chatSolutionSchema(figures: boolean): JsonSchema {
  return obj({
    include: { type: 'boolean' },
    problem: str,
    steps: figures ? stepsJsonSchema : textStepsJsonSchema,
    ...(figures ? { figure: figureJsonSchema } : {}),
    question: quizItemSchema,
    subject: str,
    unit: str,
  });
}

const proposalSchema = obj({
  kind: { type: 'string', enum: ['none', 'questions', 'note'] },
  questions: (quizJsonSchema.properties as Record<string, unknown>).questions,
  note_addition: obj({ key_point_id: str, title: str, text: str }),
});

/** 노트 채팅. solve: 문제 풀이 칸까지 (schema.sql 을 다시 실행하기 전에는 빼고 예전처럼) */
export function noteChatJsonSchema(o: { solve: boolean; figures: boolean }): JsonSchema {
  return obj({
    reply: str,
    // 노트 밖 일반 지식을 보탰는지 (화면에 표시)
    outside_note: { type: 'boolean' },
    proposal: proposalSchema,
    ...(o.solve ? { solution: chatSolutionSchema(o.figures) } : {}),
  });
}

/** 홈 AI 채팅 (노트 없이 아무 과목이나) */
export function homeChatJsonSchema(figures: boolean): JsonSchema {
  return obj({ reply: str, solution: chatSolutionSchema(figures) });
}

/** 받은 풀이 (검사는 readChatSolution 이 한다) */
export const zChatSolutionRaw = z.object({
  include: z.boolean().catch(false),
  problem: z.string().catch(''),
  // 무료는 그림 칸이 없다 (zod 4 는 z.unknown() 칸도 빠지면 오류라 optional)
  steps: z.unknown().optional(),
  figure: z.unknown().optional(),
  question: z.unknown().optional(),
  subject: z.string().catch(''),
  unit: z.string().catch(''),
});
export type ChatSolutionRaw = z.infer<typeof zChatSolutionRaw>;

export const zNoteAddition = z.object({
  key_point_id: z.string().catch(''),
  title: z.string().catch(''),
  text: z.string().catch(''),
});
export type NoteAddition = z.infer<typeof zNoteAddition>;

export const zChat = z.object({
  reply: z.string().catch(''),
  outside_note: z.boolean().catch(false),
  solution: zChatSolutionRaw.optional().catch(undefined),
  proposal: z
    .object({
      kind: z.enum(['none', 'questions', 'note']).catch('none'),
      questions: z.array(z.unknown()).catch([]),
      note_addition: zNoteAddition.catch({ key_point_id: '', title: '', text: '' }),
    })
    .catch({ kind: 'none', questions: [], note_addition: { key_point_id: '', title: '', text: '' } }),
});
export type ChatResult = z.infer<typeof zChat>;

export const zHomeChat = z.object({
  reply: z.string().catch(''),
  solution: zChatSolutionRaw.optional().catch(undefined),
});

// ---------------------------------------------------------------- 테마 (Pro)
const palette = obj({ bg: str, surface: str, accent: str });
export const themeJsonSchema: JsonSchema = obj({
  name: str,
  summary: str,
  light: palette,
  dark: palette,
  font: { type: 'string', enum: ['default', 'round', 'hand', 'serif'] },
  paper: { type: 'string', enum: ['none', 'lined', 'grid', 'dots'] },
  image_prompt: str,
  pattern_svg: str,
});
const zPaletteAi = z
  .object({ bg: z.string().catch(''), surface: z.string().catch(''), accent: z.string().catch('') })
  .catch({ bg: '', surface: '', accent: '' });
export const zThemeAi = z.object({
  name: z.string().catch(''),
  summary: z.string().catch(''),
  light: zPaletteAi,
  dark: zPaletteAi,
  font: z.enum(['default', 'round', 'hand', 'serif']).catch('default'),
  paper: z.enum(['none', 'lined', 'grid', 'dots']).catch('none'),
  image_prompt: z.string().catch(''),
  pattern_svg: z.string().catch(''),
});
export type ThemeAi = z.infer<typeof zThemeAi>;

export const themeImageJsonSchema: JsonSchema = obj({ image_prompt: str });
export const zThemeImageAi = z.object({ image_prompt: z.string().catch('') });

// ---------------------------------------------------------------- 자기 검사
export const checkJsonSchema: JsonSchema = obj({
  verdicts: { type: 'array', items: obj({ index: int, keep: { type: 'boolean' }, reason: str }) },
});
export const zCheck = z.object({
  verdicts: z.array(z.object({ index: z.number().int(), keep: z.boolean(), reason: z.string().catch('') })).catch([]),
});

// ---------------------------------------------------------------- 채점
export const gradeJsonSchema: JsonSchema = obj({
  result: { type: 'string', enum: ['correct', 'partial', 'wrong'] },
  score: { type: 'number' },
  feedback: str,
  missing_points: strArr,
});
export const zGrade = z.object({
  result: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['correct', 'partial', 'wrong']))
    .catch('wrong'),
  score: z.number().catch(0),
  feedback: z.string().catch(''),
  missing_points: z.array(z.string()).catch([]),
});
export type GradeResult = z.infer<typeof zGrade>;

/** AI 문제 → DB 문제 행. 이상한 문제는 null */
/** 같이 인정할 답 하나의 최대 길이 */
export const ACCEPTED_MAX_CHARS = 100;

export function toQuestionRow(q: QuizItem): {
  type: 'mcq' | 'ox' | 'cloze' | 'short';
  prompt: string;
  choices: string[] | null;
  answer: number | boolean | string;
  accepted: string[];
  explanation: string;
  key_point_id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  pages: number[];
} | null {
  const prompt = q.prompt.trim();
  if (!prompt || prompt.length > 1000) return null;
  const base = {
    prompt,
    explanation: q.explanation.trim().slice(0, 2000),
    key_point_id: q.key_point_id.trim().slice(0, 40),
    difficulty: q.difficulty,
    pages: q.pages.filter((p) => Number.isInteger(p) && p > 0 && p < 100000).slice(0, 20),
  };
  if (q.type === 'mcq') {
    const choices = q.choices.map((c) => c.trim()).filter(Boolean);
    if (choices.length < 3 || choices.length > 6) return null;
    // DB 크기 제한(보기 8KB)을 넘지 않게: 너무 긴 보기가 있으면 그 문제는 버린다
    if (choices.some((c) => c.length > 300)) return null;
    if (new Set(choices).size !== choices.length) return null;
    if (q.answer_index < 0 || q.answer_index >= choices.length) return null;
    return { ...base, type: 'mcq', choices, answer: q.answer_index, accepted: [] };
  }
  if (q.type === 'ox') {
    return { ...base, type: 'ox', choices: null, answer: q.answer_bool, accepted: [] };
  }
  const answer = q.answer_text.trim();
  if (!answer || answer.length > 200) return null;
  if (q.type === 'cloze' && !/_{2,}|\(\s*\)|\[\s*\]/.test(prompt)) return null;
  // 같이 인정할 답: 100자까지, 10개까지 (DB 크기 제한 4KB 안)
  const accepted = Array.from(new Set(q.accepted.map((a) => a.trim()).filter((a) => a && a !== answer && a.length <= ACCEPTED_MAX_CHARS))).slice(0, 10);
  return { ...base, type: q.type, choices: null, answer, accepted };
}

/** 화면에서 보낸 문제(행 모양)를 다시 검사한다 */
export const zQuestionRowInput = z.object({
  type: z.enum(['mcq', 'ox', 'cloze', 'short']),
  prompt: z.string().max(1000),
  choices: z.array(z.string().max(300)).max(6).nullable().catch(null),
  answer: z.union([z.number().int(), z.boolean(), z.string().max(200)]),
  accepted: z.array(z.string().max(ACCEPTED_MAX_CHARS)).max(10).catch([]),
  explanation: z.string().max(2000).catch(''),
  key_point_id: z.string().max(40).nullable().catch(null),
  difficulty: z.enum(['easy', 'medium', 'hard']).catch('medium'),
  pages: z.array(z.number().int()).max(20).catch([]),
});
export type QuestionRowInput = z.infer<typeof zQuestionRowInput>;

export function rowToQuizItem(r: QuestionRowInput): QuizItem {
  return {
    type: r.type,
    prompt: r.prompt,
    choices: r.choices ?? [],
    answer_index: typeof r.answer === 'number' ? r.answer : -1,
    answer_bool: typeof r.answer === 'boolean' ? r.answer : false,
    answer_text: typeof r.answer === 'string' ? r.answer : '',
    accepted: r.accepted,
    explanation: r.explanation,
    key_point_id: r.key_point_id ?? '',
    difficulty: r.difficulty,
    pages: r.pages,
  };
}
