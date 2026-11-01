// 문제를 실제 시험지처럼 (과목마다 다른 모양): 문제 글을 원래 번호 · 발문(묻는 문장, 굵게) · 자료/지문 상자 · <보기> 상자로 나누고,
// 정답·해설은 '이름: 내용'·①·(가)마다 줄을 나눈다. 화면(components/exam/ExamText.tsx)은 이것대로 그리기만 한다 (시험 exam-layout.test.ts).
// 새 문제는 AI 가 이 꼴(자료 → 빈 줄 → 발문, 단계·조건은 한 줄씩)로 쓰고(prompts.ts EXAM_LAYOUT_RULE),
// 예전 문제(한 덩어리 글)는 문장으로 나눠 묻는 문장을 찾는다. 글자는 바꾸지 않는다 (나누고 자리만 옮긴다: 빈칸은 한 칸으로 줄 수 있다)
import { splitBogi } from './bogi';
import { codeRanges, previewText } from './richtext';

/** 시험지 모양: 국어·영어는 지문(읽는 글), 수학은 조건·풀이, 과학·사회는 자료·실험 상자, 코딩은 코드 */
export type ExamStyle = 'korean' | 'english' | 'math' | 'science' | 'social' | 'code' | 'general';

/** 과목 이름의 낱말 → 모양 (앞의 것이 먼저: '영문법'은 영어, '생명과학'은 과학, '문법'은 국어) */
const STYLE_WORDS: ReadonlyArray<readonly [ExamStyle, RegExp]> = [
  [
    'code',
    /코딩|프로그래밍|컴퓨터|^정보$|정보\s*(?:과학|처리|기술|교과)|알고리즘|자료\s*구조|파이썬|자바|c\+\+|c\s*언어|python|java|\bsql\b|coding|programming|computer/i,
  ],
  ['math', /수학|미적분|확률|통계|기하|대수|산수|math|calculus|algebra|geometry|statistics/i],
  ['science', /과학|물리|화학|생명|생물|지구|천문|science|physics|chemistry|biology/i],
  ['english', /영어|영문|영단어|english|토익|toeic|토플|toefl|텝스|teps|회화/i],
  ['korean', /국어|문학|독서|언어와\s*매체|화법|작문|문법|고전|한문|국문/i],
  ['social', /사회|역사|한국사|세계사|동아시아사|지리|경제|정치|윤리|도덕|사문|생윤|윤사|법|history|geography|economics|politics|social/i],
];

/** 글에서 영어 글자의 몫 (한글·영어 글자만 센다, 글자가 적으면 0) */
function latinShare(s: string): number {
  const en = s.match(/[A-Za-z]/g)?.length ?? 0;
  const ko = s.match(/[가-힣]/g)?.length ?? 0;
  return en + ko < 20 ? 0 : en / (en + ko);
}

/**
 * 시험지 모양: 과목 이름이 먼저, 모르는 이름이면 노트의 자료 종류(reading·math), 그래도 모르면 문제 글
 * (코드 블록·백틱 → 코딩, 수식 여럿 → 수학, 거의 영어 → 영어)
 */
export function examStyle(o: { subject?: string | null; material?: string | null; text?: string | null }): ExamStyle {
  const name = String(o.subject ?? '').trim();
  if (name) for (const [style, re] of STYLE_WORDS) if (re.test(name)) return style;
  const text = String(o.text ?? '');
  if (o.material === 'math') return 'math';
  if (o.material === 'reading') return latinShare(text) > 0.6 ? 'english' : 'korean';
  if (/^[ \t]*```/m.test(text) || (text.match(/`[^`\n]+`/g)?.length ?? 0) >= 2) return 'code';
  if ((text.match(/\$[^$\n]+\$/g)?.length ?? 0) >= 2) return 'math';
  if (latinShare(text) > 0.6) return 'english';
  return 'general';
}

// ------------------------------------------------------------- 문장 나누기
type Range = [number, number];

/** 건드리지 않을 자리: 코드(`조각`·``` 블록)와 수식($…$) */
function skipRanges(text: string): Range[] {
  const out = codeRanges(text);
  for (const m of text.matchAll(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!out.some(([a, b]) => s < b && e > a)) out.push([s, e]);
  }
  return out;
}
const inside = (ranges: readonly Range[], i: number) => ranges.some(([a, b]) => i >= a && i < b);

