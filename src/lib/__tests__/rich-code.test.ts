import { describe, expect, it, vi } from 'vitest';
import { docToRich, richToDoc, type DocNode } from '@/lib/rich-doc';
import { codeBlock, codeSpan, hasRichMarks, parseRich, plainMathText, previewText, splitMath, stripMarks, stripRich, type Inline } from '@/lib/richtext';

vi.mock('server-only', () => ({}));

const flat = (ns: Inline[]): string =>
  ns.map((n) => (n.t === 'text' ? n.v : n.t === 'code' ? `{${n.v}}` : n.t === 'math' ? `[${n.tex}]` : `<${n.t}>${flat(n.c)}</${n.t}>`)).join('');
const lines = (s: string) => parseRich(s).map((l) => (l.code ? `code(${l.code.lang}${l.code.start ? ',start' : ''}):` : '') + flat(l.c));
const round = (s: string, single = false) => docToRich(richToDoc(s, { single }), { single });

describe('코드 읽기', () => {
  it('`코드` 안은 글자 그대로: 수식·꾸미기·$ 없이 쓴 수식을 읽지 않는다', () => {
    expect(lines('`print(x)` 를 쓰면 출력돼요')).toEqual(['{print(x)} 를 쓰면 출력돼요']);
    expect(lines('`echo $HOME $PATH` 와 `**kwargs`, `__init__`')).toEqual(['{echo $HOME $PATH} 와 {**kwargs}, {__init__}']);
    expect(lines('`x = 10;` 다음 `a_n = 2^n`')).toEqual(['{x = 10;} 다음 {a_n = 2^n}']);
    // 꾸미기 안의 코드, 코드 옆의 수식
    expect(lines('**`self`** 는 $x^2$ 처럼')).toEqual(['<b>{self}</b> 는 [x^2] 처럼']);
  });

  it('백틱 n 개로 열고 n 개로 닫는다 (안에 백틱이 든 코드), 닫는 것이 없으면 글자', () => {
    expect(lines('``a`b`` 와 `` `x` ``')).toEqual(['{a`b} 와 {`x`}']);
    expect(lines('따옴표 ` 하나와 `` 둘')).toEqual(['따옴표 ` 하나와 `` 둘']);
    expect(lines('\\`이건\\` 글자')).toEqual(['`이건` 글자']);
    // 코드는 줄을 넘지 않는다
    expect(lines('`a\nb`')).toEqual(['`a', 'b`']);
  });

  it('수식 안에서는 백틱을 만나면 수식이 아니다 (코드 조각이 이긴다)', () => {
    expect(splitMath('가격은 $5 이고 `x$` 예요').map((p) => p.kind)).toEqual(['text', 'code', 'text']);
  });

  it('``` 줄로 감싼 코드 블록: 언어 이름, 들여쓰기, 닫지 않은 블록', () => {
    expect(lines('설명\n```python\ndef f():\n    return 1\n```\n끝')).toEqual(['설명', 'code(python,start):{def f():}', 'code(python):{    return 1}', '끝']);
    expect(lines('```\n**굵게 아님** $x$\n\n```')).toEqual(['code(,start):{**굵게 아님** $x$}', 'code():']);
    expect(lines('- 예시:\n  ```js\n  const a = 1;\n    b();\n  ```')).toEqual(['예시:', 'code(js,start):{const a = 1;}', 'code(js):{  b();}']);
    expect(lines('```sh\nls -l')).toEqual(['code(sh,start):{ls -l}']);
    expect(lines('```\n```')).toEqual(['code(,start):']);
    // 한 줄에 ``` 로 감싼 것은 글 속 코드
    expect(lines('```print(1)``` 처럼')).toEqual(['{print(1)} 처럼']);
  });

  it('미리보기·검색·AI 에 보낼 글·PDF 글', () => {
    const s = '`__init__` 는 **생성자**, `**kwargs` 는 $x^2$\n```py\nprint(f"{a}")\n```';
    expect(previewText(s)).toBe('__init__ 는 생성자, **kwargs 는 x² print(f"{a}")');
    expect(stripRich(s)).toBe('__init__ 는 생성자, **kwargs 는 $x^2$\nprint(f"{a}")');
    expect(plainMathText(s)).toBe('__init__ 는 생성자, **kwargs 는 x²\nprint(f"{a}")');
    expect(stripMarks(s)).toBe('`__init__` 는 생성자, `**kwargs` 는 $x^2$\n```py\nprint(f"{a}")\n```');
    expect(hasRichMarks('그냥 `x`')).toBe(true);
    // 예전 미리보기처럼 짝이 없는 기호는 글에서만 걷는다
    expect(previewText('__굵게__ 와 `__x__`')).toBe('굵게 와 __x__');
  });

  it('$ 없이 쓴 코드 같은 글은 수식으로 읽지 않는다: 괄호 짝이 안 맞거나 ; 로 끝나는 덩어리', () => {
    const kinds = (s: string) => splitMath(s).map((p) => (p.kind === 'math' ? `[${p.tex}]` : p.kind === 'code' ? `{${p.text}}` : p.text));
    expect(kinds('HAVING COUNT(*) > 1 인 그룹')).toEqual(['HAVING COUNT(*) > 1 인 그룹']);
    expect(kinds('int x = 10; int *p = &x;')).toEqual(['int x = 10; int *p = &x;']);
    expect(kinds('직선 y=2x+1 과')).toEqual(['직선 ', '[y=2x+1]', ' 과']);
  });

  it('저장 형식으로 적기 (안에 백틱·끝의 빈칸)', () => {
    for (const t of ['x', 'a`b', '`x', 'x`', ' x', 'x ', ' x ', '``', '   ']) {
      const [p] = splitMath(codeSpan(t));
      expect(p).toEqual({ kind: 'code', text: t });
    }
    expect(codeBlock(['a', '```', 'b'], 'md')).toBe('````md\na\n```\nb\n````');
    expect(lines(codeBlock(['a', '```', 'b'], 'md'))).toEqual(['code(md,start):{a}', 'code(md):{```}', 'code(md):{b}']);
  });
});

