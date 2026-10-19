// AI 가 준 풀이(문제 그림·단계 풀이)를 검사해 저장할 모양으로 만든다 (서버·화면 공통).
// 단계 풀이·AI 답 글이 말한 답이 문제의 정답과 같은지도 여기서 본다 (답 맞추기)
import { compileExpr } from './expr';
import { normalizeFigure, normalizeSteps, readFigure, readSteps, type Figure, type Step } from './spec';

export type Solution = { figure: Figure | null; steps: Step[] };

/**
 * DB 칸 크기 한도(schema.sql: figure 32KB, steps 16KB)보다 넉넉히 작게.
 * jsonb 는 JSON 글보다 커진다 (그림처럼 칸 이름과 숫자가 많으면 1.8배쯤, 글이 대부분인 단계는 거의 같다)
 */
const FIGURE_BYTES = 14_000;
const STEPS_BYTES = 11_000;

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * 받은 풀이 → 저장할 풀이. 단계가 없으면 null.
 * figures 가 false 면 그림은 버리고 글 단계만 (무료 채팅). 그림이 너무 크면 그림만 빼고, 단계 글이 너무 길면 줄인다
 */
export function readSolution(raw: unknown, opts: { figures?: boolean } = {}): Solution | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { steps?: unknown; figure?: unknown };
  let figure = opts.figures === false ? null : normalizeFigure(r.figure);
  if (figure && bytes(figure) > FIGURE_BYTES) figure = null;
  let steps = normalizeSteps(r.steps, figure);
  if (!steps.length) return null;
  if (bytes(steps) > STEPS_BYTES) steps = steps.map((s) => ({ ...s, text: s.text.slice(0, 220) }));
  if (bytes(steps) > STEPS_BYTES) return null;
  return { figure, steps };
}

/** DB 에서 읽은 문제의 풀이 (없으면 null) */
export function solutionOf(q: { figure?: unknown; steps?: unknown }): Solution | null {
  const figure = readFigure(q.figure);
  const steps = readSteps(q.steps, figure);
  if (!steps.length && !figure) return null;
  return { figure, steps };
}

/** AI 에게 보여 줄 정답 (객관식은 번호와 보기) */
export function answerForPrompt(q: { type: string; choices: string[] | null; answer: unknown }): string {
  if (q.type === 'mcq') {
    const i = Number(q.answer);
    return `${i + 1}. ${q.choices?.[i] ?? ''}`;
  }
  if (q.type === 'ox') return q.answer ? 'O (true)' : 'X (false)';
  return String(q.answer ?? '');
}

/** 풀이를 만들 문제 목록 (AI 에게 보내는 모양) */
export function questionsForSolve(
  qs: Array<{ type: string; prompt: string; choices: string[] | null; answer: unknown; explanation: string }>,
  indexes?: number[],
): Array<{ index: number; type: string; prompt: string; choices: string[]; answer: string; explanation: string }> {
  const pick = indexes ?? qs.map((_, i) => i);
  return pick
    .filter((i) => i >= 0 && i < qs.length)
    .map((i) => {
      const q = qs[i];
      return { index: i, type: q.type, prompt: q.prompt, choices: q.choices ?? [], answer: answerForPrompt(q), explanation: q.explanation };
    });
}

// ---------------------------------------------------------------- 답 맞추기
// 단계 풀이·AI 답 글이 '이게 답'이라고 분명히 말한 것만 읽어 문제의 정답과 견준다. 애매하면 읽지 않는다
// (맞는 풀이를 버리거나 정답을 잘못 고치는 것보다 그냥 두는 편이 낫다).

const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩';

/** 정답과 견줄 문제 (questions 행·채팅 문제와 같은 모양. 객관식 answer 는 보기 번호 0부터) */
export type AnswerKey = { type: string; choices?: string[] | null; answer: unknown; accepted?: string[] | null };

/** 글에서 읽은 답 */
export type AnswerClaim = {
  /** 보기 번호 (1부터) */
  choice: number | null;
  /** 보기 번호 뒤에 붙인 값 ('④ 1' 의 '1'). 번호가 없으면 phrase 와 같다 */
  value: string;
  /** 답이라고 한 말 그대로 ('④번 1', '5 cm', 'x = 3') */
  phrase: string;
  ox: boolean | null;
  /** '정답은 …'·'…이 정답'처럼 답이라고 밝혔는지 (아니면 '따라서 … = 값' 같은 마무리 문장에서 읽은 것) */
  explicit: boolean;
};

