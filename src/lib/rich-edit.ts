// 고치기 칸의 꾸미기 버튼: 고른 글을 쉬운 기호로 감싸거나 풀고, 줄 앞에 목록 표시를 붙이거나 뗀다.
// 바꿀 곳(start~end)과 넣을 글, 바꾼 뒤 고를 곳을 돌려준다 (화면은 브라우저의 되돌리기가 되게 그 부분만 바꾼다).

export type RichEdit = { start: number; end: number; text: string; selStart: number; selEnd: number };

/** 고른 글을 mark 로 감싼다. 이미 감싸져 있으면 푼다. 고른 글이 없으면 placeholder 를 넣고 고른다 */
export function toggleWrap(value: string, s: number, e: number, mark: string, placeholder: string): RichEdit {
  const sel = value.slice(s, e);
  const n = mark.length;
  // 고른 글 바깥이 이미 감싸져 있으면 푼다 (**|굵게|**)
  if (s >= n && value.slice(s - n, s) === mark && value.slice(e, e + n) === mark) {
    return { start: s - n, end: e + n, text: sel, selStart: s - n, selEnd: e - n };
  }
  // 고른 글 자체가 감싸져 있으면 푼다 (|**굵게**|)
  if (sel.length > n * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(n, sel.length - n);
    return { start: s, end: e, text: inner, selStart: s, selEnd: s + inner.length };
  }
  // 앞뒤 빈칸은 표시 밖으로 (기호 바로 안쪽에 빈칸이 있으면 꾸며지지 않는다). 여러 줄이면 줄마다 따로
  if (sel.includes('\n')) {
    const lines = sel.split('\n').map((l) => {
      const core = l.trim();
      if (!core) return l;
      const lead = l.match(/^\s*/)![0];
      const list = core.match(/^(?:[-•]|\d{1,3}[.)])\s+/)?.[0] ?? '';
      const body = core.slice(list.length);
      return body ? `${lead}${list}${mark}${body}${mark}` : l;
    });
    const text = lines.join('\n');
    return { start: s, end: e, text, selStart: s, selEnd: s + text.length };
  }
  const lead = sel.match(/^\s*/)![0];
  const core = sel.trim();
  const trail = core ? sel.slice(lead.length + core.length) : '';
  const body = core || placeholder;
  const text = `${lead}${mark}${body}${mark}${trail}`;
  const at = s + lead.length + n;
  return { start: s, end: e, text, selStart: at, selEnd: at + body.length };
}

const LIST_RE = /^(\s*)(?:[-•]|\d{1,3}[.)])\s+/;

/** 고른 줄들을 목록으로 (모두 이미 그 목록이면 푼다). 빈 줄은 그대로 */
export function toggleList(value: string, s: number, e: number, kind: 'bullet' | 'number'): RichEdit {
  const lineStart = value.lastIndexOf('\n', Math.max(0, s - 1)) + (s > 0 ? 1 : 0);
  const from = s > 0 ? lineStart : 0;
  // 고른 끝이 줄 맨 앞이면 그 줄은 빼고
  const endAt = e > s && value[e - 1] === '\n' ? e - 1 : e;
  let lineEnd = value.indexOf('\n', endAt);
  if (lineEnd === -1) lineEnd = value.length;
  const lines = value.slice(from, lineEnd).split('\n');
  const same = kind === 'bullet' ? /^\s*[-•]\s+/ : /^\s*\d{1,3}[.)]\s+/;
  const filled = lines.filter((l) => l.trim());
  const undo = filled.length > 0 && filled.every((l) => same.test(l));
  let k = 0;
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
