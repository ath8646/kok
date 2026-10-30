// PDF 요약 정리: 정리 노트를 손글씨 필기 느낌의 PDF 로 그린다 (AI 없음).
// 어두운 모눈종이 위에 제목·구역 알약·개념 띠·정의 상자·주의·예시·공식·마인드맵·자료 그림·확인해 볼 것.
// 글꼴: 본문 고운돋움(Gowun Dodum)·제목 주아(Jua), OFL (src/lib/server/pdf-fonts, 한글 11172자·2350자 부분 글꼴.
// 글리프 길이를 2바이트로 맞춘 글꼴만 쓴다: pdf-lib 의 부분 글꼴 만들기가 홀수 길이를 깨뜨린다).
// 두 글꼴에 없는 수식 글자는 DejaVu Sans 에서 뽑은 글꼴로: 그리스 문자는 ExtraLight(본문 획 굵기와 비슷), 위아래 첨자·⇌ 같은 기호는 Book
// (tools/pdf-fonts/math-font.py). 수식은 texToText 로 한 줄 글로 바꾸고, 제목·용어·이름처럼 꾸미기 없이 그리는 글은 plainMathText 로
import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit, { type Font as KitFont } from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import type { Mindmap, Note } from '@/lib/ai/schemas';
import type { PdfTheme } from '@/lib/note-pdf';
import { parseRich, plainMathText, type Inline } from '@/lib/richtext';
import { texToText } from '@/lib/tex-text';

export type PdfFigure = { title: string; caption: string; bytes: Uint8Array; w: number; h: number };
export type NotePdfInput = {
  title: string;
  subject: string;
  unit: string;
  note: Note;
  mindmap: Mindmap | null;
  figures: PdfFigure[];
  theme: PdfTheme;
  date: Date;
  /** AI 가 만든 정리인지 (직접 쓴 빈 노트가 아니면): 인공지능기본법의 생성형 AI 결과물 표시 — 쪽마다 'AI 정리'와 파일 정보(Subject·Keywords) */
  aiMade: boolean;
  /** 설정 note.importance: AI 가 정한 중요도(★★★)를 개념 띠에 (끄면 내가 별표한 개념에만 ★) */
  showImportance?: boolean;
};

// ------------------------------------------------------------- 크기·색
const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = { top: 50, bottom: 48, x: 42 };
const CONTENT_W = PAGE.w - MARGIN.x * 2;
const GRID = 14.17;
const BODY = 10.5;
const LINE = 15.5;

type Palette = {
  bg: RGB;
  grid: RGB;
  gridAlpha: number;
  text: RGB;
  muted: RGB;
  lavender: RGB;
  lavenderInk: RGB;
  barAlpha: number;
  pink: RGB;
  teal: RGB;
  yellow: RGB;
  blue: RGB;
  line: RGB;
  lineAlpha: number;
  mark: RGB;
  branches: RGB[];
};

const hex = (s: string): RGB => rgb(parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255);

const PALETTES: Record<PdfTheme, Palette> = {
  dark: {
    bg: hex('#14161e'),
    grid: hex('#ffffff'),
    gridAlpha: 0.07,
    text: hex('#eef0f6'),
    muted: hex('#a9afbf'),
    lavender: hex('#b9abf7'),
    lavenderInk: hex('#1b1537'),
    barAlpha: 0.22,
    pink: hex('#ff8fb1'),
    teal: hex('#6ee7c8'),
    yellow: hex('#ffd977'),
    blue: hex('#8fc1ff'),
    line: hex('#ffffff'),
    lineAlpha: 0.7,
    mark: hex('#ffd60a'),
    branches: ['#8fc1ff', '#ffc27a', '#7fe0a4', '#b9abf7', '#ff8fb1', '#d7a2ff', '#7fdcea', '#d9c3a3'].map(hex),
  },
  light: {
    bg: hex('#faf8f2'),
    grid: hex('#8d8878'),
    gridAlpha: 0.16,
    text: hex('#1c1c1e'),
    muted: hex('#6b6b70'),
    lavender: hex('#6d5fe8'),
    lavenderInk: hex('#ffffff'),
    barAlpha: 0.14,
    pink: hex('#d6376c'),
    teal: hex('#0d8f6f'),
    yellow: hex('#9c5901'),
    blue: hex('#2c62c9'),
    line: hex('#1c1c1e'),
    lineAlpha: 0.55,
    mark: hex('#ffe766'),
    branches: ['#0361cd', '#985700', '#03772b', '#5856d6', '#c50539', '#9536c2', '#067182', '#7f623d'].map(hex),
  },
};

