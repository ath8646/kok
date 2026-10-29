// 터미널 글 도우미: ANSI 색 코드, 글자 칸 너비(한글은 두 칸), 열 맞추기. 화면과 상관없는 순수 함수 (시험 term.test.ts)

/** ANSI 색 (SGR). 화면(components/terminal/Ansi.tsx)이 테마 색으로 바꿔 그린다 */
export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  boldGreen: '\x1b[1;32m',
  boldBlue: '\x1b[1;34m',
  boldCyan: '\x1b[1;36m',
  boldRed: '\x1b[1;31m',
  boldYellow: '\x1b[1;33m',
} as const;

export function paint(code: string, s: string): string {
  return `${code}${s}${C.reset}`;
}

/** ANSI 코드를 뺀 글 */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 터미널 글꼴(나눔고딕코딩)이 칸에 딱 맞게 그리는 글자: 아스키, 한글, 한자, 전각 글자.
 * 그 밖의 기호(·…★─→ 등)는 글꼴마다 너비가 제각각이라 화면이 칸 너비의 상자에 넣어 그린다 (charCells 칸)
 */
export function isGridGlyph(cp: number): boolean {
  return (
    (cp >= 0x20 && cp < 0x7f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff01 && cp <= 0xff60)
  );
}

/** 앞 글자에 붙는 글자 (위에 붙는 표시 x̄·F⃗, 이모지 꾸밈, 폭 없는 빈칸): 0칸 */
export function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0x200b && cp <= 0x200d) ||
    cp === 0x2060
  );
}

/** 글자 하나가 차지하는 칸 (한글·한자·전각 기호·이모지와 …—①은 두 칸, 붙는 글자는 0칸) */
export function charCells(cp: number): number {
  if (cp >= 0x20 && cp < 0x7f) return 1;
  if (cp === 0 || isZeroWidth(cp)) return 0;
  if (cp < 0x1100) return 1;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2014 ||
    cp === 0x2015 ||
    cp === 0x2026 ||
    cp === 0x203b ||
    (cp >= 0x2460 && cp <= 0x24ff) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** 화면에서 차지하는 칸 수 (ANSI 코드는 0칸) */
export function cells(s: string): number {
  let n = 0;
  for (const ch of stripAnsi(s)) n += charCells(ch.codePointAt(0) ?? 0);
  return n;
}

/** 오른쪽을 빈칸으로 채워 width 칸으로 (넘치면 그대로) */
export function padEnd(s: string, width: number): string {
  const n = cells(s);
  return n >= width ? s : s + ' '.repeat(width - n);
}

export function padStart(s: string, width: number): string {
  const n = cells(s);
  return n >= width ? s : ' '.repeat(width - n) + s;
}

/** width 칸을 넘으면 잘라 '…'(두 칸)을 붙인다 (ANSI 코드가 없는 글만) */
export function clip(s: string, width: number): string {
  if (cells(s) <= width) return s;
  let out = '';
  let n = 0;
  for (const ch of s) {
    const w = charCells(ch.codePointAt(0) ?? 0);
    if (n + w > width - 2) break;
    out += ch;
    n += w;
  }
  return `${out}…`;
}

/**
 * ls 처럼 이름을 여러 열로 (위에서 아래로 먼저 채운다). names 는 색을 칠한 글이어도 된다.
 * 한 줄에 들어가지 않으면 한 줄에 하나씩
 */
export function columns(names: string[], width: number, gap = 2): string {
  if (!names.length) return '';
  const w = names.map(cells);
  const total = w.reduce((a, b) => a + b + gap, 0) - gap;
  if (total <= width) return names.join(' '.repeat(gap));
  for (let cols = Math.min(names.length, Math.floor(width / 2)); cols > 1; cols--) {
    const rows = Math.ceil(names.length / cols);
    const colW: number[] = [];
    for (let c = 0; c < cols; c++) {
      let m = 0;
      for (let r = 0; r < rows; r++) {
        const i = c * rows + r;
        if (i < names.length) m = Math.max(m, w[i]);
      }
      colW.push(m);
    }
    if (colW.reduce((a, b) => a + b, 0) + gap * (cols - 1) > width) continue;
    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const i = c * rows + r;
        if (i >= names.length) continue;
        const last = c === cols - 1 || (c + 1) * rows + r >= names.length;
        line += last ? names[i] : padEnd(names[i], colW[c] + gap);
      }
      lines.push(line);
    }
    return lines.join('\n');
  }
  return names.join('\n');
}

/** 표: 열마다 가장 넓은 칸에 맞춘다 (aligns: 'r' 은 오른쪽 맞춤). 마지막 열은 채우지 않는다 */
export function table(rows: string[][], aligns: Array<'l' | 'r'> = [], gap = 2): string {
  if (!rows.length) return '';
  const n = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: n }, (_, c) => Math.max(0, ...rows.map((r) => cells(r[c] ?? ''))));
  return rows
    .map((r) =>
      r
        .map((v, c) => {
          const last = c === r.length - 1;
          if (aligns[c] === 'r') return padStart(v, widths[c]) + (last ? '' : ' '.repeat(gap));
          return last ? v : padEnd(v, widths[c] + gap);
        })
        .join('')
        .replace(/\s+$/, ''),
    )
    .join('\n');
}

/** 사람이 읽기 쉬운 크기 (ls -h, du -h) */
export function human(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const units = ['K', 'M', 'G'];
  let v = bytes;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}${units[u]}`;
}

/** 글의 UTF-8 바이트 수 (파일 크기) */
export function byteLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}
