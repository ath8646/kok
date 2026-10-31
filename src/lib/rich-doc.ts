// 노트 글(쉬운 꾸미기 기호) ↔ 보이는 그대로 고치는 칸의 문서(Tiptap 문서 JSON).
// 저장 형식은 그대로다: **굵게**·==형광펜==·!!빨간 글씨!!·줄 앞 '- '·'1. '·$수식$·`코드`·``` 코드 블록 (src/lib/richtext.ts 의 parseRich 가 읽는 그대로).
// 코드는 문서에서 'code' 표시(다른 꾸미기와 같이 쓸 수 있다)와 'codeBlock' 덩이다.
// 문서 → 글은 만든 글을 다시 읽어(parseRich) 같은지 확인하고, 기호로 적을 수 없는 꾸미기(영어·숫자 바로 뒤에서 여는 굵게 등)는
// 그 꾸미기만 뺀다: 글자는 잃지 않는다. 고치지 않은 칸은 이 변환을 거치지 않는다(칸이 문서가 바뀐 때만 저장).
import { codeBlock, codeSpan, parseRich, richBlocks, type Inline } from './richtext';

export type RichMarkName = 'bold' | 'highlight' | 'red';
export type DocMark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; marks?: DocMark[]; text?: string };

/** 여는 차례 (바깥 → 안): 같은 자리에서 여러 꾸미기를 열면 굵게가 가장 바깥 */
const MARK_ORDER: readonly RichMarkName[] = ['bold', 'highlight', 'red'];
const SYMBOL: Record<RichMarkName, string> = { bold: '**', highlight: '==', red: '!!' };
const FROM_INLINE = { b: 'bold', mark: 'highlight', red: 'red' } as const;

const BULLET_PREFIX = /^\s*[-•]\s+/;
const NUMBER_PREFIX = /^\s*(\d{1,3})[.)]\s+/;

// ------------------------------------------------------------------ 글 → 문서
function marksOf(names: readonly RichMarkName[], code = false): DocMark[] | undefined {
  const marks: DocMark[] = MARK_ORDER.filter((m) => names.includes(m)).map((type) => ({ type }));
  if (code) marks.push({ type: 'code' });
  return marks.length ? marks : undefined;
}

function pushText(out: DocNode[], text: string, names: readonly RichMarkName[], code = false) {
  if (!text) return;
  const last = out[out.length - 1];
  const key = (marksOf(names, code) ?? []).map((m) => m.type).join(',');
  // 코드 조각은 따로 둔다 (붙어 있는 두 코드 조각을 하나로 합치지 않게)
  if (!code && last?.type === 'text' && (last.marks ?? []).map((m) => m.type).join(',') === key) {
    last.text = (last.text ?? '') + text;
    return;
  }
  const marks = marksOf(names, code);
  out.push(marks ? { type: 'text', text, marks } : { type: 'text', text });
}

function inlineDoc(ns: Inline[], names: RichMarkName[], out: DocNode[]) {
  for (const n of ns) {
    if (n.t === 'text') pushText(out, n.v, names);
    else if (n.t === 'code') pushText(out, n.v, names, true);
    else if (n.t === 'math') {
      const marks = marksOf(names);
      out.push({ type: 'math', attrs: { tex: n.tex, display: n.display }, ...(marks ? { marks } : {}) });
    } else {
      const m = FROM_INLINE[n.t];
      inlineDoc(n.c, names.includes(m) ? names : [...names, m], out);
    }
  }
}

const paragraph = (content: DocNode[]): DocNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

/**
 * 저장된 글 → 문서. single: 한 줄 칸(개념 이름·용어): 줄 앞 목록 표시도 글자 그대로, 여러 줄은 빈칸으로 잇는다
 */
export function richToDoc(text: string, opts: { single?: boolean } = {}): DocNode {
  const src = text ?? '';
  const lines = parseRich(src);
  if (opts.single) {
    // 줄 앞 목록 표시는 글자로 (읽을 때 나눈 줄과 글의 줄이 같을 때는 적힌 그대로). 코드 블록 줄은 코드 조각으로
    const raw = src.split('\n');
    const same = raw.length === lines.length;
    const out: DocNode[] = [];
    lines.forEach((l, i) => {
      if (i) pushText(out, ' ', []);
      if (l.list && !l.code) {
        const m = same ? raw[i].match(l.list === 'bullet' ? BULLET_PREFIX : NUMBER_PREFIX) : null;
        pushText(out, m ? m[0] : l.list === 'bullet' ? '- ' : `${l.n}. `, []);
      }
      inlineDoc(l.c, [], out);
    });
    return { type: 'doc', content: [paragraph(out)] };
  }
  const blocks: DocNode[] = [];
  let list: DocNode | null = null;
  for (const b of richBlocks(lines)) {
    if (b.code) {
      list = null;
      const body = b.lines.join('\n');
      blocks.push({ type: 'codeBlock', attrs: { language: b.lang || null }, ...(body ? { content: [{ type: 'text', text: body }] } : {}) });
      continue;
    }
    const l = b.line;
    const inl: DocNode[] = [];
    inlineDoc(l.c, [], inl);
    if (!l.list) {
      list = null;
      blocks.push(paragraph(inl));
      continue;
    }
    const type = l.list === 'bullet' ? 'bulletList' : 'orderedList';
    if (!list || list.type !== type) {
      list = type === 'orderedList' ? { type, attrs: { start: l.n || 1 }, content: [] } : { type, content: [] };
      blocks.push(list);
    }
    list.content!.push({ type: 'listItem', content: [paragraph(inl)] });
  }
  return { type: 'doc', content: blocks.length ? blocks : [paragraph([])] };
}

