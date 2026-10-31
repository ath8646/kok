import CFB from 'cfb';
import { deflateSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractOffice, officeNameProblem, officeText } from '@/lib/office';
import { hwpEqToTex } from '@/lib/office/hwp-eq';
import { isOfficeText, officeTextHeader } from '@/lib/office/names';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const file = (data: Uint8Array, name: string) => Object.assign(new Blob([new Uint8Array(data)]), { name });

describe('한글 수식 → LaTeX', () => {
  it('분수·근호·첨자·큰 연산자·괄호·행렬·글자', () => {
    expect(hwpEqToTex('{a+b} over {c-d}')).toBe('\\frac{a + b}{c - d}');
    expect(hwpEqToTex('x = {-b +- sqrt {b^2 - 4ac}} over {2a}')).toBe('x = \\frac{- b \\pm \\sqrt{b^{2} - 4 ac}}{2 a}');
    expect(hwpEqToTex('root 3 of x')).toBe('\\sqrt[3]{x}');
    expect(hwpEqToTex('sum _{i=1} ^{n} i')).toBe('\\sum_{i = 1}^{n} i');
    expect(hwpEqToTex('lim _{x -> 0} {sin x} over x = 1')).toBe('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1');
    expect(hwpEqToTex('LEFT { x | x > 0 RIGHT }')).toBe('\\left\\{ x | x > 0 \\right\\}');
    expect(hwpEqToTex('cases{x & x >= 0 # -x & x < 0}')).toBe('\\begin{cases}x & x \\ge 0 \\\\ - x & x < 0\\end{cases}');
    expect(hwpEqToTex('alpha + Gamma + BETA')).toBe('\\alpha + \\Gamma + B');
    expect(hwpEqToTex('"속력" = d over t')).toBe('\\text{속력} = \\frac{d}{t}');
    expect(hwpEqToTex('angle ABC = 90 deg')).toBe('\\angle ABC = 90 ^{\\circ}');
    expect(hwpEqToTex('x sup 2 + bar x + vec F')).toBe('x^{2} + \\overline{x} + \\vec{F}');
  });
});

describe('워드(.docx)', () => {
  const doc = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>3주차 포인터</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">포인터는 </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>주소</w:t></w:r><w:r><w:t>를 담는다.</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>주소 연산자 &amp;</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t>int *p = &amp;x;</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">    *p = 20;</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">넓이는 </w:t></w:r><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f><m:r><m:t>ab</m:t></m:r></m:oMath><w:r><w:t xml:space="preserve"> 이다.</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>연산자</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>뜻</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>*</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>간접 | 참조</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:sectPr/></w:body></w:document>`;
  const styles = `<?xml version="1.0"?><w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;

  it('제목·목록·코드 블록·수식·표', () => {
    const r = officeText(zip({ 'word/document.xml': doc, 'word/styles.xml': styles, '[Content_Types].xml': '<Types/>' }));
    expect(r.kind).toBe('docx');
    expect(r.text).toBe(
      [
        '# 3주차 포인터',
        '포인터는 주소를 담는다.',
        '  - 주소 연산자 &',
        '```',
        'int *p = &x;',
        '    *p = 20;',
        '```',
        '넓이는  $\\frac{1}{2}ab$  이다.',
        '',
        '| 연산자 | 뜻 |',
        '| * | 간접 ｜ 참조 |',
      ].join('\n'),
    );
  });
});

