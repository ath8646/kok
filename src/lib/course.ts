// 단계별 학습 (Max): 노트 하나를 AI 가 단계(unit) → 레슨(lesson) → 카드·확인 문제로 나눈 학습 길.
// 서버가 만들어 note_courses.plan 에 저장하고, 화면은 길(path)을 그려 레슨을 하나씩 열어 준다. 진도는 note_courses.progress (학생이 고친다)
// 레슨은 듀오링고처럼 "카드 한 장 → 그 카드 문제"(문제의 after = 카드 번호)로 배우고 바로 떠올린다. 틀린 문제는 레슨 끝에 다시
// (CHECK_RETRIES 번까지), 처음에 틀린 문제는 진도의 mistakes 에 모아 단계 복습·총정리·'틀린 문제 복습'에서 먼저 낸다.
// 문제 종류: 객관식·OX·빈칸(낱말 고르기 또는 적기)·단답 + 짝 맞추기(match)·순서 맞추기(order).
// 예전 레슨(after·hint·pairs·figure_id 없음)은 카드를 다 본 뒤 문제, 예전 진도(mistakes 없음)도 그대로 읽힌다
import { z } from 'zod';
import { coursePlanRange } from '@/lib/ai/scale';
import { readChatQuestion, toQuestionRow, type CourseAi, type CourseOutline, type CourseUnitAi, type Note } from './ai/schemas';
import { normalizeAnswer, type QuestionType } from './grading';
import { stripChoiceLabels } from './material-questions';
import { codeRanges, plainMathText } from './richtext';