// ------------------------------------------------------------------ 문서 → 글
/** 한 줄의 조각: 글자 하나(꾸미기와 함께, code 면 코드 조각의 글자) 또는 수식 하나 */
type Atom = { ch: string; marks: Set<RichMarkName>; code?: boolean } | { math: string; display: boolean; marks: Set<RichMarkName> };

const KNOWN = new Set<string>(MARK_ORDER);

function atomsOf(nodes: DocNode[]): Atom[][] {
  // hardBreak 가 줄을 나눈다
  const lines: Atom[][] = [[]];
  for (const n of nodes) {
    const marks = new Set((n.marks ?? []).map((m) => m.type).filter((t): t is RichMarkName => KNOWN.has(t)));
    const code = (n.marks ?? []).some((m) => m.type === 'code');
    if (n.type === 'hardBreak') lines.push([]);
    else if (n.type === 'math') {
      const tex = String(n.attrs?.tex ?? '').trim();
      if (tex) lines[lines.length - 1].push({ math: tex, display: n.attrs?.display === true, marks });
    } else if (typeof n.text === 'string') {
      // 수식·코드 자리표로 쓰는 글자(개인용 영역)는 읽을 때 사라지니 처음부터 뺀다
      for (const ch of Array.from(n.text.replace(/[\ue000-\uf8ff\u{f0000}-\u{ffffd}]/gu, ''))) {
        if (ch === '\n') lines.push([]);
        else lines[lines.length - 1].push(code ? { ch, marks: new Set(marks), code: true } : { ch, marks: new Set(marks) });
      }
    } else if (n.content) {
      const inner = atomsOf(n.content);
      lines[lines.length - 1].push(...inner[0]);
      lines.push(...inner.slice(1));
    }
  }
  return lines;
}

const isSpace = (a: Atom) => 'ch' in a && !a.code && /\s/.test(a.ch);
const isCode = (a: Atom | undefined): a is { ch: string; marks: Set<RichMarkName>; code: true } => !!a && 'ch' in a && a.code === true;
const sameMarks = (a: Atom, b: Atom) => a.marks.size === b.marks.size && [...a.marks].every((m) => b.marks.has(m));

/** 꾸미기는 빈칸으로 열거나 닫을 수 없다: 꾸민 곳의 양 끝 빈칸은 꾸미기 밖으로 */
function trimEdges(atoms: Atom[]) {
  for (const m of MARK_ORDER) {
    let i = 0;
    while (i < atoms.length) {
      if (!atoms[i].marks.has(m)) {
        i++;
        continue;
      }
      let j = i;
      while (j < atoms.length && atoms[j].marks.has(m)) j++;
      let a = i;
      let b = j - 1;
      while (a <= b && isSpace(atoms[a])) atoms[a++].marks.delete(m);
      while (b >= a && isSpace(atoms[b])) atoms[b--].marks.delete(m);
      i = j;
    }
  }
}

function emit(atoms: Atom[], prefix: string, escape: boolean): string {
  let s = prefix;
  const stack: RichMarkName[] = [];
  let afterMath = false;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    // 열려 있는 것 중 이 조각에도 있는 앞부분만 두고 닫은 뒤, 없는 것을 연다
    let keep = 0;
    while (keep < stack.length && a.marks.has(stack[keep])) keep++;
    if (stack.length > keep) afterMath = false;
    while (stack.length > keep) s += SYMBOL[stack.pop()!];
    for (const m of MARK_ORDER) {
      if (a.marks.has(m) && !stack.includes(m)) {
        s += SYMBOL[m];
        stack.push(m);
        afterMath = false;
      }
    }
    if (isCode(a)) {
      // 이어진 코드 글자(꾸미기가 같은 것)를 한 조각으로
      let text = a.ch;
      while (isCode(atoms[i + 1]) && sameMarks(a, atoms[i + 1])) text += (atoms[++i] as { ch: string }).ch;
      s += codeSpan(text);
      afterMath = false;
    } else if ('ch' in a) {
      // 수식 바로 뒤의 숫자는 수식을 닫지 못하게 해서($x$2) 빈칸 하나를 둔다
      if (afterMath && /[0-9]/.test(a.ch)) s += ' ';
      s += escape && (a.ch === '$' || a.ch === '`') ? `\\${a.ch}` : a.ch;
      afterMath = false;
    } else {
      s += a.display ? `$$${a.math}$$` : `$${a.math}$`;
      afterMath = !a.display;
    }
  }
  while (stack.length) s += SYMBOL[stack.pop()!];
  return s;
}