// 값 바로 뒤의 끝맺음('이에요'·'예요' …)과 그 뒤 (띄어쓰기·문장부호·글 끝)
const COPULA = '(?:이에요|이예요|예요|에요|입니다|이랍니다|이거든요|이네요|이지요|이죠|이고|이며|이다|이야|이요)';
const AFTER = '(?=$|[\\s.,!?。~…()\\]"\'”’」』])';
const PHRASE_END = new RegExp(`^(.*?)${COPULA}${AFTER}`);
const COPULA_AT = new RegExp(`${COPULA}${AFTER}`, 'g');
/** '정답은 ', '답: ', '정답이 ' (오답·대답·답지는 아니다) */
const MARK = /(?<![가-힣A-Za-z])(?:정답|답)(\s*(?:은요|는요|은|는|이|가))?(?:\s*[:：,]\s*|\s+)/g;
/** '④번이 정답이에요', 'O가 답이에요' ('정답이 아니에요'·'정답처럼'은 아니다) */
const MARK_AFTER =
  /(?<![가-힣A-Za-z0-9])([①-⑩](?:\s*번)?|\d{1,2}\s*번|[OoXx○×])\s*(?:이|가)?\s*(?:바로\s*)?(?:정답|답)(?=(?:이에요|이예요|예요|입니다|이랍니다|이다|이야|이죠|이고|이며|이요)?(?:$|[\s.,!?。~…()\]"'”’」』]))/g;
/** 보기 번호만 말하고 끝맺는 것 ('4번이에요'. '2번 곱하면'은 아니다) */
const CHOICE_SAY = new RegExp(`(?<![\\d가-힣A-Za-z])(\\d{1,2})\\s*번\\s*${COPULA}${AFTER}`, 'g');
/** O·X 만 말하고 끝맺는 것 ('X예요') */
const OX_SAY = new RegExp(`(?<![가-힣A-Za-z0-9])([OoXx○×])\\s*(?:\\([^)]{0,12}\\))?\\s*${COPULA}${AFTER}`, 'g');
/** 답이라고 하기 바로 앞에 이런 말이 있으면 가정이거나 남이 쓴 답이다 ('만약 …라면 정답은', '답지에는 정답이') */
const HEDGE = /만약|만일|라면|다면|경우|처럼|흔히|헷갈|착각|실수|잘못|대신|답지|해설지|정답지/;
/** 이런 말이 있는 문장에서는 보기 번호·마무리 값만으로 답을 읽지 않는다 (다른 보기를 설명하거나 가정하는 문장) */
const UNCLEAR = /아니|않|틀리|틀린|틀렸|틀려|오답|함정|헷갈|착각|잘못|대신|라고|라는|라면|다면|만약|만일|경우|처럼|지만|보이|보여|인지|일까|거나/;
/** 마무리하는 말 ('따라서 …', '… 이므로 …') */
const CONCLUDE = /(?:^|[\s,])(?:따라서|그러므로|그래서|즉|결국|결론적으로|그러니까|그러니)[\s,]+|(?:므로|니까)[\s,]+/g;
const EDGE_MARKS = /^[\s"'“”‘’「」『』《》]+|[\s"'“”‘’「」『』《》.,!?。~…]+$/g;

/** 답이라고 한 곳(at) 바로 앞이 가정·남의 답인지. '…처럼 보이지만 실제로는 ④번이 정답' 처럼 '-지만' 뒤는 새로 말하는 것이다 */
function hedged(s: string, at: number): boolean {
  const clause =
    s
      .slice(Math.max(0, at - 24), at)
      .split(/지만|는데|그런데|그러나|하지만/)
      .pop() ?? '';
  return HEDGE.test(clause);
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\*\*/g, '')
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const OX_TRUE = ['o', '○', '◯', '⭕', '〇', '참', 'true'];
const OX_FALSE = ['x', '×', '✕', '✗', '❌', '거짓', 'false'];

/** 'O'·'X(틀림)'·'참' 같은 O/X 답 (아니면 null) */
export function readOx(s: string): boolean | null {
  const t = s
    .normalize('NFKC')
    .replace(/[$\s]+/g, '')
    .toLowerCase()
    .replace(/[(（][^()（）]*[)）]$/, '')
    .replace(EDGE_MARKS, '');
  if (OX_TRUE.includes(t)) return true;
  if (OX_FALSE.includes(t)) return false;
  return null;
}

/** 답이라고 한 말 → 답. 다른 말이 섞여 답으로 볼 수 없으면 null */
function phraseClaim(raw: string, explicit: boolean): AnswerClaim | null {
  const phrase = raw.replace(EDGE_MARKS, '');
  if (!phrase || phrase.length > 160 || /정답|답|아니|않|라고|라는/.test(phrase)) return null;
  let choice: number | null = null;
  let value = phrase;
  const m = phrase.match(/^(?:([①-⑩])(?:\s*번)?|(\d{1,2})\s*번)/);
  // 번호 뒤에는 띄어쓰기·괄호·쌍점·쉼표로 값이 붙는다 ('④번 1', '④(1)'). 조사가 바로 붙으면('②번으로 되어') 답이라고 한 말이 아니다
  if (m && /^(?:$|[\s(（:：,，])/.test(phrase.slice(m[0].length))) {
    choice = m[1] ? CIRCLED_NUMS.indexOf(m[1]) + 1 : Number(m[2]);
    value = phrase
      .slice(m[0].length)
      .replace(/^[\s:：,，]+/, '')
      .replace(/^[(（](.*)[)）]$/, '$1')
      .trim();
  }
  // 값에 보기 번호가 또 있으면 답을 여럿 말한 것이다 ('④, ⑤', '될 수 있는 건 ④뿐')
  if (/[①-⑩]|\d\s*번/.test(value)) return null;
  // 긴 말은 값으로 보지 않는다 (번호를 말했으면 번호만: '③ 세포 호흡은 미토콘드리아에서 일어난다')
  if (value.length > 40) {
    if (choice === null) return null;
    value = '';
  }
  return { choice, value, phrase, ox: readOx(phrase), explicit };
}

/** '정답은 …'·'…이 정답' 으로 밝힌 답들 */
function explicitClaims(text: string): AnswerClaim[] {
  const out: AnswerClaim[] = [];
  for (const s of sentencesOf(text)) {
    for (const m of s.matchAll(MARK)) {
      if (hedged(s, m.index)) continue;
      const rest = s.slice(m.index + m[0].length);
      const cut = rest.match(PHRASE_END);
      // '정답: ④' 처럼 끝맺음이 없으면 문장 끝까지. 단 '답이 나와요'('이/가' 뒤)나 '…요/다'로 끝나는 말은 답이라고 한 말이 아니다
      const bare = !/[이가]/.test(m[1] ?? '') && !/[요다][\s.!?。~]*$/.test(rest);
      const c = cut ? phraseClaim(cut[1], true) : bare ? phraseClaim(rest, true) : null;
      if (c) out.push(c);
    }
    for (const m of s.matchAll(MARK_AFTER)) {
      if (hedged(s, m.index)) continue;
      const c = phraseClaim(m[1], true);
      if (c) out.push(c);
    }
  }
  return out;
}

/** 값으로 볼 만한지 (수·식·O/X, 또는 띄어쓰기 없는 짧은 말: '발산', '엽록체') */
function valueLike(v: string): boolean {
  return readValue(v).k !== 'text' || (v.length <= 12 && !/\s/.test(v));
}

/** 글 전체에 '=' 가 하나뿐이고 'x = 3이에요' 처럼 이름 하나에 값을 말하면 그 값 */
function equationClaim(text: string): AnswerClaim | null {
  const plain = text.replace(/\$/g, '');
  if ((plain.match(/(?<![=!<>])=(?!=)/g) ?? []).length !== 1 || /[<>≤≥≠]|\\(?:le|ge|ne|lt|gt)(?![a-z])/.test(plain)) return null;
  const eq = new RegExp(`(?<![A-Za-z\\\\])(?:[A-Za-z](?:_\\{?[A-Za-z0-9]+\\}?)?'?|\\\\[a-z]+)\\s*=\\s*(.+?)${COPULA}${AFTER}`);
  for (const s of sentencesOf(plain)) {
    if (UNCLEAR.test(s)) continue;
    const m = s.match(eq);
    const c = m ? phraseClaim(m[1], true) : null;
    if (c && c.choice === null && readValue(c.value).k !== 'text') return c;
  }
  return null;
}

/** 마무리 문장('따라서 …', '…이므로 …')이 말하는 값: '= 값' 의 오른쪽, 또는 '…은 값이에요' 의 값 */
function concludedClaim(s: string): AnswerClaim | null {
  let start = -1;
  for (const m of s.matchAll(CONCLUDE)) start = m.index + m[0].length;
  if (start < 0) return null;
  const part = s.slice(start);
  // 끝맺음이 하나여야 한다 ('a는 2이고 b는 3이에요' 는 값이 둘)
  const ends = [...part.matchAll(COPULA_AT)];
  if (ends.length !== 1) return null;
  const head = part.slice(0, ends[0].index).replace(/\$/g, '').trim();
  // 부등식은 값이 아니다
  if (/[<>≤≥≠]|\\(?:le|ge|ne|lt|gt)(?![a-z])/.test(head)) return null;
  const sides = head.split(/(?<![=!<>])=(?!=)/);
  // 'x = 2, y = 3' 처럼 값을 여럿 말하면 읽지 않는다
  if (sides.length > 2 && /[,，]|또는|혹은|그리고/.test(sides[sides.length - 2])) return null;
  // '…은 값' 의 값: 마지막 조사 뒤 ('또는'·'혹은' 의 '는·은' 은 조사가 아니다)
  const value = sides.length > 1 ? sides[sides.length - 1] : (head.split(/(?<=\S)(?<![또혹])(?:은|는|이|가)\s+/).pop() ?? '');
  const c = phraseClaim(value, false);
  return c && (c.value ? valueLike(c.value) : c.choice !== null) ? c : null;
}

/** 마무리 문장·보기 번호만으로 읽는 답 (마지막 단계에서만 쓴다. 다른 보기를 설명하거나 가정하는 문장은 건너뛴다) */
function weakClaims(text: string): AnswerClaim[] {
  const out: AnswerClaim[] = [];
  let concluded: AnswerClaim | null = null;
  for (const s of sentencesOf(text)) {
    if (UNCLEAR.test(s)) continue;
    // '④예요', '④ 1이에요', '따라서 ④($1$)이에요'
    for (const m of s.matchAll(/[①-⑩]/g)) {
      const cut = s.slice(m.index).match(PHRASE_END);
      const c = cut ? phraseClaim(cut[1], false) : null;
      if (c && c.choice !== null && (!c.value || valueLike(c.value))) out.push(c);
    }
    for (const m of s.matchAll(CHOICE_SAY)) out.push({ choice: Number(m[1]), value: '', phrase: `${m[1]}번`, ox: null, explicit: false });
    for (const m of s.matchAll(OX_SAY)) {
      const ox = readOx(m[1]);
      if (ox !== null) out.push({ choice: null, value: m[1], phrase: m[1], ox, explicit: false });
    }
    concluded = concludedClaim(s) ?? concluded;
  }
  if (concluded) out.push(concluded);
  const eq = equationClaim(text);
  if (eq) out.push({ ...eq, explicit: false });
  return out;
}

/** 여러 곳에서 읽은 답을 하나로. 서로 다른 답을 말했으면 null */
function mergeClaims(claims: AnswerClaim[]): AnswerClaim | null {
  let out: AnswerClaim | null = null;
  for (const c of claims) {
    if (!out) {
      out = { ...c };
      continue;
    }
    if (c.choice !== null) {
      if (out.choice !== null && out.choice !== c.choice) return null;
      out.choice = c.choice;
    }
    if (c.ox !== null) {
      if (out.ox !== null && out.ox !== c.ox) return null;
      out.ox = c.ox;
    }
    if (c.value) {
      if (out.value && compareText(out.value, c.value) !== 'same') return null;
      out.value ||= c.value;
    }
    out.phrase ||= c.phrase;
    out.explicit ||= c.explicit;
  }
  return out;
}

/**
 * 답 글·해설에서 정답이라고 밝힌 답: '정답은 ②번 1/6이에요', '④번이 정답이에요', '정답: X', '답은 5 cm예요',
 * 그리고 '=' 가 하나뿐인 'x = 3이에요'. 다른 보기를 설명하는 말('③은 틀려요', '정답이 ③번이 아니라')이나
 * 가정('만약 …라면 정답은')은 읽지 않고, 서로 다른 답을 말했으면 null
 */
export function claimIn(text: string): AnswerClaim | null {
  const claims = explicitClaims(text);
  const eq = equationClaim(text);
  if (eq) claims.push(eq);
  return mergeClaims(claims);
}

/**
 * 단계 풀이가 마지막 단계에서 말한 답 (마지막 단계만 본다. 앞 단계의 중간 값은 보지 않는다).
 * '정답은 …' 처럼 밝힌 답이 있으면 그것만, 없으면 보기 번호('따라서 ④예요', '4번이에요'), O/X('X예요'),
 * 마무리 문장의 값('따라서 … = 1이에요', '그래서 극한값은 1이에요')을 읽는다. AI 가 준 그대로의 단계를 넣어도 된다
 */
export function finalClaim(steps: unknown): AnswerClaim | null {
  if (!Array.isArray(steps)) return null;
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = (steps[i] as { text?: unknown } | null)?.text;
    if (typeof t !== 'string' || !t.trim()) continue;
    const explicit = explicitClaims(t);
    return mergeClaims(explicit.length ? explicit : weakClaims(t));
  }
  return null;
}

/** 값이 보기와 같은 보기 번호들 (0부터) */
function choicesLike(value: string, choices: string[]): number[] {
  return choices.map((c, i) => (compareText(value, c) === 'same' ? i : -1)).filter((i) => i >= 0);
}

/** 번호와 함께 말한 값이 그 보기와 맞지 않는지 ('④ 1/3' 인데 ④ 가 1 이고 ③ 이 1/3) */
function valueContradicts(value: string, choices: string[], i: number): boolean {
  const hits = choicesLike(value, choices);
  return (hits.length > 0 && !hits.includes(i)) || (choices[i] !== undefined && compareText(value, choices[i]) === 'differ');
}

/**
 * 읽은 답이 문제의 정답과 같은지. differ 는 분명히 다를 때만 (객관식: 다른 번호, 또는 다른 보기 하나와 같은 값,
 * 또는 정답 보기와 다른 수. O/X: 반대. 단답·빈칸: 정답·같이 인정할 답 모두와 다른 수·식)
 */
export function judgeClaim(c: AnswerClaim, key: AnswerKey): 'same' | 'differ' | 'unknown' {
  if (key.type === 'mcq') {
    const choices = key.choices ?? [];
    const idx = Number(key.answer);
    if (!Number.isInteger(idx) || idx < 0) return 'unknown';
    if (c.choice !== null) {
      if (c.choice - 1 !== idx) return 'differ';
      return c.value && choices[idx] !== undefined && valueContradicts(c.value, choices, idx) ? 'differ' : 'same';
    }
    if (!c.value || choices[idx] === undefined) return 'unknown';
    const hits = choicesLike(c.value, choices);
    if (hits.length) return !hits.includes(idx) ? 'differ' : hits.length === 1 ? 'same' : 'unknown';
    return compareText(c.value, choices[idx]) === 'differ' ? 'differ' : 'unknown';
  }
  if (key.type === 'ox') return c.ox === null ? 'unknown' : c.ox === Boolean(key.answer) ? 'same' : 'differ';
  const said = c.value || c.phrase;
  const forms = [String(key.answer ?? ''), ...(key.accepted ?? [])].filter((s) => s.trim());
  if (!said || !forms.length) return 'unknown';
  let differ = false;
  for (const f of forms) {
    const r = compareText(said, f);
    if (r === 'same') return 'same';
    // 단위가 달라 모르면(5 cm ↔ 50 mm) 다르다고 하지 않는다
    if (r === 'unsure') return 'unknown';
    if (r === 'differ') differ = true;
  }
  return differ ? 'differ' : 'unknown';
}

/** 읽은 답이 가리키는 보기 (0부터): 번호를 말했으면 그 번호(같이 말한 값이 그 보기와 맞을 때만), 값만 말했으면 그 값과 같은 보기 하나 */
export function claimedIndex(c: AnswerClaim, choices: string[]): number | null {
  if (c.choice !== null) {
    const i = c.choice - 1;
    if (choices[i] === undefined) return null;
    return c.value && valueContradicts(c.value, choices, i) ? null : i;
  }
  if (!c.value) return null;
  const hits = choicesLike(c.value, choices);
  return hits.length === 1 ? hits[0] : null;
}

/** 단계 풀이가 정답에 닿는지: 마지막 단계가 정답과 분명히 다른 답을 말할 때만 false (노트 그림 풀이는 이때 풀이를 붙이지 않는다) */
export function stepsReachAnswer(steps: unknown, key: AnswerKey): boolean {
  const c = finalClaim(steps);
  return !c || judgeClaim(c, key) !== 'differ';
}

/** 글(해설 등)이 이 답을 말하는지: 수·식이면 글 속 수식($…$)과 수 하나하나와 견주고, 말이면 그 말이 들어 있는지 */
export function mentionsAnswer(text: string, answer: string): boolean {
  const a = canon(answer);
  if (!a) return false;
  if (readValue(answer).k === 'text') return canon(text).includes(a);
  const pieces = [...text.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
  pieces.push(...(text.replace(/\$[^$]*\$/g, ' ').match(/-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g) ?? []));
  return pieces.some((p) => compareText(p, answer) === 'same');
}

/** 문제 글에 ①부터 차례로 적힌 보기 (번호 1부터 → 보기 글). 차례대로 적혀 있지 않으면 빈 목록 */
export function listedChoices(problem: string): Map<number, string> {
  const marks = [...problem.matchAll(/[①-⑩]/g)];
  const out = new Map<number, string>();
  if (marks.length < 2 || marks.some((m, i) => m[0] !== CIRCLED_NUMS[i])) return out;
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : problem.length;
    out.set(
      i + 1,
      problem
        .slice(m.index + 1, end)
        .split('\n')[0]
        .trim(),
    );
  });
  return out;
}

// ---- 값 견주기: '$\frac{1}{6}$' = '1/6' = '0.17', '5 cm' = '5', '60°' = 'π/3', '3, -1' = '-1, 3', '２' = '2'

type Num = { k: 'num'; v: number; unit: string; places: number | null; approx: boolean; pi: boolean };
type Val = Num | { k: 'fn'; f: (x: number) => number } | { k: 'list'; items: Val[]; ordered: boolean } | { k: 'ox'; v: boolean } | { k: 'text'; s: string };

/** same: 같은 답, differ: 분명히 다른 답, unsure: 단위가 달라 알 수 없음, na: 견줄 수 없는 글 (말로 된 답은 다르다고 하지 않는다) */
export type ValueMatch = 'same' | 'differ' | 'unsure' | 'na';

// [표준 단위, 같은 단위로 보는 글, 읽을 때 끝 글자에 받침이 있는지 ('5 kg이에요', '5 cm예요')]
const UNITS: Array<[string, string[], boolean]> = [
  ['km', ['km', '킬로미터'], false],
  ['cm', ['cm', '센티미터'], false],
  ['mm', ['mm', '밀리미터'], false],
  ['nm', ['nm', '나노미터'], false],
  ['μm', ['μm', '마이크로미터'], false],
  ['m', ['m', '미터'], false],
  ['km^2', ['km^2', '제곱킬로미터'], false],
  ['cm^2', ['cm^2', '제곱센티미터'], false],
  ['mm^2', ['mm^2', '제곱밀리미터'], false],
  ['m^2', ['m^2', '제곱미터'], false],
  ['cm^3', ['cm^3', 'cc', '세제곱센티미터'], false],
  ['m^3', ['m^3', '세제곱미터'], false],
  ['ml', ['ml', '밀리리터'], false],
  ['l', ['l', '리터'], false],
  ['kg', ['kg', '킬로그램'], true],
  ['mg', ['mg', '밀리그램'], true],
  ['g', ['g', '그램'], true],
  ['m/s^2', ['m/s^2'], true],
  ['m/s', ['m/s'], false],
  ['km/h', ['km/h'], false],
  ['g/cm^3', ['g/cm^3', 'g/ml'], false],
  ['ms', ['ms', '밀리초'], false],
  ['s', ['s', 'sec', '초'], false],
  ['min', ['min', '분'], true],
  ['h', ['h', '시간'], true],
  ['kj', ['kj', '킬로줄'], true],
  ['j', ['j', '줄'], true],
  ['kcal', ['kcal', '킬로칼로리'], false],
  ['cal', ['cal', '칼로리'], false],
  ['n', ['n', '뉴턴'], true],
  ['kw', ['kw', '킬로와트'], false],
  ['w', ['w', '와트'], false],
  ['v', ['v', '볼트'], false],
  ['ma', ['ma', '밀리암페어'], false],
  ['a', ['a', '암페어'], false],
  ['ω', ['ω', '옴'], true],
  ['hz', ['hz', '헤르츠'], false],
  ['kpa', ['kpa', '킬로파스칼'], true],
  ['pa', ['pa', '파스칼'], true],
  ['atm', ['atm', '기압'], true],
  ['mol', ['mol', '몰'], true],
  ['°c', ['°c', '섭씨'], false],
  ['k', ['k', '켈빈'], true],
  ['°', ['°', '도'], false],
  ['%', ['%', '퍼센트', '프로'], false],
];
/** 셈 단위 (같은 글끼리만 같은 단위. 읽기는 한글 끝 글자대로) */
const COUNTERS = '개 명 원 번 회 배 쪽 장 마리 권 대 송이 그루 자루 켤레 층 칸 가지 살 세 쌍 단계 일 년 개월 주 달 시 등'.split(' ');
const UNIT_ALIAS: Array<[string, string]> = [
  ...UNITS.flatMap(([std, as]) => as.map((a): [string, string] => [a, std])),
  ...COUNTERS.map((c): [string, string] => [c, c]),
].sort((a, b) => b[0].length - a[0].length);
const UNIT_BATCHIM = new Map(UNITS.map(([std, , b]) => [std, b]));
const SQUARE_UNITS: Record<string, string> = { '㎠': 'cm^2', '㎡': 'm^2', '㎤': 'cm^3', '㎥': 'm^3', '㎢': 'km^2' };
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const GREEK: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  omega: 'ω',
};

/** LaTeX 를 보통 수식 글로 (\frac{a}{b} → ((a)/(b)), \sqrt{a} → √(a), \text{cm} → cm) */
function unlatex(s: string): string {
  let t = s.replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|operatorname|textrm|textbf|rm|bf|boxed)\s*\{([^{}]*)\}/g, '$1');
  for (let i = 0; i < 6; i++) {
    const next = t
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))')
      .replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, '(($1)/($2))')
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '(($2)^(1/($1)))')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
    if (next === t) break;
    t = next;
  }
  return t
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ|\\circ|\\degree/g, '°')
    .replace(/\\%/g, '%')
    .replace(/\\(?:cdot|times)(?![a-z])/g, '×')
    .replace(/\\div(?![a-z])/g, '÷')
    .replace(/\\pi(?![a-z])/g, 'π')
    .replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|rho|sigma|tau|phi|omega)(?![a-z])/g, (_, g: string) => GREEK[g])
    .replace(/\\infty/g, '∞')
    .replace(/\\(?:leq|le)(?![a-z])/g, '≤')
    .replace(/\\(?:geq|ge)(?![a-z])/g, '≥')
    .replace(/\\(?:neq|ne)(?![a-z])/g, '≠')
    .replace(/\\pm(?![a-z])/g, '±')
    .replace(/\\sqrt/g, '√')
    .replace(/\\(?:left|right|displaystyle|quad|qquad|[,;:!])/g, '')
    .replace(/\^\{(\w)\}/g, '^$1')
    .replace(/\^\{([^{}]*)\}/g, '^($1)')
    .replace(/_\{([^{}]*)\}/g, '_$1')
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'));
}

