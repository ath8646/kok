// AI가 돌려줄 JSON 모양.
// 1) JSON 스키마: Claude API 의 structured outputs(output_config.format)에 넣는다.
//    규칙: 모든 객체 additionalProperties:false, 재귀 금지, min/max 길이 금지.
// 2) zod 스키마: 받은 JSON 을 한 번 더 검사하고 빈 값을 채운다.
import { z } from 'zod';
import { figureJsonSchema, stepsJsonSchema, textStepsJsonSchema } from '@/lib/figure/spec';
import { FIG_KINDS } from '@/lib/source-figures';

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

/**
 * 합친 노트를 AI 로 다시 정리 (Pro): 정리 노트 + 개념 번호 옮김 (예전 번호 → 그 내용이 들어간 번호).
 * 옮김은 노트 뒤에 쓴다: 개념을 다 정한 뒤에 어디로 갔는지 적을 수 있다
 */
export const reorganizeJsonSchema: JsonSchema = obj({
  ...(noteJsonSchema.properties as Record<string, unknown>),
  id_map: { type: 'array', items: obj({ from: str, to: str }) },
});

export const zReorganize = z.object({
  id_map: z.array(z.object({ from: z.string().catch(''), to: z.string().catch('') })).catch([]),
});

/**
 * 정리 + 자료 그림 (PDF·사진에서 그림을 찾을 때). 그림은 노트 뒤에 쓴다: 개념을 먼저 정해야 그림을 붙일 개념 이름을 적을 수 있다.
 * corners: 네 모서리 (0~1000, 왼쪽 위·오른쪽 위·오른쪽 아래·왼쪽 아래의 x, y)
 */
export const organizeFiguresJsonSchema: JsonSchema = obj({
  ...(noteJsonSchema.properties as Record<string, unknown>),
  figures: {
    type: 'array',
    items: obj({
      page: int,
      kind: { type: 'string', enum: [...FIG_KINDS] },
      title: str,
      caption: str,
      asks: str,
      key_point_title: str,
      corners: intArr,
    }),
  },
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
const quizItemProps = {
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
};
export const quizJsonSchema: JsonSchema = obj({ questions: { type: 'array', items: obj(quizItemProps) } });
/** 자료 그림이 있을 때: 그림 문제는 figure_id 에 그림 번호 ('' 이면 그림 없는 문제) */
export const quizFiguresJsonSchema: JsonSchema = obj({ questions: { type: 'array', items: obj({ ...quizItemProps, figure_id: str }) } });

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
  /** 그림 문제의 자료 그림 번호 (자료 그림이 있을 때만) */
  figure_id: z.string().catch('').optional(),
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
// Claude structured outputs 는 스키마의 속성이 모두 합쳐 약 40개를 넘으면 "compiled grammar is too large" 로 거절한다
// (schemas.test.ts 가 SCHEMA_PROPS_MAX 로 지킨다). 그래서 채팅은 문제 칸을 짧게(chatQuestionSchema) 쓰고,
// 그림은 한 호출에 넣지 않고 풀이가 나온 뒤 따로 부른다 (chatFigureJsonSchema)

/**
 * 채팅이 만드는 문제 (노트에 넣을 문제·넣자고 하는 문제): 문제 단계의 칸(quizItemProps)을 줄인 모양.
 * answer 는 글 하나: 객관식은 정답 보기의 글 그대로, OX 는 "O"·"X", 빈칸·단답은 답 글 (readChatQuestion 이 문제 칸으로 바꾼다)
 */
export const chatQuestionSchema: JsonSchema = obj({
  type: quizItemProps.type,
  prompt: str,
  choices: strArr,
  answer: str,
  accepted: strArr,
  explanation: str,
  key_point_id: str,
  difficulty: quizItemProps.difficulty,
});

/**
 * 채팅에서 푼 문제: 읽은 문제, 글로 된 단계 풀이, 노트에 넣을 문제 모양, (홈 채팅만) 과목·단원 짐작.
 * figures(Pro): 그림이 도움이 되는지(needs_figure) — true 일 때만 두 번째 호출로 그림을 받는다 (chatFigureJsonSchema).
 * guess: 과목·단원 칸 (홈 채팅: 노트가 없어서 넣을 곳을 짐작한다. 노트 채팅은 이 노트에 넣으니 없다)
 */
export function chatSolutionSchema(o: { figures: boolean; guess: boolean }): JsonSchema {
  return obj({
    include: { type: 'boolean' },
    problem: str,
    steps: textStepsJsonSchema,
    ...(o.figures ? { needs_figure: { type: 'boolean' } } : {}),
    question: chatQuestionSchema,
    ...(o.guess ? { subject: str, unit: str } : {}),
  });
}

/** 노트 채팅이 넣자고 하는 것: 문제, 개념 글, 용어 (넣기 전에는 늘 학생에게 묻는다) */
const proposalSchema = obj({
  kind: { type: 'string', enum: ['none', 'questions', 'note', 'terms'] },
  questions: { type: 'array', items: chatQuestionSchema },
  note_addition: obj({ key_point_id: str, title: str, text: str }),
  terms: { type: 'array', items: obj({ term: str, meaning: str }) },
});

/**
 * 노트 채팅. solve: 문제 풀이 칸까지 (schema.sql 을 다시 실행하기 전에는 빼고 예전처럼).
 * AI 는 JSON 을 칸 순서대로 쓴다: 풀이(단계)를 먼저 쓰고 답 글을 나중에 써야 답이 단계와 어긋나지 않는다
 */
export function noteChatJsonSchema(o: { solve: boolean; figures: boolean }): JsonSchema {
  return obj({
    ...(o.solve ? { solution: chatSolutionSchema({ figures: o.figures, guess: false }) } : {}),
    reply: str,
    // 노트 밖 일반 지식을 보탰는지 (화면에 표시)
    outside_note: { type: 'boolean' },
    proposal: proposalSchema,
  });
}

/** 홈 AI 채팅 (노트 없이 아무 과목이나). 풀이를 먼저, 답 글은 마지막에 */
export function homeChatJsonSchema(figures: boolean): JsonSchema {
  return obj({ solution: chatSolutionSchema({ figures, guess: true }), reply: str });
}

/**
 * 채팅 풀이의 그림 (Pro, 풀이가 나온 뒤 두 번째 호출): 문제 그림과, 단계마다 그 단계에서 처음 나타나는(add)·강조할(focus) 그림 요소.
 * index 는 <steps> 의 단계 번호 (0부터)
 */
export const chatFigureJsonSchema: JsonSchema = obj({
  figure: figureJsonSchema,
  steps: { type: 'array', items: obj({ index: int, add: strArr, focus: strArr }) },
});

export const zChatFigure = z.object({
  figure: z.unknown().optional(),
  steps: z.array(z.object({ index: z.number().int().catch(-1), add: z.array(z.string()).catch([]), focus: z.array(z.string()).catch([]) })).catch([]),
});

/** 채팅이 만든 문제(chatQuestionSchema 모양) → 문제 단계의 모양. 답을 읽을 수 없으면 null */
export const zChatQuestion = z.object({
  type: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['mcq', 'ox', 'cloze', 'short'])),
  prompt: z.string(),
  choices: z.array(z.string()).catch([]),
  answer: z.string().catch(''),
  accepted: z.array(z.string()).catch([]),
  explanation: z.string().catch(''),
  key_point_id: z.string().catch(''),
  difficulty: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['easy', 'medium', 'hard']))
    .catch('medium'),
});