describe('파워포인트(.pptx)', () => {
  const P =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sp = (ph: string, paras: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
  const para = (t: string, lvl = 0, font = '') =>
    `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ''}<a:r>${font ? `<a:rPr><a:latin typeface="${font}"/></a:rPr>` : ''}<a:t>${t}</a:t></a:r></a:p>`;
  const slide = (shapes: string) => `<?xml version="1.0"?><p:sld ${P}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
  const files = {
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels':
      '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
    // 차례상 첫 슬라이드는 slide2.xml
    'ppt/slides/slide2.xml': slide(sp('<p:ph type="title"/>', para('스택과 큐')) + sp('<p:ph idx="1"/>', para('스택은 LIFO') + para('push·pop', 1))),
    'ppt/slides/slide1.xml': slide(
      sp('<p:ph type="title"/>', para('코드')) +
        sp('', para('def push(x):', 0, 'Consolas') + para('    stack.append(x)', 0, 'Consolas')) +
        `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody>${para('연산')}</a:txBody></a:tc><a:tc><a:txBody>${para('시간')}</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>${para('push')}</a:txBody></a:tc><a:tc><a:txBody>${para('O(1)')}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
        sp('<p:ph type="sldNum"/>', para('2')),
    ),
    'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': slide(sp('<p:ph type="body"/>', para('시험에 push 시간이 나온다'))),
  };

  it('슬라이드 차례·제목·목록 단계·코드·표·발표자 노트 (쪽 번호는 뺀다)', () => {
    const r = officeText(zip(files));
    expect(r.kind).toBe('pptx');
    expect(r.text).toBe(
      [
        '## 1. 스택과 큐',
        '- 스택은 LIFO',
        '  - push·pop',
        '',
        '## 2. 코드',
        '```',
        'def push(x):',
        '    stack.append(x)',
        '```',
        '',
        '| 연산 | 시간 |',
        '| push | O(1) |',
        '',
        '(발표자 노트) 시험에 push 시간이 나온다',
      ].join('\n'),
    );
  });
});

describe('한글(.hwpx)', () => {
  const H = 'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"';
  const p = (inner: string) => `<hp:p><hp:run>${inner}</hp:run></hp:p>`;
  const cell = (row: number, col: number, t: string) =>
    `<hp:tc><hp:subList>${p(`<hp:t>${t}</hp:t>`)}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/></hp:tc>`;
  const section = `<?xml version="1.0"?><hs:sec ${H}>
    ${p('<hp:ctrl><hp:header><hp:subList>' + p('<hp:t>머리말</hp:t>') + '</hp:subList></hp:header></hp:ctrl><hp:t>1. 광합성</hp:t>')}
    ${p('<hp:t>빛 에너지로<hp:lineBreak/>포도당을 만든다. 식: </hp:t><hp:equation><hp:script>6CO_2 + 12H_2O -&gt; C_6 H_12 O_6</hp:script></hp:equation>')}
    ${p(`<hp:tbl><hp:tr>${cell(0, 0, '단계')}${cell(0, 1, '장소')}</hp:tr><hp:tr>${cell(1, 0, '명반응')}${cell(1, 1, '틸라코이드')}</hp:tr></hp:tbl>`)}
  </hs:sec>`;

  it('문단·줄바꿈·수식·표 (머리말은 뺀다)', () => {
    const r = officeText(
      zip({
        mimetype: 'application/hwp+zip',
        'Contents/content.hpf':
          '<opf:package><opf:manifest><opf:item id="s0" href="Contents/section0.xml"/></opf:manifest><opf:spine><opf:itemref idref="s0"/></opf:spine></opf:package>',
        'Contents/section0.xml': section,
      }),
    );
    expect(r.kind).toBe('hwpx');
    expect(r.text).toBe(
      [
        '1. 광합성',
        '빛 에너지로',
        '포도당을 만든다. 식: $6 CO_{2} + 12 H_{2} O \\to C_{6} H_{12} O_{6}$',
        '',
        '| 단계 | 장소 |',
        '| 명반응 | 틸라코이드 |',
      ].join('\n'),
    );
  });
});

