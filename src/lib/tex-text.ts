// 수식(LaTeX) 한 조각을 한 줄 글로 바꾼다. 카드 미리보기·그림 이름(previewText)과 PDF 요약 정리가 쓴다.
// 한 줄 글로 바꿔도 뜻이 바뀌지 않게: 분수는 묶어야 할 곳에 괄호(b/(2a), (1/2)mv², (b²-4ac)/(4a)), 대분수는 2¹⁄₃,
// 첨자로 못 바꾸는 것은 ^(k+1)·_(…), sin·log·lim 같은 함수 이름은 남긴다(sin²θ, lim(x→0)).
// 글자는 PDF 수식 글꼴(DejaVu Sans 에서 뽑은 것, tools/pdf-fonts/math-font.py)에 있는 것만 쓴다.

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
  '−': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
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
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  i: 'ⁱ',
  j: 'ʲ',
  k: 'ᵏ',
  l: 'ˡ',
  m: 'ᵐ',
  n: 'ⁿ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  x: 'ˣ',
  y: 'ʸ',
  z: 'ᶻ',
  T: 'ᵀ',
  // 여집합 A^C
  C: 'ᶜ',
};
/** 앞 덩어리에 붙는 글자 (위아래 첨자·프라임·도) */
const SCRIPT_CHARS = new Set([...Object.values(SUB), ...Object.values(SUP), '′', '″', '‴', '°']);

