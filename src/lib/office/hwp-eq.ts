// 한글 수식 편집기의 수식 글(HWP·HWPX 의 수식 개체) → LaTeX.
// 예: "{a+b} over 2" → \frac{a+b}{2}, "root 3 of x" → \sqrt[3]{x}, "sum _{i=1} ^n" → \sum_{i=1}^{n}, "LEFT ( x RIGHT )" → \left( x \right)
// 자주 쓰는 명령만 바꾸고, 모르는 낱말은 글자 그대로 둔다 (화면은 KaTeX 가 그리고, 못 그리면 글로 보인다).

type Tok = { k: 'word' | 'num' | 'sym' | 'open' | 'close' | 'sup' | 'sub' | 'text' | 'han'; v: string };

const GREEK = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'omicron',
  'pi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'chi',
  'psi',
  'omega',
];
const GREEK_UPPER: Record<string, string> = {
  gamma: '\\Gamma',
  delta: '\\Delta',
  theta: '\\Theta',
  lambda: '\\Lambda',
  xi: '\\Xi',
  pi: '\\Pi',
  sigma: '\\Sigma',
  upsilon: '\\Upsilon',
  phi: '\\Phi',
  psi: '\\Psi',
  omega: '\\Omega',
};

/** 낱말 명령 → LaTeX (소문자로 찾는다) */
const WORDS: Record<string, string> = {
  times: '\\times',
  div: '\\div',
  pm: '\\pm',
  mp: '\\mp',
  cdot: '\\cdot',
  circ: '\\circ',
  bullet: '\\bullet',
  le: '\\le',
  leq: '\\le',
  ge: '\\ge',
  geq: '\\ge',
  ne: '\\ne',
  neq: '\\ne',
  approx: '\\approx',
  sim: '\\sim',
  simeq: '\\simeq',
  equiv: '\\equiv',
  propto: '\\propto',
  in: '\\in',
  notin: '\\notin',
  ni: '\\ni',
  owns: '\\ni',
  subset: '\\subset',
  supset: '\\supset',
  subseteq: '\\subseteq',
  supseteq: '\\supseteq',
  cup: '\\cup',
  cap: '\\cap',
  union: '\\bigcup',
  inter: '\\bigcap',
  emptyset: '\\emptyset',
  inf: '\\infty',
  infinity: '\\infty',
  partial: '\\partial',
  nabla: '\\nabla',
  therefore: '\\therefore',
  because: '\\because',
  forall: '\\forall',
  exist: '\\exists',
  exists: '\\exists',
  angle: '\\angle',
  triangle: '\\triangle',
  perp: '\\perp',
  bot: '\\perp',
  parallel: '\\parallel',
  deg: '^{\\circ}',
  prime: "'",
  cdots: '\\cdots',
  ldots: '\\ldots',
  vdots: '\\vdots',
  ddots: '\\ddots',
  dots: '\\ldots',
  rarrow: '\\rightarrow',
  larrow: '\\leftarrow',
  lrarrow: '\\leftrightarrow',
  uparrow: '\\uparrow',
  downarrow: '\\downarrow',
  vee: '\\vee',
  wedge: '\\wedge',
  oplus: '\\oplus',
  otimes: '\\otimes',
  hbar: '\\hbar',
  ell: '\\ell',
  sum: '\\sum',
  prod: '\\prod',
  coprod: '\\coprod',
  int: '\\int',
  dint: '\\iint',
  tint: '\\iiint',
  oint: '\\oint',
  lim: '\\lim',
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  cot: '\\cot',
  sec: '\\sec',
  csc: '\\csc',
  arcsin: '\\arcsin',
  arccos: '\\arccos',
  arctan: '\\arctan',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  log: '\\log',
  ln: '\\ln',
  lg: '\\lg',
  exp: '\\exp',
  max: '\\max',
  min: '\\min',
  det: '\\det',
  gcd: '\\gcd',
  mod: '\\bmod',
  lbrace: '\\{',
  rbrace: '\\}',
};
/** 대문자 화살표는 두 줄 화살표 */
const UPPER_WORDS: Record<string, string> = {
  RARROW: '\\Rightarrow',
  LARROW: '\\Leftarrow',
  LRARROW: '\\Leftrightarrow',
  UPARROW: '\\Uparrow',
  DOWNARROW: '\\Downarrow',
};