type Flat = { ch: string; marks: string; at: number };

/** 비교용 꾸미기 이름 (코드 조각의 글자는 끝에 '|code') */
const markKey = (names: Iterable<RichMarkName>, code: boolean) => MARK_ORDER.filter((m) => [...names].includes(m)).join(',') + (code ? '|code' : '');

function flatAtoms(prefix: string, atoms: Atom[]): Flat[] {
  const out: Flat[] = Array.from(prefix, (ch) => ({ ch, marks: '', at: -1 }));
  atoms.forEach((a, at) => {
    const marks = markKey(a.marks, isCode(a));
    if ('ch' in a) out.push({ ch: a.ch, marks, at });
    else for (const ch of Array.from(a.math)) out.push({ ch, marks, at });
  });
  return out;
}

function flatParsed(s: string): Flat[] {
  const out: Flat[] = [];
  const walk = (ns: Inline[], names: RichMarkName[], code: boolean) => {
    for (const n of ns) {
      const marks = markKey(names, code || n.t === 'code');
      if (n.t === 'text' || n.t === 'code') for (const ch of Array.from(n.v)) out.push({ ch, marks, at: -1 });
      else if (n.t === 'math') for (const ch of Array.from(n.tex)) out.push({ ch, marks, at: -1 });
      else walk(n.c, names.includes(FROM_INLINE[n.t]) ? names : [...names, FROM_INLINE[n.t]], code);
    }
  };
  parseRich(s).forEach((l, i) => {
    if (i) out.push({ ch: '\n', marks: '', at: -1 });
    const p = l.list === 'bullet' ? '- ' : l.list === 'number' ? `${l.n}. ` : '';
    for (const ch of p) out.push({ ch, marks: '', at: -1 });
    // 코드 블록으로 읽힌 줄(글 줄이 ``` 처럼 보인 것)은 다른 꾸미기로 세어서 다시 적게 한다
    walk(l.c, [], !!l.code);
    if (l.code && !l.c.length) out.push({ ch: '', marks: '|block', at: -1 });
  });
  return out;
}

/** 처음 다른 자리와, 같은 글자인데 읽은 쪽에 빠진 꾸미기 */
function firstDiff(want: Flat[], got: Flat[]): { i: number; lost: RichMarkName[] } | null {
  const n = Math.max(want.length, got.length);
  for (let i = 0; i < n; i++) {
    const w = want[i];
    const g = got[i];
    if (!w || !g || w.ch !== g.ch) return { i, lost: [] };
    if (w.marks !== g.marks) {
      const have = new Set(g.marks.split('|')[0].split(','));
      return {
        i,
        lost: w.marks
          .split('|')[0]
          .split(',')
          .filter((m): m is RichMarkName => !!m && !have.has(m)),
      };
    }
  }
  return null;
}

/**
 * 읽은 글이 달라진 자리에서 탓할 꾸미기: 거기서 열리는 것 → 바로 앞에서 닫힌 것 → 거기 있는 것.
 * (열리지 못한 꾸미기는 기호가 글자로 남고, 너무 일찍·늦게 닫힌 꾸미기는 옆 글자까지 꾸민다)
 */
function culprit(atoms: Atom[], want: Flat[], i: number): { at: number; m: RichMarkName } | null {
  const at = i < want.length ? want[i].at : atoms.length - 1;
  if (at < 0) return null;
  const cur = atoms[at];
  const prev = atoms[at - 1];
  for (const m of MARK_ORDER) if (cur.marks.has(m) && !prev?.marks.has(m)) return { at, m };
  if (prev) for (const m of MARK_ORDER) if (prev.marks.has(m) && !cur.marks.has(m)) return { at: at - 1, m };
  for (const m of MARK_ORDER) if (cur.marks.has(m)) return { at, m };
  if (prev) for (const m of MARK_ORDER) if (prev.marks.has(m)) return { at: at - 1, m };
  return null;
}