const GREEK: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};
/** 글자처럼 뒤 글자와 붙는 기호 (\Delta x → Δx, \angle ABC → ∠ABC) */
const TEX_LETTERS: Record<string, string> = { ...GREEK, partial: '∂', nabla: '∇', angle: '∠', measuredangle: '∡', triangle: '△', hbar: 'ℏ', ell: 'ℓ' };
const TEX_SYMBOLS: Record<string, string> = {
  ...TEX_LETTERS,
  times: '×',
  cdot: '·',
  cdotp: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  ast: '*',
  star: '⋆',
  circ: '∘',
  bullet: '•',
  oplus: '⊕',
  otimes: '⊗',
  odot: '⊙',
  rightleftharpoons: '⇌',
  leftrightharpoons: '⇋',
  rightleftarrows: '⇄',
  leftrightarrows: '⇆',
  rightarrow: '→',
  longrightarrow: '→',
  to: '→',
  leftarrow: '←',
  longleftarrow: '←',
  gets: '←',
  leftrightarrow: '↔',
  longleftrightarrow: '↔',
  Rightarrow: '⇒',
  Longrightarrow: '⇒',
  implies: '⇒',
  Leftarrow: '⇐',
  Longleftarrow: '⇐',
  impliedby: '⇐',
  Leftrightarrow: '⇔',
  Longleftrightarrow: '⇔',
  iff: '⇔',
  uparrow: '↑',
  downarrow: '↓',
  updownarrow: '↕',
  Uparrow: '⇑',
  Downarrow: '⇓',
  mapsto: '↦',
  nearrow: '↗',
  searrow: '↘',
  nwarrow: '↖',
  swarrow: '↙',
  leq: '≤',
  le: '≤',
  leqslant: '≤',
  leqq: '≦',
  geq: '≥',
  ge: '≥',
  geqslant: '≥',
  geqq: '≧',
  neq: '≠',
  ne: '≠',
  lt: '<',
  gt: '>',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  doteq: '≐',
  fallingdotseq: '≒',
  ll: '≪',
  gg: '≫',
  propto: '∝',
  infty: '∞',
  sum: '∑',
  prod: '∏',
  coprod: '∐',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  bigcup: '⋃',
  bigcap: '⋂',
  therefore: '∴',
  because: '∵',
  perp: '⊥',
  parallel: '∥',
  nparallel: '∦',
  square: '□',
  Box: '□',
  diamond: '◇',
  frown: '⌒',
  diameter: '⌀',
  ldots: '…',
  dots: '…',
  dotsc: '…',
  dotso: '…',
  cdots: '⋯',
  dotsb: '⋯',
  dotsm: '⋯',
  vdots: '⋮',
  ddots: '⋱',
  in: '∈',
  notin: '∉',
  ni: '∋',
  subset: '⊂',
  supset: '⊃',
  subseteq: '⊆',
  supseteq: '⊇',
  subsetneq: '⊊',
  supsetneq: '⊋',
  cup: '∪',
  cap: '∩',
  setminus: '∖',
  smallsetminus: '∖',
  backslash: '∖',
  emptyset: '∅',
  varnothing: '∅',
  complement: '∁',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  neg: '¬',
  lnot: '¬',
  land: '∧',
  wedge: '∧',
  lor: '∨',
  vee: '∨',
  degree: '°',
  prime: '′',
  aleph: 'ℵ',
  Re: 'ℜ',
  Im: 'ℑ',
  langle: '⟨',
  rangle: '⟩',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  vert: '|',
  lvert: '|',
  rvert: '|',
  mid: '|',
  Vert: '‖',
  lVert: '‖',
  rVert: '‖',
  lbrace: '{',
  rbrace: '}',
  lbrack: '[',
  rbrack: ']',
  colon: ':',
  top: '⊤',
  bot: '⊥',
  dagger: '†',
  ddagger: '‡',
  checkmark: '✓',
  enspace: ' ',
  thinspace: ' ',
  medspace: ' ',
  thickspace: ' ',
  space: ' ',
  nobreakspace: ' ',
};
/** 뜻을 뒤집는 \not (\not= → ≠) */
const TEX_NOT: Record<string, string> = {
  '=': '≠',
  '<': '≮',
  '>': '≯',
  in: '∉',
  subset: '⊄',
  supset: '⊅',
  subseteq: '⊈',
  supseteq: '⊉',
  equiv: '≢',
  sim: '≁',
  parallel: '∦',
  exists: '∄',
  le: '≰',
  leq: '≰',
  ge: '≱',
  geq: '≱',
};
/** 이름을 그대로 쓰는 함수 (sin x, log₂ 8) */
const TEX_FUNCS = new Set([
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'log',
  'ln',
  'lg',
  'exp',
  'det',
  'gcd',
  'lcm',
  'deg',
  'dim',
  'arg',
  'ker',
  'hom',
  'Pr',
  'sgn',
  'lim',
  'liminf',
  'limsup',
  'max',
  'min',
  'sup',
  'inf',
]);
/** 아래 첨자를 괄호로 붙이는 함수 (lim(x→0), max(x∈A)) */
const TEX_LIMITS = new Set(['lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf']);
/** 안의 글을 글자 그대로 */
const TEX_TEXT = new Set([
  'text',
  'textrm',
  'textnormal',
  'textup',
  'textmd',
  'textbf',
  'textit',
  'textsl',
  'textsc',
  'textsf',
  'texttt',
  'emph',
  'mbox',
  'hbox',
]);
/** 안의 수식만 남기는 꾸밈 (글꼴·밑줄·상자·취소선) */
const TEX_STYLE = new Set([
  'mathrm',
  'mathbf',
  'mathit',
  'mathsf',
  'mathtt',
  'mathnormal',
  'boldsymbol',
  'bm',
  'pmb',
  'mathbb',
  'mathcal',
  'mathfrak',
  'mathscr',
  'underline',
  'boxed',
  'fbox',
  'cancel',
  'bcancel',
  'xcancel',
  'sout',
  'check',
  'breve',
  'acute',
  'grave',
  'mathring',
  'utilde',
  'overleftarrow',
  'overleftrightarrow',
  'underrightarrow',
  'underleftarrow',
  'underbrace',
  'overbrace',
]);
/** 글자 하나 위에 붙이는 표시 (x̄ 평균·켤레, F⃗ 벡터, ŷ). 두 글자 이상이면 글자만 (선분 AB) */
const TEX_ACCENTS: Record<string, string> = {
  bar: '̄',
  overline: '̄',
  vec: '⃗',
  overrightarrow: '⃗',
  hat: '̂',
  widehat: '̂',
  dot: '̇',
  ddot: '̈',
  tilde: '̃',
  widetilde: '̃',
};
/** 호 AB (⌒AB) */
const TEX_ARCS = new Set(['wideparen', 'overarc', 'overgroup']);
/** 인자를 읽고 버리는 명령 */
const TEX_DROP = new Set(['phantom', 'hphantom', 'vphantom', 'label', 'hspace', 'vspace', 'color']);
/** 예전 글꼴 바꾸기 ({\rm cm}): 그 묶음이 낱말이면 한 덩어리 */
const TEX_OLD_FONTS = new Set(['rm', 'bf', 'it', 'sf', 'tt', 'cal', 'mit']);
/** 행렬 괄호 (줄은 ; 로 나눈다) */
const TEX_MATRIX: Record<string, [string, string]> = {
  matrix: ['(', ')'],
  pmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
  smallmatrix: ['(', ')'],
};

