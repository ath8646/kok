// 단계별 학습 (Pro): 노트 하나를 AI 가 단계(unit) → 레슨(lesson) → 카드·확인 문제로 나눈 학습 길.
// 서버가 만들어 note_courses.plan 에 저장하고, 화면은 길(path)을 그려 레슨을 하나씩 열어 준다. 진도는 note_courses.progress (학생이 고친다)
import { z } from 'zod';
import { coursePlanRange } from '@/lib/ai/scale';
import { readChatQuestion, toQuestionRow, type CourseAi, type CourseOutline, type CourseUnitAi, type Note } from './ai/schemas';
import type { QuestionType } from './grading';

// ------------------------------------------------------------- 수준
export const COURSE_LEVELS = ['elementary', 'middle', 'high', 'college', 'expert'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/** 화면 이름과 한 줄 설명 (수준 고르기) */
export const COURSE_LEVEL_INFO: Record<CourseLevel, { name: string; desc: string }> = {
  elementary: { name: '초등학생', desc: '짧은 문장과 생활 속 예시, 외우기 요령 · 확인은 OX와 쉬운 객관식' },
  middle: { name: '중학생', desc: '용어 뜻풀이와 원인·결과, 헷갈리는 둘 비교 · 확인은 객관식·OX·빈칸' },
  high: { name: '고등학생', desc: '시험 말투의 구분·조건·함정, 풀이 예시 · 확인은 응용 객관식·빈칸·단답' },
  college: { name: '대학생', desc: '원리와 근거, 원어 용어 그대로, 비판적 비교 · 확인은 단답과 두 개념을 잇는 객관식' },
  expert: { name: '전문', desc: '원리·예외·한계와 실무 함정 · 확인은 미묘한 구분과 판단' },
};

// ------------------------------------------------------------- 학습 내용 (plan)
export type CourseCheck = {
  type: QuestionType;
  prompt: string;
  choices: string[] | null;
  answer: number | boolean | string;
  accepted: string[];
  explanation: string;
};
export type CourseCardKind = 'concept' | 'example' | 'compare' | 'tip';
export type CourseCard = { kind: CourseCardKind; heading: string; text: string; tip: string };
export type CourseLesson = { title: string; goal: string; key_point_ids: string[]; cards: CourseCard[]; checks: CourseCheck[] };
export type CourseUnit = { title: string; summary: string; lessons: CourseLesson[] };
export type CoursePlan = { title: string; intro: string; units: CourseUnit[] };

/** 만들 때 함께 보낼 원본 자료의 끝: 글은 글자 수, PDF 는 앞쪽 몇 쪽(크기도), 사진은 몇 장 */
export const COURSE_MATERIAL = { textChars: 20_000, pdfPages: 8, pdfBytes: 6 * 1024 * 1024, images: 4 } as const;
/** 레슨 하나의 카드·확인 문제 답 길이 (토큰) */
const LESSON_TOKENS = 650;
/** 답 길이와 에너지 검사·화면 예상에 쓰는 답 길이 (한 번에 만들 때): 개념 수에 따라 */
export function courseOut(keyPoints: number): { max: number; estimate: number } {
  const { lessons } = coursePlanRange(keyPoints);
  const max = Math.min(24_000, 4000 + lessons.max * LESSON_TOKENS);
  return { max, estimate: Math.round(max * 0.6) };
}

/**
 * 레슨이 이보다 많을 수 있는 노트(개념 9개부터)는 두 번에 나눠 만든다: 길의 뼈대 한 번 → 단계마다 레슨(동시에).
 * 한 번에 받으면 답이 2만 토큰 가까이 되어 시간 안에 끝나지 않거나 잘렸다 (큰 노트의 레슨이 안 만들어지던 까닭)
 */
export const COURSE_STAGED_FROM = 9;
export const courseStaged = (keyPoints: number) => coursePlanRange(keyPoints).lessons.max >= COURSE_STAGED_FROM;

/** 뼈대의 답 길이: 레슨마다 이름·목표·개념 번호 */
export function courseOutlineOut(keyPoints: number): number {
  return Math.min(8000, 1500 + coursePlanRange(keyPoints).lessons.max * 150);
}
/** 한 단계의 답 길이: 그 단계의 레슨 수만큼 */
export function courseUnitOut(lessons: number): number {
  return Math.min(10_000, 1500 + Math.max(1, lessons) * LESSON_TOKENS * 1.3);
}

/**
 * 만들기 예상 (에너지 검사·화면 예상이 같은 계산): 보낼 노트 길이(글자)와 개념 수로 입력·답 토큰.
 * 나눠 만들 때는 뼈대(노트 전체) + 단계마다(그 단계의 개념, 노트를 단계 수로 나눈 만큼 + 길 전체)
 */
export function courseCost(keyPoints: number, noteChars: number): { inputTokens: number; outTokens: number } {
  const note = Math.min(26_000, 3000 + noteChars * 0.9);
  if (!courseStaged(keyPoints)) return { inputTokens: note, outTokens: courseOut(keyPoints).estimate };
  const { units, lessons } = coursePlanRange(keyPoints);
  const stages = Math.round((units.min + units.max) / 2);
  const outline = courseOutlineOut(keyPoints);
  return {
    inputTokens: Math.round(note + stages * (3000 + (note - 3000) / stages + outline * 0.6)),
    outTokens: Math.round(outline * 0.6 + lessons.max * LESSON_TOKENS * 0.7),
  };
}

/** 한 학습 길의 크기 끝 (답이 길어지거나 저장 칸(256KB)을 넘지 않게) */
export const COURSE_LIMITS = { units: 6, lessons: 6, cards: 8, checks: 6, recap: 6, final: 10 } as const;

const zCheck = z.object({
  type: z.enum(['mcq', 'ox', 'cloze', 'short']),
  prompt: z.string(),
  choices: z.array(z.string()).nullable().catch(null),
  answer: z.union([z.number(), z.boolean(), z.string()]),
  accepted: z.array(z.string()).catch([]),
  explanation: z.string().catch(''),
});
const zPlan = z.object({
  title: z.string().catch(''),
  intro: z.string().catch(''),
  units: z
    .array(
      z.object({
        title: z.string().catch(''),
        summary: z.string().catch(''),
        lessons: z
          .array(
            z.object({
              title: z.string().catch(''),
              goal: z.string().catch(''),
              key_point_ids: z.array(z.string()).catch([]),
              cards: z
                .array(
                  z.object({
                    kind: z.enum(['concept', 'example', 'compare', 'tip']).catch('concept'),
                    heading: z.string().catch(''),
                    text: z.string().catch(''),
                    tip: z.string().catch(''),
                  }),
                )
                .catch([]),
              checks: z.array(zCheck).catch([]),
            }),
          )
          .catch([]),
      }),
    )
    .catch([]),
});

/** 저장된 학습 내용을 읽는다 (모양이 깨졌으면 null) */
export function readCoursePlan(raw: unknown): CoursePlan | null {
  const r = zPlan.safeParse(raw);
  if (!r.success) return null;
  const plan = r.data;
  const units = plan.units.filter((u) => u.lessons.length);
  if (!units.length) return null;
  return { ...plan, units };
}

const clip = (s: string, n: number) => {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** AI 확인 문제 → 채점할 수 있는 문제. 답을 읽을 수 없거나 이상하면 null */
export function settleCheck(raw: unknown): CourseCheck | null {
  const q = readChatQuestion(raw);
  if (!q) return null;
  const row = toQuestionRow(q);
  if (!row) return null;
  return { type: row.type, prompt: row.prompt, choices: row.choices, answer: row.answer, accepted: row.accepted, explanation: row.explanation };
}

/**
 * AI 가 만든 학습 길을 저장할 모양으로 다듬는다: 빈 것은 빼고, 수를 줄이고, 글은 자른다.
 * 노트에 없는 개념 번호는 뺀다. 레슨이 하나도 없으면 null
 */
export function settleCourse(ai: CourseAi, keyPointIds: readonly string[]): CoursePlan | null {
  const known = new Set(keyPointIds);
  const units: CourseUnit[] = [];
  for (const u of ai.units.slice(0, COURSE_LIMITS.units)) {
    const lessons: CourseLesson[] = [];
    for (const l of u.lessons.slice(0, COURSE_LIMITS.lessons)) {
      const cards = l.cards
        .map((c) => ({ kind: c.kind, heading: clip(c.heading, 40), text: clip(c.text, 600), tip: clip(c.tip, 200) }))
        .filter((c) => c.text)
        .slice(0, COURSE_LIMITS.cards);
      const checks = l.checks
        .map(settleCheck)
        .filter((c): c is CourseCheck => !!c)
        .slice(0, COURSE_LIMITS.checks);
      if (!cards.length) continue;
      lessons.push({
        title: clip(l.title, 40) || `레슨 ${lessons.length + 1}`,
        goal: clip(l.goal, 160),
        key_point_ids: [...new Set(l.key_point_ids.filter((k) => known.has(k)))].slice(0, 6),
        cards,
        checks,
      });
    }
    if (!lessons.length) continue;
    units.push({ title: clip(u.title, 40) || `${units.length + 1}단계`, summary: clip(u.summary, 200), lessons });
  }
  if (!units.length) return null;
  return { title: clip(ai.title, 60), intro: clip(ai.intro, 240), units };
}

// ------------------------------------------------------------- 큰 노트: 나눠 만들기
/** 뼈대를 받은 대로 쓸 수 있게: 빈 단계·레슨은 빼고 수를 줄인다 (settleCourse 와 같은 끝). 레슨이 없으면 null */
export function settleOutline(o: CourseOutline, keyPointIds: readonly string[]): CourseOutline | null {
  const known = new Set(keyPointIds);
  const units = o.units
    .map((u) => ({
      ...u,
      lessons: u.lessons
        .filter((l) => l.title.trim() || l.goal.trim() || l.key_point_ids.length)
        .slice(0, COURSE_LIMITS.lessons)
        .map((l) => ({ ...l, key_point_ids: [...new Set(l.key_point_ids.filter((k) => known.has(k)))] })),
    }))
    .filter((u) => u.lessons.length)
    .slice(0, COURSE_LIMITS.units);
  return units.length ? { ...o, units } : null;
}

/** AI 가 뼈대를 못 만들었을 때: 개념을 차례대로 한두 개씩 레슨으로, 레슨 세 개쯤마다 단계 (AI 없이) */
export function fallbackOutline(note: Note, keyPoints = note.key_points.length): CourseOutline {
  const { units } = coursePlanRange(keyPoints);
  const kps = note.key_points.filter((k) => k.id);
  const per = kps.length > COURSE_LIMITS.units * COURSE_LIMITS.lessons ? 2 : kps.length > 12 ? 2 : 1;
  const lessons: CourseOutline['units'][number]['lessons'] = [];
  for (let i = 0; i < kps.length; i += per) {
    const group = kps.slice(i, i + per);
    lessons.push({
      title: clip(group[0].title, 20),
      goal: `${clip(group.map((k) => k.title).join('·'), 60)}을 설명할 수 있어요`,
      key_point_ids: group.map((k) => k.id),
    });
  }
  const n = Math.min(COURSE_LIMITS.units, Math.max(units.min, Math.ceil(lessons.length / COURSE_LIMITS.lessons)), Math.max(1, lessons.length));
  const size = Math.ceil(lessons.length / n);
  const out: CourseOutline['units'] = [];
  for (let u = 0; u < n; u++) {
    const ls = lessons.slice(u * size, (u + 1) * size);
    if (ls.length) out.push({ title: `${u + 1}단계`, summary: '', lessons: ls });
  }
  return { title: clip(note.title, 24), intro: '', units: out };
}

/** 노트의 문제 (레슨을 AI 없이 만들 때 확인 문제로) */
export type NoteQuestionLite = {
  type: string;
  prompt: string;
  choices: unknown;
  answer: unknown;
  accepted?: unknown;
  explanation?: unknown;
  key_point_id?: unknown;
};

/** 노트의 문제 → 확인 문제 모양 (채팅 문제 모양: settleCourse 가 읽는다). 읽을 수 없으면 null */
function questionAsCheck(q: NoteQuestionLite): Record<string, unknown> | null {
  const choices = Array.isArray(q.choices) ? q.choices.map(String) : [];
  const answer =
    q.type === 'mcq'
      ? typeof q.answer === 'number'
        ? (choices[q.answer] ?? '')
        : ''
      : q.type === 'ox'
        ? q.answer === true
          ? 'O'
          : q.answer === false
            ? 'X'
            : ''
        : typeof q.answer === 'string'
          ? q.answer
          : '';
  if (!answer || !['mcq', 'ox', 'cloze', 'short'].includes(q.type)) return null;
  return {
    type: q.type,
    prompt: String(q.prompt ?? ''),
    choices,
    answer,
    accepted: Array.isArray(q.accepted) ? q.accepted.map(String) : [],
    explanation: typeof q.explanation === 'string' ? q.explanation : '',
  };
}

/**
 * 한 단계의 레슨을 AI 가 끝내 못 만들었을 때: 노트의 개념 설명·예시·함정으로 카드를, 노트의 문제로 확인 문제를 만든다 (AI 없이).
 * 다른 단계는 AI 레슨 그대로라 길 전체가 실패하지 않는다
 */
export function fallbackLessons(lessons: CourseOutline['units'][number]['lessons'], note: Note, questions: NoteQuestionLite[]): CourseUnitAi['lessons'] {
  const byId = new Map(note.key_points.map((k) => [k.id, k]));
  return lessons.map((l) => {
    const kps = l.key_point_ids.map((id) => byId.get(id)).filter((k): k is Note['key_points'][number] => !!k);
    const ids = new Set(kps.map((k) => k.id));
    const cards: CourseUnitAi['lessons'][number]['cards'] = kps.map((k) => ({
      kind: 'concept',
      heading: clip(k.title, 20),
      text: k.explanation,
      tip: clip(k.why, 60),
    }));
    for (const ex of note.examples.filter((e) => ids.has(e.key_point_id)).slice(0, 2)) cards.push({ kind: 'example', heading: '예시', text: ex.text, tip: '' });
    for (const p of note.pitfalls.filter((e) => ids.has(e.key_point_id)).slice(0, 2))
      cards.push({ kind: 'tip', heading: '헷갈리기 쉬워요', text: p.text, tip: '' });
    if (!cards.length && l.goal.trim()) cards.push({ kind: 'concept', heading: clip(l.title, 20), text: l.goal, tip: '' });
    const checks = questions
      .filter((q) => typeof q.key_point_id === 'string' && ids.has(q.key_point_id))
      .map(questionAsCheck)
      .filter((c): c is Record<string, unknown> => !!c)
      .slice(0, 3);
    return { cards, checks };
  });
}

/** 뼈대 + 단계마다 받은 레슨 → 한 번에 만든 것과 같은 모양 (settleCourse 가 다듬는다). 레슨 수가 다르면 앞에서부터 맞춘다 */
export function assembleCourse(outline: CourseOutline, units: CourseUnitAi['lessons'][]): CourseAi {
  return {
    title: outline.title,
    intro: outline.intro,
    units: outline.units.map((u, ui) => ({
      title: u.title,
      summary: u.summary,
      lessons: u.lessons.map((l, li) => ({
        title: l.title,
        goal: l.goal,
        key_point_ids: l.key_point_ids,
        cards: units[ui]?.[li]?.cards ?? [],
        checks: units[ui]?.[li]?.checks ?? [],
      })),
    })),
  };
}

/** 한 단계에 보낼 노트: 그 단계의 개념과 그 개념의 함정·예시, 용어·공식은 모두 (개념이 없으면 노트 그대로) */
export function noteForStage(note: Note, keyPointIds: readonly string[]): Note {
  const ids = new Set(keyPointIds);
  const key_points = note.key_points.filter((k) => ids.has(k.id));
  if (!key_points.length) return note;
  return {
    ...note,
    key_points,
    pitfalls: note.pitfalls.filter((p) => ids.has(p.key_point_id)),
    examples: note.examples.filter((p) => ids.has(p.key_point_id)),
    checks: [],
    changes: [],
  };
}

// ------------------------------------------------------------- 진도 (progress)
export type Stars = 0 | 1 | 2 | 3;
export type CourseProgress = {
  /** "유닛번호-레슨번호" → 별 수 (1~3) 와 끝낸 때 */
  lessons: Record<string, { stars: number; at: string }>;
  /** 단계 복습(유닛번호) */
  recaps: Record<string, { stars: number; at: string }>;
  /** 마지막 총정리 */
  final?: { stars: number; at: string };
};

const zDone = z.object({ stars: z.number().int().min(0).max(3).catch(1), at: z.string().catch('') });
const zProgress = z.object({
  lessons: z.record(z.string(), zDone).catch({}),
  recaps: z.record(z.string(), zDone).catch({}),
  final: zDone.optional(),
});

export function readProgress(raw: unknown): CourseProgress {
  const r = zProgress.safeParse(raw ?? {});
  if (!r.success) return { lessons: {}, recaps: {} };
  return r.data;
}

export const lessonKey = (unit: number, lesson: number) => `${unit}-${lesson}`;

/** 맞힌 수로 별 1~3개: 다 맞으면 3, 70% 이상 2, 그 밑은 1 (레슨을 끝낸 것 자체를 쳐 준다). 확인 문제가 없으면 3 */
export function starsFor(correct: number, total: number): Stars {
  if (total <= 0) return 3;
  const r = correct / total;
  return r >= 1 ? 3 : r >= 0.7 ? 2 : 1;
}

// ------------------------------------------------------------- 길 (path)
export type CourseNode =
  | { kind: 'lesson'; id: string; unit: number; lesson: number; title: string; state: 'done' | 'current' | 'locked'; stars: number }
  | { kind: 'recap'; id: string; unit: number; title: string; state: 'done' | 'current' | 'locked'; stars: number }
  | { kind: 'final'; id: string; title: string; state: 'done' | 'current' | 'locked'; stars: number };

/**
 * 길 위의 칸들을 차례대로: 단계마다 레슨들 → 단계 복습, 맨 끝에 총정리.
 * 끝낸 칸 다음 하나만 '지금 할 것'(current)이고 그 뒤는 locked = 아직 차례가 아님 (듀오링고처럼 한 칸씩. 화면은 한 번 묻고 건너뛰게 해 준다). 끝낸 칸은 언제든 다시 할 수 있다
 */
export function courseNodes(plan: CoursePlan, progress: CourseProgress): CourseNode[] {
  const out: CourseNode[] = [];
  let unlocked = true;
  const state = (done: boolean): 'done' | 'current' | 'locked' => {
    if (done) return 'done';
    if (unlocked) {
      unlocked = false;
      return 'current';
    }
    return 'locked';
  };
  plan.units.forEach((u, ui) => {
    u.lessons.forEach((l, li) => {
      const p = progress.lessons[lessonKey(ui, li)];
      out.push({ kind: 'lesson', id: `l-${ui}-${li}`, unit: ui, lesson: li, title: l.title, state: state(!!p), stars: p?.stars ?? 0 });
    });
    const r = progress.recaps[String(ui)];
    out.push({ kind: 'recap', id: `r-${ui}`, unit: ui, title: `${u.title} 복습`, state: state(!!r), stars: r?.stars ?? 0 });
  });
  if (plan.units.length > 1) {
    const f = progress.final;
    out.push({ kind: 'final', id: 'final', title: '총정리', state: state(!!f), stars: f?.stars ?? 0 });
  }
  return out;
}

/** 단계가 이만큼부터면 길을 섹션으로 나눠 보인다 (길이 너무 길어 끝까지 내리기 힘들어서) */
export const SECTION_FROM_UNITS = 4;
/** 섹션 하나에 단계 몇 개쯤 (고르게 나눈다: 4단계 → 2·2, 5단계 → 3·2, 7단계 → 3·2·2) */
export const UNITS_PER_SECTION = 3;
/** 섹션 하나에 칸(레슨·단계 복습) 몇 개쯤까지: 단계마다 레슨이 많으면 섹션을 더 잘게 */
const SECTION_NODES = 13;

export type CourseSection = {
  /** 0부터 */
  index: number;
  /** 이 섹션의 단계 번호 (0부터, 차례대로) */
  units: number[];
  /** 이 섹션의 칸 (마지막 섹션에는 총정리도) */
  nodes: CourseNode[];
  done: number;
  total: number;
  /** done: 모두 끝냄, current: 지금 할 칸이 이 섹션에, later: 아직 (건너뛰어 끝낸 칸이 있을 수 있다) */
  state: 'done' | 'current' | 'later';
};

/**
 * 긴 길은 섹션으로 나눈다: 섹션 1(1~3단계) → 섹션 2(4~6단계) … 단계 번호는 길 전체로 이어진다.
 * 단계가 SECTION_FROM_UNITS 보다 적고 칸도 많지 않으면 null (나누지 않고 예전처럼 한 줄로).
 * 섹션 수 = 단계 3개쯤마다, 칸이 많으면 더 (단계보다 많지는 않게), 단계는 앞 섹션부터 하나씩 더 받아 고르게
 */
export function courseSections(plan: CoursePlan, nodes: CourseNode[]): CourseSection[] | null {
  const n = plan.units.length;
  const byUnits = n >= SECTION_FROM_UNITS ? Math.ceil(n / UNITS_PER_SECTION) : 1;
  const count = Math.min(n, Math.max(byUnits, Math.ceil(nodes.length / SECTION_NODES)));
  if (count < 2) return null;
  const base = Math.floor(n / count);
  let extra = n % count;
  const out: CourseSection[] = [];
  let next = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    const units = Array.from({ length: size }, (_, k) => next + k);
    next += size;
    const own = new Set(units);
    const list = nodes.filter((x) => (x.kind === 'final' ? i === count - 1 : own.has(x.unit)));
    const done = list.filter((x) => x.state === 'done').length;
    out.push({
      index: i,
      units,
      nodes: list,
      done,
      total: list.length,
      state: list.length > 0 && done === list.length ? 'done' : list.some((x) => x.state === 'current') ? 'current' : 'later',
    });
  }
  return out;
}

/** 단계(0부터)가 든 섹션 번호 (0부터). 나누지 않은 길이면 null */
export function sectionOfUnit(sections: CourseSection[] | null, unit: number): number | null {
  if (!sections) return null;
  return sections.find((x) => x.units.includes(unit))?.index ?? null;
}

export function courseStats(plan: CoursePlan, progress: CourseProgress): { total: number; done: number; lessons: number; checks: number } {
  const nodes = courseNodes(plan, progress);
  const lessons = plan.units.reduce((a, u) => a + u.lessons.length, 0);
  const checks = plan.units.reduce((a, u) => a + u.lessons.reduce((b, l) => b + l.checks.length, 0), 0);
  return { total: nodes.length, done: nodes.filter((n) => n.state === 'done').length, lessons, checks };
}

/** 글자열을 숫자로 (같은 날 같은 차례의 복습 문제가 바뀌지 않게 쓰는 간단한 해시) */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 여러 레슨의 확인 문제에서 고루 n 개를 뽑는다 (seed 가 같으면 같은 문제) */
export function pickChecks(lessons: CourseLesson[], n: number, seed: string): CourseCheck[] {
  const pools = lessons.map((l) => [...l.checks]).filter((p) => p.length);
  if (!pools.length) return [];
  let h = hash(seed);
  const next = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
  // 레슨마다 섞어 두고, 레슨을 돌며 하나씩 가져간다 (한 레슨 문제만 몰리지 않게)
  for (const p of pools) {
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
  }
  const out: CourseCheck[] = [];
  for (let round = 0; out.length < n; round++) {
    let took = false;
    for (const p of pools) {
      const c = p[round];
      if (!c) continue;
      out.push(c);
      took = true;
      if (out.length >= n) break;
    }
    if (!took) break;
  }
  return out;
}

/** 단계 복습 문제: 그 단계의 레슨 문제에서 */
export function recapChecks(plan: CoursePlan, unit: number, seed: string): CourseCheck[] {
  const u = plan.units[unit];
  return u ? pickChecks(u.lessons, COURSE_LIMITS.recap, `${seed}:recap:${unit}`) : [];
}

/** 총정리 문제: 모든 단계에서 */
export function finalChecks(plan: CoursePlan, seed: string): CourseCheck[] {
  return pickChecks(
    plan.units.flatMap((u) => u.lessons),
    COURSE_LIMITS.final,
    `${seed}:final`,
  );
}