const ENDS = '.?!？！。';
const CLOSERS = `"'”’」』)]）`;
/** 마침표로 끝나도 문장 끝이 아닌 영어 줄임말 ('Mr. Smith', 'e.g. this') 과 이름 머리글자 ('J. K.') */
const ABBREV = /(?:^|[\s("'“‘])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|No|Fig|Vol|pp?|cf|approx|e\.g|i\.e|a\.m|p\.m|U\.S|[A-Z])$/;

/**
 * 문장 자리 [start, end) (양 끝 빈칸은 뺀다): 마침표·물음표 뒤에 빈칸이 오거나 줄이 바뀌면 끝.
 * 3.14 · a.b 처럼 바로 글자가 이어지면, 코드·수식 안이면, 번호('1.')면, 영어 줄임말('Mr.')이면 끝이 아니다
 */
function sentenceSpans(text: string, skip: readonly Range[] = skipRanges(text)): Range[] {
  const out: Range[] = [];
  let start = 0;
  const push = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push([s, e]);
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' && !inside(skip, i)) {
      push(i);
      start = i + 1;
      continue;
    }
    if (!ENDS.includes(ch) || inside(skip, i)) continue;
    let j = i + 1;
    while (j < text.length && (ENDS.includes(text[j]) || CLOSERS.includes(text[j]))) j++;
    if (j < text.length && !/\s/.test(text[j])) continue;
    if (ch === '.' && /(?:^|\s)\d{1,2}$/.test(text.slice(Math.max(0, i - 3), i))) continue;
    if (ch === '.' && ABBREV.test(text.slice(Math.max(0, i - 8), i))) continue;
    push(j);
    start = j;
    i = j - 1;
  }
  push(text.length);
  return out;
}

/** 글을 re(줄바꿈·빈 줄)에서 나눈다: 코드 블록·수식 안에서는 나누지 않는다 (코드 줄이 흩어지지 않게) */
function splitOutside(text: string, re: RegExp): string[] {
  const skip = skipRanges(text);
  const out: string[] = [];
  let from = 0;
  for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
    const at = m.index ?? 0;
    if (inside(skip, at)) continue;
    out.push(text.slice(from, at));
    from = at + m[0].length;
  }
  out.push(text.slice(from));
  return out;
}

// ------------------------------------------------------------- 묻는 문장 (발문)
const TAIL = `["'”’」』)\\]]*$`;
/** 분명히 묻는 문장: '~하시오', '~것은?', '무엇인가?' */
const STRONG_ASK = new RegExp(
  `(?:시오|십시오|하라|쓰라|구하라|고르라|답하라)\\s*[.。]?${TAIL}|(?:것은|것을|것만을|것끼리|값은|값을|무엇|어느|몇|얼마|누구|언제|어디|무슨|어떤|어떻게|왜)[^.?!]{0,40}[?？]${TAIL}`,
);
/** 묻는 것 같은 문장: 물음표로 끝나거나 '~인가.' */
const WEAK_ASK = new RegExp(`[?？]${TAIL}|(?:인가|일까|는가|은가)\\s*[.。]${TAIL}`);
/**
 * 영어 문제: 의문사로 시작해 물음표로 끝나거나, 시키는 말로 시작 (지문의 평서문 'When people sleep, …' 은 묻는 문장이 아니다)
 */