// ------------------------------------------------------------- 수준
export const COURSE_LEVELS = ['elementary', 'middle', 'high', 'college', 'expert'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/** 화면 이름과 한 줄 설명 (수준 고르기) */
export const COURSE_LEVEL_INFO: Record<CourseLevel, { name: string; desc: string }> = {
  elementary: { name: '초등학생', desc: '짧은 문장과 생활 속 예시, 외우기 요령 · 문제는 OX·쉬운 객관식·짝 맞추기 (타자 없이)' },
  middle: { name: '중학생', desc: '용어 뜻풀이와 원인·결과, 헷갈리는 둘 비교 · 문제는 객관식·OX·낱말 빈칸·짝·순서' },
  high: { name: '고등학생', desc: '시험 말투의 구분·조건·함정, 풀이 예시 · 문제는 응용 객관식·빈칸·순서·단답' },
  college: { name: '대학생', desc: '원리와 근거, 원어 용어 그대로, 비판적 비교 · 문제는 단답·두 개념을 잇는 객관식·순서' },
  expert: { name: '전문', desc: '원리·예외·한계와 실무 함정 · 문제는 미묘한 구분과 판단·단답' },
};

// ------------------------------------------------------------- 학습 내용 (plan)
export const COURSE_CHECK_TYPES = ['mcq', 'ox', 'cloze', 'short', 'match', 'order'] as const;
export type CourseCheckType = QuestionType | 'match' | 'order';
export type CoursePair = { left: string; right: string };
export type CourseCheck = {
  type: CourseCheckType;
  prompt: string;
  /** mcq: 보기, cloze: 고를 낱말 (null 이면 적어서 답한다), order: 바른 차례 (화면이 섞어 보인다) */
  choices: string[] | null;
  /** mcq: 정답 보기 번호, ox: 참·거짓, cloze·short: 답 글, match·order: '' */
  answer: number | boolean | string;
  accepted: string[];
  explanation: string;
  /** 나오는 자리: 몇 번째 카드 뒤 (0부터). 없으면 카드를 다 본 뒤 (예전 레슨) */
  after?: number;
  /** 답을 알려 주지 않는 힌트 한 줄 */
  hint?: string;
  /** 짝 맞추기의 짝 (왼쪽 ↔ 오른쪽) */
  pairs?: CoursePair[];
};
export type CourseCardKind = 'concept' | 'example' | 'compare' | 'tip';
export type CourseCard = {
  kind: CourseCardKind;
  heading: string;
  text: string;
  tip: string;
  /** 이 카드가 설명하는 노트의 자료 그림 ('f2') */
  figure_id?: string;
};
export type CourseLesson = { title: string; goal: string; key_point_ids: string[]; cards: CourseCard[]; checks: CourseCheck[] };
export type CourseUnit = { title: string; summary: string; lessons: CourseLesson[] };
export type CoursePlan = { title: string; intro: string; units: CourseUnit[] };

/** 만들 때 함께 보낼 원본 자료의 끝: 글은 글자 수, PDF 는 앞쪽 몇 쪽(크기도), 사진은 몇 장 */
export const COURSE_MATERIAL = { textChars: 20_000, pdfPages: 8, pdfBytes: 6 * 1024 * 1024, images: 4 } as const;
/** 레슨 하나의 카드·확인 문제 답 길이 (토큰): 카드 3~5장 + 문제 4~6개 (해설·힌트·짝 포함) */
const LESSON_TOKENS = 1300;
/** 답 길이와 에너지 검사·화면 예상에 쓰는 답 길이 (한 번에 만들 때): 개념 수에 따라 */
export function courseOut(keyPoints: number): { max: number; estimate: number } {
  const { lessons } = coursePlanRange(keyPoints);
  const max = Math.min(24_000, 4000 + lessons.max * LESSON_TOKENS);
  return { max, estimate: Math.round(max * 0.6) };
}

/**
 * 레슨이 이보다 많을 수 있는 노트(개념 7개부터)는 두 번에 나눠 만든다: 길의 뼈대 한 번 → 단계마다 레슨(동시에).
 * 한 번에 받으면 답이 길어 시간 안에 끝나지 않거나 잘렸다 (큰 노트의 레슨이 안 만들어지던 까닭).
 * 레슨마다 문제가 늘어(4~6개) 한 번에 만드는 크기를 레슨 6개까지로 줄였다 (예전 8개)
 */
export const COURSE_STAGED_FROM = 7;
export const courseStaged = (keyPoints: number) => coursePlanRange(keyPoints).lessons.max >= COURSE_STAGED_FROM;

/** 뼈대의 답 길이: 레슨마다 이름·목표·개념 번호 */
export function courseOutlineOut(keyPoints: number): number {
  return Math.min(8000, 1500 + coursePlanRange(keyPoints).lessons.max * 150);
}
/** 한 단계의 답 길이: 그 단계의 레슨 수만큼 */
export function courseUnitOut(lessons: number): number {
  return Math.min(12_000, Math.round(1500 + Math.max(1, lessons) * LESSON_TOKENS * 1.2));
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
export const COURSE_LIMITS = { units: 6, lessons: 6, cards: 8, checks: 7, recap: 6, final: 10 } as const;
/** 레슨 안에서 한 문제를 다시 내는 수 (틀리면 레슨 끝에: 처음 + 이만큼) */
export const CHECK_RETRIES = 2;
/** 모아 두는 틀린 문제 수 (진도 칸 32KB 안: 최근 것만) */
export const MISTAKES_MAX = 80;
/** '틀린 문제 복습' 한 번에 내는 수 */
export const MISTAKE_REVIEW = 10;
/** 저장할 학습 길의 크기 끝 (바이트, DB 칸 256KB 안: 넘으면 힌트·문제·카드를 줄인다) */
export const COURSE_PLAN_BYTES = 200_000;
/** 짝 맞추기 한 칸, 순서 맞추기 한 칸, 낱말 고르기 칩 하나의 글자 끝 (작은 칸에 들어가게) */
const PAIR_MAX = { left: 40, right: 60 } as const;
const ORDER_ITEM_MAX = 60;
const BANK_ITEM_MAX = 40;

/** 저장된 문제가 화면에서 풀 수 있는 모양인지 (모양이 깨진 문제 하나만 빼고 나머지는 둔다) */
function playable(c: CourseCheck): boolean {
  if (c.type === 'mcq') return !!c.choices && c.choices.length >= 2 && typeof c.answer === 'number' && c.answer >= 0 && c.answer < c.choices.length;
  if (c.type === 'ox') return typeof c.answer === 'boolean';
  if (c.type === 'match') return (c.pairs?.length ?? 0) >= 2;
  if (c.type === 'order') return (c.choices?.length ?? 0) >= 2;
  return typeof c.answer === 'string' && !!c.answer.trim();
}

const zCheck = z.object({
  type: z.enum(COURSE_CHECK_TYPES),
  prompt: z.string(),
  choices: z.array(z.string()).nullable().catch(null),
  answer: z.union([z.number(), z.boolean(), z.string()]),
  accepted: z.array(z.string()).catch([]),
  explanation: z.string().catch(''),
  after: z.number().int().min(0).optional().catch(undefined),
  hint: z.string().optional().catch(undefined),
  pairs: z
    .array(z.object({ left: z.string(), right: z.string() }))
    .optional()
    .catch(undefined),
});
const zCard = z.object({
  kind: z.enum(['concept', 'example', 'compare', 'tip']).catch('concept'),
  heading: z.string().catch(''),
  text: z.string().catch(''),
  tip: z.string().catch(''),
  figure_id: z.string().optional().catch(undefined),
});
/** 목록에서 읽을 수 있는 것만 (하나가 깨져도 나머지는 남긴다) */
function each<T>(item: z.ZodType<T>, keep: (x: T) => boolean = () => true) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((xs) =>
      xs.flatMap((x) => {
        const r = item.safeParse(x);
        return r.success && keep(r.data) ? [r.data] : [];
      }),
    );
}
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
              cards: each(zCard),
              checks: each(zCheck, (c) => playable(c as CourseCheck)),
            }),
          )
          .catch([]),
      }),
    )
    .catch([]),
});

/**
 * 저장된 학습 내용을 읽는다 (모양이 깨졌으면 null).
 * 예전 레슨의 객관식은 보기 번호(① · 1.)를 단 채로 저장돼 있어서 뗀다 (화면이 번호를 따로 달고 보기를 섞는다)
 */
