// 글 속의 수식($...$)을 찾아 나눈다. Pandoc 규칙을 따른다:
// 여는 $ 바로 뒤와 닫는 $ 바로 앞은 빈칸이 아니고, 닫는 $ 뒤에 숫자가 오지 않는다.
// 그래서 "$5 와 $10" 같은 돈 표기는 수식으로 보지 않는다.

import { texToText } from './tex-text';

export type RichPart = { kind: 'text'; text: string } | { kind: 'math'; tex: string; display: boolean };

// ------------------------------------------------------------ $ 없이 쓴 수식
// AI·학생이 $ 없이 쓴 수식("y=e^{2x}과 y축", "a_n = 2^n")도 수식으로 보인다: 글 조각에서 수식 글자만으로 된 덩어리를 찾아
// 분명한 표시(^, 아래 첨자, \명령, 숫자·연산이 있는 등식)가 있으면 수식 조각으로 바꾼다. 영어 낱말(세 글자 이상, 함수 이름 빼고)과
// 한글은 덩어리를 끊고, 꾸미기 표시(**, ==, !!, ____)와 주소·메일은 그대로 둔다.
const MATH_CHARS = /[A-Za-z0-9\\^_{}()[\]+\-−×÷/=<>≤≥≠≈±.,:;'′°%!|& ]+/g;
const MATH_FUNCS = new Set([
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'log',
  'ln',
  'lim',
  'exp',
  'max',
  'min',
  'det',
  'mod',
  'sinh',
  'cosh',
  'tanh',
  'arcsin',
  'arccos',
  'arctan',
  'deg',
  'dim',
  'gcd',
  'sup',
  'inf',
  'sgn',
]);
const MATH_WORD = /(?<![\\A-Za-z0-9_^}])[A-Za-z]{2,}(?![A-Za-z_^{])/g;
/** 두 글자 낱말 중 수식에 흔한 것 (미분 dx·dy…) */
const MATH_TWO = new Set(['dx', 'dy', 'dz', 'dt', 'du', 'dv', 'dr', 'pi']);
/** 주소·메일은 수식으로 보지 않는다 */
const MATH_SKIP = /\S*(?:https?:\/\/|www\.|@)\S*/g;
const MATH_MARKS = /\*\*|==|!!/g;
const MATH_STRONG = [
  /\\[A-Za-z]{2,}/, // \frac, \sqrt, \pi …
  /\^[{(A-Za-z0-9+\-−]/, // x^2, e^{2x}
  /_\{|_\d|(?:^|[^A-Za-z0-9])[A-Za-z0-9]_[A-Za-z]/, // a_n, x_{i}, H_2O, CO_2 (snake_case 는 아님)
  /[A-Za-z0-9)\]]\s*[=<>≤≥≠≈]\s*[-−+(A-Za-z0-9\\]/, // 등식·부등식 (아래에서 숫자·연산이 같이 있어야 한다)
];
const MATH_OPERAND = /\d|[+\-−×÷/^\\]/;

function looksLikeMath(run: string): boolean {
  if (/__/.test(run)) return false;
  if (!MATH_STRONG.some((re) => re.test(run))) return false;
  // 등식만으로는 숫자·연산이 같이 있어야 (a = b 같은 영어 글은 그대로)
  return MATH_STRONG.slice(0, 3).some((re) => re.test(run)) || MATH_OPERAND.test(run);
}

/** 괄호 짝이 맞게 양 끝을 다듬는다: "1<a<e^2)" → "1<a<e^2", "(x+1" → "x+1" */
function balanceParens(core: string): string {
  let t = core;
  for (;;) {
    const open = (t.match(/[([]/g) ?? []).length;
    const close = (t.match(/[)\]]/g) ?? []).length;
    if (open === close) return t;
    if (close > open && /[)\]]$/.test(t)) t = t.slice(0, -1).replace(/[\s.,:;!]+$/, '');
    else if (open > close && /^[([]/.test(t)) t = t.slice(1).replace(/^[\s.,:;!]+/, '');
    else return t;
  }
}

/** 글 조각에서 $ 없이 쓴 수식을 찾아 수식 조각으로 나눈다 (없으면 글 그대로 하나) */
function bareMath(text: string): RichPart[] {
  if (!/[\\^_=<>]/.test(text)) return [{ kind: 'text', text }];
  const out: RichPart[] = [];
  const push = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += t;
    else out.push({ kind: 'text', text: t });
  };
  // 주소·메일은 통째로 글
  let from = 0;
  for (const u of text.matchAll(MATH_SKIP)) {
    bareMathRuns(text.slice(from, u.index ?? 0), out, push);
    push(u[0]);
    from = (u.index ?? 0) + u[0].length;
  }
  bareMathRuns(text.slice(from), out, push);
  return out.length ? out : [{ kind: 'text', text }];
}

function bareMathRuns(text: string, out: RichPart[], push: (t: string) => void): void {
  let at = 0;
  for (const m of text.matchAll(MATH_CHARS)) {
    const start = m.index ?? 0;
    push(text.slice(at, start));
    at = start + m[0].length;
    // 영어 낱말(함수 이름 빼고)과 ', ' 는 덩어리를 끊는다
    const pieces: Array<{ s: number; e: number }> = [];
    let ps = 0;
    const cut = (s: number, e: number) => {
      if (e > ps) pieces.push({ s: ps, e: s });
      ps = e;
    };
    const breaks: Array<{ s: number; e: number }> = [];
    for (const w of m[0].matchAll(MATH_WORD)) {
      const word = w[0].toLowerCase();
      if (!MATH_FUNCS.has(word) && !MATH_TWO.has(word)) breaks.push({ s: w.index ?? 0, e: (w.index ?? 0) + w[0].length });
    }
    for (const c of m[0].matchAll(/[,;]\s+/g)) breaks.push({ s: (c.index ?? 0) + 1, e: (c.index ?? 0) + c[0].length });
    for (const k of m[0].matchAll(MATH_MARKS)) breaks.push({ s: k.index ?? 0, e: (k.index ?? 0) + k[0].length });
    for (const b of breaks.sort((a, b) => a.s - b.s)) cut(b.s, b.e);
    pieces.push({ s: ps, e: m[0].length });
    let last = 0;
    for (const pc of pieces) {
      if (pc.e <= pc.s) continue;
      const raw = m[0].slice(pc.s, pc.e);
      // 양 끝의 빈칸과 문장 부호는 글로 남기고, 괄호 짝을 맞춘다
      const trimmed = raw.replace(/^[\s.,:;!]+/, '').replace(/[\s.,:;!]+$/, '');
      const core = balanceParens(trimmed);
      const lead = raw.indexOf(core);
      if (lead < 0 || core.length < 2 || !looksLikeMath(core)) continue;
      push(m[0].slice(last, pc.s + lead));
      out.push({ kind: 'math', tex: core, display: false });
      last = pc.s + lead + core.length;
    }
    push(m[0].slice(last));
  }
  push(text.slice(at));
}

export function splitMath(input: string): RichPart[] {
  const s = input ?? '';
  const out: RichPart[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) out.push(...bareMath(buf));
    buf = '';
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    if (ch === '$') {
      const display = s[i + 1] === '$';
      const open = display ? 2 : 1;
      const start = i + open;
      if (display) {
        const end = s.indexOf('$$', start);
        if (end > start) {
          const tex = s.slice(start, end).trim();
          if (tex) {
            flush();
            out.push({ kind: 'math', tex, display: true });
            i = end + 2;
            continue;
          }
        }
      } else if (start < s.length && !/\s/.test(s[start])) {
        let j = start;
        let found = -1;
        while (j < s.length) {
          const c = s[j];
          if (c === '\n') break;
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === '$') {
            if (!/\s/.test(s[j - 1]) && !/[0-9]/.test(s[j + 1] ?? '')) found = j;
            break;
          }
          j++;
        }
        if (found > start) {
          flush();
          out.push({ kind: 'math', tex: s.slice(start, found), display: false });
          i = found + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ------------------------------------------------------------ 쉬운 꾸미기
// **굵게**, ==형광펜==, !!빨간 글씨!!, 줄 앞 '- ' 목록, '1. ' 번호 목록, $수식$.
// 여는 표시 바로 뒤와 닫는 표시 바로 앞은 빈칸이 아니어야 꾸민다 ("대박!! 진짜!!" 같은 글은 그대로).

export type Inline = { t: 'text'; v: string } | { t: 'math'; tex: string; display: boolean } | { t: 'b' | 'mark' | 'red'; c: Inline[] };
export type RichLine = { list: 'bullet' | 'number' | null; n: number; c: Inline[] };

export const RICH_MARKS = [
  { mark: '**', t: 'b' },
  { mark: '==', t: 'mark' },
  { mark: '!!', t: 'red' },
] as const;

const PUA = 0xe000; // 수식 자리표 (개인용 글자 영역)

export type MarkHit = { mark: string; t: 'b' | 'mark' | 'red'; close: number };

/**
 * s 의 i 에서 꾸미기가 열리면 그 표시와 닫는 표시의 자리 (화면과 고치기 버튼이 같은 규칙을 쓴다).
 * - 여는 표시 바로 뒤와 닫는 표시 바로 앞은 빈칸이 아니고, 같은 기호가 셋 이상 이어지지 않는다
 * - 영어·숫자 바로 뒤에서 여는 표시는 안의 글에 한글 같은 글자가 있을 때만 (x**2 + y**2, a==b 는 그대로, 1**단계** 는 굵게)
 */
export function markAt(s: string, i: number): MarkHit | null {
  const m = RICH_MARKS.find((k) => s.startsWith(k.mark, i));
  if (!m) return null;
  const n = m.mark.length;
  const from = i + n;
  if (from >= s.length || /\s/.test(s[from]) || s[from] === m.mark[0]) return null;
  let j = s.indexOf(m.mark, from + 1);
  while (j !== -1 && (/\s/.test(s[j - 1]) || s[j + n] === m.mark[0])) j = s.indexOf(m.mark, j + 1);
  if (j === -1) return null;
  if (i > 0 && /[A-Za-z0-9]/.test(s[i - 1]) && !/[^\x00-\x7f]/.test(s.slice(from, j))) return null;
  return { mark: m.mark, t: m.t, close: j };
}

/** 한 줄 안의 꾸미기 자리 모두 (안쪽 것도). [여는 자리, 닫는 자리, 표시] — 고치기 버튼이 '이미 꾸민 곳'을 찾을 때 */
export function markSpans(line: string): Array<{ open: number; close: number; mark: string }> {
  const out: Array<{ open: number; close: number; mark: string }> = [];
  const walk = (from: number, to: number, depth: number) => {
    let i = from;
    while (i < to) {
      const hit = depth < 4 ? markAt(line.slice(0, to), i) : null;
      if (hit) {
        out.push({ open: i, close: hit.close, mark: hit.mark });
        walk(i + hit.mark.length, hit.close, depth + 1);
        i = hit.close + hit.mark.length;
        continue;
      }
      i++;
    }
  };
  walk(0, line.length, 0);
  return out;
}

function inlineNodes(s: string, maths: Array<{ tex: string; display: boolean }>, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    let text = '';
    for (const ch of buf) {
      const code = ch.charCodeAt(0);
      if (code >= PUA && code < PUA + maths.length) {
        if (text) out.push({ t: 'text', v: text });
        text = '';
        out.push({ t: 'math', ...maths[code - PUA] });
      } else text += ch;
    }
    if (text) out.push({ t: 'text', v: text });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const hit = depth < 4 ? markAt(s, i) : null;
    if (hit) {
      flush();
      out.push({ t: hit.t, c: inlineNodes(s.slice(i + hit.mark.length, hit.close), maths, depth + 1) });
      i = hit.close + hit.mark.length;
      continue;
    }
    buf += s[i];
    i++;
  }
  flush();
  return out;
}

/** 꾸민 글을 줄과 조각으로 나눈다 (화면은 이것만 그린다: HTML 로 바꾸지 않는다) */
export function parseRich(input: string): RichLine[] {
  const maths: Array<{ tex: string; display: boolean }> = [];
  let s = '';
  for (const p of splitMath(input ?? '')) {
    if (p.kind === 'text') s += p.text.replace(/[\ue000-\uf8ff]/g, '');
    else if (maths.length < 6000) {
      s += String.fromCharCode(PUA + maths.length);
      maths.push({ tex: p.tex, display: p.display });
    }
  }
  return s.split('\n').map((raw) => {
    const bullet = raw.match(/^\s*[-•]\s+/);
    const num = bullet ? null : raw.match(/^\s*(\d{1,3})[.)]\s+/);
    if (bullet) return { list: 'bullet' as const, n: 0, c: inlineNodes(raw.slice(bullet[0].length), maths) };
    if (num) return { list: 'number' as const, n: Number(num[1]), c: inlineNodes(raw.slice(num[0].length), maths) };
    return { list: null, n: 0, c: inlineNodes(raw, maths) };
  });
}

/** 꾸미기 기호나 수식이 들어 있는지 (고치기 칸에서 미리보기를 보일지) */
export function hasRichMarks(text: string): boolean {
  return parseRich(text).some((l) => l.list || l.c.some((n) => n.t !== 'text'));
}

/** 꾸미기 기호를 빼고 글만 (검색·미리보기용, 수식은 그대로) */
export function stripRich(input: string): string {
  const walk = (ns: Inline[]): string =>
    ns.map((n) => (n.t === 'text' ? n.v : n.t === 'math' ? (n.display ? `$$${n.tex}$$` : `$${n.tex}$`) : walk(n.c))).join('');
  return parseRich(input)
    .map((l) => walk(l.c))
    .join('\n');
}

/** 글자 꾸미기(**, ==, !!)만 빼고 줄 앞 목록 표시와 수식은 둔다 (AI 에 보낼 노트: AI 가 문제·그림에 기호를 옮기지 않게) */
export function stripMarks(input: string): string {
  const walk = (ns: Inline[]): string =>
    ns.map((n) => (n.t === 'text' ? n.v : n.t === 'math' ? (n.display ? `$$${n.tex}$$` : `$${n.tex}$`) : walk(n.c))).join('');
  return parseRich(input)
    .map((l) => (l.list === 'bullet' ? '- ' : l.list === 'number' ? `${l.n}. ` : '') + walk(l.c))
    .join('\n');
}

/** 꾸미기 기호(**, ==, !!)를 빼고 수식은 읽을 수 있는 글자로. 나머지 글은 그대로 (PDF 의 제목·용어처럼 __init__ 도 지키는 곳) */
export function plainMathText(input: string): string {
  return splitMath(stripRich(input ?? ''))
    .map((p) => (p.kind === 'text' ? p.text : texToText(p.tex)))
    .join('');
}

/** 카드 미리보기용: 수식은 읽을 수 있는 글자로, 줄바꿈과 꾸미기 기호는 정리 */
export function previewText(input: string): string {
  return plainMathText(input)
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