const EN_ASK =
  /^(?:(?:Which|What|Why|How|Who|Whom|Whose|When|Where)\b.*[?？]|(?:Choose|Select|Write|Explain|Describe|Find|Fill|Complete|Translate|Answer|Name|List|Calculate|Solve|Circle|Underline|Rewrite|Correct)\b.*[.?:])["'”’)\]]*$/;
/** 묻는 문장 뒤에 붙는 조건 ('(단, …)', '※ …') */
const CONDITION = /^\(?\s*(?:단|※|\*)\s*[,，:]?\s/;
/** 자료 앞의 이끄는 문장 ('다음은 … 실험이다.'): 실제 시험처럼 묻는 문장과 함께 위에 둔다 */
const LEAD = /^(?:다음|아래|그림|표|자료|그래프|지도|사진|도표|대화|실험|제시문)(?:은|는|의|에|과|와|을|를|\s)/;
/** 하위 문제 번호 '(1)' · '1)' */
const SUBQ = /^\(?(\d{1,2})\)\s*/;

/**
 * 묻는 문장 자리와 세기 (2: 분명히 묻는 한국어 문장, 1: 영어 문제·물음표만). 한국어 발문이 있으면 그것이 먼저:
 * 영어 시험은 발문이 한국어고 지문(영어)에 물음표 문장이 섞일 수 있다
 */
function askAt(sents: readonly string[]): { i: number; level: 1 | 2 } | null {
  for (let i = sents.length - 1; i >= 0; i--) if (STRONG_ASK.test(sents[i])) return { i, level: 2 };
  for (let i = sents.length - 1; i >= 0; i--) if (EN_ASK.test(sents[i])) return { i, level: 1 };
  for (let i = sents.length - 1; i >= 0; i--) if (WEAK_ASK.test(sents[i])) return { i, level: 1 };
  return null;
}
const askIndex = (sents: readonly string[]): number | null => askAt(sents)?.i ?? null;
/** 글의 문장들 */
const sentencesOf = (text: string): string[] => sentenceSpans(text).map(([s, e]) => text.slice(s, e));

/** 상자에 넣을 만한 자료인지: 길거나(두 문장 이상), 단계·표시·줄바꿈·코드가 있으면 */
function boxWorthy(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length >= 60 || /[\n①-⑳㉠-㉻㈎-㈛|]|\((?:가|나|다|라|마)\)|```/.test(t)) return true;
  return t.length >= 40 && sentenceSpans(t).length >= 2;
}

// ------------------------------------------------------------- 자료 상자의 줄
/** 상자 안 한 줄: 문단, 차례 칸(① … · (가) …), 제목([실험 과정]), 이름 붙은 줄(학생 A: … · 결과: …) */
export type ExamLine =
  { kind: 'p'; text: string } | { kind: 'step'; mark: string; text: string } | { kind: 'head'; text: string } | { kind: 'label'; label: string; text: string };

/** 시험지의 덩이 (그리는 차례대로) */
export type ExamBlock =
  { kind: 'stem'; text: string } | { kind: 'box'; lines: ExamLine[] } | { kind: 'bogi'; items: string[] } | { kind: 'text'; text: string };

export type ExamLayout = {
  /** 원래 문제 번호 ('1-가-1)', '[1~2]') */
  label: string | null;
  blocks: ExamBlock[];
  /** 묻는 문장 (없으면 문제 글 전체). 접힌 목록은 examSummary */
  ask: string;
};

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const HANGUL_MARKS = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'];
/** 표시가 글 조각의 시작인지 (앞이 줄 처음·빈칸·문장 부호) */
const startOk = (s: string, i: number) => i === 0 || /[\s.,:;(\[]/.test(s[i - 1]);

type Mark = { at: number; mark: string; len: number };

/** 표시 다음 말이 조사면 칸이 아니라 빈칸·가리키는 말이다 ('(가) 이므로', '(가) 에 알맞은 말') */
const PARTICLE_AFTER =
  /^\s*(?:이므로|이고|이며|이면|이라|이니|이다|이었|일|에서|에게|에|을|를|은|는|이|가|와|과|의|으로|로|도|만|까지|부터|처럼|보다)(?=[\s,，.。?!)\]]|$)/;
/** 칸 글이 문장처럼 끝나는지 (빈칸 '(가)'·'____'·'( )' 만 있거나 그것으로 끝나는 칸도 된다) */
const STEP_END = /(?:[.!?。]|[다요]|\((?:가|나|다|라|마|바|사|아|자|차)\)|_{2,}|\(\s*\))["'”’)\]]*\s*$/;

/** 표시마다 바로 뒤에 빈칸이 있고 그다음이 조사가 아닌지 ('①, ②는'·'①과 ②'·'①은'은 차례가 아니라 보기를 가리키는 말) */
function marksStartParts(line: string, marks: readonly Mark[]): boolean {
  return marks.every((m) => {
    const rest = line.slice(m.at + m.len);
    return /^\s/.test(rest) && !PARTICLE_AFTER.test(rest);
  });
}

/**
 * ①②③… 차례 칸 (①부터 차례대로, 처음 나온 것만: 뒤의 '⑦에서'는 칸이 아니다). 둘이 안 되면 null.
 * 보기를 가리키는 말('①, ②는 옳다')과 밑줄 친 말의 번호('The book ① that I read ② was …')는 칸이 아니다:
 * 표시 뒤에 빈칸이 있어야 하고, 마지막 칸을 뺀 칸의 반 넘게가 문장으로 끝나야 한다 (실험 과정·풀이 단계)
 */
function circledAt(line: string, skip: readonly Range[]): Mark[] | null {
  const out: Mark[] = [];
  let from = 0;
  for (const mark of CIRCLED) {
    let at = line.indexOf(mark, from);
    while (at >= 0 && (inside(skip, at) || !startOk(line, at))) at = line.indexOf(mark, at + 1);
    if (at < 0) break;
    out.push({ at, mark, len: 1 });
    from = at + 1;
  }
  if (out.length < 2 || !marksStartParts(line, out)) return null;
  const bodies = out.slice(0, -1).map((m, i) => line.slice(m.at + m.len, out[i + 1].at).trim());
  return bodies.filter((b) => STEP_END.test(b)).length * 2 >= bodies.length ? out : null;
}

/**
 * (가)(나)… 조건 칸: 문장 첫머리에서 차례대로, 뒤에 글이 다섯 자 넘게 (빈칸 '(가)'는 칸이 아니다: '③ (가) ④').
 * 수학은 조건을 늘 이렇게 쓴다
 */
function parenAt(line: string, skip: readonly Range[], math: boolean): Mark[] | null {
  const out: Mark[] = [];
  let from = 0;
  for (const h of HANGUL_MARKS) {
    const mark = `(${h})`;
    let at = line.indexOf(mark, from);
    const sentenceStart = (i: number) => i === 0 || /[.?!。]\s+$|^\s+$|:\s*$/.test(line.slice(Math.max(0, i - 3), i)) || (math && startOk(line, i));
    while (at >= 0 && (inside(skip, at) || !sentenceStart(at))) at = line.indexOf(mark, at + 1);
    if (at < 0) break;
    out.push({ at, mark, len: mark.length });
    from = at + mark.length;
  }
  // 표시 뒤가 조사면 빈칸이다 (수학적 귀납법의 '(가) 이므로')
  if (out.length < 2 || !marksStartParts(line, out)) return null;
  // 칸마다 글이 있어야 한다 (표시 사이가 비면 빈칸 표시다)
  for (let i = 0; i < out.length; i++) {
    const end = i + 1 < out.length ? out[i + 1].at : line.length;
    if (line.slice(out[i].at + out[i].len, end).trim().length < 5) return null;
  }
  return out;
}

/** 한 줄을 차례 칸으로 (칸이 없으면 문단 하나). 마지막 칸 뒤에 이어진 문장(실험 결과 …)은 따로 문단 */
function stepLines(line: string, style: ExamStyle): ExamLine[] {
  const skip = skipRanges(line);
  const marks = circledAt(line, skip) ?? parenAt(line, skip, style === 'math');
  if (!marks) return [{ kind: 'p', text: line }];
  const out: ExamLine[] = [];
  const intro = line.slice(0, marks[0].at).trim();
  if (intro) out.push({ kind: 'p', text: intro });
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : line.length;
    const body = line.slice(m.at + m.len, end).trim();
    if (i + 1 < marks.length) {
      out.push({ kind: 'step', mark: m.mark, text: body });
      return;
    }
    // 마지막 칸: 첫 문장만 칸에, 나머지(열두 자 넘게)는 문단
    const spans = sentenceSpans(body);
    const rest = spans.length >= 2 ? body.slice(spans[1][0]).trim() : '';
    if (rest.length >= 12) {
      out.push({ kind: 'step', mark: m.mark, text: body.slice(0, spans[0][1]).trim() });
      out.push({ kind: 'p', text: rest });
    } else out.push({ kind: 'step', mark: m.mark, text: body });
  });
  return out;
}

/**
 * 상자 머리 '[실험 과정]' · '<실험 결과>' · '【자료】' (보기 상자 표시는 bogi.ts 가 먼저 가져간다): 짝이 맞는 괄호 안의
 * 한글 이름이 줄 앞에 따로 있을 때만 ('[0, 1]에서 연속인 함수'·'<p>' 는 머리가 아니다). 괄호까지 그대로 보인다
 */
const HEAD = /^\s*([[［【〔<〈《])\s*([^\]］】〕>〉》\n,，]{1,24}?)\s*([\]］】〕>〉》])(?=\s|$)/;
const HEAD_PAIR: Record<string, string> = { '[': ']', '［': '］', '【': '】', '〔': '〕', '<': '>', '〈': '〉', '《': '》' };

function headAt(line: string): { text: string; rest: string } | null {
  const m = HEAD.exec(line);
  if (!m || HEAD_PAIR[m[1]] !== m[3] || /^\d+$/.test(m[2].trim()) || !/[가-힣]/.test(m[2])) return null;
  return { text: m[0].trim(), rest: line.slice(m[0].length).trim() };
}
/** 이름 붙은 줄 '학생 A: …' · '결과: …' (이름은 열두 자 안, 시각 '10:30' 은 아니다) */
const LABEL_LINE = /^([^\s:：][^:：\n]{0,11}?)\s*[:：]\s+(\S[\s\S]*)$/;
/** 이름으로 볼 수 없는 표시: 문장 끝·꾸미기(**·==·!!)·수식($)·코드(`)·괄호 */
const LABEL_MARKUP = /[.?!。`$*=\\{}<>_~[\]]/;

/** 줄 첫머리의 차례 표시 (단계·조건을 한 줄씩 쓴 새 꼴): ① · (가) · ㈎ 다음 빈칸 ('(가)는 …'의 (가)는 표시가 아니다) */
const LINE_MARK = /^([①-⑳㈎-㈛]|\((?:가|나|다|라|마|바|사|아|자|차)\))\s+(\S[\s\S]*)$/;

function materialLines(text: string, style: ExamStyle): ExamLine[] {
  const out: ExamLine[] = [];
  for (const raw of splitOutside(text, /\n/)) {
    let line = raw.trim();
    if (!line) continue;
    // 코드 블록은 한 덩이 그대로
    if (/^```/.test(line)) {
      out.push({ kind: 'p', text: line });
      continue;
    }
    const head = headAt(line);
    if (head) {
      out.push({ kind: 'head', text: head.text });
      line = head.rest;
      if (!line) continue;
    }
    const lab = LABEL_LINE.exec(line);
    // 이름에 꾸미기·수식·코드 표시가 있으면 이름 줄이 아니다 (이름은 꾸미기 없이 굵게 그린다)
    if (lab && !/^[\d\s]+$/.test(lab[1]) && !LABEL_MARKUP.test(lab[1])) {
      out.push({ kind: 'label', label: lab[1].trim(), text: lab[2].trim() });
      continue;
    }
    // 한 줄에 칸이 여럿이면 나누고, 줄 앞에 표시 하나면 그 칸 ('(가) 이므로'처럼 조사가 이어지면 빈칸이다)
    const steps = stepLines(line, style);
    const lm = steps.length === 1 ? LINE_MARK.exec(line) : null;
    const one = lm && !PARTICLE_AFTER.test(line.slice(lm[1].length)) ? lm : null;
    out.push(...(one ? [{ kind: 'step' as const, mark: one[1], text: one[2].trim() }] : steps));
  }
  return out;
}