export function readCoursePlan(raw: unknown): CoursePlan | null {
  const r = zPlan.safeParse(raw);
  if (!r.success) return null;
  const plan = r.data as CoursePlan;
  const units = plan.units
    .filter((u) => u.lessons.length)
    .map((u) => ({
      ...u,
      lessons: u.lessons.map((l) => ({
        ...l,
        checks: l.checks.map((c) => (c.type === 'mcq' && c.choices ? { ...c, choices: stripChoiceLabels(c.choices) } : c)),
      })),
    }));
  if (!units.length) return null;
  return { ...plan, units };
}

const clip = (s: string, n: number) => {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** 견주기용: 띄어쓰기 없이 작은 글자로 (수식은 읽을 수 있는 글자로) */
const squash = (s: string) => plainMathText(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** AI 가 쓴 문제 칸 (받은 그대로, 다듬기 전) */
const zRawCheck = z.object({
  type: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .catch(''),
  prompt: z.string().catch(''),
  choices: z
    .array(z.unknown())
    .catch([])
    .transform((xs) => xs.filter((x): x is string => typeof x === 'string')),
  explanation: z.string().catch(''),
  hint: z.string().catch(''),
  after: z.number().int().nullable().catch(null),
  pairs: z.array(z.object({ left: z.string().catch(''), right: z.string().catch('') })).catch([]),
});
type RawCheck = z.infer<typeof zRawCheck>;

/** 보기가 다른 보기의 자리를 가리킨다 (①, '위의 것 모두'): 보기를 섞으면 뜻이 바뀌어서 그런 문제는 뺀다 */
const POSITIONAL = /(위|앞|아래)의?\s*(것|보기|답|내용)|[①-⑩]|(^|\s)\d\s*번(?!째)/;

/** 빈칸·단답의 답이 문제 글에 그대로 보이면 (답을 알려 주는 문제) */
function givesAway(prompt: string, answer: string): boolean {
  const a = squash(answer);
  if (a.length < 2 || /^[\d.,\-+]+$/.test(a)) return false;
  return squash(prompt.replace(/_{2,}|\(\s*\)|\[\s*\]/g, ' ')).includes(a);
}

/** 낱말 고르기 빈칸의 칩: 정답 + 헷갈리는 낱말 (같은 낱말·같이 인정하는 답은 빼고). 3개가 안 되면 null (적어서 답한다) */
function wordBank(raw: readonly string[], answer: string, accepted: readonly string[]): string[] | null {
  const alt = new Set(accepted.map((a) => normalizeAnswer(plainMathText(a))));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string, isAnswer: boolean) => {
    const t = s.trim();
    if (!t || t.length > BANK_ITEM_MAX) return;
    const k = normalizeAnswer(plainMathText(t));
    if (!k || seen.has(k) || (!isAnswer && alt.has(k))) return;
    seen.add(k);
    out.push(t);
  };
  add(answer, true);
  if (!out.length) return null;
  for (const x of raw) add(x, false);
  return out.length >= 3 ? out.slice(0, 6) : null;
}

function settleMatch(c: RawCheck, extra: Partial<CourseCheck>): CourseCheck | null {
  const pairs: CoursePair[] = [];
  const ls = new Set<string>();
  const rs = new Set<string>();
  for (const p of c.pairs) {
    const left = p.left.trim();
    const right = p.right.trim();
    if (!left || !right || left.length > PAIR_MAX.left || right.length > PAIR_MAX.right) continue;
    const l = squash(left);
    const r = squash(right);
    if (!l || !r || l === r || ls.has(l) || rs.has(r)) continue;
    ls.add(l);
    rs.add(r);
    pairs.push({ left, right });
    if (pairs.length >= 5) break;
  }
  if (pairs.length < 3) return null;
  return { type: 'match', prompt: clip(c.prompt, 300) || '짝을 맞춰 보세요', choices: null, answer: '', accepted: [], explanation: clip(c.explanation, 600), pairs, ...extra };
}

function settleOrder(c: RawCheck, extra: Partial<CourseCheck>): CourseCheck | null {
  const prompt = clip(c.prompt, 300);
  const items: string[] = [];
  const seen = new Set<string>();
  // 모든 칸이 차례 번호(1. 2. 3. · ①②③)를 달고 있으면 뗀다 (섞어도 번호가 차례를 알려 주지 않게)
  for (const x of stripChoiceLabels(c.choices)) {
    const t = x.trim();
    if (!t || t.length > ORDER_ITEM_MAX) continue;
    const k = squash(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    items.push(t);
    if (items.length >= 6) break;
  }
  if (!prompt || items.length < 3) return null;
  return { type: 'order', prompt, choices: items, answer: '', accepted: [], explanation: clip(c.explanation, 600), ...extra };
}

/**
 * AI 확인 문제 → 풀 수 있는 문제. 답을 읽을 수 없거나 이상하면 null:
 * 객관식은 보기가 3~6개·겹치지 않음·다른 보기 자리를 가리키지 않음, 빈칸·단답은 답이 문제 글에 보이지 않음,
 * 빈칸의 낱말 칩은 정답을 꼭 넣고 3~6개, 짝은 3~5쌍(겹치지 않게), 순서는 3~6칸.
 * card: AI 가 적은 카드 번호 → 남은 카드 번호 (빈 카드를 뺀 만큼 옮긴다)
 */
export function settleCheck(raw: unknown, o: { card?: (i: number) => number } = {}): CourseCheck | null {
  const r = zRawCheck.safeParse(raw);
  if (!r.success) return null;
  const c = r.data;
  const extra: Partial<CourseCheck> = {};
  if (c.after !== null) extra.after = o.card ? o.card(c.after) : Math.max(0, c.after);
  const hint = clip(c.hint, 160);
  if (hint) extra.hint = hint;
  if (c.type === 'match') return settleMatch(c, extra);
  if (c.type === 'order') return settleOrder(c, extra);
  const q = readChatQuestion(raw);
  if (!q) return null;
  const row = toQuestionRow(q);
  if (!row) return null;
  let choices = row.choices;
  if (row.type === 'mcq') {
    choices = stripChoiceLabels(row.choices ?? []);
    if (choices.some((x) => POSITIONAL.test(x))) return null;
  }
  if ((row.type === 'cloze' || row.type === 'short') && givesAway(row.prompt, String(row.answer))) return null;
  if (row.type === 'cloze') choices = wordBank(c.choices, String(row.answer), row.accepted);
  return { type: row.type, prompt: row.prompt, choices, answer: row.answer, accepted: row.accepted, explanation: clip(row.explanation, 600), ...extra };
}

/** 같은 문제인지 (한 레슨에 두 번 넣지 않게) */
function checkSig(c: CourseCheck): string {
  return [c.type, squash(c.prompt), ...(c.choices ?? []).map(squash), ...(c.pairs ?? []).map((p) => `${squash(p.left)}=${squash(p.right)}`)].join('|');
}

/**
 * 노트 용어로 만드는 짝 맞추기 (AI 없이): 이 레슨 카드에 나온 용어 3~4개와 그 뜻.
 * 짧은 것만 (용어 16자·뜻 32자: 작은 칸에 들어가게), 뜻에 용어가 그대로 든 것은 뺀다 (답을 알려 줘서). 3개가 안 되면 null
 */
export function termMatch(terms: ReadonlyArray<{ term: string; meaning: string }>, cards: readonly CourseCard[]): CourseCheck | null {
  const text = squash(cards.map((c) => `${c.heading} ${c.text} ${c.tip}`).join(' '));
  const pairs: CoursePair[] = [];
  const ls = new Set<string>();
  const rs = new Set<string>();
  for (const t of terms) {
    const left = t.term.trim();
    const right = t.meaning.trim();
    if (plainMathText(left).length > 16 || plainMathText(right).length > 32) continue;
    const l = squash(left);
    const r = squash(right);
    if (l.length < 2 || !r || ls.has(l) || rs.has(r) || r.includes(l) || !text.includes(l)) continue;
    ls.add(l);
    rs.add(r);
    pairs.push({ left, right });
    if (pairs.length >= 4) break;
  }
  if (pairs.length < 3) return null;
  return { type: 'match', prompt: '용어와 뜻을 짝지어 보세요', choices: null, answer: '', accepted: [], explanation: '', pairs };
}

/** 받은 카드 → 저장할 카드 (빈 카드는 null, 노트에 없는 그림 번호는 지운다) */
function settleCard(c: { kind: CourseCardKind; heading: string; text: string; tip: string; figure_id?: string }, figures: ReadonlySet<string>): CourseCard | null {
  const text = clip(c.text, 600);
  if (!text) return null;
  const card: CourseCard = { kind: c.kind, heading: clip(c.heading, 40), text, tip: clip(c.tip, 200) };
  const f = (c.figure_id ?? '').trim();
  if (f && figures.has(f)) card.figure_id = f;
  return card;
}

export type SettleExtra = {
  /** 노트의 자료 그림 번호 (카드의 figure_id 는 이 안에서만) */
  figureIds?: readonly string[];
  /** 노트의 용어 (짝 맞추기가 없는 레슨에 용어 짝 맞추기를 더한다) */
  terms?: ReadonlyArray<{ term: string; meaning: string }>;
};

/**
 * AI 가 만든 학습 길을 저장할 모양으로 다듬는다: 빈 것은 빼고, 수를 줄이고, 글은 자른다.
 * 노트에 없는 개념 번호·그림 번호는 뺀다. 문제의 자리(after)는 남은 카드 번호로 옮긴다.
 * 짝 맞추기가 없는 레슨에 노트 용어가 3개 넘게 나오면 용어 짝 맞추기를 하나 더한다 (AI 없이). 레슨이 하나도 없으면 null
 */
export function settleCourse(ai: CourseAi, keyPointIds: readonly string[], extra: SettleExtra = {}): CoursePlan | null {
  const known = new Set(keyPointIds);
  const figures = new Set(extra.figureIds ?? []);
  const units: CourseUnit[] = [];
  for (const u of ai.units.slice(0, COURSE_LIMITS.units)) {
    const lessons: CourseLesson[] = [];
    for (const l of u.lessons.slice(0, COURSE_LIMITS.lessons)) {
      const cards: CourseCard[] = [];
      // AI 가 적은 카드 번호 → 남은 카드 번호 (빈 카드 뒤의 문제는 그 앞 카드 뒤로)
      const cardAt: number[] = [];
      for (const c of l.cards) {
        const card = cards.length < COURSE_LIMITS.cards ? settleCard(c, figures) : null;
        if (card) cards.push(card);
        cardAt.push(Math.max(0, cards.length - 1));
      }
      if (!cards.length) continue;
      const toCard = (i: number) => cardAt[Math.min(Math.max(0, i), cardAt.length - 1)] ?? 0;
      const checks: CourseCheck[] = [];
      const seen = new Set<string>();
      for (const raw of l.checks) {
        if (checks.length >= COURSE_LIMITS.checks) break;
        const c = settleCheck(raw, { card: toCard });
        if (!c) continue;
        const sig = checkSig(c);
        if (seen.has(sig)) continue;
        seen.add(sig);
        checks.push(c);
      }
      if (extra.terms?.length && checks.length < COURSE_LIMITS.checks - 1 && !checks.some((c) => c.type === 'match')) {
        const m = termMatch(extra.terms, cards);
        if (m) checks.push({ ...m, after: cards.length - 1 });
      }
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
  return fitPlanSize({ title: clip(ai.title, 60), intro: clip(ai.intro, 240), units });
}

const planBytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;

/**
 * 저장 칸(256KB)에 들어가게: 크면 덜 중요한 것부터 줄인다 (힌트 → 문제 5개 → 카드 4장 → 해설 → 문제 3개 → 카드 글).
 * 레슨이 많고(나눠 만든 길은 36개까지) 한글이 많을 때만 (한글은 한 글자 3바이트)
 */
export function fitPlanSize(plan: CoursePlan, max = COURSE_PLAN_BYTES): CoursePlan {
  if (planBytes(plan) <= max) return plan;
  const steps: Array<(l: CourseLesson) => CourseLesson> = [
    (l) => ({
      ...l,
      checks: l.checks.map((c) => {
        const { hint: _h, ...rest } = c;
        void _h;
        return rest;
      }),
    }),
    (l) => ({ ...l, checks: l.checks.slice(0, 5) }),
    (l) => ({ ...l, cards: l.cards.slice(0, 4) }),
    (l) => ({ ...l, checks: l.checks.map((c) => ({ ...c, explanation: clip(c.explanation, 120) })) }),
    (l) => ({ ...l, checks: l.checks.slice(0, 3) }),
    (l) => ({ ...l, cards: l.cards.slice(0, 3).map((c) => ({ ...c, text: clip(c.text, 200), tip: clip(c.tip, 60) })) }),
    (l) => ({ ...l, checks: l.checks.map((c) => ({ ...c, prompt: clip(c.prompt, 160), explanation: clip(c.explanation, 60) })) }),
  ];
  let out = plan;
  for (const step of steps) {
    out = { ...out, units: out.units.map((u) => ({ ...u, lessons: u.lessons.map(step) })) };
    if (planBytes(out) <= max) break;
  }
  return out;
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
 * 다른 단계는 AI 레슨 그대로라 길 전체가 실패하지 않는다. 용어 짝 맞추기는 settleCourse 가 더한다
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

// ------------------------------------------------------------- 레슨 안의 차례·채점
export type LessonStep = { kind: 'card'; index: number } | { kind: 'check'; index: number };

/**
 * 레슨의 차례: 문제에 자리(after)가 있으면 "카드 한 장 → 그 카드 문제"를 되풀이하고,
 * 자리가 없는 문제는 카드를 다 본 뒤에. 자리가 하나도 없으면(예전 레슨) 카드를 다 본 뒤 문제
 */
export function lessonSteps(cards: number, checks: ReadonlyArray<Pick<CourseCheck, 'after'>>): LessonStep[] {
  const out: LessonStep[] = [];
  const placed = cards > 0 && checks.some((c) => typeof c.after === 'number');
  for (let i = 0; i < cards; i++) {
    out.push({ kind: 'card', index: i });
    if (!placed) continue;
    checks.forEach((c, j) => {
      if (typeof c.after === 'number' && Math.min(Math.max(0, c.after), cards - 1) === i) out.push({ kind: 'check', index: j });
    });
  }
  checks.forEach((c, j) => {
    if (!placed || typeof c.after !== 'number') out.push({ kind: 'check', index: j });
  });
  return out;
}

/** 순서 맞추기: 놓은 차례가 바른 차례와 같은지 (띄어쓰기·문장 부호는 보지 않는다) */
export function orderCorrect(check: Pick<CourseCheck, 'choices'>, items: readonly string[]): boolean {
  const want = check.choices ?? [];
  return want.length > 0 && items.length === want.length && items.every((x, i) => normalizeAnswer(x) === normalizeAnswer(want[i]));
}

/** 정답을 한 줄 글로 (틀렸을 때·끝 화면의 틀린 문제·신고) */
export function checkAnswerText(c: CourseCheck): string {
  if (c.type === 'mcq') return c.choices?.[Number(c.answer)] ?? '';
  if (c.type === 'ox') return c.answer ? 'O (맞다)' : 'X (틀리다)';
  if (c.type === 'order') return (c.choices ?? []).join(' → ');
  if (c.type === 'match') return (c.pairs ?? []).map((p) => `${p.left} = ${p.right}`).join(', ');
  return String(c.answer ?? '');
}

/** 글자열을 숫자로 (같은 날 같은 차례의 복습 문제가 바뀌지 않게 쓰는 간단한 해시) */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: string): () => number {
  let h = hash(seed);
  return () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
}

/**
 * 0..n-1 을 섞은 차례 (seed 가 같으면 같다). moved: 처음 차례 그대로는 내지 않는다 (순서 맞추기·짝 맞추기가 처음부터 맞아 있지 않게)
 */
export function shuffled(n: number, seed: string, moved = false): number[] {
  const next = rng(seed);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (moved && n > 1 && out.every((x, i) => x === i)) out.push(out.shift()!);
  return out;
}

/**
 * 객관식·낱말 칩을 보일 차례 (seed 가 같으면 같다: 키보드 숫자·신고의 번호도 이것으로).
 * 다른 보기 자리를 가리키는 보기가 있으면('①과 ② 모두': 예전 레슨) 섞지 않고 처음 차례 그대로
 */
export function choiceOrder(c: Pick<CourseCheck, 'type' | 'choices'>, seed: string): number[] {
  const n = c.choices?.length ?? 0;
  if (c.type === 'mcq' && c.choices?.some((x) => POSITIONAL.test(x))) return Array.from({ length: n }, (_, i) => i);
  return shuffled(n, seed);
}

/**
 * 짝 맞추기의 두 줄 차례 (왼쪽·오른쪽 따로 섞는다). 같은 줄에 제 짝이 나란히 놓인 줄은 하나까지만
 * (따로 섞기만 하면 짝 3개 판의 다섯에 하나는 처음부터 다 맞춰진 채로 나왔다)
 */
export function matchColumns(n: number, seed: string): { lefts: number[]; rights: number[] } {
  const lefts = shuffled(n, `${seed}:l`);
  for (let t = 0; t < 24; t++) {
    const rights = shuffled(n, `${seed}:r${t || ''}`);
    if (rights.filter((r, k) => r === lefts[k]).length <= 1) return { lefts, rights };
  }
  // 한 칸씩 밀면 어느 줄도 제 짝이 아니다
  return { lefts, rights: lefts.map((_, k) => lefts[(k + 1) % n]) };
}

/** 빈칸 자리 찾기 차례: 밑줄 셋 이상 → 밑줄 둘 → ( )·[ ]. 낱말에 붙은 것(snake_case·__init__·print())은 빈칸이 아니다 */
const BLANKS = [/(?<![A-Za-z0-9_])_{3,}(?![A-Za-z0-9_])/g, /(?<![A-Za-z0-9_])__(?![A-Za-z0-9_])/g, /(?<![A-Za-z0-9_])(?:\(\s*\)|\[\s*\])/g];

/**
 * 빈칸 문제의 답 자리 (글에서 [start, end)): 코드(`조각`·``` 블록) 밖의 첫 빈칸. 없으면 null
 * (코드 안의 빈칸은 코드 그대로 보이고 고른 낱말은 문제 아래 칸에)
 */
export function clozeBlank(prompt: string): { start: number; end: number } | null {
  const code = codeRanges(prompt);
  for (const re of BLANKS) {
    for (const m of prompt.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!code.some(([a, b]) => start < b && end > a)) return { start, end };
    }
  }
  return null;
}

/** 레슨에 걸리는 시간 어림 (분): 카드 20초, 문제 20~40초 (말풍선) */
export function lessonMinutes(cards: number, checks: ReadonlyArray<Pick<CourseCheck, 'type' | 'choices'>>): number {
  const secs = cards * 20 + checks.reduce((a, c) => a + (c.type === 'match' ? 40 : c.type === 'order' ? 35 : c.type === 'short' || (c.type === 'cloze' && !c.choices) ? 30 : 20), 0);
  return Math.max(1, Math.round(secs / 60));
}

// ------------------------------------------------------------- 진도 (progress)
export type Stars = 0 | 1 | 2 | 3;
export type CourseMistake = { at: string; n: number };
export type CourseProgress = {
  /** "유닛번호-레슨번호" → 별 수 (1~3) 와 끝낸 때 */
  lessons: Record<string, { stars: number; at: string }>;
  /** 단계 복습(유닛번호) */
  recaps: Record<string, { stars: number; at: string }>;
  /** 마지막 총정리 */
  final?: { stars: number; at: string };
  /** 처음에 틀린 문제: "유닛-레슨-문제번호" → 마지막에 틀린 때·틀린 수. 처음에 맞히면 빠진다 */
  mistakes?: Record<string, CourseMistake>;
};

const zDone = z.object({ stars: z.number().int().min(0).max(3).catch(1), at: z.string().catch('') });
const zMistake = z.object({ at: z.string().catch(''), n: z.number().int().min(1).catch(1) });
const zProgress = z.object({
  lessons: z.record(z.string(), zDone).catch({}),
  recaps: z.record(z.string(), zDone).catch({}),
  final: zDone.optional().catch(undefined),
  mistakes: z.record(z.string(), zMistake).optional().catch(undefined),
});

export function readProgress(raw: unknown): CourseProgress {
  const r = zProgress.safeParse(raw ?? {});
  if (!r.success) return { lessons: {}, recaps: {} };
  const { final, mistakes, ...rest } = r.data;
  return { ...rest, ...(final ? { final } : {}), ...(mistakes && Object.keys(mistakes).length ? { mistakes } : {}) };
}

export const lessonKey = (unit: number, lesson: number) => `${unit}-${lesson}`;
/** 문제 하나의 번호: "유닛-레슨-문제" (틀린 문제 모으기) */
export const checkKey = (unit: number, lesson: number, check: number) => `${unit}-${lesson}-${check}`;

/** 맞힌 수로 별 1~3개: 다 맞으면 3, 70% 이상 2, 그 밑은 1 (레슨을 끝낸 것 자체를 쳐 준다). 확인 문제가 없으면 3 */
export function starsFor(correct: number, total: number): Stars {
  if (total <= 0) return 3;
  const r = correct / total;
  return r >= 1 ? 3 : r >= 0.7 ? 2 : 1;
}

/** 레슨·복습을 끝낸 결과. rightFirst·wrongFirst: 처음 답이 맞은·틀린 문제 번호 (checkKey) */
export type LessonResult = { stars: Stars; correct: number; total: number; rightFirst: string[]; wrongFirst: string[] };
export type ResultNode = { kind: 'lesson'; unit: number; lesson: number } | { kind: 'recap'; unit: number } | { kind: 'final' } | { kind: 'mistakes' };

/**
 * 끝낸 결과를 진도에 적는다: 별은 더 높은 것만 남기고('틀린 문제 복습'은 별이 없다),
 * 처음에 틀린 문제는 틀린 문제에 넣고(틀린 수 +1), 처음에 맞힌 문제는 뺀다. 틀린 문제는 최근 MISTAKES_MAX 개까지
 */
export function applyResult(p: CourseProgress, node: ResultNode, r: LessonResult, at: string): CourseProgress {
  const out: CourseProgress = { lessons: { ...p.lessons }, recaps: { ...p.recaps }, ...(p.final ? { final: p.final } : {}) };
  const keep = (old: { stars: number } | undefined) => ({ stars: Math.max(old?.stars ?? 0, r.stars), at });
  if (node.kind === 'lesson') {
    const k = lessonKey(node.unit, node.lesson);
    out.lessons[k] = keep(out.lessons[k]);
  } else if (node.kind === 'recap') out.recaps[String(node.unit)] = keep(out.recaps[String(node.unit)]);
  else if (node.kind === 'final') out.final = keep(out.final);
  const mistakes: Record<string, CourseMistake> = { ...(p.mistakes ?? {}) };
  for (const k of r.rightFirst) delete mistakes[k];
  for (const k of r.wrongFirst) mistakes[k] = { at, n: (mistakes[k]?.n ?? 0) + 1 };
  const keys = Object.keys(mistakes);
  if (keys.length > MISTAKES_MAX) {
    keys.sort((a, b) => (mistakes[b].at < mistakes[a].at ? -1 : mistakes[b].at > mistakes[a].at ? 1 : 0));
    for (const k of keys.slice(MISTAKES_MAX)) delete mistakes[k];
  }
  if (Object.keys(mistakes).length) out.mistakes = mistakes;
  return out;
}

// ------------------------------------------------------------- 복습 문제 고르기
/** 어느 레슨의 몇 번째 문제인지 붙인 문제 (틀린 문제 모으기·신고) */
export type KeyedCheck = { key: string; unit: number; lesson: number; check: CourseCheck };

function lessonPool(plan: CoursePlan, unit: number, lesson: number): KeyedCheck[] {
  return (plan.units[unit]?.lessons[lesson]?.checks ?? []).map((check, i) => ({ key: checkKey(unit, lesson, i), unit, lesson, check }));
}

/** 번호로 문제를 찾는다 (없는 번호면 null: 레슨을 다시 만들면 진도와 함께 비워져서 보통은 없다) */
function keyed(plan: CoursePlan, key: string): KeyedCheck | null {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(key);
  if (!m) return null;
  const [unit, lesson, i] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = plan.units[unit]?.lessons[lesson]?.checks[i];
  return check ? { key, unit, lesson, check } : null;
}

/** 틀린 문제 번호를 최근 것부터 (where: 그 단계만) */
function recentMistakes(plan: CoursePlan, mistakes: CourseProgress['mistakes'], where?: (k: KeyedCheck) => boolean): KeyedCheck[] {
  return Object.entries(mistakes ?? {})
    .sort(([ka, a], [kb, b]) => (a.at < b.at ? 1 : a.at > b.at ? -1 : ka.localeCompare(kb)))
    .map(([k]) => keyed(plan, k))
    .filter((k): k is KeyedCheck => !!k && (!where || where(k)));
}

/**
 * 여러 레슨의 확인 문제에서 n 개를 뽑는다: first(틀렸던 문제)를 먼저 넣고, 남은 자리는 레슨마다 섞어 고루 (seed 가 같으면 같은 문제)
 */
export function pickChecks(pools: KeyedCheck[][], n: number, seed: string, first: readonly KeyedCheck[] = []): KeyedCheck[] {
  const out: KeyedCheck[] = [];
  const taken = new Set<string>();
  for (const k of first) {
    if (out.length >= n) break;
    if (taken.has(k.key)) continue;
    taken.add(k.key);
    out.push(k);
  }
  const rest = pools.map((p) => p.filter((k) => !taken.has(k.key))).filter((p) => p.length);
  const next = rng(seed);
  // 레슨마다 섞어 두고, 레슨을 돌며 하나씩 가져간다 (한 레슨 문제만 몰리지 않게)
  for (const p of rest) {
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
  }
  for (let round = 0; out.length < n; round++) {
    let took = false;
    for (const p of rest) {
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

/** 단계 복습 문제: 그 단계에서 틀린 문제를 먼저, 남은 자리는 그 단계 레슨에서 고루 */
export function recapChecks(plan: CoursePlan, unit: number, seed: string, mistakes?: CourseProgress['mistakes']): KeyedCheck[] {
  const u = plan.units[unit];
  if (!u) return [];
  return pickChecks(
    u.lessons.map((_, li) => lessonPool(plan, unit, li)),
    COURSE_LIMITS.recap,
    `${seed}:recap:${unit}`,
    recentMistakes(plan, mistakes, (k) => k.unit === unit),
  );
}

/** 총정리 문제: 길 전체에서 틀린 문제를 먼저 (자리의 반까지), 남은 자리는 모든 단계에서 고루 */
export function finalChecks(plan: CoursePlan, seed: string, mistakes?: CourseProgress['mistakes']): KeyedCheck[] {
  return pickChecks(
    plan.units.flatMap((u, ui) => u.lessons.map((_, li) => lessonPool(plan, ui, li))),
    COURSE_LIMITS.final,
    `${seed}:final`,
    recentMistakes(plan, mistakes).slice(0, Math.ceil(COURSE_LIMITS.final / 2)),
  );
}

/** '틀린 문제 복습': 최근에 틀린 것부터 MISTAKE_REVIEW 개 */
export function mistakeChecks(plan: CoursePlan, progress: CourseProgress, limit = MISTAKE_REVIEW): KeyedCheck[] {
  return recentMistakes(plan, progress.mistakes).slice(0, limit);
}

/** 모아 둔 틀린 문제 수 (지금 길에 있는 것만) */
export function mistakeCount(plan: CoursePlan, progress: CourseProgress): number {
  return recentMistakes(plan, progress.mistakes).length;
}

// ------------------------------------------------------------- 길 (path)
export type CourseNode =
  | { kind: 'lesson'; id: string; unit: number; lesson: number; title: string; state: 'done' | 'current' | 'locked'; stars: number }
  | { kind: 'recap'; id: string; unit: number; title: string; state: 'done' | 'current' | 'locked'; stars: number }
  | { kind: 'final'; id: string; title: string; state: 'done' | 'current' | 'locked'; stars: number };

/**
 * 길 위의 칸들을 차례대로: 단계마다 레슨들 → 단계 복습, 맨 끝에 총정리.
 * 끝낸 칸 다음 하나만 '지금 할 것'(current)이고 그 뒤는 locked = 아직 차례가 아님 (듀오링고처럼 한 칸씩. 화면은 말풍선에서 건너뛰게 해 준다). 끝낸 칸은 언제든 다시 할 수 있다
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

/** 앞에 끝내지 않은 칸 수 (건너뛰는 칸 수: 말풍선 안내) */
export function skippedBefore(nodes: readonly CourseNode[], id: string): number {
  const at = nodes.findIndex((n) => n.id === id);
  return at < 0 ? 0 : nodes.slice(0, at).filter((n) => n.state !== 'done').length;
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

// ------------------------------------------------------------- 핵심 정리 (단계마다)
/** 단계의 카드에 나온 노트 용어 (핵심 정리 시트) */
export function unitTerms(unit: CourseUnit, terms: ReadonlyArray<{ term: string; meaning: string }>): Array<{ term: string; meaning: string }> {
  const text = squash(unit.lessons.flatMap((l) => l.cards.map((c) => `${c.heading} ${c.text} ${c.tip}`)).join(' '));
  const seen = new Set<string>();
  return terms.filter((t) => {
    const k = squash(t.term);
    if (k.length < 2 || seen.has(k) || !text.includes(k)) return false;
    seen.add(k);
    return true;
  });
}
