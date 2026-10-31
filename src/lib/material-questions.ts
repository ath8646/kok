// 자료 종류에 따른 문제 (lib/material-type.ts):
// - 기출·문제집: AI 가 꺼낸 원래 문제를 읽어 문제 행으로 (readOriginals). 번호·배점을 떼고, 보기 번호는 모든 보기에 같은 꼴로
//   붙어 있을 때만 뗀다('A. Lincoln' 같은 보기를 깨뜨리지 않게). 정답은 보기의 글로 받아 번호를 하나 밀려 적는 일이 없다.
// - 단어장: 노트의 용어(낱말 → 뜻)마다 AI 없이 카드를 만든다 (vocabCards: 노트에 적힌 뜻 그대로라 틀린 문제가 생기지 않는다).
//   조각을 합치거나 노트에 더할 때 용어·예문은 AI 에 보내지 않고 앱이 옮긴다 (mergeTerms·addMissingTerms·placeExamples:
//   낱말이 많아도 합친 답이 길어져 잘리지 않고, 낱말이 빠지거나 뜻이 바뀌지 않게).
// 서버(파이프라인)와 시험이 같이 쓴다 (화면 없이 계산만).
import { readChatQuestion, toQuestionRow, type QuizItem } from './ai/schemas';
import { QUESTIONS_MAX } from './ai/scale';
import { matchKeyPoint } from './source-figures';

type QuestionRow = NonNullable<ReturnType<typeof toQuestionRow>>;

/**
 * 파이프라인이 들고 다니는 문제 (저장할 때 origin·answer_from·kp_title 은 뗀다).
 * origin: material = 자료의 원래 문제, vocab = 단어장 카드 (AI 검사를 건너뛴다). answer_from: 원래 문제의 답을 어디서 얻었는지.
 * kp_title: 원래 문제를 꺼낼 때 노트의 개념 이름 (노트를 다시 합쳐 번호가 바뀌어도 이름으로 다시 붙인다).
 * figure_crop: 원래 문제가 쓰는 자료 그림의 파일 (다시 합쳐 그림 번호가 바뀌어도 파일로 다시 찾는다)
 */
export type MaterialQuestion = QuestionRow & {
  figure_id?: string;
  origin?: 'material' | 'vocab';
  answer_from?: 'material' | 'solved';
  kp_title?: string;
  figure_crop?: string;
};

/** 자료 하나에서 꺼내는 원래 문제 수 끝 (노트의 문제 수 끝과 같다) */
export const ORIGINALS_MAX = QUESTIONS_MAX;
/**
 * 단어장 카드 수 끝: 정리 한 조각에서 받는 낱말 수(prompts.ts 단어장 지침의 150)와 같다. 카드는 AI 없이 만들어서
 * 노트의 문제 수 끝(QUESTIONS_MAX: 원래 문제 + AI 문제)과 따로 센다
 */
export const VOCAB_CARDS_MAX = 150;

// ------------------------------------------------------------- 원래 문제
/**
 * 문제 앞의 번호('1.', '12)', '[3]', '문제 4.', 'Q5.', '3번.')와 배점('[3점]', '(2점)'), 끝의 문항 꼴 표시('(단답형)')를 뗀다.
 * '10.5 g' 같은 소수와 '21번 염색체'·'100번 반복' 처럼 글의 일부인 'N번'은 그대로 (번 뒤에 . ) : 가 올 때만 번호)
 */
export function cleanQuestionPrompt(prompt: string): string {
  return prompt
    .replace(/^\s*(?:(?:문제|문항|Q)\s*)?(?:\[\s*\d{1,3}\s*\]|\(\s*\d{1,3}\s*\)|\d{1,3}\s*(?:\)|번\s*[.):]|\.(?!\d)))\s*/u, '')
    .replace(/\s*[[(](?:단답형|서술형|객관식|주관식|선택형)[\])]\s*$/u, '')
    .replace(/\s*[[(]\s*\d+(?:\.\d+)?\s*점\s*[\])]\s*$/u, '')
    .replace(/^\s*[[(]\s*\d+(?:\.\d+)?\s*점\s*[\])]\s*/u, '')
    .trim();
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
type LabelFamily = 'circled' | 'paren' | 'num' | 'upper' | 'lower';

