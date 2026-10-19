// 그래프용 수식 읽기: "x^2 - 3x + 2", "2sin(x)", "sqrt(x+1)" 같은 식을 안전하게 계산한다.
// eval·Function 을 쓰지 않고 직접 읽는다 (AI 가 준 글이라 코드로 실행하지 않는다).

type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

const MAX_LEN = 160;

function tokenize(src: string): Tok[] | null {
  const s = src
    .replace(/\*\*/g, '^')
    .replace(/[×·∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\pi/g, 'pi')
    .replace(/\\left|\\right/g, '')
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'));
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) return null;
      out.push({ k: 'num', v });
      i = j;
      continue;
    }
    if (/[a-zA-Zπ\\]/.test(c)) {
      let j = i + (c === '\\' ? 1 : 0);
      while (j < s.length && /[a-zA-Zπ]/.test(s[j])) j++;
      const raw = s.slice(c === '\\' ? i + 1 : i, j).toLowerCase();
      // 함수 이름 뒤에 바로 붙은 x (sinx) 와 이어 쓴 글자(2xy 는 없다고 본다)를 나눈다
      const word = splitWord(raw);
      if (!word) return null;
      for (const w of word) out.push({ k: 'id', v: w });
      i = j;
      continue;
    }
    if ('+-*/^(),|'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

/** "sinx" → ["sin","x"], "xpi" → ["x","pi"]. 모르는 글자가 섞이면 null */
function splitWord(raw: string): string[] | null {
  const out: string[] = [];
  let rest = raw;
  const names = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x'].sort((a, b) => b.length - a.length);
  while (rest) {
    const hit = names.find((n) => rest.startsWith(n));
    if (!hit) return null;
    out.push(hit);
    rest = rest.slice(hit.length);
  }
  return out;
}

/**
 * 식을 계산 함수로 바꾼다. 읽을 수 없으면 null.
 * 앞의 "y =", "f(x) =" 는 뺀다. 곱하기를 생략해도 된다 (2x, 3(x+1), x(x-1)).
 */
export function compileExpr(input: string): Fn | null {
  if (typeof input !== 'string') return null;
  let src = input.trim();
  if (!src || src.length > MAX_LEN) return null;
  src = src.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
  const parsed = tokenize(src);
  if (!parsed || !parsed.length) return null;
  const toks: Tok[] = parsed;
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()?.v === v;

  const startsPrimary = (t: Tok | undefined) => !!t && (t.k === 'num' || t.k === 'id' || (t.k === 'op' && (t.v === '(' || t.v === '|')));

  function expr(): Fn | null {
    if (++depth > 40) return null;
    let left = term();
    while (left && (isOp('+') || isOp('-'))) {
      const op = (toks[p++] as { v: string }).v;
      const right = term();
      if (!right) return null;
      const a = left;
      left = op === '+' ? (x) => a(x) + right(x) : (x) => a(x) - right(x);
    }
    depth--;
    return left;
  }

  function term(): Fn | null {
    let left = unary();
    for (;;) {
      if (!left) return null;
      if (isOp('*') || isOp('/')) {
        const op = (toks[p++] as { v: string }).v;
        const right = unary();
        if (!right) return null;
        const a = left;
        left = op === '*' ? (x) => a(x) * right(x) : (x) => a(x) / right(x);
        continue;
      }
      // 생략한 곱하기: 2x, 3(x+1), x(x-1), 2sin(x) — 단 '|' 는 닫는 것일 수 있어 빼고 본다
      const t = peek();
      if (startsPrimary(t) && !(t?.k === 'op' && t.v === '|')) {
        const right = power();
        if (!right) return null;
        const a = left;
        left = (x) => a(x) * right(x);
        continue;
      }
      return left;
    }
  }

  function unary(): Fn | null {
    if (isOp('-')) {
      p++;
      const v = unary();
      return v ? (x) => -v(x) : null;
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }

  function power(): Fn | null {
    const base = primary();
    if (!base) return null;
    if (isOp('^')) {
      p++;
      const ex = unary();
      if (!ex) return null;
      return (x) => Math.pow(base(x), ex(x));
    }
    return base;
  }

  function primary(): Fn | null {
    const t = toks[p++];
    if (!t) return null;
    if (t.k === 'num') {
      const v = t.v;
      return () => v;
    }
    if (t.k === 'id') {
      if (t.v === 'x') return (x) => x;
      if (t.v in CONSTS) {
        const v = CONSTS[t.v];
        return () => v;
      }
      const f = FUNCS[t.v];
      if (!f) return null;
      // sin(x), sin x, sin^2(x) 는 받지 않는다: 괄호가 있어야 한다
      if (isOp('(')) {
        p++;
        const inner = expr();
        if (!inner || !isOp(')')) return null;
        p++;
        return (x) => f(inner(x));
      }
      const arg = power();
      return arg ? (x) => f(arg(x)) : null;
    }
    if (t.v === '(') {
      const inner = expr();
      if (!inner || !isOp(')')) return null;
      p++;
      return inner;
    }
    if (t.v === '|') {
      const inner = expr();
      if (!inner || !isOp('|')) return null;
      p++;
      return (x) => Math.abs(inner(x));
    }
    return null;
  }

  const fn = expr();
  if (!fn || p !== toks.length) return null;
  // 한 번 계산해 봐서 던지지 않는지
  try {
    fn(0.5);
  } catch {
    return null;
  }
  return fn;
}