// ------------------------------------------------------------- <보기> (줄 없이 이어 쓴 ㄱ. ㄴ. ㄷ. 도)
/**
 * '<보기>' 줄 없이 'ㄱ. … ㄴ. … ㄷ. …'를 이어 쓴 글 (자료에서 꺼낸 문제): ㄱ부터 차례대로 둘 넘게, 글 끝까지.
 * 앞 글이 묻는 문장이나 '<보기>'로 끝날 때만
 */
function inlineBogi(text: string): { before: string; items: string[] } | null {
  const seq = 'ㄱㄴㄷㄹㅁㅂ';
  const skip = skipRanges(text);
  const hits: Array<{ at: number; body: number }> = [];
  for (const m of text.matchAll(/(^|[\s>〉\])])([ㄱ-ㅂ])\s*[.．)]\s+/g)) {
    const at = (m.index ?? 0) + m[1].length;
    if (inside(skip, at)) continue;
    if (m[2] === 'ㄱ') hits.length = 0;
    if (m[2] !== seq[hits.length]) continue;
    hits.push({ at, body: (m.index ?? 0) + m[0].length });
  }
  if (hits.length < 2) return null;
  let before = text.slice(0, hits[0].at).trim();
  const mark = /[<〈［[(（]\s*보\s*기\s*[>〉］\])）]\s*$/.exec(before);
  if (mark) before = before.slice(0, mark.index).trim();
  else {
    const sents = sentenceSpans(before).map(([s, e]) => before.slice(s, e));
    if (!sents.length || askIndex(sents) !== sents.length - 1) return null;
  }
  // 표시는 쓴 그대로 ('ㄱ)' 을 'ㄱ.' 로 바꾸지 않는다)
  const items = hits.map((h, i) => text.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : text.length).trim());
  return { before, items };
}