/** 보기 앞의 번호·글자 (차례 번호 0부터와 그 꼴) */
function choiceLabel(c: string): { family: LabelFamily; n: number; rest: string } | null {
  const s = c.trimStart();
  const circled = CIRCLED.indexOf(s[0] ?? '');
  if (circled >= 0) return { family: 'circled', n: circled, rest: s.slice(1).trim() };
  let m = /^\(\s*(\d{1,2})\s*\)\s*/u.exec(s);
  if (m) return { family: 'paren', n: Number(m[1]) - 1, rest: s.slice(m[0].length).trim() };
  m = /^(\d{1,2})(?:\)|\.(?!\d))\s*/u.exec(s);
  if (m) return { family: 'num', n: Number(m[1]) - 1, rest: s.slice(m[0].length).trim() };
  m = /^([A-F])(?:\)|\.)\s+/u.exec(s);
  if (m) return { family: 'upper', n: m[1].charCodeAt(0) - 65, rest: s.slice(m[0].length).trim() };
  m = /^([a-f])(?:\)|\.)\s+/u.exec(s);
  if (m) return { family: 'lower', n: m[1].charCodeAt(0) - 97, rest: s.slice(m[0].length).trim() };
  return null;
}

/** 모든 보기가 같은 꼴의 번호를 차례대로(①②③…, 1) 2) 3)…, A. B. C.…) 달고 있을 때만 번호를 뗀다 */
export function stripChoiceLabels(choices: readonly string[]): string[] {
  const labels = choices.map(choiceLabel);
  const same = labels.length > 0 && labels.every((l, i) => l && l.family === labels[0]!.family && l.n === i && l.rest);
  return same ? labels.map((l) => l!.rest) : choices.map((c) => c.trim());
}

const zz = (s: unknown) => (typeof s === 'string' ? s : '');
const normKey = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
/** 같은 문제인지 견주는 글 (문제 글 + 보기) */
const questionKey = (q: Pick<QuestionRow, 'prompt' | 'choices'>) => normKey(`${q.prompt}\n${(q.choices ?? []).join('\n')}`);

/**
 * AI 가 꺼낸 원래 문제(problemsJsonSchema) → 문제 행. 읽을 수 없거나 이상한 문제는 뺀다:
 * 정답을 보기에서 찾지 못함·보기가 3~6개가 아님·빈칸 없는 빈칸 문제·너무 긴 글(toQuestionRow), 없는 자료 그림이 필요한 문제, 겹친 문제.
 * kps: 지금 노트의 개념 (번호가 없으면 비운다), figureIds: 노트의 자료 그림 번호, before: 앞서 꺼낸 문제 (같은 문제는 다시 넣지 않는다)
 */
export function readOriginals(
  json: unknown,
  o: { kps: ReadonlyArray<{ id: string; title: string }>; figureIds: ReadonlySet<string>; max?: number; before?: ReadonlyArray<QuestionRow> },
): MaterialQuestion[] {
  const raw = json && typeof json === 'object' ? (json as { questions?: unknown }).questions : null;
  if (!Array.isArray(raw)) return [];
  const titleOf = new Map(o.kps.map((k) => [k.id, k.title]));
  const seen = new Set((o.before ?? []).map(questionKey));
  const out: MaterialQuestion[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    const choices = Array.isArray(x.choices) ? stripChoiceLabels(x.choices.map(zz)) : [];
    const item: QuizItem | null = readChatQuestion({ ...x, prompt: cleanQuestionPrompt(zz(x.prompt)), choices });
    if (!item) continue;
    const pages = Array.isArray(x.pages) ? x.pages.map(Number).filter((p) => Number.isInteger(p)) : [];
    const row = toQuestionRow({ ...item, pages });
    if (!row) continue;
    const fid = zz(x.figure_id).trim();
    if (fid && !o.figureIds.has(fid)) continue; // 없는 그림이 필요한 문제
    const key = questionKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const kp = titleOf.has(row.key_point_id) ? row.key_point_id : '';
    out.push({
      ...row,
      key_point_id: kp,
      ...(kp ? { kp_title: titleOf.get(kp) } : {}),
      ...(fid ? { figure_id: fid } : {}),
      origin: 'material',
      answer_from: x.answer_from === 'material' ? 'material' : 'solved',
    });
    if (out.length >= (o.max ?? ORIGINALS_MAX)) break;
  }
  return out;
}