// ------------------------------------------------------------- 글꼴
/** 본문·제목 글꼴, 그다음 차례로 찾는 수식 글꼴들 */
const FONT_FILES = ['GowunDodum-Regular.sub.woff2', 'Jua-Regular.sub.woff2', 'DejaVuSans-Greek.sub.woff2', 'DejaVuSans-Math.sub.woff2'];
let fontCache: Promise<Uint8Array[]> | null = null;
function loadFonts() {
  fontCache ??= (async () => {
    const dir = path.join(process.cwd(), 'src', 'lib', 'server', 'pdf-fonts');
    return (await Promise.all(FONT_FILES.map((f) => readFile(path.join(dir, f))))).map((b) => new Uint8Array(b));
  })();
  return fontCache;
}
/** 글자 모양 재기용 (위에 붙는 표시 자리): 필요할 때만 읽는다 */
const kitCache: KitFont[] = [];

type Run = { text: string; b?: boolean; mark?: boolean; red?: boolean };

/** 꾸민 글 → 줄마다 조각 (목록 표시는 글머리로, 수식은 읽을 수 있는 글자로) */
function richLines(input: string): Run[][] {
  const walk = (ns: Inline[], style: Omit<Run, 'text'>, out: Run[]) => {
    for (const n of ns) {
      if (n.t === 'text') out.push({ ...style, text: n.v });
      else if (n.t === 'math') out.push({ ...style, text: texToText(n.tex) });
      else walk(n.c, { ...style, [n.t === 'b' ? 'b' : n.t === 'mark' ? 'mark' : 'red']: true }, out);
    }
  };
  return parseRich(input ?? '').map((l) => {
    const out: Run[] = [];
    if (l.list === 'bullet') out.push({ text: '• ' });
    else if (l.list === 'number') out.push({ text: `${l.n}. ` });
    walk(l.c, {}, out);
    return out;
  });
}

const plain = (s: string): Run[][] => [[{ text: s }]];

// ------------------------------------------------------------- 그리기
class Sheet {
  pages: PDFPage[] = [];
  page!: PDFPage;
  /** 위에서부터 잰 지금 자리 */
  y = MARGIN.top;
  private chars: { body: Set<number>; head: Set<number> };
  /** 본문 글꼴에 없는 글자를 차례로 찾는 글꼴 (그리스 문자 → 수식 기호) */
  private extra: Array<{ font: PDFFont; chars: Set<number> }>;

  constructor(
    readonly doc: PDFDocument,
    readonly p: Palette,
    readonly body: PDFFont,
    readonly head: PDFFont,
    extra: PDFFont[],
    /** 글자 모양 (위에 붙는 표시를 앞 글자 위에 놓을 때) */
    private kit: (font: PDFFont) => KitFont | null,
  ) {
    this.chars = { body: new Set(body.getCharacterSet()), head: new Set(head.getCharacterSet()) };
    this.extra = extra.map((font) => ({ font, chars: new Set(font.getCharacterSet()) }));
    this.newPage();
  }

  /** 어느 글꼴에도 없는 글자는 □ 로 (pdf-lib 가 멈추지 않게) */
  clean(s: string, font: 'body' | 'head' = 'body'): string {
    const set = this.chars[font];
    let out = '';
    for (const ch of s.replace(/\r/g, '')) {
      const cp = ch.codePointAt(0) ?? 0;
      if (ch === '\n' || ch === '\t') out += ' ';
      else if (set.has(cp)) out += ch;
      else if (cp >= 0xe000 && cp <= 0xf8ff) continue;
      else out += this.chars.body.has(cp) || this.extra.some((f) => f.chars.has(cp)) ? ch : '□';
    }
    return out;
  }

