// 한글·워드·PPT 속 그림: 그림 자리 표시 줄, 그림 머리 읽기, 문서마다 그림 꺼내기, 정리 지시·예상 에너지
import CFB from 'cfb';
import { deflateSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DOC_PICTURES_PER_CHUNK, keepPictureMarks, pictureMark, pictureNumbers, renumberPictures, splitDocText, stripPictureMarks } from '@/lib/doc-pictures';
import { imageInfo } from '@/lib/image-size';
import { extractOffice, officeContent } from '@/lib/office';
import { cropOf, picturePriority, picturesForParts, usablePicture, type DocPicture } from '@/lib/office/pictures';
import { chartTable } from '@/lib/office/chart';
import { officeFileName } from '@/lib/office/names';
import { splitText } from '@/lib/pdf';
import { organizePrompt } from '@/lib/ai/prompts';
import { estimateEnergy, redrawsWanted } from '@/lib/ai/models';
import { keyPointRange } from '@/lib/ai/scale';
import { FILE_ACCEPT, splitForLimit } from '@/lib/quick-add';

// ---------------------------------------------------------------- 시험용 그림 (머리만 있는 파일: 크기는 머리로 읽는다)
const png = (w: number, h: number) => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  b.set(strToU8('IHDR'), 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[30] = w % 251; // 그림마다 내용이 다르게
  b[31] = h % 251;
  return b;
};
const jpeg = (w: number, h: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 0xff,
    w >> 8,
    w & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
const gif = (w: number, h: number) => new Uint8Array([...strToU8('GIF89a'), w & 0xff, w >> 8, h & 0xff, h >> 8, ...Array(20).fill(0)]);
const bmp = (w: number, h: number) => {
  const b = new Uint8Array(54);
  b.set(strToU8('BM'), 0);
  const dv = new DataView(b.buffer);
  dv.setInt32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, -h, true);
  return b;
};
const wmf = () => new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, ...Array(40).fill(1)]);

const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
const file = (data: Uint8Array, name: string) => Object.assign(new Blob([new Uint8Array(data)]), { name });

describe('그림 자리 표시 줄', () => {
  const text = ['가', pictureMark(3), '나', pictureMark(1), pictureMark(3), '다', pictureMark(2)].join('\n');

  it('번호 읽기·번호 다시 매기기·서버의 정리·지우기', () => {
    expect(pictureNumbers(text)).toEqual([3, 1, 2]);
    expect(pictureNumbers('[[picture 1]] 은 줄 전체가 아니면 아니다')).toEqual([]);
    // 3 → 1, 2 → 2, 1 은 지운다. 같은 그림이 또 나오면 처음 것만
    expect(renumberPictures(text, [3, 2])).toBe(['가', '[[picture 1]]', '나', '다', '[[picture 2]]'].join('\n'));
    // 서버: 올린 그림이 2장이면 3번 자리는 지우고 번호는 그대로
    expect(keepPictureMarks(text, 2)).toBe(['가', '나', '[[picture 1]]', '다', '[[picture 2]]'].join('\n'));
    expect(stripPictureMarks(text)).toBe('가\n나\n다');
    // 지운 줄 때문에 빈 줄이 셋 넘게 이어지지 않는다
    expect(stripPictureMarks('가\n\n[[picture 1]]\n\n나')).toBe('가\n\n나');
  });

  it('그림 줄을 지우지 않으면 글은 한 글자도 바꾸지 않는다 (학생이 쓴 코드의 빈 줄 두 개 등)', () => {
    const code = 'def a():\n    pass\n\n\ndef b():\n    pass\n\n\n\n끝';
    expect(keepPictureMarks(code, 0)).toBe(code);
    expect(renumberPictures(code, [])).toBe(code);
    expect(stripPictureMarks(code)).toBe(code);
    const withPic = `${code}\n${pictureMark(1)}`;
    expect(keepPictureMarks(withPic, 1)).toBe(withPic);
  });

  it('정리 조각: 그림 줄이 없으면 글자 수로만(예전과 같다), 그림이 많으면 그림 줄 앞에서 나눈다', () => {
    const plain = 'ㄱ'.repeat(50_000) + '\n\n' + 'ㄴ'.repeat(10_000);
    expect(splitDocText(plain, 40_000)).toEqual(splitText(plain, 40_000));
    const many = Array.from({ length: 25 }, (_, i) => `${i + 1}번 그림 설명\n${pictureMark(i + 1)}`).join('\n');
    const parts = splitDocText(many, 40_000);
    expect(parts.map((p) => pictureNumbers(p).length)).toEqual([DOC_PICTURES_PER_CHUNK, DOC_PICTURES_PER_CHUNK, 5]);
    expect(parts.join('')).toBe(many);
    expect(parts[1].startsWith(pictureMark(11))).toBe(true);
  });

  it('긴 문서를 자료 여러 개로 나눠도 그림 줄은 온전하다', () => {
    const long = Array.from({ length: 40 }, (_, i) => `## ${i + 1}. 슬라이드\n${'설명 '.repeat(120)}\n${pictureMark(i + 1)}`).join('\n');
    const parts = splitForLimit(long, 6000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap((p) => pictureNumbers(p))).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });
});

