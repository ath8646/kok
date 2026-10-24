// 글 속의 수식($...$)을 찾아 나눈다. Pandoc 규칙을 따른다:
// 여는 $ 바로 뒤와 닫는 $ 바로 앞은 빈칸이 아니고, 닫는 $ 뒤에 숫자가 오지 않는다.
// 그래서 "$5 와 $10" 같은 돈 표기는 수식으로 보지 않는다.

export type RichPart = { kind: 'text'; text: string } | { kind: 'math'; tex: string; display: boolean };

export function splitMath(input: string): RichPart[] {
  const s = input ?? '';
  const out: RichPart[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf });
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

const SUB: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  o: 'ₒ',
  x: 'ₓ',
  n: 'ₙ',
  i: 'ᵢ',
  m: 'ₘ',
};
const SUP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
  x: 'ˣ',
};
const TEX_SYMBOLS: Array<[RegExp, string]> = [
  [/\\(?:times)\b/g, '×'],
  [/\\(?:cdot)\b/g, '·'],
  [/\\(?:div)\b/g, '÷'],
  [/\\(?:pm)\b/g, '±'],
  [/\\(?:rightleftharpoons|leftrightarrow|Leftrightarrow)\b/g, '⇄'],
  [/\\(?:rightarrow|longrightarrow|Rightarrow|to)\b/g, '→'],
  [/\\(?:leftarrow|Leftarrow)\b/g, '←'],
  [/\\(?:leq|le)\b/g, '≤'],
  [/\\(?:geq|ge)\b/g, '≥'],
  [/\\(?:neq|ne)\b/g, '≠'],
  [/\\(?:approx)\b/g, '≈'],
  [/\\(?:infty)\b/g, '∞'],
  [/\^\s*\{?\\circ\}?/g, '°'],
  [/\\(?:degree)\b/g, '°'],
  [/\\(?:pi)\b/g, 'π'],
  [/\\(?:alpha)\b/g, 'α'],
  [/\\(?:beta)\b/g, 'β'],
  [/\\(?:gamma)\b/g, 'γ'],
  [/\\(?:Delta)\b/g, 'Δ'],
  [/\\(?:delta)\b/g, 'δ'],
  [/\\(?:theta)\b/g, 'θ'],
  [/\\(?:lambda)\b/g, 'λ'],
  [/\\(?:mu)\b/g, 'μ'],
  [/\\(?:sigma)\b/g, 'σ'],
  [/\\(?:omega)\b/g, 'ω'],
  [/\\(?:Omega)\b/g, 'Ω'],
];

function mapAll(s: string, table: Record<string, string>): string | null {
  let out = '';
  for (const ch of s) {
    const m = table[ch];
    if (!m) return null;
    out += m;
  }
  return out;
}

/** 수식 한 조각을 글자로 대강 바꾼다 (CO_2 → CO₂, x^2 → x², \times → ×) */
export function texToText(tex: string): string {
  let t = tex;
  t = t.replace(/\\(?:text|mathrm|textbf|mathbf|operatorname)\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2');
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  for (const [re, s] of TEX_SYMBOLS) t = t.replace(re, s);
  t = t.replace(/_\{([^{}]*)\}|_([^\s{}\\])/g, (m, a: string | undefined, b: string | undefined) => {
    const raw = a ?? b ?? '';
    return mapAll(raw.replace(/\s+/g, ''), SUB) ?? raw;
  });
  t = t.replace(/\^\{([^{}]*)\}|\^([^\s{}\\])/g, (m, a: string | undefined, b: string | undefined) => {
    const raw = a ?? b ?? '';
    return mapAll(raw.replace(/\s+/g, ''), SUP) ?? `^${raw}`;
  });
  t = t.replace(/\\left|\\right/g, '');
  t = t.replace(/\\[a-zA-Z]+/g, '');
  t = t.replace(/[{}]/g, '').replace(/\\,|\;|\\!|\\ /g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** 카드 미리보기용: 수식은 읽을 수 있는 글자로, 줄바꿈과 꾸미기 기호는 정리 */
export function previewText(input: string): string {
  return splitMath(stripRich(input ?? ''))
    .map((p) => (p.kind === 'text' ? p.text : texToText(p.tex)))
    .join('')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