// ------------------------------------------------------------- 시험지 덩이
/** 원래 문제 번호: '1-가-1)' · '2-1)' · '3)' · '[1~2]' */
const LABEL = /^(?:\[\s*\d{1,3}\s*[~∼～-]\s*\d{1,3}\s*\]|\d{1,3}(?:\s*-\s*[0-9A-Za-z가-힣]{1,3}){0,3}\s*\))\s+/;

/** 발문 + 그 뒤 조건, 앞의 하위 문제 '(1) … (2) …'까지 (하위 문제는 한 줄씩) */
function stemRange(sents: readonly string[], k: number): { from: number; to: number; sub: boolean } {
  let to = k;
  while (to + 1 < sents.length && CONDITION.test(sents[to + 1])) to++;
  // (2) 로 시작하는 발문이면 (1) 까지 거슬러 하위 문제를 모두 발문으로
  const n = SUBQ.exec(sents[k]);
  let from = k;
  if (n && Number(n[1]) >= 2) {
    let want = Number(n[1]) - 1;
    for (let i = k - 1; i >= 0 && want >= 1; i--) {
      const m = SUBQ.exec(sents[i]);
      if (m && Number(m[1]) === want) {
        from = i;
        want--;
      }
    }
    if (want >= 1) from = k;
  }
  return { from, to, sub: from < k };
}

/** 하위 문제 '(1) …(2) …'는 줄을 나눈다 */
function subLines(stem: string): string {
  return stem.replace(/\s+(?=\(\d{1,2}\)\s)/g, '\n');
}