/** 표에 직접 있는 값만 (\constructor 같은 이름이 Object 의 속성을 읽지 않게) */
const own = (table: Record<string, string>, key: string): string | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

function mapAll(s: string, table: Record<string, string>): string | null {
  let out = '';
  for (const ch of s) {
    const m = own(table, ch);
    if (!m) return null;
    out += m;
  }
  return out;
}

const CMD = /\\(?:([a-zA-Z]+)|([\s\S]))/y;

/** 명령 뒤 인자 하나: {…}(중괄호 짝을 맞춘다) · \명령 · 글자 하나 */
function readArg(s: string, from: number): { v: string; end: number } | null {
  let j = from;
  while (j < s.length && /\s/.test(s[j])) j++;
  if (j >= s.length || s[j] === '}') return null;
  if (s[j] === '{') {
    let depth = 0;
    for (let k = j; k < s.length; k++) {
      if (s[k] === '\\') k++;
      else if (s[k] === '{') depth++;
      else if (s[k] === '}' && --depth === 0) return { v: s.slice(j + 1, k), end: k + 1 };
    }
    return { v: s.slice(j + 1), end: s.length };
  }
  if (s[j] === '\\') {
    CMD.lastIndex = j;
    const m = CMD.exec(s);
    return m ? { v: m[0], end: CMD.lastIndex } : { v: '', end: j + 1 };
  }
  const ch = String.fromCodePoint(s.codePointAt(j) ?? 32);
  return { v: ch, end: j + ch.length };
}

/** [옵션] 인자 (\sqrt[3]{8}) */
function readOpt(s: string, from: number): { v: string; end: number } | null {
  let j = from;
  while (j < s.length && s[j] === ' ') j++;
  if (s[j] !== '[') return null;
  let depth = 0;
  for (let k = j + 1; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') depth--;
    else if (s[k] === ']' && depth <= 0) return { v: s.slice(j + 1, k), end: k + 1 };
  }
  return null;
}

/** 한 단계 안의 조각. 분수·근호·함수 이름은 양옆을 본 뒤에 글로 바꾼다 */
type Tok =
  | { k: 'txt'; v: string }
  /** 묶음 한 덩어리: {…}·\text{…}. 뒤에 첨자가 오면 덩어리가 아닐 때만 괄호로 */
  | { k: 'grp'; v: string; atom: boolean }
  | { k: 'frac'; num: string; den: string; digits: boolean }
  | { k: 'root'; idx: string; v: string; atom: boolean }
  /** 함수 이름 끝: 바로 뒤가 피연산자면 빈칸 (sin θ) */
  | { k: 'fn' }
  /** lim(…) 끝: 뒤의 분수가 앞에 곱해진 것으로 보지 않는다 */
  | { k: 'stop' };

type Part = { text: string; atom: boolean };