describe('코드 고치기 (문서 ↔ 글)', () => {
  it('저장된 글이 그대로 돌아온다', () => {
    for (const s of [
      '`print(x)` 를 쓰면',
      '`a` 와 `b`',
      '**`self`** 는 첫 인자',
      '==`for`== 문',
      '``a`b`` 와 `` `x` ``',
      '`echo $HOME` 와 $x^2$',
      '설명\n```python\ndef f():\n    return 1\n```\n끝',
      '```\n\n```',
      '````md\n```\n````',
      '- 목록\n```\ncode\n```\n- 다시',
      '따옴표 ` 하나',
      '\\`\\`\\`',
      '\\`a\\` 와 `b`',
    ])
      expect(round(s), s).toBe(s);
    for (const s of ['`__init__` 메서드', '`a` b `c`']) expect(round(s, true), s).toBe(s);
  });

  it('문서의 코드 표시·코드 블록을 글로', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '함수 ' },
            { type: 'text', text: 'len', marks: [{ type: 'code' }] },
            { type: 'text', text: '(', marks: [{ type: 'code' }, { type: 'bold' }] },
            { type: 'text', text: ' 와' },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'c' }, content: [{ type: 'text', text: 'int main() {\n  return 0;\n}' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '```' }] },
      ],
    };
    const s = docToRich(doc);
    expect(s).toBe('함수 `len`**`(`** 와\n```c\nint main() {\n  return 0;\n}\n```\n\\`\\`\\`');
    expect(lines(s)).toEqual(['함수 {len}<b>{(}</b> 와', 'code(c,start):{int main() {}', 'code(c):{  return 0;}', 'code(c):{}}', '```']);
  });

  it('코드 블록은 문서에서 codeBlock 덩이, 코드 조각은 code 표시', () => {
    const doc = richToDoc('`a` 와\n```py\nx = 1\n```');
    expect(doc.content?.map((b) => b.type)).toEqual(['paragraph', 'codeBlock']);
    expect(doc.content?.[0].content?.[0]).toEqual({ type: 'text', text: 'a', marks: [{ type: 'code' }] });
    expect(doc.content?.[1]).toEqual({ type: 'codeBlock', attrs: { language: 'py' }, content: [{ type: 'text', text: 'x = 1' }] });
  });
});

describe('AI 에 보낼 노트의 코드', () => {
  it('코드 블록 예시는 길게 두고, 잘리면 블록을 닫는다', async () => {
    const { noteForPrompt } = await import('@/lib/server/notes');
    const code = '```py\n' + Array.from({ length: 80 }, (_, i) => `x${i} = ${i}  # ${'설명'.repeat(3)}`).join('\n') + '\n```';
    const note = {
      title: '코드',
      unit: '',
      summary: '`print` 를 쓴다',
      key_points: [{ id: 'k1', title: '변수', explanation: '`x = 1` 처럼 쓴다', why: '', importance: 'high' as const, pages: [] }],
      terms: [],
      formulas: [],
      pitfalls: [],
      examples: [
        { text: code, key_point_id: 'k1' },
        { text: '```c\nint x;\n```', key_point_id: 'k1' },
      ],
      checks: [],
      changes: [],
    };
    const out = JSON.parse(noteForPrompt(note)) as { summary: string; examples: Array<{ text: string }> };
    expect(out.summary).toBe('`print` 를 쓴다');
    const [long, short] = out.examples.map((e) => e.text);
    expect(long.length).toBeGreaterThan(800);
    expect(long.endsWith('…\n```')).toBe(true);
    expect((long.match(/^```/gm) ?? []).length).toBe(2);
    expect(short).toBe('```c\nint x;\n```');
  });
});