describe('그림 머리 읽기', () => {
  it('JPEG·PNG·GIF·BMP·WEBP 의 형식과 크기, 못 읽는 형식은 null', () => {
    expect(imageInfo(jpeg(640, 480))).toEqual({ format: 'jpeg', width: 640, height: 480 });
    expect(imageInfo(png(1200, 800))).toEqual({ format: 'png', width: 1200, height: 800 });
    expect(imageInfo(gif(300, 200))).toEqual({ format: 'gif', width: 300, height: 200 });
    expect(imageInfo(bmp(221, 72))).toEqual({ format: 'bmp', width: 221, height: 72 });
    const webp = new Uint8Array(32);
    webp.set(strToU8('RIFF'), 0);
    webp.set(strToU8('WEBPVP8X'), 8);
    webp.set([0xff, 0x01, 0x00, 0xc7, 0x00, 0x00], 24);
    expect(imageInfo(webp)).toEqual({ format: 'webp', width: 512, height: 200 });
    expect(imageInfo(wmf())).toBeNull();
    expect(imageInfo(strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });

  it('자르기 값: 음수는 0, 한쪽을 90% 넘게 자르는 값은 잘못 읽은 것으로 보고 자르지 않는다', () => {
    expect(cropOf(-0.1, 0, 0.2, 0)).toEqual({ l: 0, t: 0, r: 0.2, b: 0 });
    expect(cropOf(0, 0, 1, 0)).toBeUndefined();
    expect(cropOf(0, 0, 0.95, 0)).toBeUndefined();
    expect(cropOf(0.0001, 0, 0, 0.001)).toBeUndefined();
  });

  it('아주 큰 차트도 문서 읽기를 멈추지 않는다 (앞 60줄만 표로)', () => {
    const pts = Array.from({ length: 200_000 }, (_, i) => `<c:pt idx="${i}"><c:v>${i}</c:v></c:pt>`).join('');
    const xml = `<c:chartSpace><c:chart><c:plotArea><c:lineChart><c:ser><c:tx><c:v>값</c:v></c:tx><c:val><c:numRef><c:numCache>${pts}</c:numCache></c:numRef></c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>`;
    const t = chartTable(xml);
    expect(t?.rows.length).toBe(61);
    expect(t?.rows[60]).toEqual(['60', '59']);
    expect(chartTable('<c:chartSpace><c:chart>')).toBeNull();
  });

  it('작은 아이콘·가늘고 긴 줄·여러 번 나온 그림은 쓰지 않는다', () => {
    expect(usablePicture(800, 600)).toBe(true);
    expect(usablePicture(64, 64)).toBe(false);
    expect(usablePicture(221, 72)).toBe(false);
    expect(usablePicture(1600, 80)).toBe(false);
    expect(usablePicture(800, 600, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------- 워드
const W = 'xmlns:w="w" xmlns:r="r" xmlns:a="a" xmlns:pic="pic" xmlns:wp="wp" xmlns:mc="mc" xmlns:v="v" xmlns:c="c"';
const drawing = (rid: string, crop = '') =>
  `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/>${crop}<a:stretch/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const chartXml = `<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>연도별 강수량</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart>
  <c:ser><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>서울</c:v></c:pt></c:strCache></c:strRef></c:tx>
    <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>2020</c:v></c:pt><c:pt idx="1"><c:v>2021</c:v></c:pt></c:strCache></c:strRef></c:cat>
    <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>1200.5</c:v></c:pt><c:pt idx="1"><c:v>980.0000000001</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
  <c:ser><c:tx><c:v>부산</c:v></c:tx><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>1500</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
</c:barChart></c:plotArea></c:chart></c:chartSpace>`;

describe('워드 속 그림', () => {
  const doc = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:r><w:t>삼국의 영토 변화를 지도로 본다.</w:t></w:r></w:p>
    <w:p>${drawing('rIdMap', '<a:srcRect l="10000" t="0" r="10000" b="20000"/>')}</w:p>
    <w:p><w:r><w:t>로고</w:t></w:r>${drawing('rIdLogo')}</w:p>
    <w:p>${drawing('rIdLogo')}</w:p>
    <w:p>${drawing('rIdIcon')}<w:r><w:t>아이콘이 붙은 문단</w:t></w:r></w:p>
    <w:p><w:r><w:pict><v:shape><v:imagedata r:id="rIdOld"/></v:shape></w:pict></w:r></w:p>
    <w:p><w:r><w:object><v:shape><v:imagedata r:id="rIdEq"/></v:shape></w:object></w:r></w:p>
    <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>상자 글</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>상자 글</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>유물</w:t></w:r></w:p></w:tc><w:tc><w:p>${drawing('rIdCell')}</w:p></w:tc></w:tr></w:tbl>
    <w:p>${drawing('rIdLogo')}${drawing('rIdLink')}</w:p>
    <w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:sectPr/></w:body></w:document>`;
  const rels = `<?xml version="1.0"?><Relationships>
    <Relationship Id="rIdMap" Target="media/map.png"/><Relationship Id="rIdLogo" Target="media/logo.png"/>
    <Relationship Id="rIdIcon" Target="media/icon.png"/><Relationship Id="rIdOld" Target="media/old.jpeg"/>
    <Relationship Id="rIdEq" Target="media/eq.wmf"/><Relationship Id="rIdCell" Target="media/cell.gif"/>
    <Relationship Id="rIdLink" Target="https://example.com/a.png" TargetMode="External"/>
    <Relationship Id="rIdChart" Target="charts/chart1.xml"/></Relationships>`;
  const docx = zip({
    'word/document.xml': doc,
    'word/_rels/document.xml.rels': rels,
    'word/media/map.png': png(1000, 800),
    'word/media/logo.png': png(400, 400),
    'word/media/icon.png': png(32, 32),
    'word/media/old.jpeg': jpeg(600, 450),
    'word/media/eq.wmf': wmf(),
    'word/media/cell.gif': gif(320, 240),
    'word/charts/chart1.xml': chartXml,
  });

  it('그림 자리마다 표시 줄, 쓸 그림만 1부터 차례로 (자르기·예전 VML·표 칸 그림은 표 다음)', () => {
    const r = officeContent(docx);
    expect(r.kind).toBe('docx');
    // 쓰는 그림: 지도(자르기), 예전 모양 그림, 표 칸 그림. 로고(세 번 나옴)·아이콘(작음)·수식(WMF)·인터넷 그림은 뺀다
    expect(r.pictures.map((p) => [p.n, p.format, p.width, p.height])).toEqual([
      [1, 'png', 800, 640],
      [2, 'jpeg', 600, 450],
      [3, 'gif', 320, 240],
    ]);
    expect(r.pictures[0].crop).toEqual({ l: 0.1, t: 0, r: 0.1, b: 0.2 });
    expect(r.text).toBe(
      [
        '삼국의 영토 변화를 지도로 본다.',
        '',
        '[[picture 1]]',
        '로고',
        '',
        '아이콘이 붙은 문단',
        '',
        '[[picture 2]]',
        '',
        '상자 글',
        '',
        '| 유물 |  |',
        '',
        '[[picture 3]]',
        '',
        '(차트: 연도별 강수량)',
        '',
        '| 항목 | 서울 | 부산 |',
        '| 2020 | 1200.5 | 1500 |',
        '| 2021 | 980 |  |',
      ].join('\n'),
    );
  });

  it('글이 거의 없어도 그림이 있으면 넣는다 (그림만 있는 문서도 AI 가 그림을 읽는다)', async () => {
    const pictureOnly = zip({
      'word/document.xml': `<w:document ${W}><w:body><w:p>${drawing('rId1')}</w:p></w:body></w:document>`,
      'word/_rels/document.xml.rels': '<Relationships><Relationship Id="rId1" Target="media/a.jpeg"/></Relationships>',
      'word/media/a.jpeg': jpeg(1200, 900),
    });
    const r = await extractOffice(file(pictureOnly, '지도.docx'));
    expect(r.pictures).toHaveLength(1);
    expect(r.text).toBe('[[picture 1]]');
  });
});

// ---------------------------------------------------------------- PPT
describe('PPT 속 그림·차트', () => {
  const P = 'xmlns:p="p" xmlns:a="a" xmlns:r="r" xmlns:c="c"';
  const pic = (rid: string, hidden = false) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="4" name="그림"${hidden ? ' hidden="1"' : ''}/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:srcRect t="25000"/></p:blipFill></p:pic>`;
  const slide = `<?xml version="1.0"?><p:sld ${P}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="제목"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>광합성 실험</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="본문"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>빛의 세기에 따른 기포 수</a:t></a:r></a:p></p:txBody></p:sp>
    ${pic('rIdPhoto')}
    ${pic('rIdHidden', true)}
    <p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="묶음"/></p:nvGrpSpPr>${pic('rIdGroup')}</p:grpSp>
    <p:sp><p:nvSpPr><p:cNvPr id="7" name="채운 도형"/></p:nvSpPr><p:spPr><a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill></p:spPr></p:sp>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="차트"/></p:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  const pptx = zip({
    'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide,
    'ppt/slides/_rels/slide1.xml.rels': `<Relationships>
      <Relationship Id="rIdPhoto" Target="../media/image1.jpeg"/><Relationship Id="rIdHidden" Target="../media/image2.png"/>
      <Relationship Id="rIdGroup" Target="../media/image3.png"/><Relationship Id="rIdFill" Target="../media/image4.png"/>
      <Relationship Id="rIdChart" Target="../charts/chart1.xml"/></Relationships>`,
    'ppt/media/image1.jpeg': jpeg(1600, 1200),
    'ppt/media/image2.png': png(500, 500),
    'ppt/media/image3.png': png(900, 300),
    'ppt/media/image4.png': png(700, 700),
    'ppt/charts/chart1.xml': chartXml,
  });

  it('그림(자르기)·묶음 속 그림·그림으로 채운 도형·차트 값 표, 숨긴 그림은 뺀다', () => {
    const r = officeContent(pptx);
    expect(r.kind).toBe('pptx');
    expect(r.text).toBe(
      [
        '## 1. 광합성 실험',
        '- 빛의 세기에 따른 기포 수',
        '[[picture 1]]',
        '[[picture 2]]',
        '[[picture 3]]',
        '(차트: 연도별 강수량)',
        '',
        '| 항목 | 서울 | 부산 |',
        '| 2020 | 1200.5 | 1500 |',
        '| 2021 | 980 |  |',
      ].join('\n'),
    );
    expect(r.pictures.map((p) => [p.format, p.width, p.height])).toEqual([
      ['jpeg', 1600, 900],
      ['png', 900, 225],
      ['png', 700, 700],
    ]);
    // 큰 그림부터 넣는다 (한도를 넘으면 앞에서부터)
    expect(picturePriority(r.text, r.pictures)).toEqual([1, 3, 2]);
  });
});

// ---------------------------------------------------------------- 한글 (HWPX)
describe('한글(HWPX) 속 그림', () => {
  const H = 'xmlns:hs="hs" xmlns:hp="hp" xmlns:hc="hc"';
  const pic = (ref: string, caption = '', clip = '') =>
    `<hp:pic id="1"><hp:orgSz width="20000" height="10000"/>${clip}<hc:img binaryItemIDRef="${ref}" bright="0"/>${
      caption ? `<hp:caption side="BOTTOM"><hp:subList><hp:p><hp:run><hp:t>${caption}</hp:t></hp:run></hp:p></hp:subList></hp:caption>` : ''
    }</hp:pic>`;
  const sec = `<?xml version="1.0"?><hs:sec ${H}>
    <hp:p><hp:run><hp:t>세포 분열 과정</hp:t>${pic('image1', '[그림 1] 체세포 분열', '<hp:imgClip left="0" right="1000" top="0" bottom="400"/><hp:imgDim dimwidth="1000" dimheight="500"/>')}</hp:run></hp:p>
    <hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>단계</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      <hp:tc><hp:subList><hp:p><hp:run>${pic('image2')}</hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
    <hp:p><hp:run><hp:t>끝</hp:t></hp:run></hp:p></hs:sec>`;
  const hpf = `<?xml version="1.0"?><opf:package xmlns:opf="opf"><opf:manifest>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
    <opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>
    <opf:item id="image2" href="BinData/image2.jpg" media-type="image/jpg" isEmbeded="1"/>
    </opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>`;

  it('그림 자리·그림 설명·표 칸 그림(표 다음)·자르기', () => {
    const r = officeContent(
      zip({
        mimetype: 'application/hwp+zip',
        'Contents/content.hpf': hpf,
        'Contents/section0.xml': sec,
        'BinData/image1.png': png(1000, 500),
        'BinData/image2.jpg': jpeg(800, 600),
      }),
    );
    expect(r.kind).toBe('hwpx');
    expect(r.text).toBe(['세포 분열 과정', '[[picture 1]]', '[그림 1] 체세포 분열', '', '| 단계 |  |', '', '[[picture 2]]', '끝'].join('\n'));
    expect(r.pictures.map((p) => [p.format, p.width, p.height, p.crop])).toEqual([
      ['png', 1000, 400, { l: 0, t: 0, r: 0, b: 0.2 }],
      ['jpeg', 800, 600, undefined],
    ]);
  });

  it('오른쪽·아래가 없거나 0 인 imgClip 은 자르기로 보지 않는다 (그림 전체)', () => {
    const odd = `<?xml version="1.0"?><hs:sec ${H}><hp:p><hp:run><hp:t>그림</hp:t>${pic('image1', '', '<hp:imgClip left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="1000" dimheight="500"/>')}</hp:run></hp:p></hs:sec>`;
    const r = officeContent(
      zip({ mimetype: 'application/hwp+zip', 'Contents/content.hpf': hpf, 'Contents/section0.xml': odd, 'BinData/image1.png': png(3000, 2000) }),
    );
    expect(r.pictures.map((p) => [p.width, p.height, p.crop])).toEqual([[3000, 2000, undefined]]);
  });
});

// ---------------------------------------------------------------- 한글 (HWP 5.0)
describe('한글(HWP) 속 그림', () => {
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const rec = (tag: number, level: number, data: number[]) => [...u32(tag | (level << 10) | (data.length << 20)), ...data];
  const wchars = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
  const ctrlChar = (code: number, id: string) => [...u16(code), ...[...id].reverse().map((c) => c.charCodeAt(0)), ...Array(8).fill(0), ...u16(code)];
  const ctrlHeader = (id: string, level: number) => rec(71, level, [...[...id].reverse().map((c) => c.charCodeAt(0)), ...Array(20).fill(0)]);
  /** 그림 레코드: 44바이트부터 자른 뒤 남은 사각형(왼쪽·위·오른쪽·아래), 71바이트 뒤에 그림 목록 번호 */
  const picture = (level: number, bin: number, crop: [number, number, number, number] = [0, 0, 0, 0]) =>
    rec(85, level, [...Array(44).fill(0), ...crop.flatMap(u32), ...Array(11).fill(0), ...u16(bin), ...Array(5).fill(0)]);
  /** DocInfo 그림 목록 한 줄: 문서 안 그림(EMBEDDING), 저장 번호, 확장자 */
  const binData = (storage: number, ext: string) => rec(18, 0, [...u16(1), ...u16(storage), ...u16(ext.length), ...wchars(ext)]);

  const body = [
    ...rec(66, 0, Array(22).fill(0)),
    ...rec(67, 1, [...wchars('지층의 단면'), ...ctrlChar(11, 'gso '), ...u16(13)]),
    ...ctrlHeader('gso ', 1),
    ...rec(76, 2, Array(40).fill(0)),
    // 왼쪽 1/4 을 잘라 낸 그림 (원래 1024×768 픽셀 = 76800×57600 HWPUNIT)
    ...picture(3, 2, [19200, 0, 76800, 57600]),
    // 꼬리말 속 그림 (학교 로고)은 뺀다
    ...rec(66, 0, Array(22).fill(0)),
    ...rec(67, 1, [...ctrlChar(16, 'foot'), ...u16(13)]),
    ...ctrlHeader('foot', 1),
    ...rec(72, 2, Array(12).fill(0)),
    ...rec(66, 2, Array(22).fill(0)),
    ...rec(67, 3, [...ctrlChar(11, 'gso '), ...u16(13)]),
    ...ctrlHeader('gso ', 3),
    ...rec(76, 4, Array(40).fill(0)),
    ...picture(5, 1),
    ...rec(66, 0, Array(22).fill(0)),
    ...rec(67, 1, [...wchars('위로 갈수록 새로운 지층'), ...u16(13)]),
  ];
  const hwp = () => {
    const doc = CFB.utils.cfb_new();
    const header = new Uint8Array(256);
    header.set(strToU8('HWP Document File'), 0);
    header.set(u32(0x05000300), 32);
    header.set(u32(1), 36);
    CFB.utils.cfb_add(doc, '/FileHeader', header);
    // 목록 1번 = 저장 번호 7(로고), 2번 = 저장 번호 10 (파일 이름은 16진: BIN000A)
    CFB.utils.cfb_add(doc, '/DocInfo', deflateSync(new Uint8Array([...rec(16, 0, Array(26).fill(0)), ...binData(7, 'png'), ...binData(10, 'jpg')])));
    CFB.utils.cfb_add(doc, '/BodyText/Section0', deflateSync(new Uint8Array(body)));
    CFB.utils.cfb_add(doc, '/BinData/BIN0007.png', deflateSync(png(600, 600)));
    CFB.utils.cfb_add(doc, '/BinData/BIN000A.jpg', deflateSync(jpeg(1024, 768)));
    return new Uint8Array(CFB.write(doc, { type: 'array' }) as number[]);
  };

  it('그리기 개체의 그림 → DocInfo 목록 → BinData (압축)·자르기, 꼬리말 그림은 뺀다', () => {
    const r = officeContent(hwp());
    expect(r.kind).toBe('hwp');
    // 꼬리말만 있는 문단은 빈 줄
    expect(r.text).toBe(['지층의 단면', '[[picture 1]]', '', '위로 갈수록 새로운 지층'].join('\n'));
    expect(r.pictures.map((p) => [p.format, p.width, p.height, p.crop])).toEqual([['jpeg', 768, 768, { l: 0.25, t: 0, r: 0, b: 0 }]]);
  });
});

describe('자료 조각마다 넣을 그림', () => {
  const pic = (n: number, w: number, h: number): DocPicture => ({ n, format: 'png', mime: 'image/png', bytes: png(w, h), width: w, height: h });
  const pictures = [pic(1, 400, 300), pic(2, 1600, 1200), pic(3, 800, 600), pic(4, 900, 900), pic(5, 300, 300)];
  const parts = [['가', pictureMark(1), pictureMark(2), '나', pictureMark(3)].join('\n'), ['다', pictureMark(4), pictureMark(5)].join('\n')];

  it('조각마다 큰 그림부터 한도까지, 넣은 그림만 나온 차례로 1부터 (못 바꾼 그림은 건너뛰고 다음 그림)', async () => {
    const seen: number[] = [];
    const steps: Array<[number, number]> = [];
    const r = await picturesForParts(
      parts,
      pictures,
      2,
      async (p) => {
        seen.push(p.n);
        if (p.n === 4) throw new Error('이 기기가 못 읽는 그림');
        return `jpeg-${p.n}`;
      },
      (d, t) => steps.push([d, t]),
    );
    // 첫 조각: 2(가장 큼) → 3, 1 은 한도 밖. 둘째 조각: 4 는 못 바꿔서 5
    expect(seen).toEqual([2, 3, 4, 5]);
    expect(r.parts[0]).toEqual({ text: ['가', '[[picture 1]]', '나', '[[picture 2]]'].join('\n'), files: ['jpeg-2', 'jpeg-3'] });
    expect(r.parts[1]).toEqual({ text: ['다', '[[picture 1]]'].join('\n'), files: ['jpeg-5'] });
    expect(r.left).toBe(1);
    expect(steps.at(-1)).toEqual([4, 4]);
  });

  it('그림 한도가 0 이면 글만', async () => {
    const r = await picturesForParts(parts, pictures, 0, async (p) => p.n);
    expect(r.parts.map((p) => p.files)).toEqual([[], []]);
    expect(r.parts[0].text).toBe('가\n나');
    expect(r.left).toBe(5);
  });
});

// ---------------------------------------------------------------- 정리 지시·예상
describe('문서 속 그림을 AI 에 보낼 때', () => {
  it('정리 지시: 그림 자리 줄과 Picture N, 자료 그림의 page 는 그림 번호', () => {
    const p = organizePrompt({ title: '세포', kind: 'text', pictures: [1, 2], figures: 3, keyPoints: { min: 3, max: 6 } });
    expect(p).toMatch(/\[\[picture N\]\]/);
    expect(p).toMatch(/"Picture N:"/);
    expect(p).toMatch(/page: the number N of the attached picture/);
    expect(p).toMatch(/At most 3/);
    // 그림 없는 글 자료는 예전 그대로
    const plain = organizePrompt({ title: '세포', kind: 'text', keyPoints: { min: 3, max: 6 } });
    expect(plain).toMatch(/The material is text, so leave "pages" empty/);
    expect(plain).not.toMatch(/figures:/);
  });

  it('예상 에너지·다시 그리기·개념 수에 그림이 들어간다', () => {
    const without = estimateEnergy({ kind: 'text', chars: 8000 }, 'claude-sonnet-5-5', 0.001);
    const withPics = estimateEnergy({ kind: 'text', chars: 8000, images: 5 }, 'claude-sonnet-5-5', 0.001);
    expect(withPics).toBeGreaterThan(without);
    expect(redrawsWanted({ kind: 'text', canFigures: true, sourceFiguresSetting: true, featureOn: true })).toBe(false);
    expect(redrawsWanted({ kind: 'text', pictures: 2, canFigures: true, sourceFiguresSetting: true, featureOn: true })).toBe(true);
    expect(keyPointRange({ kind: 'text', chars: 3000, images: 6 }).max).toBeGreaterThan(keyPointRange({ kind: 'text', chars: 3000 }).max);
  });

  it('파일 고르기·원본 탭이 쓰는 이름', () => {
    expect(FILE_ACCEPT).toContain('.hwp');
    expect(FILE_ACCEPT).toContain('.pptx');
    expect(officeFileName('(파일: 3단원.hwp)\n\n본문')).toBe('3단원.hwp');
    expect(officeFileName('그냥 글')).toBeNull();
  });
});