/** 견주기 좋은 모양: 전각 글자·윗첨자·LaTeX·띄어쓰기·대소문자·앞뒤 따옴표와 끝 문장부호를 맞춘다 */
function canon(s: string): string {
  return (
    unlatex(
      s
        .replace(/[㎠㎡㎤㎥㎢]/g, (c) => SQUARE_UNITS[c])
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (c) => `^${[...c].map((d) => SUPERSCRIPT.indexOf(d)).join('')}`)
        .normalize('NFKC')
        .replace(/\$/g, ' ')
        .replace(/\\[()[\]]/g, ' '),
    )
      .replace(/[−–—]/g, '-')
      .replace(/[×✕]/g, '*')
      .replace(/÷/g, '/')
      // 천 단위 쉼표 ('1,000원'). 띄어 쓴 '100, 200' 은 답 여럿이라 띄어쓰기를 지우기 전에 본다
      .replace(/(?<![\d,.([])\d{1,3}(?:,\d{3})+(?![\d,])/g, (n) => n.replace(/,/g, ''))
      .replace(/\s+/g, '')
      .toLowerCase()
      .replace(EDGE_MARKS, '')
  );
}

/** 맨 바깥 괄호 밖의 쉼표(loose: '또는'·'그리고'·수 사이 '과/와'도)로 나눈다 */
function splitTop(s: string, loose: boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth === 0) {
      if (ch === ',') {
        out.push(cur);
        cur = '';
        continue;
      }
      const word = loose ? s.slice(i).match(/^(?:또는|혹은|그리고|및)/) : null;
      if (word || (loose && (ch === '과' || ch === '와') && /[\d)π]$/.test(cur) && /^[-\d(√π]/.test(s.slice(i + 1)))) {
        out.push(cur);
        cur = '';
        i += (word?.[0].length ?? 1) - 1;
        continue;
      }
    }
    cur += ch;
  }
  out.push(cur);
  return out.filter(Boolean);
}

