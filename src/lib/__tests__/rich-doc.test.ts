import { describe, expect, it } from 'vitest';
import { docIsEmpty, docToRich, richToDoc, sameDoc, type DocNode } from '../rich-doc';
import { parseRich } from '../richtext';

const round = (s: string, single = false) => docToRich(richToDoc(s, { single }), { single });

type Inl = ReturnType<typeof parseRich>[number]['c'];
const flat = (ns: Inl): string => ns.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'math' ? n.tex : flat(n.c))).join('');

const para = (...content: DocNode[]): DocNode => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const t = (text: string, ...marks: string[]): DocNode =>
  marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text };
const math = (tex: string, ...marks: string[]): DocNode => ({
  type: 'math',
  attrs: { tex, display: false },
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});

describe('rich-doc: 저장된 글이 그대로 돌아온다', () => {
  // 노트에 흔히 있는 글: 고치기 칸을 열었다 닫아도(문서로 바꿨다 되돌려도) 글자 하나 바뀌지 않아야 한다
  const same = [
    '광합성은 빛으로 ==포도당==을 만든다',
    '**광합성**은 !!엽록체!!에서 일어나요.',
    '- 잎을 잘라 보면 초록색 알갱이가 보인다\n- 알갱이 속에 !!엽록소!!가 있다',
    '1. 빛을 받는다\n2. 물을 나눈다\n3. 포도당을 만든다',
    '첫 줄\n\n셋째 줄',
    '넓이는 $S = \\pi r^2$ 이에요.',
    '$$\\frac{a}{b}$$',
    'x**2 + y**2 는 굵게가 아니에요',
    'a==b 와 c==d',
    '대박!! 진짜!!',
    '$5 와 $10',
    '1**단계**는 굵게',
    '**굵게 ==형광펜 안== 굵게**',
    '==형광펜 **굵게** 형광펜==',
    '__init__ 함수',
    'snake_case_name 과 a@b.com',
    '- 목록 다음\n보통 줄\n- 다시 목록',
    '3. 셋째부터\n4. 넷째',
    '이 글에는 꾸미기가 없어요.',
    '',
    '★ 별표와 ① 동그라미 숫자',
    '**$x^2$** 은 굵은 수식',
  ];
  it.each(same)('%j', (s) => {
    expect(round(s)).toBe(s);
  });

  it('한 줄 칸: 줄 앞 번호도 글자 그대로', () => {
    expect(round('1. 광합성', true)).toBe('1. 광합성');
    expect(round('- 엽록체', true)).toBe('- 엽록체');
    expect(round('**광합성**의 재료', true)).toBe('**광합성**의 재료');
    expect(round('2) 호흡', true)).toBe('2) 호흡');
  });

  it('한 줄 칸에 여러 줄이 오면 빈칸으로 잇는다', () => {
    expect(
      docToRich(
        {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [t('가')] },
            { type: 'paragraph', content: [t('나')] },
          ],
        },
        { single: true },
      ),
    ).toBe('가 나');
  });
});

