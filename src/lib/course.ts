// 단계별 학습 (Pro): 노트 하나를 AI 가 단계(unit) → 레슨(lesson) → 카드·확인 문제로 나눈 학습 길.
// 서버가 만들어 note_courses.plan 에 저장하고, 화면은 길(path)을 그려 레슨을 하나씩 열어 준다. 진도는 note_courses.progress (학생이 고친다)
import { z } from 'zod';
import { readChatQuestion, toQuestionRow, type CourseAi } from './ai/schemas';
import type { QuestionType } from './grading';

// ------------------------------------------------------------- 수준
export const COURSE_LEVELS = ['elementary', 'middle', 'high', 'college', 'expert'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/** 화면 이름과 한 줄 설명 (수준 고르기) */
export const COURSE_LEVEL_INFO: Record<CourseLevel, { name: string; desc: string }> = {
  elementary: { name: '초등학생', desc: '쉬운 말과 생활 속 예로, 짧게' },
  middle: { name: '중학생', desc: '교과서처럼 용어를 풀어 설명' },
  high: { name: '고등학생', desc: '시험에 나오는 구분·함정까지' },
  college: { name: '대학생', desc: '원리와 근거, 원어 용어 그대로' },
  expert: { name: '전문', desc: '깊이 있게, 예외와 한계까지' },
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
/** 답 길이 (레슨 20개 × 카드·문제) 와 에너지 검사·화면 예상에 쓰는 답 길이 */
export const COURSE_OUT = { max: 16_000, estimate: 9_000 } as const;

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
      const checks = l.checks.map(settleCheck).filter((c): c is CourseCheck => !!c).slice(0, COURSE_LIMITS.checks);
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
