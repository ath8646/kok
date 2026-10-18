// 고치기 칸의 꾸미기 버튼: 고른 글을 쉬운 기호로 감싸거나 풀고, 줄 앞에 목록 표시를 붙이거나 뗀다.
// 바꿀 곳(start~end)과 넣을 글, 바꾼 뒤 고를 곳을 돌려준다 (화면은 브라우저의 되돌리기가 되게 그 부분만 바꾼다).
import { markAt, markSpans } from './richtext';

export type RichEdit = { start: number; end: number; text: string; selStart: number; selEnd: number };

/** 줄 앞의 들여쓰기와 목록 표시 ('- ', '• ', '1. ', '2) ') */
const LIST_PREFIX = /^\s*(?:(?:[-•]|\d{1,3}[.)])\s+)?/;
const LIST_RE = /^(\s*)(?:[-•]|\d{1,3}[.)])\s+/;

function lineStartOf(value: string, at: number): number {
  return at > 0 ? value.lastIndexOf('\n', at - 1) + 1 : 0;
}

function lineEndOf(value: string, at: number): number {
  const i = value.indexOf('\n', at);
  return i === -1 ? value.length : i;
}

/** 글 전체가 mark 로 감싼 꾸미기 하나인지 (**굵게**) */
function wholeSpan(text: string, mark: string): boolean {
  const hit = markAt(text, 0);
  return !!hit && hit.mark === mark && hit.close === text.length - mark.length;
}

/** 글 안에 있는 같은 꾸미기를 모두 푼다 (고른 곳 전체를 감쌀 때 안쪽 기호가 겹치지 않게) */
function unwrapAll(text: string, mark: string): string {
  let out = text;
  for (let round = 0; round < 20; round++) {
    const sp = markSpans(out).find((x) => x.mark === mark);
    if (!sp) break;
    out = out.slice(0, sp.open) + out.slice(sp.open + mark.length, sp.close) + out.slice(sp.close + mark.length);
  }
  return out;
}

/**
 * 고른 글을 mark 로 감싼다(**굵게**). 고른 곳이 이미 그 꾸미기 안이면(커서만 있어도) 그 꾸미기를 푼다.
 * 고른 글이 없으면 placeholder 를 넣고 고른다. 화면(markAt)과 같은 규칙이라 버튼으로 붙인 기호는 늘 보인다:
 * 앞뒤 빈칸·목록 표시는 기호 밖으로, 영어·숫자 단어 가운데를 고르면 그 단어 전체를 감싼다. 여러 줄이면 줄마다
 */
export function toggleWrap(value: string, s: number, e: number, mark: string, placeholder: string): RichEdit {
  const n = mark.length;
  const sel = value.slice(s, e);
  if (sel.includes('\n')) {
    const ls = lineStartOf(value, s);
    const segs = sel.split('\n').map((part, i) => {
      // 줄 맨 앞부터인 조각만 목록 표시를 떼어 둔다
      const pre0 = (i > 0 || s === ls ? part.match(LIST_PREFIX) : part.match(/^\s*/))![0];
      const rest = part.slice(pre0.length);
      const body = rest.trim();
      const lead = rest.match(/^\s*/)![0];
      return { pre: pre0 + lead, body, post: rest.slice(lead.length + body.length) };
    });
    const filled = segs.filter((g) => g.body);
    const undo = filled.length > 0 && filled.every((g) => wholeSpan(g.body, mark));
    const text = segs
      .map((g) => {
        if (!g.body) return g.pre + g.post;
        if (undo) return g.pre + g.body.slice(n, g.body.length - n) + g.post;
        if (wholeSpan(g.body, mark)) return g.pre + g.body + g.post;
        return g.pre + mark + unwrapAll(g.body, mark) + mark + g.post;
      })
      .join('\n');
    return { start: s, end: e, text, selStart: s, selEnd: s + text.length };
  }

  const ls = lineStartOf(value, s);
  const line = value.slice(ls, lineEndOf(value, e));
  let a = s - ls;
  let b = e - ls;
  // 목록 표시 안이나 줄 맨 앞부터 고르면 표시 뒤부터
  const prefix = line.match(LIST_PREFIX)![0].length;
  if (a < prefix) {
    a = prefix;
    b = Math.max(b, prefix);
  }
  // 앞뒤 빈칸은 기호 밖으로 (기호 바로 안쪽에 빈칸이 있으면 꾸며지지 않는다)
  while (a < b && /\s/.test(line[a])) a++;
  while (b > a && /\s/.test(line[b - 1])) b--;

  // 고른 곳(커서)을 감싼 같은 꾸미기, 또는 고른 곳이 바로 그 꾸미기면 푼다 (가장 안쪽 것)
  const hits = markSpans(line).filter((sp) => sp.mark === mark && ((sp.open + n <= a && b <= sp.close) || (sp.open === a && sp.close + n === b)));
  const hit = hits.sort((x, y) => x.close - x.open - (y.close - y.open))[0];
  if (hit) {
    const inner = line.slice(hit.open + n, hit.close);
    const exact = hit.open === a && hit.close + n === b;
    return {
      start: ls + hit.open,
      end: ls + hit.close + n,
      text: inner,
      selStart: exact ? ls + hit.open : ls + a - n,
      selEnd: exact ? ls + hit.open + inner.length : ls + b - n,
    };
  }

  if (a === b) {
    const at = ls + a;
    return { start: at, end: at, text: `${mark}${placeholder}${mark}`, selStart: at + n, selEnd: at + n + placeholder.length };
  }
  // 영어·숫자 단어 가운데의 영어·숫자만 고르면 그 단어 전체를 (x**y** 는 꾸며지지 않아서)
  if (a > 0 && /[A-Za-z0-9]/.test(line[a - 1]) && !/[^\x00-\x7f]/.test(line.slice(a, b))) {
    while (a > 0 && /[A-Za-z0-9_]/.test(line[a - 1])) a--;
    while (b < line.length && /[A-Za-z0-9_]/.test(line[b])) b++;
  }
  const inner = unwrapAll(line.slice(a, b), mark);
  return { start: ls + a, end: ls + b, text: `${mark}${inner}${mark}`, selStart: ls + a + n, selEnd: ls + a + n + inner.length };
}

