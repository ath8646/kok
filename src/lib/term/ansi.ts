// ANSI 색 코드(SGR: \x1b[…m) 읽기: 화면(components/terminal)이 조각마다 테마 색으로 칠한다.
// 색 번호 0~7 은 검정·빨강·초록·노랑·파랑·자주·청록·흰색, 8~15 는 밝은 색. 그 밖의 제어 글(\x1b[2J 등)은 버린다
import { cells, charCells, isGridGlyph, isZeroWidth } from './text';

export type AnsiStyle = {
  fg: number | null;
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
};
export type AnsiSpan = { text: string; style: AnsiStyle };

export const PLAIN: AnsiStyle = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };

function apply(st: AnsiStyle, params: number[]): AnsiStyle {
  const s = { ...st };
  if (!params.length) params = [0];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) Object.assign(s, PLAIN);
    else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 7) s.inverse = true;
    else if (p === 22) s.bold = s.dim = false;
    else if (p === 23) s.italic = false;
    else if (p === 24) s.underline = false;
    else if (p === 27) s.inverse = false;
    else if (p >= 30 && p <= 37) s.fg = p - 30;
    else if (p >= 90 && p <= 97) s.fg = p - 90 + 8;
    else if (p === 39) s.fg = null;
    else if (p >= 40 && p <= 47) s.bg = p - 40;
    else if (p >= 100 && p <= 107) s.bg = p - 100 + 8;
    else if (p === 49) s.bg = null;
    else if (p === 38 || p === 48) {
      // 256색·트루컬러는 가장 가까운 기본 색 대신 그냥 건너뛴다 (뒤의 숫자까지)
      i += params[i + 1] === 5 ? 2 : params[i + 1] === 2 ? 4 : 0;
    }
  }
  return s;
}

/** 글 한 줄 → 같은 모양끼리 묶은 조각 */
export function parseAnsi(text: string): AnsiSpan[] {
  const out: AnsiSpan[] = [];
  let style = PLAIN;
  let buf = '';
  /** 이 줄에서 지금까지 쓴 칸 (탭은 8칸마다 멈춘다) */
  let col = 0;
  const flush = () => {
    if (!buf) return;
    const last = out[out.length - 1];
    if (last && same(last.style, style)) last.text += buf;
    else out.push({ text: buf, style });
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\x1b') {
      // CSI: ESC [ 숫자;숫자 … 끝 글자
      if (text[i + 1] === '[') {
        let j = i + 2;
        while (j < text.length && /[0-9;?]/.test(text[j])) j++;
        const final = text[j];
        if (final === 'm') {
          flush();
          const params = text
            .slice(i + 2, j)
            .split(';')
            .filter((x) => x !== '')
            .map(Number)
            .filter((n) => Number.isFinite(n));
          style = apply(style, params);
        }
        i = final === undefined ? j - 1 : j;
        continue;
      }
      continue;
    }
    // 탭은 다음 8칸 자리까지 빈칸, 그 밖의 제어 글은 버린다
    if (ch === '\t') {
      const n = 8 - (col % 8);
      buf += ' '.repeat(n);
      col += n;
      continue;
    }
    if (ch < ' ' || ch === '\x7f') continue;
    buf += ch;
    col += cells(ch);
  }
  flush();
  return out;
}

function same(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.underline === b.underline && a.inverse === b.inverse
  );
}

/** 칸 맞추기 조각: cells 0 은 글꼴이 칸에 맞게 그리는 글(그대로), 1·2 는 그 칸 수의 상자에 가운데로 넣을 기호 하나 */
export type GridPart = { text: string; cells: 0 | 1 | 2 };

export function gridParts(text: string): GridPart[] {
  const out: GridPart[] = [];
  let run = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isGridGlyph(cp)) {
      run += ch;
      continue;
    }
    if (isZeroWidth(cp)) {
      // 앞 글자에 붙인다 (앞이 상자면 그 상자 안에)
      const last = out[out.length - 1];
      if (!run && last && last.cells) last.text += ch;
      else run += ch;
      continue;
    }
    if (run) out.push({ text: run, cells: 0 });
    run = '';
    out.push({ text: ch, cells: charCells(cp) === 2 ? 2 : 1 });
  }
  if (run) out.push({ text: run, cells: 0 });
  return out;
}
