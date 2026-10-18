import { describe, expect, it } from 'vitest';
import { hasRichMarks, parseRich, previewText, stripMarks, stripRich, type Inline } from '@/lib/richtext';
import { continueList, insertSnippet, toggleList, toggleWrap } from '@/lib/rich-edit';
import { moveInGroup, starredFirst, withIds } from '@/lib/note-order';

const flat = (ns: Inline[]): string => ns.map((n) => (n.t === 'text' ? n.v : n.t === 'math' ? `[${n.tex}]` : `<${n.t}>${flat(n.c)}</${n.t}>`)).join('');

describe('쉬운 꾸미기 읽기', () => {
  it('굵게·형광펜·빨간 글씨와 수식', () => {
    const [l] = parseRich('광합성은 **빛**으로 ==포도당==을 !!만든다!! $6CO_2$');
    expect(flat(l.c)).toBe('광합성은 <b>빛</b>으로 <mark>포도당</mark>을 <red>만든다</red> [6CO_2]');
  });
  it('빈칸이 붙은 기호, 셋 이상 이어진 기호는 그대로 (대박!! 진짜!!)', () => {
    expect(flat(parseRich('대박!! 진짜!!')[0].c)).toBe('대박!! 진짜!!');
    expect(flat(parseRich('a == b 이고 c == d')[0].c)).toBe('a == b 이고 c == d');
    expect(flat(parseRich('**')[0].c)).toBe('**');
    // 코드처럼 영어·숫자 바로 뒤에 붙은 표시
    expect(flat(parseRich('x**2 + y**2')[0].c)).toBe('x**2 + y**2');
    expect(flat(parseRich('a==b and c==d')[0].c)).toBe('a==b and c==d');
    // 한글 바로 뒤는 꾸민다. 숫자·영어 바로 뒤도 안에 한글이 있으면 꾸민다
    expect(flat(parseRich('광합성은**빛**')[0].c)).toBe('광합성은<b>빛</b>');
    expect(flat(parseRich('1**단계**와 DNA**는** pH7!!이하!!')[0].c)).toBe('1<b>단계</b>와 DNA<b>는</b> pH7<red>이하</red>');
  });
  it('겹쳐 꾸미기와 수식 감싸기', () => {
    expect(flat(parseRich('**==둘 다==**')[0].c)).toBe('<b><mark>둘 다</mark></b>');
    expect(flat(parseRich('**$x^2$ 는 넓이**')[0].c)).toBe('<b>[x^2] 는 넓이</b>');
  });
  it('줄 앞 - 와 1. 은 목록', () => {
    const ls = parseRich('첫 줄\n- 하나\n• 둘\n3. 셋\n2) 넷');
    expect(ls.map((l) => l.list)).toEqual([null, 'bullet', 'bullet', 'number', 'number']);
    expect(ls[3].n).toBe(3);
    expect(flat(ls[1].c)).toBe('하나');
  });
  it('AI 에 보낼 글은 글자 꾸미기만 빼고 목록·수식은 둔다', () => {
    expect(stripMarks('**빛**과 ==물==\n- !!산소!!는 결과물\n2. $CO_2$ 는 재료')).toBe('빛과 물\n- 산소는 결과물\n2. $CO_2$ 는 재료');
    expect(stripMarks('대박!! 진짜!! x**2')).toBe('대박!! 진짜!! x**2');
  });
  it('미리보기·검색 글에는 기호가 없다', () => {
    expect(stripRich('**굵게** ==형광== !!빨강!!\n- 목록')).toBe('굵게 형광 빨강\n목록');
    expect(previewText('**광합성**은 $CO_2$ 를 ==쓴다==')).toBe('광합성은 CO₂ 를 쓴다');
    expect(hasRichMarks('그냥 글')).toBe(false);
    expect(hasRichMarks('**굵게**')).toBe(true);
    expect(hasRichMarks('- 목록')).toBe(true);
  });
});