/** 고른 줄들을 목록으로 (모두 이미 그 목록이면 푼다). 빈 줄은 그대로, 빈 칸·빈 줄에서 누르면 표시를 넣는다 */
export function toggleList(value: string, s: number, e: number, kind: 'bullet' | 'number'): RichEdit {
  const from = lineStartOf(value, s);
  // 고른 끝이 줄 맨 앞이면 그 줄은 빼고
  const endAt = e > s && value[e - 1] === '\n' ? e - 1 : e;
  const lineEnd = lineEndOf(value, endAt);
  const lines = value.slice(from, lineEnd).split('\n');
  const same = kind === 'bullet' ? /^\s*[-•]\s+/ : /^\s*\d{1,3}[.)]\s+/;
  // 번호는 바로 윗줄 번호에 이어서
  const prev = from > 0 ? value.slice(lineStartOf(value, from - 1), from - 1).match(/^\s*(\d{1,3})[.)]\s+/) : null;
  const first = kind === 'number' && prev ? Number(prev[1]) + 1 : 1;
  const filled = lines.filter((l) => l.trim());
  if (!filled.length) {
    const ins = `${lines[0]}${kind === 'bullet' ? '- ' : `${first}. `}`;
    const text = [ins, ...lines.slice(1)].join('\n');
    const at = from + ins.length;
    return { start: from, end: lineEnd, text, selStart: at, selEnd: at };
  }
  const undo = filled.every((l) => same.test(l));
  let k = first - 1;
  const text = lines
    .map((l) => {
      if (!l.trim()) return l;
      const bare = l.replace(LIST_RE, '$1');
      if (undo) return bare;
      k++;
      const indent = bare.match(/^\s*/)![0];
      return `${indent}${kind === 'bullet' ? '- ' : `${k}. `}${bare.slice(indent.length)}`;
    })
    .join('\n');
  return { start: from, end: lineEnd, text, selStart: from, selEnd: from + text.length };
}

/** 고른 곳에 글을 넣고, 넣은 글 안의 □ 자리(있으면)를 고른다 (공식 도우미) */
export function insertSnippet(value: string, s: number, e: number, snippet: string): RichEdit {
  const sel = value.slice(s, e);
  // □ 가 있으면 첫 □ 에 고른 글을 넣는다 (예: \frac{□}{□} 에 고른 글)
  const first = snippet.indexOf('□');
  const text = first >= 0 && sel ? snippet.replace('□', sel) : snippet;
  const hole = text.indexOf('□');
  const at = hole >= 0 ? s + hole : s + text.length;
  return { start: s, end: e, text, selStart: at, selEnd: hole >= 0 ? at + 1 : at };
}

/**
 * 목록 줄에서 엔터: 다음 줄에 같은 표시(번호는 하나 큰 수)를 붙인다. 빈 목록 줄이면 표시를 떼어 목록을 끝낸다.
 * 목록 줄이 아니거나 표시 안에 커서가 있으면 null (보통 엔터)
 */
export function continueList(value: string, at: number): RichEdit | null {
  const lineStart = value.lastIndexOf('\n', at - 1) + 1;
  let lineEnd = value.indexOf('\n', at);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  const m = line.match(/^(\s*)(?:([-•])|(\d{1,3})([.)]))\s+/);
  if (!m || at < lineStart + m[0].length) return null;
  const indent = m[1];
  if (!line.slice(m[0].length).trim()) {
    const end = lineStart + indent.length;
    return { start: lineStart, end: lineStart + m[0].length, text: indent, selStart: end, selEnd: end };
  }
  const mark = m[2] ? `${m[2]} ` : `${Number(m[3]) + 1}${m[4]} `;
  const text = `\n${indent}${mark}`;
  return { start: at, end: at, text, selStart: at + text.length, selEnd: at + text.length };
}