// ------------------------------------------------------------- 원래 문제를 꺼낼 곳
/**
 * 기출·문제집 조각(정리 조각 chunk) 안의 [from, to): PDF 는 조각 안의 쪽, 사진은 조각 안의 사진, 글은 조각 글의 글자 자리.
 * 지문을 문제마다 옮겨 적어 답이 길어지니 몇 쪽씩 나눠 꺼내고(ai/scale.ts problemPieces), 그래도 답이 잘리면 반으로 나눠 다시 꺼낸다
 */
export type ProblemsJob = { chunk: number; from: number; to: number };

export function readJobs(v: unknown): ProblemsJob[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (j): j is ProblemsJob =>
      !!j &&
      typeof j === 'object' &&
      Number.isInteger(j.chunk) &&
      j.chunk >= 0 &&
      Number.isInteger(j.from) &&
      Number.isInteger(j.to) &&
      j.from >= 0 &&
      j.to > j.from,
  );
}

/** 글 (lo, hi) 안에서 at 근처의 나눌 자리: reach 안에서 가장 가까운 빈 줄 뒤, 없으면 줄 끝 뒤, 없으면 at (문제 하나가 둘로 나뉘지 않게) */
function textCut(text: string, at: number, reach: number, lo: number, hi: number): number {
  for (const sep of ['\n\n', '\n']) {
    let best = -1;
    for (const x of [text.lastIndexOf(sep, at), text.indexOf(sep, at)]) {
      const cut = x + sep.length;
      if (x < 0 || cut <= lo || cut >= hi || Math.abs(x - at) > reach) continue;
      if (best < 0 || Math.abs(cut - at) < Math.abs(best - at)) best = cut;
    }
    if (best >= 0) return best;
  }
  return at;
}

/** 기출 조각 chunk 를 꺼낼 일들: n 개(쪽·사진, 글이면 글자)를 pieces 번에 나눠서 (글은 줄 끝에서 자른다). 빈틈도 겹침도 없다 */
export function problemJobs(chunk: number, n: number, pieces: number, text?: string): ProblemsJob[] {
  const parts = Math.max(1, Math.min(pieces, n));
  const at = (k: number) => Math.floor((k * n) / parts);
  const cuts = [0];
  for (let k = 1; k < parts; k++) cuts.push(text ? textCut(text, at(k), Math.floor(n / parts / 4), cuts[k - 1], n) : at(k));
  cuts.push(n);
  return cuts
    .slice(0, -1)
    .map((from, k) => ({ chunk, from, to: cuts[k + 1] }))
    .filter((j) => j.to > j.from);
}

/** 답이 잘린 일을 반으로 (글이면 text 를 줄 끝에서). 쪽·사진 하나나 2000자 안의 글은 더 나누지 않는다 (null) */
export function halveJob(job: ProblemsJob, text?: string): ProblemsJob[] | null {
  const size = job.to - job.from;
  if (text !== undefined ? size < 2000 : size < 2) return null;
  const at = Math.floor((job.from + job.to) / 2);
  const mid = text !== undefined ? textCut(text, at, Math.floor(size / 4), job.from, job.to) : at;
  return [
    { ...job, to: mid },
    { ...job, from: mid },
  ];
}

// ------------------------------------------------------------- 단어장 카드
type Term = { term: string; meaning: string };
type Kp = { id: string; title: string; explanation: string; pages: number[] };