const startsOperand = (c: string) => c !== '' && !SCRIPT_CHARS.has(c) && /[\p{L}\p{N}(√∫∑∏∂∇∠△|]/u.test(c);
const endsOperand = (c: string) => c !== '' && (SCRIPT_CHARS.has(c) || /[\p{L}\p{N})\]|'!%]/u.test(c));
const paren = (s: string) => s.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$1($2)$3');

/** 처음 여는 괄호가 맨 끝에서 닫히는지 ((x+1) 은 한 덩어리, (a)(b) 는 아님) */
function wrappedIn(s: string, open: string, close: string): boolean {
  if (s[0] !== open || s[s.length - 1] !== close) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return i === s.length - 1;
  }
  return false;
}

/** 분모로 그대로 둘 수 있는 한 덩어리인지 (2·x²·π·시간·dx·√2·(x+1)·f(x)·|x|) */
function isAtomText(t: string): boolean {
  const cps = Array.from(t.trim());
  while (cps.length && SCRIPT_CHARS.has(cps[cps.length - 1])) cps.pop();
  const s = cps.join('');
  if (!s) return true;
  if (/^\d+(?:\.\d+)?$/.test(s) || /^\p{L}$/u.test(s) || /^\p{Script=Hangul}+$/u.test(s)) return true;
  if (/^[dδΔ∂][a-zA-Zα-ω]$/u.test(s)) return true;
  if (s[0] === '√') return isAtomText(s.slice(1));
  if (wrappedIn(s, '(', ')') || wrappedIn(s, '[', ']') || /^\|[^|]+\|$/.test(s)) return true;
  const call = /^\p{L}+[′']*(?=\()/u.exec(s);
  return !!call && wrappedIn(s.slice(call[0].length), '(', ')');
}

const LOW_OPS = new Set([...'+-−±∓=≠<>≤≥≦≧≈≡≃≅∼≒→←↔⇒⇐⇔⇌⇄,;/÷']);
/** 분자를 괄호로 묶어야 하는지: 바깥에 +, −, =, 빈칸 같은 것이 있으면 (맨 앞 부호는 괜찮다) */
function needsNumParens(t: string): boolean {
  let depth = 0;
  for (const ch of t.trim().replace(/^[-−+]/, '')) {
    if ('([{⟨'.includes(ch)) depth++;
    else if (')]}⟩'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (LOW_OPS.has(ch) || /\s/.test(ch))) return true;
  }
  return false;
}

const isWord = (t: string) => /^[\p{L}\p{N}]+$/u.test(t.trim());

/** 조각 i 바로 뒤의 글자 (빈칸을 건너뛸지). 분수·근호는 피연산자, lim(…) 끝은 '' */
function charAfter(toks: Tok[], i: number, skipSpace: boolean): string {
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t.k === 'fn') continue;
    if (t.k === 'stop') return '';
    if (t.k === 'frac' || t.k === 'root') return '√';
    const v = skipSpace ? t.v.trimStart() : t.v;
    if (v) return Array.from(v)[0];
  }
  return '';
}

/** 분수 앞이 무엇인지: 피연산자로 끝나는지·숫자인지·분수인지·함수 이름인지 */
function sideBefore(toks: Tok[], i: number): { operand: boolean; digit: boolean; frac: boolean; fn: boolean } {
  for (let j = i - 1; j >= 0; j--) {
    const t = toks[j];
    if (t.k === 'stop') break;
    if (t.k === 'fn') return { operand: true, digit: false, frac: false, fn: true };
    if (t.k === 'frac') return { operand: true, digit: false, frac: true, fn: false };
    if (t.k === 'root') return { operand: true, digit: false, frac: false, fn: false };
    const cps = Array.from(t.v.trimEnd());
    if (!cps.length) continue;
    const c = cps[cps.length - 1];
    return { operand: endsOperand(c), digit: /[0-9]/.test(c), frac: false, fn: false };
  }
  return { operand: false, digit: false, frac: false, fn: false };
}

