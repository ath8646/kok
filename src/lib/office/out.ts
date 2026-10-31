// 문서에서 꺼낸 글을 이어 붙이는 도우미: 문단·목록·표·코드 블록·그림 자리·차트.
// 꺼낸 글은 AI 에 그대로 가는 자료라서 마크다운 비슷하게 쓴다 (제목은 #, 목록은 -, 표는 | 칸 |, 코드는 ``` 블록, 그림은 [[picture N]] 줄)
import { pictureMark } from '../doc-pictures';

/** 코드에 쓰는 고정폭 글꼴 이름 (워드·PPT 의 글꼴로 코드 줄을 알아본다) */
export const MONO_FONT =
  /consol|courier|menlo|monaco|mono|d2\s?coding|source\s?code|fira\s?code|jetbrains|lucida\s?console|cascadia|inconsolata|\bhack\b|나눔고딕코딩|nanumgothiccoding|d2코딩/i;

/** 코드 문단 스타일 이름 (워드) */
export const CODE_STYLE = /code|preformatted|소스|코드/i;

export class TextOut {
  private lines: string[] = [];
  private code: string[] | null = null;

  /** 문단 하나 (빈 문단은 빈 줄 하나) */
  para(text: string) {
    this.flushCode();
    this.lines.push(text.replace(/\s+$/u, ''));
  }

  /** 코드 한 줄 (이어진 코드 줄은 ``` 블록 하나로 묶는다) */
  codeLine(text: string) {
    (this.code ??= []).push(text.replace(/\s+$/u, ''));
  }

  /** 표 하나: 줄마다 | 칸 | 칸 | */
  table(rows: string[][]) {
    this.flushCode();
    const clean = rows
      .map((r) =>
        r.map((c) =>
          c
            .replace(/\s*\n\s*/g, ' / ')
            .replace(/\|/g, '｜')
            .trim(),
        ),
      )
      .filter((r) => r.some(Boolean));
    if (!clean.length) return;
    this.lines.push('');
    for (const r of clean) this.lines.push(`| ${r.join(' | ')} |`);
    this.lines.push('');
  }

  blank() {
    this.flushCode();
    this.lines.push('');
  }

  /** 그림 자리 한 줄 ('[[picture N]]'). n 이 없으면(또 나온 그림) 넣지 않는다 */
  picture(n: number | null | undefined) {
    if (!n) return;
    this.flushCode();
    this.lines.push(pictureMark(n));
  }

  /** 차트: 제목 한 줄과 값 표 */
  chart(c: { title: string; rows: string[][] } | null) {
    if (!c) return;
    this.para(c.title ? `(차트: ${c.title})` : '(차트)');
    this.table(c.rows);
  }

  /** 코드 블록을 쓰는 중인지 (코드 사이의 빈 문단은 블록 안의 빈 줄로) */
  get inCode(): boolean {
    return this.code !== null;
  }

  flushCode() {
    if (!this.code) return;
    // 앞뒤 빈 줄은 빼고 블록으로
    const c = this.code;
    while (c.length && !c[0].trim()) c.shift();
    while (c.length && !c[c.length - 1].trim()) c.pop();
    if (c.length) this.lines.push('```', ...c, '```');
    this.code = null;
  }

  toString(): string {
    this.flushCode();
    return tidy(this.lines.join('\n'));
  }
}

/** 빈 줄이 셋 넘게 이어지면 둘로, 줄 끝 빈칸·문서 앞뒤 빈 줄은 뺀다 */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