const ACCENTS: Record<string, string> = {
  bar: '\\overline',
  vec: '\\vec',
  hat: '\\hat',
  dot: '\\dot',
  ddot: '\\ddot',
  tilde: '\\tilde',
  under: '\\underline',
  acute: '\\acute',
  grave: '\\grave',
  check: '\\check',
  breve: '\\breve',
  dyad: '\\overleftrightarrow',
  arch: '\\overset{\\frown}',
};
const STYLES: Record<string, string> = { rm: '\\mathrm', it: '\\mathit', bold: '\\mathbf' };
const MATRICES: Record<string, [string, string]> = {
  matrix: ['\\begin{matrix}', '\\end{matrix}'],
  pmatrix: ['\\begin{pmatrix}', '\\end{pmatrix}'],
  bmatrix: ['\\begin{bmatrix}', '\\end{bmatrix}'],
  dmatrix: ['\\begin{vmatrix}', '\\end{vmatrix}'],
  cases: ['\\begin{cases}', '\\end{cases}'],
  pile: ['\\begin{matrix}', '\\end{matrix}'],
  lpile: ['\\begin{matrix}', '\\end{matrix}'],
  rpile: ['\\begin{matrix}', '\\end{matrix}'],
  eqalign: ['\\begin{aligned}', '\\end{aligned}'],
};
/** 여러 글자 기호 */
const SYMBOLS: Array<[string, string]> = [
  ['<=>', '\\Leftrightarrow'],
  ['<->', '\\leftrightarrow'],
  ['==>', '\\Rightarrow'],
  ['<=', '\\le'],
  ['>=', '\\ge'],
  ['!=', '\\ne'],
  ['->', '\\to'],
  ['=>', '\\Rightarrow'],
  ['+-', '\\pm'],
  ['-+', '\\mp'],
  ['...', '\\ldots'],
];
const ONE_SYMBOL: Record<string, string> = { '%': '\\%', $: '\\$', '~': '\\ ', '`': '\\,', '\\': '\\backslash ' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      const t = end < 0 ? src.slice(i + 1) : src.slice(i + 1, end);
      out.push({ k: 'text', v: t });
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === '{' || c === '}') {
      out.push({ k: c === '{' ? 'open' : 'close', v: c });
      i++;
      continue;
    }
    if (c === '^' || c === '_') {
      out.push({ k: c === '^' ? 'sup' : 'sub', v: c });
      i++;
      continue;
    }
    const word = /^[A-Za-z]+/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      out.push(w.toLowerCase() === 'sup' ? { k: 'sup', v: '^' } : w.toLowerCase() === 'sub' ? { k: 'sub', v: '_' } : { k: 'word', v: w });
      i += w.length;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    const han = /^[^\x00-\x7f]+/.exec(src.slice(i));
    if (han) {
      out.push({ k: 'han', v: han[0] });
      i += han[0].length;
      continue;
    }
    const multi = SYMBOLS.find(([s]) => src.startsWith(s, i));
    if (multi) {
      out.push({ k: 'sym', v: multi[0] });
      i += multi[0].length;
      continue;
    }
    out.push({ k: 'sym', v: c });
    i++;
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isWord(t: Tok | undefined, ...ws: string[]): boolean {
    return !!t && t.k === 'word' && ws.includes(t.v.toLowerCase());
  }

  /** 닫는 } · 행 나누기 # · 칸 나누기 & · RIGHT 앞까지 */
  seq(stops: { close?: boolean; cells?: boolean; right?: boolean } = {}): string {
    const items: string[] = [];
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.k === 'close' && stops.close) break;
      if (t.k === 'sym' && stops.cells && (t.v === '#' || t.v === '&')) break;
      if (stops.right && this.isWord(t, 'right')) break;
      if (t.k === 'close') {
        // 짝 없는 } 는 건너뛴다
        this.i++;
        continue;
      }
      if (this.isWord(t, 'over')) {
        this.i++;
        const num = items.pop() ?? '';
        const den = this.element();
        items.push(`\\frac{${strip(num)}}{${strip(den)}}`);
        continue;
      }
      items.push(this.element());
    }
    return items.filter(Boolean).join(' ');
  }

  /** 원소 하나와 뒤에 붙는 위·아래 첨자 */
  element(): string {
    const base = this.atom();
    let sub = '';
    let sup = '';
    for (;;) {
      const t = this.peek();
      if (t?.k === 'sub' && !sub) {
        this.i++;
        sub = this.atom();
      } else if (t?.k === 'sup' && !sup) {
        this.i++;
        sup = this.atom();
      } else break;
    }
    return base + (sub ? `_{${strip(sub)}}` : '') + (sup ? `^{${strip(sup)}}` : '');
  }

  private atom(): string {
    const t = this.peek();
    if (!t) return '';
    this.i++;
    switch (t.k) {
      case 'open': {
        const inner = this.seq({ close: true });
        if (this.peek()?.k === 'close') this.i++;
        return `{${inner}}`;
      }
      case 'num':
        return t.v;
      case 'text':
        return t.v ? `\\text{${t.v.replace(/[{}\\]/g, '')}}` : '';
      case 'han':
        return `\\text{${t.v}}`;
      case 'sup':
      case 'sub':
        // 앞에 아무것도 없는 첨자: 빈 칸 위에
        return `{}${t.v}{${strip(this.atom())}}`;
      case 'close':
        return '';
      case 'sym': {
        const multi = SYMBOLS.find(([s]) => s === t.v);
        if (multi) return multi[1];
        return ONE_SYMBOL[t.v] ?? t.v;
      }
      case 'word':
        return this.word(t.v);
    }
  }

  private delim(): string {
    const t = this.peek();
    if (!t) return '.';
    this.i++;
    if (t.k === 'open') return '\\{';
    if (t.k === 'close') return '\\}';
    if (t.k === 'word') {
      const w = t.v.toLowerCase();
      if (w === 'lbrace') return '\\{';
      if (w === 'rbrace') return '\\}';
      if (w === 'langle') return '\\langle';
      if (w === 'rangle') return '\\rangle';
      if (w === 'lfloor' || w === 'rfloor' || w === 'lceil' || w === 'rceil') return `\\${w}`;
      this.i--;
      return '.';
    }
    if (t.v === '<') return '\\langle';
    if (t.v === '>') return '\\rangle';
    if (t.v === '||') return '\\|';
    if (/^[()[\]|./]$/.test(t.v)) return t.v;
    this.i--;
    return '.';
  }

  private word(w: string): string {
    const lw = w.toLowerCase();
    if (lw === 'sqrt') return `\\sqrt{${strip(this.element())}}`;
    if (lw === 'root') {
      const n = this.element();
      if (this.isWord(this.peek(), 'of')) this.i++;
      return `\\sqrt[${strip(n)}]{${strip(this.element())}}`;
    }
    if (lw === 'left') {
      const open = this.delim();
      const inner = this.seq({ right: true });
      let close = '.';
      if (this.isWord(this.peek(), 'right')) {
        this.i++;
        close = this.delim();
      }
      return `\\left${open} ${inner} \\right${close}`;
    }
    if (lw === 'right') return '';
    if (ACCENTS[lw]) return `${ACCENTS[lw]}{${strip(this.element())}}`;
    if (STYLES[lw]) return `${STYLES[lw]}{${strip(this.element())}}`;
    if (MATRICES[lw]) return this.matrix(MATRICES[lw]);
    if (UPPER_WORDS[w]) return UPPER_WORDS[w];
    if (WORDS[lw]) return WORDS[lw];
    if (GREEK.includes(lw)) {
      if (w === lw) return `\\${lw}`;
      // 대문자 그리스 문자 (GAMMA, Gamma): LaTeX 에 없는 것(ALPHA)은 로마자 대문자
      return GREEK_UPPER[lw] ?? lw[0].toUpperCase();
    }
    if (lw.startsWith('var') && GREEK.includes(lw.slice(3))) return `\\${lw}`;
    return w;
  }

  private matrix([begin, end]: [string, string]): string {
    if (this.peek()?.k !== 'open') return '';
    this.i++;
    const rows: string[][] = [[]];
    for (;;) {
      const cell = this.seq({ close: true, cells: true });
      rows[rows.length - 1].push(cell);
      const t = this.peek();
      if (!t) break;
      this.i++;
      if (t.k === 'close') break;
      if (t.v === '#') rows.push([]);
    }
    return `${begin}${rows.map((r) => r.join(' & ')).join(' \\\\ ')}${end}`;
  }
}

/** 겉의 한 겹 { } 를 벗긴다 (\frac{{a+b}}{2} 대신 \frac{a+b}{2}) */
function strip(s: string): string {
  const t = s.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return t;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\') {
      i++;
      continue;
    }
    if (t[i] === '{') depth++;
    else if (t[i] === '}') depth--;
    if (depth === 0 && i < t.length - 1) return t;
  }
  return t.slice(1, -1).trim();
}

/** 한글 수식 글 → LaTeX ($ 없이) */
export function hwpEqToTex(script: string): string {
  const src = (script ?? '').replace(/\r?\n/g, ' ').trim();
  if (!src) return '';
  return new Parser(tokenize(src)).seq().replace(/\s+/g, ' ').trim();
}