function resolve(toks: Tok[]): string {
  let out = '';
  toks.forEach((t, i) => {
    if (t.k === 'txt' || t.k === 'grp') out += t.v;
    else if (t.k === 'stop') out += ' ';
    else if (t.k === 'fn') {
      // sin θ · sin²θ · sin(x) · sin(π/2)
      const next = charAfter(toks, i, false);
      if (toks[i + 1]?.k !== 'frac' && next !== '(' && next !== '[' && startsOperand(next)) out += ' ';
    } else if (t.k === 'root') {
      const bare = t.atom && !startsOperand(charAfter(toks, i, false));
      out += `${t.idx}√${bare ? t.v : `(${t.v})`}`;
    } else {
      const left = sideBefore(toks, i);
      if (t.digits && left.digit) {
        // 대분수: 2\frac{1}{3} → 2¹⁄₃
        out = `${out.trimEnd()}${mapAll(t.num, SUP)}⁄${mapAll(t.den, SUB)}`;
        return;
      }
      const body = `${t.num}/${t.den}`;
      const wrap = startsOperand(charAfter(toks, i, true)) || left.frac || left.fn || (left.operand && /^[\d.]/.test(t.num));
      out += wrap ? `(${body})` : body;
    }
  });
  return out;
}

function atomOf(toks: Tok[], text: string): boolean {
  const sig = toks.filter((t) => t.k !== 'fn' && !(t.k === 'txt' && !t.v.trim()));
  if (sig.some((t) => t.k === 'frac' || t.k === 'stop')) return false;
  const [a, b] = sig;
  const tail = sig.length === 1 || (sig.length === 2 && b.k === 'txt' && Array.from(b.v.trim()).every((c) => SCRIPT_CHARS.has(c)));
  if (a && tail && ((a.k === 'grp' && a.atom) || a.k === 'root')) return true;
  return isAtomText(text);
}

/** \text{…} 안: 글자 그대로 (\%·\{ 같은 것만 풀고, 안의 $…$ 는 수식으로) */
function textMode(s: string, depth: number): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      CMD.lastIndex = i;
      const m = CMD.exec(s);
      if (!m) break;
      i = CMD.lastIndex;
      if (m[2] !== undefined) out += m[2] === '!' ? '' : '\\,:; \n'.includes(m[2]) ? ' ' : m[2];
      else if (TEX_TEXT.has(m[1]) || TEX_STYLE.has(m[1])) {
        const a = readArg(s, i);
        if (a) {
          i = a.end;
          out += textMode(a.v, depth + 1);
        }
      } else out += m[1] === 'quad' || m[1] === 'qquad' ? ' ' : (own(TEX_SYMBOLS, m[1]) ?? '');
      continue;
    }
    if (c === '$') {
      const j = s.indexOf('$', i + 1);
      if (j > i) {
        out += renderTex(s.slice(i + 1, j), depth + 1).text;
        i = j + 1;
        continue;
      }
    }
    if (c !== '{' && c !== '}') out += c === '~' ? ' ' : c;
    i++;
  }
  return out;
}