const STOP = new Set(
  'a an the to of in on at for with by from as or and be is are was were it its this that ~ etc 것 하다 하는 한 되다 있다 수 등 및 또는 따위 사람 일'.split(
    ' ',
  ),
);

/** 뜻을 이루는 낱말들 (견줄 때: 품사 표시·괄호·문장 부호를 빼고) */
function meaningWords(m: string): Set<string> {
  return new Set(
    m
      .toLowerCase()
      .replace(/\((?:n|v|a|adj|adv|prep|conj|pron|int|phr)\.?\)/g, ' ')
      .split(/[\s,;/·、，；:()（）[\]{}<>'"‘’“”!?.~\-]+/u)
      .filter((w) => w && !STOP.has(w)),
  );
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

/** 낱말 끝의 품사 표시·괄호를 뗀 답 ('abandon (v.)' → 'abandon') */
export function bareTerm(t: string): string {
  const s = t.replace(/\s*[([（【][^)\]）】]*[)\]）】]\s*$/u, '').trim();
  return s || t.trim();
}

/** 시드가 같으면 같은 차례 (자료마다 같은 카드가 나오게) */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** 같은 낱말·뜻은 한 번만 (먼저 나온 차례대로). 단어장 노트를 합칠 때 조각들의 용어를 AI 없이 이어 붙인다 */
export function mergeTerms<T extends Term>(...lists: ReadonlyArray<ReadonlyArray<T>>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const t of list) {
      const term = t.term.trim();
      const meaning = t.meaning.trim();
      if (!term || !meaning) continue;
      const key = `${normKey(term)}\n${normKey(meaning)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/** 이미 있는 낱말(뜻은 달라도)은 빼고 새 낱말만 더한다 (노트에 단어장을 더할 때 AI 가 빠뜨린 낱말을 채운다) */
export function addMissingTerms<T extends Term>(current: readonly T[], extra: readonly T[]): T[] {
  const have = new Set(current.map((t) => normKey(t.term)));
  const out = [...current];
  for (const t of extra) {
    const k = normKey(t.term);
    if (!k || !t.meaning.trim() || have.has(k)) continue;
    have.add(k);
    out.push(t);
  }
  return out;
}

/** 글에 그 낱말이 나오는지 (영어 낱말은 낱말 경계로: 'in' 이 'explain' 에 걸리지 않게) */
function mentions(text: string, term: string): boolean {
  const t = normKey(bareTerm(term));
  if (!t) return false;
  const hay = normKey(text);
  // 영어 낱말(글자·빈칸·'·- 만)은 정규식에 그대로 넣어도 된다
  if (/^[a-z][a-z' -]*$/.test(t)) return new RegExp(`(^|[^a-z])${t}([^a-z]|$)`).test(hay);
  return hay.includes(t);
}

type Example = { text: string; key_point_id: string; edited?: boolean };

/**
 * 단어장의 예문을 합친 노트의 개념에 다시 붙인다 (예문은 AI 합치기에 보내지 않고 앱이 그대로 옮긴다: 합친 답이 길어지지 않게).
 * 묶음마다 그 예문이 있던 노트의 개념(key_points)과 예문. 붙이는 차례: (sameIds 면) 같은 번호의 개념이 아직 있으면 그대로 →
 * 예문이 있던 개념과 이름이 같은(비슷한) 개념 → 예문에 나온 낱말을 이름·설명에 적은 개념 → 없으면 ''
 * (노트에는 안 보이고 단어장 카드의 예문으로만 쓰인다). 같은 글은 한 번만
 */
export function placeExamples(
  groups: ReadonlyArray<{ key_points: ReadonlyArray<{ id: string; title: string }>; examples: readonly Example[]; sameIds?: boolean }>,
  note: { key_points: ReadonlyArray<{ id: string; title: string; explanation: string }> },
  terms: readonly Term[],
): Example[] {
  const ids = new Set(note.key_points.map((k) => k.id));
  const seen = new Set<string>();
  const out: Example[] = [];
  for (const g of groups) {
    const titleOf = new Map(g.key_points.map((k) => [k.id, k.title]));
    for (const e of g.examples) {
      const key = normKey(e.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let id = g.sameIds && ids.has(e.key_point_id) ? e.key_point_id : '';
      const title = titleOf.get(e.key_point_id) ?? '';
      if (!id && title) id = matchKeyPoint(title, note.key_points);
      if (!id) {
        const word = terms.find((t) => mentions(e.text, t.term));
        if (word) id = note.key_points.find((k) => mentions(`${k.title} ${k.explanation}`, word.term))?.id ?? '';
      }
      out.push({ ...e, key_point_id: id });
    }
  }
  return out;
}

/**
 * 단어장 노트의 카드 (AI 없음): 낱말마다 하나씩, 켠 문제 종류(types) 안에서.
 * - 객관식(낱말 → 뜻): 보기는 정답 뜻 + 다른 낱말의 뜻 3개. 정답 뜻과 겹치는 말이 든 뜻과 같은 낱말의 다른 뜻
 *   ('bank' 의 '은행'·'둑')은 보기로 쓰지 않는다 (답이 둘이 되지 않게)
 * - 단답(뜻 → 낱말): 다른 낱말과 뜻이 조금 겹치면(비슷한 말) 객관식으로. 뜻이 똑같은 낱말은 같이 인정.
 *   뜻이 여럿인 낱말은 단답을 먼저 (뜻마다 문제 글이 달라진다)
 * - OX: 객관식·단답을 모두 끈 설정일 때만 (반은 다른 낱말의 뜻으로 틀린 문장)
 * 객관식과 단답을 모두 켰으면 번갈아 낸다. 빈칸만 켰으면 카드 없이 AI 문제로
 */
export function vocabCards(
  terms: readonly Term[],
  o: {
    types: readonly string[];
    keyPoints: readonly Kp[];
    examples?: ReadonlyArray<{ text: string }>;
    /** 노트의 함정: 한 함정에 같이 나온 낱말은 헷갈리는 짝(비슷한 말)으로 보고 서로의 오답 보기로 쓰지 않는다 */
    pitfalls?: ReadonlyArray<{ text: string }>;
    seed: string;
    max?: number;
  },
): MaterialQuestion[] {
  const list = mergeTerms(terms).filter((t) => t.term.length <= 120 && t.meaning.length <= 280 && !/[$`]/.test(t.term + t.meaning));
  const mcqOn = o.types.includes('mcq');
  const shortOn = o.types.includes('short');
  const oxOn = o.types.includes('ox');
  if (!mcqOn && !shortOn && !oxOn) return [];
  const words = list.map((t) => meaningWords(t.meaning));
  // 헷갈리는 짝: 함정 하나에 같이 나온 낱말들 ('huge 와 large 는 둘 다 크다는 뜻이라 헷갈려요')
  const pairs = new Set<string>();
  for (const p of o.pitfalls ?? []) {
    const named = list.map((t, j) => (mentions(p.text, t.term) ? j : -1)).filter((j) => j >= 0);
    for (const a of named) for (const b of named) if (a !== b) pairs.add(`${a}:${b}`);
  }
  /** 두 낱말의 뜻이 비슷한지 (뜻에 같은 말이 있거나 함정에서 헷갈린다고 한 짝) */
  const near = (i: number, j: number) => overlaps(words[i], words[j]) || pairs.has(`${i}:${j}`);
  /** 같은 낱말 (뜻이 여럿이라 두 번 나온 낱말: 'bank 은행'·'bank 둑') */
  const heads = list.map((t) => normKey(bareTerm(t.term)));
  const sameTerm = (i: number, j: number) => heads[i] === heads[j];
  const rand = seeded(o.seed);
  /** 정답 뜻과 비슷하지 않은 다른 뜻 n 개 (시드 차례로). 같은 낱말의 다른 뜻은 그 낱말의 뜻이기도 해서 빼고 */
  const others = (i: number, n: number): string[] => {
    const pool = list
      .map((t, j) => ({ j, m: t.meaning.trim() }))
      .filter(({ j, m }) => j !== i && !sameTerm(i, j) && !near(i, j) && normKey(m) !== normKey(list[i].meaning));
    const picked: string[] = [];
    const used = new Set<string>();
    while (pool.length && picked.length < n) {
      const [{ m }] = pool.splice(Math.floor(rand() * pool.length), 1);
      if (used.has(normKey(m))) continue;
      used.add(normKey(m));
      picked.push(m);
    }
    return picked;
  };
  const out: MaterialQuestion[] = [];
  const push = (item: Omit<QuizItem, 'explanation' | 'key_point_id' | 'pages'>, common: Pick<QuizItem, 'explanation' | 'key_point_id' | 'pages'>) => {
    const row = toQuestionRow({ ...item, ...common });
    if (row) out.push({ ...row, origin: 'vocab' });
  };
  list.slice(0, o.max ?? VOCAB_CARDS_MAX).forEach((t, i) => {
    const term = t.term.trim();
    const meaning = t.meaning.trim();
    const kp = o.keyPoints.find((k) => mentions(`${k.title} ${k.explanation}`, term));
    const ex = o.examples?.find((e) => mentions(e.text, term))?.text.trim() ?? '';
    const common = {
      explanation: `‘${term}’: ${meaning}${ex && ex.length <= 200 ? `\n예문: ${ex}` : ''}`,
      key_point_id: kp?.id ?? '',
      pages: kp?.pages.slice(0, 20) ?? [],
    };
    // 다른 낱말인데 뜻이 비슷하면 단답의 답이 둘이 될 수 있다 (같은 낱말의 다른 뜻은 답이 같아서 괜찮다)
    const similar = list.some((u, j) => j !== i && !sameTerm(i, j) && normKey(u.meaning) !== normKey(meaning) && near(i, j));
    const several = list.some((_, j) => j !== i && sameTerm(i, j));
    const distract = mcqOn ? others(i, 3) : [];
    const canMcq = distract.length === 3;
    const canShort = shortOn && !similar;
    const kind = canMcq && canShort ? (several || i % 2 === 1 ? 'short' : 'mcq') : canMcq ? 'mcq' : canShort ? 'short' : oxOn ? 'ox' : shortOn ? 'short' : null;
    const blank = { choices: [], answer_index: -1, answer_bool: false, answer_text: '', accepted: [] };
    if (kind === 'mcq') {
      const at = Math.floor(rand() * 4);
      const choices = [...distract];
      choices.splice(at, 0, meaning);
      push({ ...blank, type: 'mcq', prompt: `‘${term}’의 뜻으로 알맞은 것은?`, choices, answer_index: at, difficulty: 'easy' }, common);
    } else if (kind === 'short') {
      const answer = bareTerm(term);
      const same = list.filter((u, j) => j !== i && normKey(u.meaning) === normKey(meaning)).map((u) => bareTerm(u.term));
      const accepted = Array.from(new Set([term, ...same])).filter((a) => a !== answer);
      push({ ...blank, type: 'short', prompt: `다음 뜻을 가진 낱말을 쓰세요.\n${meaning}`, answer_text: answer, accepted, difficulty: 'medium' }, common);
    } else if (kind === 'ox') {
      const wrong = i % 2 === 1 ? others(i, 1)[0] : undefined;
      push({ ...blank, type: 'ox', prompt: `‘${term}’의 뜻은 ‘${wrong ?? meaning}’이다.`, answer_bool: !wrong, difficulty: 'easy' }, common);
    }
  });
  return out;
}

/** 저장할 때는 파이프라인만 쓰는 칸을 뗀다 */
export function forSaving<T extends MaterialQuestion>(q: T): Omit<T, 'origin' | 'answer_from' | 'kp_title' | 'figure_crop'> {
  const row: Partial<MaterialQuestion> = { ...q };
  delete row.origin;
  delete row.answer_from;
  delete row.kp_title;
  delete row.figure_crop;
  return row as Omit<T, 'origin' | 'answer_from' | 'kp_title' | 'figure_crop'>;
}