/** 끝에 붙은 단위를 뗀다 ('5cm' → 5, cm, '5(cm)' 도). 단위 앞은 수여야 한다 */
function splitUnit(c: string): { body: string; unit: string } {
  const paren = c.match(/^(.+?)\(([^()]+)\)$/);
  const inParen = paren ? UNIT_ALIAS.find(([a]) => a === paren[2]) : undefined;
  if (paren && inParen) return { body: paren[1], unit: inParen[1] };
  for (const [alias, std] of UNIT_ALIAS) {
    if (c.length > alias.length && c.endsWith(alias) && /[\d).π]$/.test(c.slice(0, -alias.length))) return { body: c.slice(0, -alias.length), unit: std };
  }
  return { body: c, unit: '' };
}

/** 수(단위와 함께) 또는 x 에 대한 식. 둘 다 아니면 null */
function readNum(c: string, approx: boolean): Num | { k: 'fn'; f: (x: number) => number } | null {
  const { body, unit } = splitUnit(c);
  if (!body || body.length > 120 || /[∞±≤≥≠<>=_]/.test(body)) return null;
  const f = compileExpr(body.replace(/√/g, 'sqrt'));
  if (!f) return null;
  const a = f(0.37);
  const b = f(1.91);
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a))) {
    const dec = body.match(/^-?\d*\.(\d+)$/);
    // 소수는 몇째 자리까지 썼는지 (어림한 값일 수 있다), 정수는 0, 분수·근호·π 는 정확한 값(null)
    const places = dec ? dec[1].length : /^-?\d+$/.test(body) ? 0 : null;
    return { k: 'num', v: a, unit, places, approx, pi: /π|pi/.test(body) };
  }
  return unit ? null : { k: 'fn', f };
}