function renderTex(s: string, depth: number): Part {
  if (depth > 12) return { text: s.replace(/\\[a-zA-Z]+|[\\{}]/g, ''), atom: false };
  let toks: Tok[] = [];
  let numToks: Tok[] | null = null; // {a \over b}
  const envs: string[] = [];
  let oldFont = false;
  const sub = (x: string) => renderTex(x, depth + 1);
  const push = (v: string) => {
    const last = toks[toks.length - 1];
    if (last?.k === 'txt') last.v += v;
    else toks.push({ k: 'txt', v });
  };
  const trimEnd = () => {
    const last = toks[toks.length - 1];
    if (last?.k === 'txt') last.v = last.v.trimEnd();
  };
  /** 줄 나눔 (\\): 행렬은 ;, 나머지는 , */
  const rowBreak = () => {
    trimEnd();
    push(envs.some((e) => Object.prototype.hasOwnProperty.call(TEX_MATRIX, e)) ? '; ' : ', ');
  };
  const pushFrac = (num: Part, den: Part) => {
    const n = num.text.trim();
    const d = den.text.trim();
    if (!n && !d) return;
    toks.push({ k: 'frac', num: num.atom || !needsNumParens(n) ? n : `(${n})`, den: den.atom ? d : `(${d})`, digits: /^\d+$/.test(n) && /^\d+$/.test(d) });
  };
  /** 첨자를 앞 덩어리에 붙인다: {a+b}^2 → (a+b)², \frac{1}{2}^2 → (1/2)² */
  const attach = (v: string) => {
    if (!v) return;
    while (toks.length) {
      const l = toks[toks.length - 1];
      if (l.k === 'txt' && !l.v.trim()) toks.pop();
      else break;
    }
    const last = toks[toks.length - 1];
    if (last?.k === 'txt') {
      last.v = last.v.trimEnd() + v;
      return;
    }
    if (last?.k === 'grp' && !last.atom) {
      last.v = paren(last.v);
      last.atom = true;
    } else if (last?.k === 'frac') toks[toks.length - 1] = { k: 'grp', v: `(${last.num}/${last.den})`, atom: true };
    else if (last?.k === 'root') toks[toks.length - 1] = { k: 'grp', v: `(${last.idx}√${last.atom ? last.v : `(${last.v})`})`, atom: true };
    toks.push({ k: 'txt', v });
  };
  const script = (kind: '^' | '_', raw: string) => {
    const p = sub(raw);
    const t = p.text.replace(/\s+/g, '');
    if (!t) return;
    if (kind === '^' && (t === '∘' || t === '°')) return attach('°');
    if (kind === '^' && /^[′']+$/.test(t)) return attach(t.replace(/'/g, '′'));
    const mapped = mapAll(t, kind === '^' ? SUP : SUB);
    if (mapped) return attach(mapped);
    // E_{운동} → E운동, x^k → x^k, a_{1/2} → a_(1/2)
    if (kind === '_' && /^\p{Script=Hangul}+$/u.test(t)) return attach(t);
    attach(kind + (Array.from(t).length === 1 ? t : `(${p.text.trim()})`));
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      CMD.lastIndex = i;
      const m = CMD.exec(s);
      if (!m) break;
      i = CMD.lastIndex;
      if (m[2] !== undefined) {
        const ch = m[2];
        if (ch === '\\') {
          const o = readOpt(s, i);
          if (o) i = o.end;
          rowBreak();
        } else if (ch === '|') push('‖');
        else if (ch === '!') {
          // 좁히는 빈칸: 없음
        } else push(',:;> \n\t'.includes(ch) ? ' ' : ch);
        continue;
      }
      const name = m[1];
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const o = readOpt(s, i);
        if (o) i = o.end;
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        const b = readArg(s, i);
        if (b) i = b.end;
        pushFrac(sub(a.v), sub(b?.v ?? ''));
      } else if (name === 'over') {
        numToks = toks;
        toks = [];
      } else if (name === 'sqrt') {
        const o = readOpt(s, i);
        if (o) i = o.end;
        const a = readArg(s, i);
        if (!a) {
          push('√');
          continue;
        }
        i = a.end;
        const p = sub(a.v);
        const n = o ? sub(o.v).text.replace(/\s+/g, '') : '';
        const idx = n ? mapAll(n, SUP) : '';
        // 위 첨자로 못 쓰는 거듭제곱근은 지수로: (x)^(1/α)
        if (idx === null) toks.push({ k: 'grp', v: `${paren(p.text.trim())}^(1/${n})`, atom: true });
        else toks.push({ k: 'root', idx, v: p.text.trim(), atom: p.atom });
      } else if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
        // 조합: ₙCᵣ (못 바꾸면 C(n, r))
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        const b = readArg(s, i);
        if (b) i = b.end;
        const n = sub(a.v).text.trim();
        const r = sub(b?.v ?? '').text.trim();
        const ns = mapAll(n.replace(/\s+/g, ''), SUB);
        const rs = mapAll(r.replace(/\s+/g, ''), SUB);
        toks.push({ k: 'grp', v: ns && rs ? `${ns}C${rs}` : `C(${n}, ${r})`, atom: true });
      } else if (TEX_TEXT.has(name)) {
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        const t = textMode(a.v, depth);
        toks.push({ k: 'grp', v: t, atom: isWord(t) });
      } else if (own(TEX_ACCENTS, name)) {
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        const p = sub(a.v);
        const t = p.text.trim();
        toks.push(/^\p{L}$/u.test(t) ? { k: 'grp', v: t + own(TEX_ACCENTS, name), atom: true } : { k: 'grp', v: p.text, atom: p.atom || isWord(t) });
      } else if (TEX_ARCS.has(name)) {
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        toks.push({ k: 'grp', v: `⌒${sub(a.v).text.trim()}`, atom: true });
      } else if (TEX_STYLE.has(name)) {
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        const p = sub(a.v);
        toks.push({ k: 'grp', v: p.text, atom: p.atom || isWord(p.text) });
        // 밑·위 설명은 괄호로: \underbrace{a+b}_{합} → a+b (합)
        const under = name === 'underbrace' ? '_' : name === 'overbrace' ? '^' : '';
        let j = i;
        while (under && s[j] === ' ') j++;
        if (under && s[j] === under) {
          const b = readArg(s, j + 1);
          if (b) {
            i = b.end;
            push(` (${sub(b.v).text.trim()})`);
          }
        }
      } else if (name === 'overset' || name === 'underset' || name === 'stackrel') {
        // 화살표 위 조건은 괄호로 (→(가열)), 호는 ⌒AB
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        const b = readArg(s, i);
        if (b) i = b.end;
        const top = sub(a.v).text.trim();
        const base = sub(b?.v ?? '').text.trim();
        toks.push({ k: 'grp', v: top === '⌒' ? `⌒${base}` : top ? `${base}(${top})` : base, atom: true });
      } else if (name === 'xrightarrow' || name === 'xleftarrow' || name === 'xRightarrow' || name === 'xLeftarrow' || name === 'xleftrightarrow') {
        const o = readOpt(s, i);
        if (o) i = o.end;
        const a = readArg(s, i);
        if (a) i = a.end;
        const notes = [a ? sub(a.v).text.trim() : '', o ? sub(o.v).text.trim() : ''].filter(Boolean);
        const arrow = { xrightarrow: '→', xleftarrow: '←', xRightarrow: '⇒', xLeftarrow: '⇐', xleftrightarrow: '↔' }[name];
        push(arrow + (notes.length ? `(${notes.join(', ')})` : ''));
      } else if (TEX_FUNCS.has(name)) {
        push(name);
        if (TEX_LIMITS.has(name)) {
          // lim_{x→0} → lim(x→0)
          let j = i;
          for (;;) {
            while (j < s.length && /\s/.test(s[j])) j++;
            const lim = /^\\(?:no)?limits(?![a-zA-Z])/.exec(s.slice(j, j + 10));
            if (!lim) break;
            j += lim[0].length;
          }
          const a = s[j] === '_' ? readArg(s, j + 1) : null;
          if (a) {
            i = a.end;
            push(`(${sub(a.v).text.trim()})`);
            toks.push({ k: 'stop' });
            continue;
          }
        }
        toks.push({ k: 'fn' });
      } else if (name === 'operatorname') {
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        push(textMode(a.v, depth).trim());
        toks.push({ k: 'fn' });
      } else if (name === 'pmod') {
        const a = readArg(s, i);
        if (a) {
          i = a.end;
          push(` (mod ${sub(a.v).text.trim()})`);
        }
      } else if (name === 'bmod' || name === 'mod') push(' mod ');
      else if (name === 'not') {
        let j = i;
        while (s[j] === ' ') j++;
        CMD.lastIndex = j;
        const n = s[j] === '\\' ? CMD.exec(s) : null;
        const key = n ? (n[1] ?? n[2]) : s[j];
        const neg = key ? own(TEX_NOT, key) : undefined;
        if (neg) {
          push(neg);
          i = n ? CMD.lastIndex : j + 1;
        }
      } else if (name === 'left' || name === 'right' || name === 'middle' || /^[bB]igg?[lmr]?$/.test(name)) {
        // 크기만 바꾸는 명령: 뒤 괄호만 남긴다 (\left. 은 없음)
        let j = i;
        while (s[j] === ' ') j++;
        if (s[j] === '.') i = j + 1;
      } else if (name === 'begin') {
        const a = readArg(s, i);
        if (!a) continue;
        i = a.end;
        const env = a.v.trim().replace(/\*$/, '');
        if (env === 'array' || env === 'alignat' || env === 'tabular') {
          const b = readArg(s, i);
          if (b) i = b.end;
        }
        envs.push(env);
        if (Object.prototype.hasOwnProperty.call(TEX_MATRIX, env)) push(TEX_MATRIX[env][0]);
        while (/\s/.test(s[i] ?? '')) i++;
      } else if (name === 'end') {
        const a = readArg(s, i);
        if (a) i = a.end;
        const env = envs.pop() ?? '';
        trimEnd();
        if (Object.prototype.hasOwnProperty.call(TEX_MATRIX, env)) push(TEX_MATRIX[env][1]);
      } else if (name === 'textcolor' || name === 'colorbox') {
        const a = readArg(s, i);
        if (a) i = a.end;
        const b = readArg(s, i);
        if (b) {
          i = b.end;
          const p = sub(b.v);
          toks.push({ k: 'grp', v: p.text, atom: p.atom });
        }
      } else if (name === 'tag') {
        const a = readArg(s, i);
        if (a) {
          i = a.end;
          push(` (${textMode(a.v, depth).trim()})`);
        }
      } else if (TEX_DROP.has(name)) {
        const a = readArg(s, i);
        if (a) i = a.end;
      } else if (name === 'cr' || name === 'newline') rowBreak();
      else if (TEX_OLD_FONTS.has(name)) oldFont = true;
      else if (name === 'quad' || name === 'qquad') toks.push({ k: 'stop' });
      else if (own(TEX_SYMBOLS, name) !== undefined) {
        push(own(TEX_SYMBOLS, name) ?? '');
        if (own(TEX_LETTERS, name)) {
          // TeX 는 명령 뒤 빈칸을 무시한다: \Delta x → Δx, \pi r → πr
          let j = i;
          while (s[j] === ' ') j++;
          if (j > i && /[a-zA-Z]/.test(s[j] ?? '')) i = j;
        }
      }
      // 모르는 명령은 뺀다 (뒤 {…} 는 묶음으로 남는다)
      continue;
    }
    if (c === '{') {
      const a = readArg(s, i);
      if (!a) {
        i++;
        continue;
      }
      i = a.end;
      const p = sub(a.v);
      toks.push({ k: 'grp', v: p.text, atom: p.atom });
      continue;
    }
    if (c === '^' || c === '_') {
      const a = readArg(s, i + 1);
      i = a ? a.end : i + 1;
      if (a) script(c, a.v);
      continue;
    }
    if (c === '}') {
      i++;
      continue;
    }
    if (c === '&') {
      // 칸 나눔: 앞 칸과 이어 읽지 않는다 (1 & \frac{1}{2} 는 대분수가 아님)
      toks.push({ k: 'stop' });
      i++;
      continue;
    }
    if (c === '~') {
      push(' ');
      i++;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i) ?? 32);
    push(ch);
    i += ch.length;
  }
  if (numToks) {
    const num = resolve(numToks);
    const den = resolve(toks);
    const denAtom = atomOf(toks, den);
    toks = [];
    pushFrac({ text: num, atom: atomOf(numToks, num) }, { text: den, atom: denAtom });
  }
  const text = resolve(toks);
  return { text, atom: atomOf(toks, text) || (oldFont && isWord(text)) };
}

/** 수식 한 조각을 읽을 수 있는 글자로 (CO_2 → CO₂, \frac{b}{2a} → b/(2a), \sin^2\theta → sin²θ) */
export function texToText(tex: string): string {
  return renderTex(tex ?? '', 0)
    .text.replace(/\s+/g, ' ')
    .replace(/([([{⟨]) /g, '$1')
    .replace(/ ([)\]}⟩,;])/g, '$1')
    .trim();
}