describe('rich-doc: 문서 → 글', () => {
  it('꾸미기 기호로 적는다', () => {
    expect(docToRich(para(t('광합성은 '), t('빛', 'bold'), t('으로 '), t('포도당', 'highlight'), t('을 만든다 '), t('중요', 'red')))).toBe(
      '광합성은 **빛**으로 ==포도당==을 만든다 !!중요!!',
    );
  });

  it('꾸민 곳의 양 끝 빈칸은 꾸미기 밖으로', () => {
    expect(docToRich(para(t('가'), t(' 굵게 ', 'bold'), t('나')))).toBe('가 **굵게** 나');
    expect(docToRich(para(t('   ', 'bold'), t('글')))).toBe('   글');
  });

  it('엇갈린 꾸미기는 닫았다 다시 연다', () => {
    const s = docToRich(para(t('가', 'bold'), t('나', 'bold', 'highlight'), t('다', 'highlight')));
    expect(s).toBe('**가==나==**==다==');
    const l = parseRich(s)[0];
    expect(l.c.map((n) => n.t)).toEqual(['b', 'mark']);
  });

  it('영어·숫자 바로 뒤의 굵게처럼 기호로 적을 수 없는 꾸미기는 빼고 글자는 남긴다', () => {
    expect(docToRich(para(t('H'), t('2', 'bold'), t('O')))).toBe('H2O');
    // 한글이 들어 있으면 굵게가 된다
    expect(docToRich(para(t('1'), t('단계', 'bold')))).toBe('1**단계**');
  });

  it('닫는 기호 뒤에 같은 기호가 오면 그 꾸미기만 뺀다', () => {
    expect(docToRich(para(t('가', 'bold'), t('*나')))).toBe('가*나');
    expect(docToRich(para(t('굵게', 'bold'), t(' 그리고 $a$ 값')))).toBe('**굵게** 그리고 \\$a\\$ 값');
  });

  it('어떤 문서든 다시 읽으면 글자가 같다', () => {
    const texts = ['가', '*', '=', '!', '$', ' ', 'a', '1', '\\', '_', '^', '-'];
    const marks = [[], ['bold'], ['highlight'], ['red'], ['bold', 'red'], ['highlight', 'bold']];
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let k = 0; k < 400; k++) {
      // 줄 앞 목록 표시('- ')는 기호로 적는 수밖에 없어서 줄은 한글로 시작한다
      const parts: DocNode[] = [t('가')];
      const n = 1 + rand(7);
      for (let j = 0; j < n; j++) {
        const word = Array.from({ length: 1 + rand(3) }, () => texts[rand(texts.length)]).join('');
        parts.push(t(word, ...marks[rand(marks.length)]));
      }
      const doc = para(...parts);
      const s = docToRich(doc);
      const plain = (parts.map((p) => p.text).join('') as string).replace(/\s+$/, '');
      const shown = parseRich(s)
        .map((l) => (l.list === 'bullet' ? '- ' : l.list === 'number' ? `${l.n}. ` : '') + flat(l.c))
        .join('\n');
      // 글자는 그대로 (수식으로 읽힌 글은 수식 글자 그대로)
      expect(shown.replace(/\s+$/, ''), JSON.stringify({ s, doc })).toBe(plain.replace(/^[ \t]*\n/, ''));
    }
  });

  it('수식 바로 뒤의 숫자 앞에는 빈칸을 둔다 (수식이 닫히게)', () => {
    const s = docToRich(para(math('x'), t('2개')));
    expect(s).toBe('$x$ 2개');
    expect(parseRich(s)[0].c[0]).toEqual({ t: 'math', tex: 'x', display: false });
  });

  it('글 속의 $ 가 수식으로 읽히면 \\$ 로 적는다', () => {
    const s = docToRich(para(t('값은 $a$ 원')));
    expect(s).toBe('값은 \\$a\\$ 원');
    expect(parseRich(s)[0].c).toEqual([{ t: 'text', v: '값은 $a$ 원' }]);
  });

  it('목록과 번호 목록', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('하나')] }] }] },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: ['셋', '넷'].map((x) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [t(x)] }] })),
        },
      ],
    };
    expect(docToRich(doc)).toBe('- 하나\n3. 셋\n4. 넷');
  });

  it('줄바꿈(hardBreak)과 앞뒤 빈 줄', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [{ type: 'paragraph' }, { type: 'paragraph', content: [t('가'), { type: 'hardBreak' }, t('나')] }, { type: 'paragraph' }],
    };
    expect(docToRich(doc)).toBe('가\n나');
  });

  it('수식은 꾸미기 안에도 있다', () => {
    expect(docToRich(para(math('x^2', 'bold'), t(' 와 '), math('y')))).toBe('**$x^2$** 와 $y$');
  });
});

describe('rich-doc: 글 → 문서', () => {
  it('꾸미기와 수식', () => {
    expect(richToDoc('가 **나** $x$')).toEqual(para(t('가 '), t('나', 'bold'), t(' '), math('x')));
  });

  it('$ 없이 쓴 수식도 수식 조각으로', () => {
    const doc = richToDoc('y=e^{2x}과 y축');
    expect(doc.content?.[0].content?.[0]).toEqual({ type: 'math', attrs: { tex: 'y=e^{2x}', display: false } });
  });

  it('목록 줄은 목록으로, 번호는 시작 번호로', () => {
    const doc = richToDoc('3. 셋\n4. 넷');
    expect(doc.content?.[0]).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
    expect(doc.content?.[0].content).toHaveLength(2);
  });

  it('빈 글은 빈 문단 하나', () => {
    expect(richToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(docIsEmpty(richToDoc(''))).toBe(true);
    expect(docIsEmpty(richToDoc('  '))).toBe(true);
    expect(docIsEmpty(richToDoc('$x$'))).toBe(false);
  });

  it('sameDoc: 꾸미기 차례가 달라도 같은 문서', () => {
    const a = para({ type: 'text', text: '가', marks: [{ type: 'bold' }, { type: 'red' }] });
    const b = para({ type: 'text', text: '가', marks: [{ type: 'red' }, { type: 'bold' }] });
    expect(sameDoc(a, b)).toBe(true);
    expect(sameDoc(a, para(t('가')))).toBe(false);
  });
});