/**
 * 문제 글을 시험지 덩이로: [원래 번호] → (이끄는 문장 + 발문 →) 자료 상자 → 발문 → <보기> → 남은 글.
 * 자료가 짧으면 상자 없이 발문 한 덩이 (한두 줄 문제는 예전처럼). style: 수학은 (가)(나) 조건을 늘 줄로 나눈다
 */
export function examLayout(prompt: string, style: ExamStyle = 'general'): ExamLayout {
  // 저장된 값이 글이 아니어도 그리다 멈추지 않게
  let text = String(prompt ?? '').trim();
  let label: string | null = null;
  const lm = LABEL.exec(text);
  if (lm && text.length > lm[0].length + 4) {
    label = lm[0].trim();
    text = text.slice(lm[0].length).trim();
  }
  let bogi: string[] | null = null;
  let after = '';
  const sb = splitBogi(text);
  if (sb) {
    text = sb.before;
    bogi = sb.items;
    after = sb.after;
  } else {
    const ib = inlineBogi(text);
    if (ib) {
      text = ib.before;
      bogi = ib.items;
    }
  }
  const blocks: ExamBlock[] = [];
  // 자료 → <보기> → 묻는 문장 (AI 가 발문을 마지막 문단에 쓴 꼴): 쓴 차례 그대로, 앞 글은 자료
  if (bogi && after && askIndex(sentencesOf(after)) !== null && askIndex(sentencesOf(text)) === null) {
    if (text) blocks.push(boxWorthy(text) ? { kind: 'box', lines: materialLines(text, style) } : { kind: 'text', text });
    blocks.push({ kind: 'bogi', items: bogi }, { kind: 'stem', text: subLines(after) });
    return { label, blocks, ask: after };
  }
  let ask = '';
  if (text) {
    const main = mainBlocks(text, style);
    blocks.push(...main.blocks);
    ask = main.ask;
  }
  if (bogi) blocks.push({ kind: 'bogi', items: bogi });
  if (after) blocks.push({ kind: 'text', text: after });
  return { label, blocks, ask: ask || String(prompt ?? '').trim() };
}

/** 마지막 문단이 '(2) …'면 '(1) …' 문단까지 거슬러 하위 문제를 모두 발문으로 (그 첫 문단 자리) */
function subParagraphsFrom(paras: readonly string[]): number {
  const last = paras.length - 1;
  const n = SUBQ.exec(paras[last]);
  if (!n || Number(n[1]) < 2) return last;
  let want = Number(n[1]) - 1;
  let from = last;
  for (let i = last - 1; i >= 0 && want >= 1; i--) {
    const m = SUBQ.exec(paras[i]);
    if (!m || Number(m[1]) !== want) break;
    from = i;
    want--;
  }
  return want >= 1 ? last : from;
}