/** 그 조각이 든 꾸민 곳에서 그 꾸미기를 뺀다 (기호로 적을 수 없는 꾸미기) */
function dropSpan(atoms: Atom[], at: number, m: RichMarkName) {
  let a = at;
  while (a > 0 && atoms[a - 1].marks.has(m)) a--;
  let b = at;
  while (b < atoms.length - 1 && atoms[b + 1].marks.has(m)) b++;
  for (let i = a; i <= b; i++) atoms[i].marks.delete(m);
}

/** 한 줄 → 글. 다시 읽어서 같을 때까지 적을 수 없는 꾸미기를 하나씩 뺀다 (글자는 하나도 잃지 않게) */
function serializeLine(atoms: Atom[], prefix = ''): string {
  trimEdges(atoms);
  let escape = false;
  let s = emit(atoms, prefix, escape);
  for (let k = 0; k < 64; k++) {
    const want = flatAtoms(prefix, atoms);
    const d = firstDiff(want, flatParsed(s));
    if (!d) return s;
    const at = d.i < want.length ? want[d.i].at : -1;
    if (d.lost.length && at >= 0) for (const m of d.lost) dropSpan(atoms, at, m);
    else {
      const c = culprit(atoms, want, d.i);
      if (c) dropSpan(atoms, c.at, c.m);
      // 글 속의 $·` 가 수식·코드로 읽히면 \$ · \` 로 적는다
      else if (!escape && atoms.some((a) => 'ch' in a && !isCode(a) && (a.ch === '$' || a.ch === '`'))) escape = true;
      else return s;
    }
    trimEdges(atoms);
    s = emit(atoms, prefix, escape);
  }
  return s;
}

function paragraphLines(p: DocNode): Atom[][] {
  return atomsOf(p.content ?? []);
}

/**
 * 문서 → 저장할 글. single: 한 줄 칸 (줄은 빈칸으로 잇는다). 앞뒤 빈 줄·빈칸은 지운다 (예전 고치기 칸의 trim 과 같게)
 */
export function docToRich(doc: DocNode, opts: { single?: boolean } = {}): string {
  const lines: string[] = [];
  for (const block of doc.content ?? []) {
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      let n = Number(block.attrs?.start ?? 1) || 1;
      for (const item of block.content ?? []) {
        const marker = block.type === 'bulletList' ? '- ' : `${n}. `;
        n++;
        const paras = (item.content ?? []).filter((c) => c.type === 'paragraph');
        const first = paras.length ? paragraphLines(paras[0]) : [[]];
        lines.push(serializeLine(first[0], marker), ...first.slice(1).map((l) => serializeLine(l)));
        for (const p of paras.slice(1)) lines.push(...paragraphLines(p).map((l) => serializeLine(l)));
        // 목록 안의 목록(붙여 넣은 것)은 줄로 편다
        for (const sub of (item.content ?? []).filter((c) => c.type !== 'paragraph')) {
          const inner = docToRich({ type: 'doc', content: [sub] });
          if (inner) lines.push(...inner.split('\n'));
        }
      }
    } else if (block.type === 'paragraph') {
      lines.push(...paragraphLines(block).map((l) => serializeLine(l)));
    } else if (block.type === 'codeBlock') {
      const body = (block.content ?? []).map((c) => c.text ?? '').join('');
      const lang = String(block.attrs?.language ?? '')
        .replace(/[`\n]/g, '')
        .trim();
      if (opts.single) lines.push(body.replace(/\n/g, ' '));
      else lines.push(...codeBlock(body.split('\n'), lang).split('\n'));
    } else if (block.content) {
      const inner = docToRich({ type: 'doc', content: block.content });
      lines.push(...inner.split('\n'));
    }
  }
  if (opts.single) {
    return lines
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return lines
    .join('\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '');
}

/** 두 문서가 같은지 (칸을 열고 아무것도 바꾸지 않았으면 저장하지 않으려고) */
export function sameDoc(a: DocNode, b: DocNode): boolean {
  return JSON.stringify(normalizeDoc(a)) === JSON.stringify(normalizeDoc(b));
}

function normalizeDoc(n: DocNode): unknown {
  const marks = (n.marks ?? []).map((m) => m.type).sort();
  return {
    t: n.type,
    ...(n.text !== undefined ? { x: n.text } : {}),
    ...(marks.length ? { m: marks } : {}),
    ...(n.attrs && Object.keys(n.attrs).length ? { a: n.attrs } : {}),
    ...(n.content?.length ? { c: n.content.map(normalizeDoc) } : {}),
  };
}

/** 문서가 비었는지 (글자도 수식도 없음. 빈 코드 블록도 비었다고 본다) */
export function docIsEmpty(doc: DocNode): boolean {
  const walk = (n: DocNode): boolean => (n.type === 'math' ? false : n.text ? !n.text.trim() : (n.content ?? []).every(walk));
  return walk(doc);
}