describe('꾸미기 버튼', () => {
  const apply = (v: string, r: { start: number; end: number; text: string }) => v.slice(0, r.start) + r.text + v.slice(r.end);
  it('고른 글을 감싸고, 다시 누르면 푼다', () => {
    const v = '광합성은 빛으로';
    const r = toggleWrap(v, 5, 7, '**', '굵게');
    const v2 = apply(v, r);
    expect(v2).toBe('광합성은 **빛으**로');
    expect(v2.slice(r.selStart, r.selEnd)).toBe('빛으');
    const r2 = toggleWrap(v2, r.selStart, r.selEnd, '**', '굵게');
    expect(apply(v2, r2)).toBe(v);
  });
  it('고른 글이 없으면 자리 글을 넣고 고른다, 빈칸은 바깥으로', () => {
    const r = toggleWrap('abc', 3, 3, '==', '형광펜');
    const v2 = apply('abc', r);
    expect(v2).toBe('abc==형광펜==');
    expect(v2.slice(r.selStart, r.selEnd)).toBe('형광펜');
    expect(apply('a  b  c', toggleWrap('a  b  c', 1, 5, '**', 'x'))).toBe('a  **b**  c');
  });
  it('여러 줄은 줄마다 감싸고 목록 표시는 밖에 둔다', () => {
    const v = '- 하나\n- 둘';
    expect(apply(v, toggleWrap(v, 0, v.length, '**', 'x'))).toBe('- **하나**\n- **둘**');
  });
  it('버튼으로 붙인 기호는 늘 보인다 (숫자·영어 바로 뒤)', () => {
    const cases: Array<[string, number, number, string, string]> = [
      ['1단계', 1, 3, '**', '1**단계**'],
      ['DNA는', 3, 4, '**', 'DNA**는**'],
      ['pH7이하', 3, 5, '!!', 'pH7!!이하!!'],
      ['abc', 1, 2, '**', '**abc**'],
    ];
    for (const [v, a, b, m, want] of cases) {
      const out = apply(v, toggleWrap(v, a, b, m, 'x'));
      expect(out).toBe(want);
      expect(flat(parseRich(out)[0].c)).not.toContain(m);
    }
  });
  it('꾸민 곳 안에 커서나 일부만 고르고 누르면 그 꾸미기를 푼다', () => {
    expect(apply('가**나다**라', toggleWrap('가**나다**라', 4, 4, '**', 'x'))).toBe('가나다라');
    expect(apply('**굵은글**', toggleWrap('**굵은글**', 2, 4, '**', 'x'))).toBe('굵은글');
    expect(apply('**굵게**', toggleWrap('**굵게**', 0, 6, '**', 'x'))).toBe('굵게');
    expect(apply('- **하나**', toggleWrap('- **하나**', 0, 8, '**', 'x'))).toBe('- 하나');
    // 다른 꾸미기 안에서는 새로 감싼다
    expect(apply('==형광==', toggleWrap('==형광==', 2, 4, '**', 'x'))).toBe('==**형광**==');
  });
  it('여러 줄: 모두 꾸며져 있으면 줄마다 풀고, 아니면 안 꾸민 줄만 감싼다', () => {
    const both = '**a**\n**b**';
    expect(apply(both, toggleWrap(both, 0, both.length, '**', 'x'))).toBe('a\nb');
    const mixed = '- **하나**\n- 둘';
    expect(apply(mixed, toggleWrap(mixed, 0, mixed.length, '**', 'x'))).toBe('- **하나**\n- **둘**');
  });
  it('안에 같은 꾸미기가 있으면 합쳐서 한 번만 감싼다', () => {
    const v = 'a **b** c';
    expect(apply(v, toggleWrap(v, 0, v.length, '**', 'x'))).toBe('**a b c**');
  });
  it('빈 칸·빈 줄에서 목록 버튼은 표시를 넣고, 번호는 윗줄에 이어서', () => {
    const r = toggleList('', 0, 0, 'bullet');
    expect(apply('', r)).toBe('- ');
    expect(r.selStart).toBe(2);
    const v = '1. 하나\n';
    const r2 = toggleList(v, v.length, v.length, 'number');
    expect(apply(v, r2)).toBe('1. 하나\n2. ');
    expect(r2.selStart).toBe(v.length + 3);
  });
  it('목록 켜고 끄기, 번호는 1부터', () => {
    const v = '첫째\n둘째\n\n셋째';
    const on = apply(v, toggleList(v, 0, v.length, 'number'));
    expect(on).toBe('1. 첫째\n2. 둘째\n\n3. 셋째');
    expect(apply(on, toggleList(on, 0, on.length, 'number'))).toBe(v);
    const b = apply('a\nb', toggleList('a\nb', 2, 2, 'bullet'));
    expect(b).toBe('a\n- b');
  });
  it('목록 줄에서 엔터: 다음 줄도 목록, 빈 줄이면 목록을 끝낸다', () => {
    const v = '- 하나';
    const r = continueList(v, v.length)!;
    expect(apply(v, r)).toBe('- 하나\n- ');
    const n = '  9. 아홉';
    expect(apply(n, continueList(n, n.length)!)).toBe('  9. 아홉\n  10. ');
    const empty = '- 하나\n- ';
    const e = continueList(empty, empty.length)!;
    expect(apply(empty, e)).toBe('- 하나\n');
    expect(continueList('그냥 글', 4)).toBeNull();
    // 표시 안에 커서가 있으면 보통 엔터
    expect(continueList('- 하나', 1)).toBeNull();
  });
  it('공식 도우미: □ 에 고른 글을 넣고 다음 □ 를 고른다', () => {
    const r = insertSnippet('x+1', 0, 3, '\\frac{□}{□}');
    const v = apply('x+1', r);
    expect(v).toBe('\\frac{x+1}{□}');
    expect(v.slice(r.selStart, r.selEnd)).toBe('□');
  });
});

describe('개념 순서', () => {
  const kps = [
    { id: 'a', starred: false },
    { id: 'b', starred: true },
    { id: 'c', starred: false },
    { id: 'd', starred: true },
  ];
  it('별표 먼저, 묶음 안에서는 원래 순서', () => {
    expect(starredFirst(kps).map((k) => k.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('같은 묶음 안에서만 옮기고 다른 묶음 자리는 그대로', () => {
    expect(moveInGroup(kps, 'd', 'b')!.map((k) => k.id)).toEqual(['a', 'd', 'c', 'b']);
    expect(moveInGroup(kps, 'c', 'a')!.map((k) => k.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(moveInGroup(kps, 'a', 'b')).toBeNull();
    expect(moveInGroup(kps, 'a', 'a')).toBeNull();
  });
  it('번호 없는 공식·용어에 겹치지 않는 번호', () => {
    const out = withIds([{ id: 't2' }, {}, {}], 't');
    expect(out.map((x) => x.id)).toEqual(['t2', 't1', 't3']);
  });
});