describe('한글(.hwp, HWP 5.0)', () => {
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const rec = (tag: number, level: number, data: number[]) => [...u32(tag | (level << 10) | (data.length << 20)), ...data];
  const wchars = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
  /** 확장 컨트롤 글자 (8 WCHAR: 글자, 이름 4바이트(거꾸로), 나머지, 다시 글자) */
  const ctrlChar = (code: number, id: string) => [...u16(code), ...[...id].reverse().map((c) => c.charCodeAt(0)), ...Array(8).fill(0), ...u16(code)];
  const ctrlHeader = (id: string, level: number) => rec(71, level, [...[...id].reverse().map((c) => c.charCodeAt(0)), ...Array(20).fill(0)]);
  const listHeader = (level: number, col: number, row: number) => rec(72, level, [...u32(1), ...u32(0), ...u16(col), ...u16(row), ...u16(1), ...u16(1)]);
  const para = (level: number, text: number[]) => [...rec(66, level, Array(22).fill(0)), ...rec(67, level + 1, [...text, ...u16(13)])];

  const body = [
    ...para(0, wchars('포인터 크기는 ')),
    ...rec(66, 0, Array(22).fill(0)),
    ...rec(67, 1, [...wchars('넓이: '), ...ctrlChar(11, 'eqed'), ...wchars(' 이다'), ...ctrlChar(11, 'tbl '), ...u16(13)]),
    ...ctrlHeader('eqed', 1),
    ...rec(88, 2, [...u32(0), ...u16('1 over 2 ab'.length), ...wchars('1 over 2 ab')]),
    ...ctrlHeader('tbl ', 1),
    ...rec(77, 2, Array(24).fill(0)),
    ...listHeader(2, 0, 0),
    ...para(2, wchars('언어')),
    ...listHeader(2, 1, 0),
    ...para(2, wchars('크기')),
    ...listHeader(2, 0, 1),
    ...para(2, wchars('C')),
    ...listHeader(2, 1, 1),
    ...para(2, wchars('8바이트')),
    // 탭은 글 안 컨트롤 (8 WCHAR)
    ...para(0, [...wchars('줄'), ...u16(10), ...wchars('바꿈'), ...u16(9), ...Array(12).fill(0), ...u16(9), ...wchars('탭')]),
  ];

  const hwp = (props: number, section: Uint8Array) => {
    const doc = CFB.utils.cfb_new();
    const header = new Uint8Array(256);
    header.set(strToU8('HWP Document File'), 0);
    header.set(u32(0x05000300), 32);
    header.set(u32(props), 36);
    CFB.utils.cfb_add(doc, '/FileHeader', header);
    CFB.utils.cfb_add(doc, '/DocInfo', new Uint8Array(4));
    CFB.utils.cfb_add(doc, '/BodyText/Section0', section);
    return new Uint8Array(CFB.write(doc, { type: 'array' }) as number[]);
  };

  it('압축한 구역: 문단·수식·표·줄바꿈·탭', () => {
    const r = officeText(hwp(1, deflateSync(new Uint8Array(body))));
    expect(r.kind).toBe('hwp');
    expect(r.text).toBe(['포인터 크기는', '넓이: $\\frac{1}{2} ab$ 이다', '', '| 언어 | 크기 |', '| C | 8바이트 |', '', '줄', '바꿈\t탭'].join('\n'));
  });

  it('암호·배포용 문서는 안내', () => {
    expect(() => officeText(hwp(1 | 2, deflateSync(new Uint8Array(body))))).toThrow(/암호/);
    expect(() => officeText(hwp(1 | 4, deflateSync(new Uint8Array(body))))).toThrow(/배포용/);
  });
});

describe('못 읽는 파일 안내', () => {
  it('예전 형식·엑셀·애플 문서·그림만 있는 문서', async () => {
    expect(officeNameProblem('a.doc')).toMatch(/\.docx/);
    expect(officeNameProblem('a.ppt')).toMatch(/\.pptx/);
    expect(officeNameProblem('a.xlsx')).toMatch(/엑셀/);
    expect(officeNameProblem('a.key')).toMatch(/PDF/);
    expect(officeNameProblem('a.hwp')).toBeNull();
    expect(() => officeText(zip({ 'xl/workbook.xml': '<workbook/>' }))).toThrow(/엑셀/);
    expect(() => officeText(strToU8('HWP Document File V3.00 \x1a\x01\x02\x03'))).toThrow(/예전 한글/);
    expect(() => officeText(strToU8('그냥 글'))).toThrow(/읽을 수 없는/);
    const empty = zip({ 'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>그림</w:t></w:r></w:p></w:body></w:document>` });
    await expect(extractOffice(file(empty, '그림.docx'))).rejects.toThrow(/글이 거의 없어요/);
  });
});

describe('문서에서 꺼낸 글 표시', () => {
  it('첫 줄의 (파일: 이름) 으로 알아본다', () => {
    expect(officeTextHeader('3단원  학습지.hwp')).toBe('(파일: 3단원 학습지.hwp)\n\n');
    expect(isOfficeText(officeTextHeader('a.pptx') + '## 1. 제목')).toBe(true);
    expect(isOfficeText('광합성은 (파일: 아님)\n')).toBe(false);
    expect(isOfficeText(null)).toBe(false);
  });
});
