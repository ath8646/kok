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

/** 수식 표시를 빼고 읽기 쉬운 글로 (검색·미리보기용) */
export function plainText(input: string): string {
  return splitMath(input)
    .map((p) => (p.kind === 'text' ? p.text : p.tex))
    .join('');
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

/** 카드 미리보기용: 수식은 읽을 수 있는 글자로, 줄바꿈과 마크다운 기호는 정리 */
export function previewText(input: string): string {
  return splitMath(input ?? '')
    .map((p) => (p.kind === 'text' ? p.text : texToText(p.tex)))
    .join('')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