function mainBlocks(text: string, style: ExamStyle): { blocks: ExamBlock[]; ask: string } {
  const paras = splitOutside(text, /\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length >= 2) {
    // 새 꼴: 자료 문단들 → 빈 줄 → 발문 (마지막 문단이 묻는 문장, 하위 문제 문단은 모두)
    const from = subParagraphsFrom(paras);
    const stem = paras.slice(from).join('\n');
    const lastAsk = /^```/.test(stem) ? null : askAt(sentencesOf(stem));
    // 발문이 먼저인 꼴 (국어·영어 시험: '다음 글의 주제로 가장 적절한 것은?' → 지문): 첫 문단이 묻는 문장으로 끝나고
    // 마지막 문단에는 그보다 약한 물음(지문 속 물음표 문장)만 있을 때
    const firstSents = sentencesOf(paras[0]);
    const firstAsk = askAt(firstSents);
    const firstIsAsk = !!firstAsk && firstAsk.i === firstSents.length - 1 && !/^```/.test(paras[0]);
    // 문단 모두가 하위 문제 '(1) …' '(2) …'
    if (lastAsk && from === 0) return { blocks: [{ kind: 'stem', text: subLines(stem) }], ask: stem };
    if (lastAsk && !(firstIsAsk && firstAsk.level > lastAsk.level)) {
      // 첫 문단이 '다음 글을 읽고 물음에 답하시오.' 같은 지시 한 문장이면 상자 밖 위에
      const order = from >= 2 && firstSents.length === 1 && firstAsk?.level === 2 ? paras[0] : '';
      const material = paras.slice(order ? 1 : 0, from).join('\n');
      return {
        blocks: [
          ...(order ? [{ kind: 'stem' as const, text: order }] : []),
          { kind: 'box', lines: materialLines(material, style) },
          { kind: 'stem', text: subLines(stem) },
        ],
        ask: stem,
      };
    }
    if (firstIsAsk) {
      const material = paras.slice(1).join('\n');
      return {
        blocks: [
          { kind: 'stem', text: subLines(paras[0]) },
          { kind: 'box', lines: materialLines(material, style) },
        ],
        ask: paras[0],
      };
    }
  }
  const spans = sentenceSpans(text);
  const sents = spans.map(([s, e]) => text.slice(s, e));
  if (sents.length <= 1) return { blocks: [{ kind: 'stem', text }], ask: text };
  const k = askIndex(sents) ?? sents.length - 1;
  const { from, to, sub } = stemRange(sents, k);
  const stemText = text.slice(spans[from][0], spans[to][1]).trim();
  let pre = text.slice(0, spans[from][0]).trim();
  const post = text.slice(spans[to][1]).trim();
  // 첫 문장이 자료를 이끌면 따로 위에: '다음은 … 실험이다.'(이끄는 말: 실제 시험처럼 발문과 함께 위로)
  // 또는 '다음 글을 읽고 물음에 답하시오.'(지시: 그 줄 그대로 위에, 묻는 문장은 자료 아래)
  let lead = '';
  let order = '';
  if (from >= 2) {
    if (STRONG_ASK.test(sents[0])) order = sents[0];
    else if (LEAD.test(sents[0]) && /다\s*[.。]$/.test(sents[0])) lead = sents[0];
    if (lead || order) pre = text.slice(spans[1][0], spans[from][0]).trim();
  }
  const stem = sub ? subLines(stemText) : stemText;
  const blocks: ExamBlock[] = [];
  if (boxWorthy(pre)) {
    if (lead) blocks.push({ kind: 'stem', text: `${lead} ${stem}` });
    if (order) blocks.push({ kind: 'stem', text: order });
    blocks.push({ kind: 'box', lines: materialLines(pre, style) });
    if (!lead) blocks.push({ kind: 'stem', text: stem });
  } else {
    // 짧은 자료는 발문과 한 덩이 (원래 글 그대로)
    blocks.push({ kind: 'stem', text: sub ? subLines(text.slice(0, spans[to][1]).trim()) : text.slice(0, spans[to][1]).trim() });
  }
  if (post) blocks.push(boxWorthy(post) ? { kind: 'box', lines: materialLines(post, style) } : { kind: 'text', text: post });
  return { blocks, ask: lead && boxWorthy(pre) ? `${lead} ${stemText}` : stemText };
}

// ------------------------------------------------------------- 정답·해설
/** 정답·해설의 한 줄: 차례 표시(①)나 이름('혈당량 조절', '(가)')이 있으면 줄 앞에 굵게 */
export type ExplainLine = { label: string | null; text: string };

/**
 * 문장 첫머리의 이름: '혈당량 조절: …' · '(가) …' · '(1) …' (이름은 열네 자 안, 괄호·문장 부호 없이.
 * 수식·코드·꾸미기 표시가 든 것은 이름이 아니다: '$f: A \to B$ 는 …', '`x: int` 는 …')
 */
const SENT_LABEL =
  /^(?:(\((?:가|나|다|라|마|바|사)\)|\(\d{1,2}\))\s*[:：]?\s*|([^\s:：.,()[\]$`*=!\\{}<>_~][^:：.,()[\]$`*=!\\{}<>_~\n]{0,13}?)\s*[:：]\s+)(\S[\s\S]*)$/;

/**
 * 정답·해설을 줄로: 이미 나뉜 줄은 그대로, 한 줄에 '이름: …'이나 (가)·(1)로 시작하는 문장이 둘 넘으면 그 문장마다 새 줄,
 * ①②… 차례가 있으면 칸마다 한 줄. 이름이 없는 문장은 앞 줄에 이어 붙인다.
 * 코드 블록(```)이나 여러 줄 수식($$)이 든 글은 나누지 않는다 (줄을 나누면 코드·수식이 깨진다): 한 덩이 그대로
 */
