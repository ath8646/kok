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