function readValue(text: string, inner = false): Val {
  const ox = readOx(text);
  if (ox !== null) return { k: 'ox', v: ox };
  let c = canon(text);
  const ap = c.match(/^(?:약|대략|거의|≈|~)(?=[-\d.(√π])/);
  if (ap) c = c.slice(ap[0].length);
  // 'x=3', 'a_n=5', 'θ=30°' 처럼 이름 하나 = 값이면 값만 본다
  c = c.replace(/^(?:[a-z](?:_\(?[a-z0-9]+\)?)?'?|[α-ω])=(?![=<>])/, '');
  if (!c) return { k: 'text', s: '' };
  if (!inner) {
    // (2, 3) 은 순서가 있는 짝, '3, -1'·'3 또는 -1' 은 순서 없는 여러 답
    const tuple = c.match(/^[([](.*)[)\]]$/);
    const pair = tuple ? splitTop(tuple[1], false) : [];
    if (pair.length > 1) return { k: 'list', items: pair.map((p) => readValue(p, true)), ordered: true };
    const parts = splitTop(c, true);
    if (parts.length > 1) return { k: 'list', items: parts.map((p) => readValue(p, true)), ordered: false };
  }
  // '√25 = 5' 처럼 계산을 이어 쓰면 마지막 '=' 의 오른쪽이 답이다 (부등식은 그대로)
  if (!/[<>≤≥≠]/.test(c)) c = c.split(/(?<![=!<>])=(?!=)/).pop() || c;
  return readNum(c, !!ap) ?? { k: 'text', s: c };
}

function close(x: number, y: number): boolean {
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}

/** 어림한 값(소수·'약 3')이 더 정확한 값을 그 자리까지 반올림하거나 버린 것과 같은지 ('0.17' ↔ 1/6, '3.1415' ↔ π) */
function roughlySame(r: Num, other: Num): boolean {
  const p = r.places;
  if (p === null || (p === 0 && !r.approx)) return false;
  if (other.places !== null && other.places <= p && !other.approx) return false;
  const k = 10 ** p;
  const s = Math.sign(other.v);
  const scaled = Math.abs(other.v) * k;
  return close(r.v, (s * Math.round(scaled + 1e-9)) / k) || close(r.v, (s * Math.floor(scaled + 1e-9)) / k);
}

function sameNum(a: Num, b: Num): boolean {
  return close(a.v, b.v) || roughlySame(a, b) || roughlySame(b, a);
}

function cmpNum(a: Num, b: Num): ValueMatch {
  if (sameNum(a, b)) return 'same';
  // 단위가 한쪽에만 있으면 바꿔 본다: 50% ↔ 0.5, 60° ↔ π/3 (π 가 있는 쪽과 견주는 60 도)
  const swap = (x: Num, y: Num): boolean => {
    if (y.unit) return false;
    if (x.unit === '%') return sameNum({ ...x, v: x.v / 100, unit: '', places: x.places === null ? null : x.places + 2 }, y);
    if (x.unit === '°' || (!x.unit && x.places === 0 && !x.pi && y.pi)) return sameNum({ ...x, v: (x.v * Math.PI) / 180, unit: '', places: null }, y);
    return false;
  };
  if (swap(a, b) || swap(b, a)) return 'same';
  // 단위가 서로 다르면 바꿔 쓴 것일 수 있다 (5 cm ↔ 50 mm)
  return a.unit && b.unit && a.unit !== b.unit ? 'unsure' : 'differ';
}

const SAMPLES = [0.37, 1.91, 2.63, 3.17, -1.3, -2.71, 0.83];

/** x 에 대한 두 식이 같은지 (여러 x 에서 계산해 본다) */
function cmpFn(f: (x: number) => number, g: (x: number) => number): ValueMatch {
  let n = 0;
  for (const x of SAMPLES) {
    const a = f(x);
    const b = g(x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (!close(a, b)) return 'differ';
    n++;
  }
  return n >= 3 ? 'same' : 'unsure';
}

function cmpList(a: Val, b: Val): ValueMatch {
  const xs = a.k === 'list' ? a.items : [a];
  const ys = b.k === 'list' ? b.items : [b];
  const nums = [...xs, ...ys].every((v) => v.k === 'num');
  if (xs.length !== ys.length) return nums ? 'differ' : 'unsure';
  const ordered = (v: Val) => v.k === 'list' && v.ordered;
  if (ordered(a) || ordered(b)) {
    const rs = xs.map((x, i) => cmpVal(x, ys[i]));
    if (rs.every((r) => r === 'same')) return 'same';
    // 순서가 있는 짝끼리만 다르다고 한다 ((2, 3) ↔ (3, 2)). 한쪽만 짝이면 모른다
    return ordered(a) && ordered(b) && nums && rs.includes('differ') ? 'differ' : 'unsure';
  }
  const left = [...ys];
  for (const x of xs) {
    const i = left.findIndex((y) => cmpVal(x, y) === 'same');
    if (i < 0) return nums ? 'differ' : 'unsure';
    left.splice(i, 1);
  }
  return 'same';
}

function cmpVal(a: Val, b: Val): ValueMatch {
  if (a.k === 'ox' || b.k === 'ox') return a.k === 'ox' && b.k === 'ox' ? (a.v === b.v ? 'same' : 'differ') : 'na';
  if (a.k === 'text' || b.k === 'text') return a.k === 'text' && b.k === 'text' && a.s === b.s ? 'same' : 'na';
  if (a.k === 'list' || b.k === 'list') return cmpList(a, b);
  if (a.k === 'num' && b.k === 'num') return cmpNum(a, b);
  if (a.k === 'fn' && b.k === 'fn') return cmpFn(a.f, b.f);
  return 'unsure';
}

/** 두 답이 같은지 ('$\frac{1}{6}$' ↔ '1/6' 같음, '5 cm' ↔ '6' 다름, '광합성' ↔ '호흡' 은 견줄 수 없음) */
export function compareText(a: string, b: string): ValueMatch {
  const ca = canon(a);
  const cb = canon(b);
  if (!ca || !cb) return 'na';
  if (ca === cb) return 'same';
  return cmpVal(readValue(a), readValue(b));
}

/** 답 뒤에 붙일 말 ('5예요', '3이에요', '5 kg이에요', '$\frac{1}{6}$이에요'). 어떻게 읽을지 모르면 null */
export function copulaFor(answer: string): '이에요' | '예요' | null {
  const c = canon(answer);
  if (!c) return null;
  const { body, unit } = splitUnit(c);
  const batchim = (ch: string) => ((ch.charCodeAt(0) - 0xac00) % 28 ? '이에요' : '예요');
  if (unit) return UNIT_BATCHIM.has(unit) ? (UNIT_BATCHIM.get(unit) ? '이에요' : '예요') : batchim(unit.slice(-1));
  // 분수는 분자를 마지막에 읽는다 ('6분의 1'), 거듭제곱은 '제곱'
  const frac = body.match(/^-?\(*(-?[\d.]+)\)*\/\(*[\d.]+\)*$/);
  if (!frac && /\^\(?\d+\)?$/.test(body)) return '이에요';
  const ch = (frac ? frac[1] : body).replace(/[)\]]+$/, '').slice(-1);
  if (/\d/.test(ch)) return '013678'.includes(ch) ? '이에요' : '예요';
  if (/[가-힣]/.test(ch)) return batchim(ch);
  return null;
}