  /** 글을 글꼴이 같은 조각으로: 고른 글꼴 → 본문 글꼴 → 수식 글꼴들. 위에 붙는 표시(x̄ 의 막대)는 따로 */
  pieces(text: string, prefer: PDFFont = this.body): Array<{ text: string; font: PDFFont; mark: boolean }> {
    const out: Array<{ text: string; font: PDFFont; mark: boolean }> = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      const head = prefer === this.head && this.chars.head.has(cp);
      const font = head ? this.head : this.chars.body.has(cp) ? this.body : (this.extra.find((f) => f.chars.has(cp))?.font ?? this.body);
      const mark = /\p{Mn}/u.test(ch);
      const last = out[out.length - 1];
      if (!mark && last && !last.mark && last.font === font) last.text += ch;
      else out.push({ text: ch, font, mark });
    }
    return out;
  }

  /** 한 줄을 그린다 (글꼴에 없는 글자는 다른 글꼴로, 위에 붙는 표시는 앞 글자 가운데 위로). 그린 너비를 돌려준다 */
  draw(text: string, x: number, baseline: number, size: number, color: RGB, o: { font?: PDFFont; page?: PDFPage; bold?: boolean } = {}): number {
    const page = o.page ?? this.page;
    const put = (t: string, font: PDFFont, px: number, py: number) => {
      page.drawText(t, { x: px, y: py, size, font, color });
      if (o.bold) page.drawText(t, { x: px + 0.35, y: py, size, font, color });
    };
    let cx = x;
    let base: { x: number; w: number; ch: string; font: PDFFont } | null = null;
    for (const pt of this.pieces(text, o.font)) {
      if (!pt.mark) {
        put(pt.text, pt.font, cx, baseline);
        cx += pt.font.widthOfTextAtSize(pt.text, size);
        const ch = Array.from(pt.text).pop() ?? '';
        const w = pt.font.widthOfTextAtSize(ch, size);
        base = { x: cx - w, w, ch, font: pt.font };
        continue;
      }
      const mk = this.kit(pt.font);
      const bk = base && this.kit(base.font);
      if (!base || !mk || !bk) continue;
      const m = mk.glyphForCodePoint(pt.text.codePointAt(0) ?? 0).bbox;
      const top = (bk.glyphForCodePoint(base.ch.codePointAt(0) ?? 0).bbox.maxY * size) / bk.unitsPerEm;
      const k = size / mk.unitsPerEm;
      put(pt.text, pt.font, base.x + base.w / 2 - ((m.minX + m.maxX) / 2) * k, baseline + Math.max(0, top + size * 0.08 - m.minY * k));
    }
    return cx - x;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: this.p.bg });
    // 모눈: 가로·세로 줄
    for (let x = GRID; x < PAGE.w; x += GRID)
      this.page.drawLine({ start: { x, y: 0 }, end: { x, y: PAGE.h }, thickness: 0.5, color: this.p.grid, opacity: this.p.gridAlpha });
    for (let y = GRID; y < PAGE.h; y += GRID)
      this.page.drawLine({ start: { x: 0, y }, end: { x: PAGE.w, y }, thickness: 0.5, color: this.p.grid, opacity: this.p.gridAlpha });
    this.y = MARGIN.top;
  }

  /** 아래에 h 만큼 자리가 없으면 새 쪽 */
  need(h: number) {
    if (this.y + h > PAGE.h - MARGIN.bottom) this.newPage();
  }
  get bottomRoom(): number {
    return PAGE.h - MARGIN.bottom - this.y;
  }
  /** PDF 좌표 (아래가 0) */
  py(yTop: number, h = 0): number {
    return PAGE.h - yTop - h;
  }
  gap(h: number) {
    this.y += h;
  }

  width(text: string, size: number, font: PDFFont = this.body): number {
    return this.pieces(text, font).reduce((a, pt) => a + (pt.mark ? 0 : pt.font.widthOfTextAtSize(pt.text, size)), 0);
  }

  /**
   * 글을 너비에 맞게 줄로 나눈다: 빈칸에서 끊고, 한 낱말이 너무 길면 글자에서 끊는다. 줄마다 [시작, 끝) 글자 위치.
   * 줄을 끊은 빈칸은 어느 줄에도 들어가지 않는다
   */
  wrapRanges(text: string, size: number, width: number, font: PDFFont = this.body): Array<[number, number]> {
    const chars = Array.from(text);
    const out: Array<[number, number]> = [];
    let start = 0;
    let lastSpace = -1;
    let i = 0;
    const measure = (a: number, b: number) => this.width(chars.slice(a, b).join(''), size, font);
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === '\n') {
        out.push([start, i]);
        start = i + 1;
        lastSpace = -1;
        i++;
        continue;
      }
      if (ch === ' ') lastSpace = i;
      if (i > start && measure(start, i + 1) > width) {
        if (lastSpace > start) {
          out.push([start, lastSpace]);
          start = lastSpace + 1;
          i = start;
        } else {
          out.push([start, i]);
          start = i;
        }
        lastSpace = -1;
        continue;
      }
      i++;
    }
    out.push([start, chars.length]);
    return out;
  }

  wrap(text: string, size: number, width: number, font: PDFFont = this.body): string[] {
    const chars = Array.from(text);
    return this.wrapRanges(text, size, width, font).map(([a, b]) => chars.slice(a, b).join(''));
  }

  /** 제목 글꼴로 한 줄 (제목 글꼴에 없는 글자는 본문·수식 글꼴로) */
  drawHead(text: string, x: number, yTop: number, size: number, color: RGB, align: 'left' | 'center' = 'left', maxWidth?: number) {
    const total = this.headWidth(text, size);
    const cx = align === 'center' ? x + ((maxWidth ?? 0) - total) / 2 : x;
    this.draw(text, cx, this.py(yTop + size * 0.86), size, color, { font: this.head });
    return total;
  }
  headWidth(text: string, size: number): number {
    return this.width(text, size, this.head);
  }

  /**
   * 꾸민 글(굵게·형광펜·빨간 글씨)을 너비 안에 그린다. 굵게는 살짝 겹쳐 두 번, 형광펜은 노란 칸, 빨간 글씨는 분홍.
   * 그린 높이를 돌려준다. 쪽이 모자라면 줄 단위로 넘어간다
   */
  rich(lines: Run[][], x: number, width: number, o: { size?: number; line?: number; color?: RGB; indent?: number } = {}): number {
    const size = o.size ?? BODY;
    const lh = o.line ?? LINE;
    const color = o.color ?? this.p.text;
    let drawn = 0;
    for (const runs of lines) {
      const cleaned = runs.map((r) => ({ ...r, chars: Array.from(this.clean(r.text)) }));
      const full = cleaned.map((r) => r.chars.join('')).join('');
      const ranges = this.wrapRanges(full, size, width);
      ranges.forEach(([start, end], li) => {
        this.need(lh);
        let cx = x + (li > 0 ? (o.indent ?? 0) : 0);
        let at = 0;
        for (const r of cleaned) {
          const rs = at;
          const re = at + r.chars.length;
          at = re;
          const a = Math.max(rs, start);
          const b = Math.min(re, end);
          if (b <= a) continue;
          const piece = r.chars.slice(a - rs, b - rs).join('');
          const w = this.width(piece, size);
          const baseline = this.py(this.y + size * 0.86);
          if (r.mark)
            this.page.drawRectangle({
              x: cx - 1,
              y: baseline - size * 0.22,
              width: w + 2,
              height: size * 1.1,
              color: this.p.mark,
              opacity: this.p === PALETTES.dark ? 0.28 : 0.55,
            });
          this.draw(piece, cx, baseline, size, r.red ? this.p.pink : color, { bold: r.b });
          cx += w;
        }
        this.y += lh;
        drawn += lh;
      });
    }
    return drawn;
  }

  text(s: string, x: number, width: number, o: Parameters<Sheet['rich']>[3] = {}): number {
    return this.rich(plain(s), x, width, o);
  }

  /** 둥근 네모 (SVG 경로: 원점은 왼쪽 위, y 는 아래로) */
  roundRect(
    x: number,
    yTop: number,
    w: number,
    h: number,
    r: number,
    o: { fill?: RGB; stroke?: RGB; strokeWidth?: number; opacity?: number; strokeOpacity?: number },
  ) {
    const rr = Math.min(r, w / 2, h / 2);
    const d = `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`;
    this.page.drawSvgPath(d, {
      x,
      y: this.py(yTop),
      color: o.fill,
      opacity: o.opacity ?? 1,
      borderColor: o.stroke,
      borderWidth: o.stroke ? (o.strokeWidth ?? 0.8) : 0,
      borderOpacity: o.strokeOpacity ?? 1,
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB, thickness = 0.8, opacity = 1) {
    this.page.drawLine({ start: { x: x1, y: this.py(y1) }, end: { x: x2, y: this.py(y2) }, thickness, color, opacity });
  }

  // ----------------------------------------------------------- 조각들
  /** 쪽 맨 위 제목: 가운데, 아래 밑줄 (샘플 필기의 장 제목처럼). 오른쪽 위에 작은 글 (KOK · 과목 · 날짜) */
  title(text: string, meta: string) {
    const size = 24;
    const m = this.clean(plainMathText(meta));
    const mw = this.width(m, 8.5);
    this.draw(m, MARGIN.x + CONTENT_W - mw, this.py(MARGIN.top - 24 + 8.5 * 0.86), 8.5, this.p.muted);
    const lines = this.wrap(this.clean(plainMathText(text), 'head'), size, CONTENT_W, this.head);
    for (const l of lines) {
      this.drawHead(l, MARGIN.x, this.y, size, this.p.text, 'center', CONTENT_W);
      this.y += size * 1.3;
    }
    const w = Math.min(CONTENT_W, Math.max(...lines.map((l) => this.headWidth(l, size))) + 40);
    this.line(MARGIN.x + (CONTENT_W - w) / 2, this.y + 2, MARGIN.x + (CONTENT_W + w) / 2, this.y + 2, this.p.lavender, 1.6);
    this.y += 18;
  }

  /** 구역 제목 알약: "01. 핵심 개념" */
  section(n: number, label: string) {
    const size = 12.5;
    const text = `${String(n).padStart(2, '0')}. ${this.clean(label, 'head')}`;
    const w = this.headWidth(text, size) + 22;
    const h = 23;
    // 제목만 쪽 끝에 남지 않게 (내용 첫 조각이 들어갈 자리까지)
    this.need(h + 96);
    if (this.y > MARGIN.top) this.y += 6;
    this.roundRect(MARGIN.x, this.y, w, h, 7, { fill: this.p.lavender });
    this.drawHead(text, MARGIN.x + 11, this.y + 4.5, size, this.p.lavenderInk);
    this.y += h + 10;
  }

  /** 개념 띠: 전체 너비 옅은 보라 띠 + 왼쪽 이름, 오른쪽 작은 글 (중요도 별) */
  bar(label: string, right = '') {
    const size = 11.5;
    const h = 21;
    this.need(h + 40);
    const lines = this.wrap(this.clean(plainMathText(label), 'head'), size, CONTENT_W - 20 - (right ? 50 : 0), this.head);
    const hh = h + (lines.length - 1) * (size * 1.3);
    this.roundRect(MARGIN.x, this.y, CONTENT_W, hh, 4, { fill: this.p.lavender, opacity: this.p.barAlpha });
    this.page.drawRectangle({ x: MARGIN.x, y: this.py(this.y, hh), width: 3, height: hh, color: this.p.lavender });
    let yy = this.y + 4;
    for (const l of lines) {
      this.drawHead(l, MARGIN.x + 10, yy, size, this.p.text);
      yy += size * 1.3;
    }
    if (right) {
      const rw = this.width(right, 9);
      this.draw(right, MARGIN.x + CONTENT_W - rw - 8, this.py(this.y + 6 + 9 * 0.86), 9, this.p.yellow);
    }
    this.y += hh + 7;
  }

  /** 정의 상자: [ 용어 : 뜻 ] 테두리만 있는 상자 (샘플의 '대기 : 지구를 둘러싸고 있는 기체') */
  defBox(term: string, meaning: string) {
    const size = BODY;
    const pad = 6;
    const label = `${this.clean(plainMathText(term))} : `;
    const lw = this.width(label, size);
    const inner = CONTENT_W - pad * 2;
    const lines = this.wrap(this.clean(plainMathText(meaning)), size, Math.max(60, inner - lw));
    const h = pad * 2 + lines.length * LINE - (LINE - size * 1.15);
    this.need(h + 4);
    this.roundRect(MARGIN.x, this.y, CONTENT_W, h, 3, { stroke: this.p.line, strokeOpacity: this.p.lineAlpha, strokeWidth: 0.9 });
    const top = this.y + pad;
    this.draw(label, MARGIN.x + pad, this.py(top + size * 0.86), size, this.p.lavender, { bold: true });
    lines.forEach((l, i) => this.draw(l, MARGIN.x + pad + lw, this.py(top + i * LINE + size * 0.86), size, this.p.text));
    this.y += h + 6;
  }

  /** 왼쪽에 작은 알약(주의·예시)이 붙은 글 */
  callout(kind: 'warn' | 'example' | 'check', text: string) {
    const label = kind === 'warn' ? '주의' : kind === 'example' ? '예시' : '확인';
    const color = kind === 'warn' ? this.p.pink : kind === 'example' ? this.p.teal : this.p.blue;
    const lw = 34;
    const x = MARGIN.x + lw + 8;
    const width = CONTENT_W - lw - 8;
    const lines = richLines(text);
    const est = lines.reduce((a, l) => a + this.wrap(l.map((r) => r.text).join(''), BODY, width).length, 0) * LINE;
    this.need(Math.min(est, 60));
    const top = this.y;
    this.roundRect(MARGIN.x, top + 1.5, lw, 14, 7, { fill: color, opacity: this.p === PALETTES.dark ? 0.22 : 0.14, stroke: color, strokeWidth: 0.8 });
    const tw = this.width(label, 8.5);
    this.draw(label, MARGIN.x + (lw - tw) / 2, this.py(top + 1.5 + 2.5 + 8.5 * 0.86), 8.5, color);
    const h = this.rich(lines, x, width);
    void h;
    this.y += 4;
  }

  /** => 로 시작하는 한 줄 (왜 중요한지) */
  arrow(text: string) {
    const lead = '=> ';
    const lw = this.width(lead, BODY);
    this.need(LINE);
    this.draw(lead, MARGIN.x + 6, this.py(this.y + BODY * 0.86), BODY, this.p.lavender);
    this.rich(richLines(text), MARGIN.x + 6 + lw, CONTENT_W - 6 - lw, { color: this.p.muted });
  }

  /** 공식 상자: 가운데 수식 + 아래 작은 이름 */
  formula(latex: string, label: string) {
    const expr = this.clean(texToText(latex));
    const size = 12.5;
    const lines = this.wrap(expr, size, CONTENT_W - 40);
    const h = 9 + lines.length * (size * 1.35) + (label ? 12 : 0);
    this.need(h + 6);
    this.roundRect(MARGIN.x + 10, this.y, CONTENT_W - 20, h, 6, { stroke: this.p.lavender, strokeWidth: 1, strokeOpacity: 0.9 });
    let yy = this.y + 6;
    for (const l of lines) {
      const w = this.width(l, size);
      this.draw(l, MARGIN.x + (CONTENT_W - w) / 2, this.py(yy + size * 0.86), size, this.p.text);
      yy += size * 1.35;
    }
    if (label) {
      const t = this.clean(plainMathText(label));
      const w = this.width(t, 8.5);
      this.draw(t, MARGIN.x + (CONTENT_W - w) / 2, this.py(yy + 1 + 8.5 * 0.86), 8.5, this.p.muted);
    }
    this.y += h + 8;
  }

  /** 마인드맵: 뿌리 알약 아래로 세로 줄기, 가지마다 색 알약 + 외우기 한 줄, 그 아래 작은 가지들 */
  mindmap(mm: Mindmap) {
    const level1 = mm.nodes.filter((n) => !n.parent_id || !mm.nodes.some((m) => m.id === n.parent_id));
    if (!level1.length) return;
    const kidsOf = (id: string) => mm.nodes.filter((n) => n.parent_id === id);
    const spineX = MARGIN.x + 14;
    // 뿌리
    const rootText = this.clean(plainMathText(mm.root_label) || '주제', 'head');
    const rw = this.headWidth(rootText, 12.5) + 24;
    this.need(60);
    const rootTop = this.y;
    this.roundRect(MARGIN.x, rootTop, rw, 24, 12, { fill: this.p.lavender });
    this.drawHead(rootText, MARGIN.x + 12, rootTop + 5, 12.5, this.p.lavenderInk);
    this.y += 24 + 10;
    let spineFrom = rootTop + 24;
    level1.forEach((n, i) => {
      const color = this.p.branches[i % this.p.branches.length];
      const label = this.clean(plainMathText(n.label), 'head');
      const hint = n.hint ? this.clean(plainMathText(n.hint)) : '';
      const kids = kidsOf(n.id);
      const grand = (k: { id: string }) => kidsOf(k.id);
      const kidText = kids
        .map((k) => {
          const g = grand(k);
          const name = (x: { label: string }) => this.clean(plainMathText(x.label));
          return g.length ? `${name(k)} (${g.map(name).join(', ')})` : name(k);
        })
        .join('  ·  ');
      const est = 22 + (hint ? LINE : 0) + (kidText ? this.wrap(kidText, 9.5, CONTENT_W - 44).length * 14 : 0) + 8;
      if (this.bottomRoom < est) {
        // 줄기를 이 쪽에서 끊고 다음 쪽에서 잇는다
        this.line(spineX, spineFrom, spineX, this.y, this.p.line, 0.9, this.p.lineAlpha);
        this.newPage();
        spineFrom = this.y;
      }
      const top = this.y;
      const pw = this.headWidth(label, 11) + 18;
      this.line(spineX, top + 10, spineX + 12, top + 10, this.p.line, 0.9, this.p.lineAlpha);
      this.roundRect(spineX + 12, top, pw, 20, 10, { fill: color, opacity: this.p === PALETTES.dark ? 0.9 : 1 });
      this.drawHead(label, spineX + 21, top + 4, 11, this.p === PALETTES.dark ? this.p.lavenderInk : hex('#ffffff'));
      if (hint) {
        this.draw(hint, spineX + 12 + pw + 8, this.py(top + 5 + 9 * 0.86), 9, this.p.muted);
      }
      this.y += 24;
      if (kidText) {
        const lines = this.wrap(kidText, 9.5, CONTENT_W - 44);
        for (const l of lines) {
          this.need(14);
          this.draw(l, spineX + 26, this.py(this.y + 9.5 * 0.86), 9.5, this.p.text);
          this.y += 14;
        }
      }
      this.y += 6;
    });
    this.line(spineX, spineFrom, spineX, this.y - 10, this.p.line, 0.9, this.p.lineAlpha);
    this.y += 4;
  }

  /** 자료 그림: 테두리 안에 그림, 아래 제목·설명 */
  async figure(f: PdfFigure, img: PDFImage) {
    const maxW = CONTENT_W - 20;
    const maxH = 250;
    const ratio = img.width && img.height ? img.width / img.height : f.w && f.h ? f.w / f.h : 1.4;
    let w = Math.min(maxW, maxH * ratio);
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    const capLines = f.caption ? this.wrap(this.clean(plainMathText(f.caption)), 9, CONTENT_W - 20) : [];
    const block = h + 12 + (f.title ? 15 : 0) + capLines.length * 12.5 + 10;
    this.need(Math.min(block, PAGE.h - MARGIN.top - MARGIN.bottom));
    const x = MARGIN.x + (CONTENT_W - w) / 2;
    this.page.drawRectangle({
      x: x - 3,
      y: this.py(this.y, h + 6),
      width: w + 6,
      height: h + 6,
      color: hex('#ffffff'),
      opacity: this.p === PALETTES.dark ? 0.06 : 0.5,
      borderColor: this.p.line,
      borderOpacity: this.p.lineAlpha,
      borderWidth: 0.8,
    });
    this.page.drawImage(img, { x, y: this.py(this.y + 3, h), width: w, height: h });
    this.y += h + 12;
    if (f.title) {
      const t = this.clean(plainMathText(f.title), 'head');
      this.drawHead(t, MARGIN.x + 10, this.y, 10.5, this.p.lavender);
      this.y += 15;
    }
    for (const l of capLines) {
      this.draw(l, MARGIN.x + 10, this.py(this.y + 9 * 0.86), 9, this.p.muted);
      this.y += 12.5;
    }
    this.y += 10;
  }

  /** 확인해 볼 것: 네모 칸 + 글 */
  checkbox(text: string) {
    const lines = richLines(text);
    this.need(LINE);
    const top = this.y;
    this.roundRect(MARGIN.x + 2, top + 2.5, 9.5, 9.5, 2, { stroke: this.p.line, strokeOpacity: this.p.lineAlpha, strokeWidth: 0.9 });
    this.rich(lines, MARGIN.x + 18, CONTENT_W - 18);
    this.y += 2;
  }

  /** 쪽마다: 아래 가운데 쪽 번호, 오른쪽 KOK (AI 가 만든 정리면 그 앞에 'AI 정리'). 글은 끝나야 모두 몇 쪽인지 알아서 마지막에 */
  footers(title: string, aiMade: boolean) {
    const n = this.pages.length;
    const kokW = this.head.widthOfTextAtSize('KOK', 10);
    this.pages.forEach((pg, i) => {
      const t = `${i + 1} / ${n}`;
      this.draw(t, (PAGE.w - this.width(t, 8.5)) / 2, 22, 8.5, this.p.muted, { page: pg });
      pg.drawText('KOK', { x: PAGE.w - MARGIN.x - kokW, y: 21, size: 10, font: this.head, color: this.p.lavender });
      if (aiMade) this.draw(AI_LABEL, PAGE.w - MARGIN.x - kokW - 7 - this.width(AI_LABEL, 8.5), 22, 8.5, this.p.muted, { page: pg });
      if (i > 0) {
        const short = Array.from(this.clean(plainMathText(title), 'head'))
          .slice(0, 30)
          .join('');
        this.draw(short, MARGIN.x, 22, 8.5, this.p.muted, { page: pg });
      }
    });
  }
}

const IMPORTANCE = { high: '★★★', medium: '★★☆', low: '★☆☆' } as const;
/** 쪽 아래의 생성형 AI 결과물 표시 */
const AI_LABEL = 'AI 정리';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 노트 → PDF 바이트와 쪽 수 */
export async function buildNotePdf(input: NotePdfInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const fonts = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(input.title);
  doc.setAuthor('KOK');
  doc.setCreator('KOK');
  doc.setProducer('KOK');
  doc.setCreationDate(input.date);
  // 기계가 읽는 표시: AI 가 만든 내용이 든 파일 (인공지능기본법·각 앱이 파일 정보로 알아볼 수 있게)
  if (input.aiMade) {
    doc.setSubject('AI가 만든 공부 정리 (KOK) · AI-generated study notes');
    doc.setKeywords(['AI 생성', 'AI-generated', 'generative AI', 'KOK']);
  }
  const embedded = await Promise.all(fonts.map((f) => doc.embedFont(f, { subset: true })));
  const [body, head, ...extra] = embedded;
  const kit = (font: PDFFont) => {
    const i = embedded.indexOf(font);
    return i < 0 ? null : (kitCache[i] ??= fontkit.create(fonts[i]));
  };
  const p = PALETTES[input.theme];
  const s = new Sheet(doc, p, body, head, extra, kit);
  const note = input.note;
  const date = input.date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
  // 단원은 학생이 고른 것만 (자료 행의 단원)
  const metaParts = ['@ KOK', input.aiMade ? 'AI가 만든 정리' : '', input.subject, input.unit, date].filter(Boolean);
  s.title(input.title || note.title || '정리 노트', metaParts.join(' · '));

  let n = 0;
  const kpTitle = new Map(note.key_points.map((k) => [k.id, k.title]));

  if (note.summary.trim()) {
    s.section(++n, '한눈에 보기');
    s.rich(richLines(note.summary), MARGIN.x + 4, CONTENT_W - 8, { size: 11, line: 16.5 });
    s.gap(8);
  }

  if (note.key_points.length) {
    s.section(++n, '핵심 개념');
    const pitfallsOf = (id: string) => note.pitfalls.filter((x) => x.key_point_id === id);
    const examplesOf = (id: string) => note.examples.filter((x) => x.key_point_id === id);
    note.key_points.forEach((k, i) => {
      const letter = LETTERS[i % LETTERS.length] + (i >= LETTERS.length ? String(Math.floor(i / LETTERS.length)) : '');
      s.bar(`${letter}. ${k.title}`, input.showImportance ? IMPORTANCE[k.importance] : k.starred ? '★' : '');
      if (k.explanation.trim()) s.rich(richLines(k.explanation), MARGIN.x + 6, CONTENT_W - 10);
      if (k.why.trim()) s.arrow(k.why);
      for (const x of examplesOf(k.id)) s.callout('example', x.text);
      for (const x of pitfallsOf(k.id)) s.callout('warn', x.text);
      s.gap(8);
    });
    // 개념에 붙지 않은 주의·예시
    const loose = [
      ...note.pitfalls.filter((x) => !kpTitle.has(x.key_point_id)).map((x) => ['warn', x.text] as const),
      ...note.examples.filter((x) => !kpTitle.has(x.key_point_id)).map((x) => ['example', x.text] as const),
    ];
    for (const [kind, text] of loose) s.callout(kind, text);
    if (loose.length) s.gap(6);
  }

  if (note.terms.length) {
    s.section(++n, '용어');
    for (const t of note.terms) s.defBox(t.term, t.meaning);
    s.gap(6);
  }

  if (note.formulas.length) {
    s.section(++n, '공식');
    for (const f of note.formulas) s.formula(f.latex, f.label);
    s.gap(4);
  }

  if (input.mindmap && input.mindmap.nodes.length) {
    s.section(++n, '마인드맵');
    s.mindmap(input.mindmap);
    s.gap(8);
  }

  if (input.figures.length) {
    s.section(++n, '자료 그림');
    for (const f of input.figures) {
      let img: PDFImage;
      try {
        img = await doc.embedJpg(f.bytes);
      } catch {
        continue;
      }
      await s.figure(f, img);
    }
  }

  if (note.checks.length) {
    s.section(++n, '확인해 볼 것');
    for (const c of note.checks) s.checkbox(c.text);
    s.gap(6);
  }

  s.footers(input.title || note.title, input.aiMade);
  const bytes = await doc.save();
  return { bytes, pages: s.pages.length };
}