/** 객관식 정답 글 → 보기 번호 (0부터): 보기의 글과 같으면 그 보기, 아니면 번호('3', '③', '3번')로. 모르면 -1 */
export function chatChoiceIndex(answer: string, choices: string[]): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const a = norm(answer);
  if (!a) return -1;
  const same = choices.findIndex((c) => norm(c) === a);
  if (same >= 0) return same;
  // 보기 글 앞에 번호가 붙어 있을 때 ('③ 5 cm' 와 '5 cm')
  const bare = (s: string) => norm(s).replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*|^\(?\d{1,2}[.)]\s*/, '');
  const loose = choices.findIndex((c) => bare(c) === bare(answer) && bare(c));
  if (loose >= 0) return loose;
  const circled = '①②③④⑤⑥⑦⑧⑨⑩'.indexOf(a[0] ?? '');
  if (circled >= 0 && a.length <= 2) return circled < choices.length ? circled : -1;
  const m = /^(\d{1,2})\s*(번|\.|\))?$/.exec(a);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= choices.length ? n - 1 : -1;
  }
  return -1;
}

export function readChatQuestion(raw: unknown): QuizItem | null {
  const r = zChatQuestion.safeParse(raw);
  if (!r.success) return null;
  const q = r.data;
  const answer = q.answer.trim();
  const base = {
    prompt: q.prompt,
    choices: q.choices,
    accepted: q.accepted,
    explanation: q.explanation,
    key_point_id: q.key_point_id,
    difficulty: q.difficulty,
    pages: [],
  };
  if (q.type === 'mcq') {
    const i = chatChoiceIndex(answer, q.choices);
    if (i < 0) return null;
    return { ...base, type: 'mcq', answer_index: i, answer_bool: false, answer_text: '' };
  }
  if (q.type === 'ox') {
    const a = answer.toLowerCase();
    const ox = /^(o|○|true|맞|참|yes)/.test(a) ? true : /^(x|×|false|틀|거짓|no)/.test(a) ? false : null;
    if (ox === null) return null;
    return { ...base, type: 'ox', choices: [], answer_index: -1, answer_bool: ox, answer_text: '' };
  }
  return { ...base, type: q.type, choices: [], answer_index: -1, answer_bool: false, answer_text: answer };
}

/** 받은 풀이 (검사는 readChatSolution 이 한다) */
export const zChatSolutionRaw = z.object({
  include: z.boolean().catch(false),
  problem: z.string().catch(''),
  // zod 4 는 z.unknown() 칸도 빠지면 오류라 optional (그림은 두 번째 호출에서 따로 받는다)
  steps: z.unknown().optional(),
  figure: z.unknown().optional(),
  /** Pro: 그림이 도움이 되는지 (두 번째 호출로 그림을 받을지) */
  needs_figure: z.boolean().catch(false).optional(),
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
      kind: z.enum(['none', 'questions', 'note', 'terms']).catch('none'),
      questions: z.array(z.unknown()).catch([]),
      note_addition: zNoteAddition.catch({ key_point_id: '', title: '', text: '' }),
      terms: z.array(z.object({ term: z.string().catch(''), meaning: z.string().catch('') })).catch([]),
    })
    .catch({ kind: 'none', questions: [], note_addition: { key_point_id: '', title: '', text: '' }, terms: [] }),
});

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
  /** 문제 다시 만들기 미리보기의 그림 문제: 노트의 자료 그림 번호 (그림은 서버가 노트에서 붙인다) */
  figure_id: z.string().max(16).optional().catch(undefined),
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
    figure_id: r.figure_id ?? '',
  };
}