export function explainLines(text: string): ExplainLine[] {
  const all = String(text ?? '');
  if (/```|\$\$/.test(all)) return all.trim() ? [{ label: null, text: all.trim() }] : [];
  const out: ExplainLine[] = [];
  for (const raw of all.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const skip = skipRanges(line);
    const steps = circledAt(line, skip);
    if (steps) {
      for (const l of stepLines(line, 'general'))
        out.push(l.kind === 'step' ? { label: l.mark, text: l.text } : { label: null, text: l.kind === 'label' ? `${l.label}: ${l.text}` : l.text });
      continue;
    }
    const spans = sentenceSpans(line, skip);
    const parts = spans.map(([s, e]) => {
      const sent = line.slice(s, e);
      const m = SENT_LABEL.exec(sent);
      const lab = m ? (m[1] ?? m[2] ?? '').trim() : '';
      return m && lab && !/^\d+$/.test(lab) ? { label: lab, text: m[3].trim() } : { label: null, text: sent };
    });
    // 이름 붙은 문장이 둘 넘거나 줄이 이름으로 시작하면 이름마다 새 줄
    const labeled = parts.filter((p) => p.label).length;
    if (labeled >= 2 || (labeled === 1 && parts[0].label)) {
      let cur: ExplainLine | null = null;
      for (const p of parts) {
        if (p.label || !cur) {
          cur = { label: p.label, text: p.text };
          out.push(cur);
        } else cur.text = `${cur.text} ${p.text}`;
      }
    } else out.push({ label: null, text: line });
  }
  return out;
}

// ------------------------------------------------------------- 형식 이름
/** 화면에 보일 문제 형식: 단답(short)은 답이 길거나 설명하라는 문제면 서술형 */
export function questionFormat(q: { type: string; prompt: string; answer: unknown }): { label: string; descriptive: boolean } {
  if (q.type === 'mcq') return { label: '객관식', descriptive: false };
  if (q.type === 'ox') return { label: 'OX', descriptive: false };
  if (q.type === 'cloze') return { label: '빈칸', descriptive: false };
  const a = String(q.answer ?? '').trim();
  const asks = /(?:설명|서술|논술|비교|분석|제시|밝히|논하)\s*하(?:시오|라)|까닭|이유를|과정을|차이(?:점)?을|방법을/.test(q.prompt);
  const descriptive = a.length > 30 || a.includes('\n') || (asks && a.length > 12);
  return { label: descriptive ? '서술형' : '단답형', descriptive };
}

/** 객관식 보기 번호 (실제 시험처럼 ①②③…) */
export function choiceMark(i: number): string {
  return CIRCLED[i] ?? `${i + 1}.`;
}

// ------------------------------------------------------------- 접힌 목록
/** 덩이 글을 한 줄로 (코드 블록이 든 글은 줄을 지킨다) */
const oneLine = (s: string) => (/```/.test(s) ? s.trim() : s.replace(/\s+/g, ' ').trim());

/** 자료 줄을 읽는 차례대로 한 줄 글로 */
function lineText(l: ExamLine): string {
  if (l.kind === 'step') return `${l.mark} ${l.text}`;
  if (l.kind === 'head') return `[${l.text}]`;
  if (l.kind === 'label') return `${l.label}: ${l.text}`;
  return l.text;
}

/** 접힌 목록의 알아보기 글 길이 (두 줄에 다 보이지 않아도 된다: 화면 읽기 프로그램이 너무 길게 읽지 않게) */
const HINT_MAX = 80;

/**
 * 문제 목록에 접어 둘 때의 두 줄: 발문은 풀 때 굵게 보이는 그대로(짧은 자료와 한 덩이면 그 덩이째),
 * 그 뒤에 흐리게 자료 첫머리(없으면 <보기> 첫 줄). '이에 대한 설명으로 옳은 것은?'처럼 흔한 발문만으로는
 * 어느 문제인지 알 수 없어서 (발문이 길면 두 줄에서 잘려 안 보인다)
 */
export function examSummary(prompt: string, style: ExamStyle = 'general'): { ask: string; hint: string } {
  // 목록은 고르기·펼치기마다 다시 그려진다: 같은 문제는 한 번만 나눈다
  const key = `${style}\u0000${String(prompt ?? '')}`;
  const hit = summaryCache.get(key);
  if (hit) return hit;
  const out = summarize(String(prompt ?? ''), style);
  if (summaryCache.size >= SUMMARY_CACHE_MAX) summaryCache.clear();
  summaryCache.set(key, out);
  return out;
}

const SUMMARY_CACHE_MAX = 2000;
const summaryCache = new Map<string, { ask: string; hint: string }>();

function summarize(prompt: string, style: ExamStyle): { ask: string; hint: string } {
  const layout = examLayout(prompt, style);
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const want = flat(layout.ask);
  const stem = layout.blocks.find((b): b is Extract<ExamBlock, { kind: 'stem' }> => b.kind === 'stem' && flat(b.text).includes(want));
  const ask = oneLine(stem ? stem.text : layout.ask);
  const box = layout.blocks.find((b): b is Extract<ExamBlock, { kind: 'box' }> => b.kind === 'box');
  const bogi = layout.blocks.find((b): b is Extract<ExamBlock, { kind: 'bogi' }> => b.kind === 'bogi');
  let hint = box ? previewText(box.lines.map(lineText).join(' ')) : bogi?.items.length ? previewText(bogi.items[0]) : '';
  hint = flat(hint);
  if (!hint || flat(ask).includes(hint)) return { ask, hint: '' };
  return { ask, hint: hint.length > HINT_MAX ? `${hint.slice(0, HINT_MAX - 1).trimEnd()}…` : hint };
}
