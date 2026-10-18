import { describe, expect, it } from 'vitest';
import { MIN_TEXT_CHARS, checkText, fileKind, groupFiles, isSubmitKey, splitComposer, titleFromName, type PlanLimits } from '@/lib/quick-add';

const FREE: PlanLimits = { pdfPages: 20, images: 5, textChars: 20000, fileMb: 20, fileDays: 7 };
const MB = 1024 * 1024;
const f = (name: string, type = '', size = 1000) => ({ name, type, size });

describe('quick-add: 파일 종류', () => {
  it('확장자와 MIME 으로 알아본다', () => {
    expect(fileKind(f('학습지.pdf'))).toBe('pdf');
    expect(fileKind(f('scan', 'application/pdf'))).toBe('pdf');
    expect(fileKind(f('IMG_1234.HEIC'))).toBe('image');
    expect(fileKind(f('photo', 'image/jpeg'))).toBe('image');
    expect(fileKind(f('필기.md'))).toBe('text');
    expect(fileKind(f('memo', 'text/plain'))).toBe('text');
    expect(fileKind(f('보고서.hwp'))).toBe('office');
    expect(fileKind(f('slides.pptx'))).toBe('office');
    expect(fileKind(f('song.mp3', 'audio/mpeg'))).toBe('other');
  });

  it('파일 이름을 제목으로 쓰되 사진 번호 이름은 버린다', () => {
    expect(titleFromName('3단원_광합성.pdf')).toBe('3단원 광합성');
    expect(titleFromName('IMG_1234.jpg')).toBe('');
    expect(titleFromName('Screenshot 2026-10-18 101010.png')).toBe('');
    expect(titleFromName('PXL_20261018_101010.jpg')).toBe('');
    expect(titleFromName('20261018_101010.jpg')).toBe('');
    expect(titleFromName('KakaoTalk_20261018_101010123.jpg')).toBe('');
    expect(titleFromName('2학기 중간 범위.pdf')).toBe('2학기 중간 범위');
    expect(titleFromName('스크린샷 1.png')).toBe('');
    expect(titleFromName('a'.repeat(80) + '.pdf')).toHaveLength(60);
  });
});

describe('quick-add: 파일 묶기', () => {
  it('PDF 는 하나씩, 사진은 한 묶음, 글 파일은 따로', () => {
    const g = groupFiles([f('a.pdf'), f('1.jpg'), f('2.jpg'), f('note.txt'), f('b.pdf')], FREE);
    expect(g.pdfs.map((x) => x.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(g.imageGroups.map((grp) => grp.map((x) => x.name))).toEqual([['1.jpg', '2.jpg']]);
    expect(g.textFiles.map((x) => x.name)).toEqual(['note.txt']);
    expect(g.rejected).toEqual([]);
  });

  it('사진이 요금제 한도보다 많으면 나눠 묶는다', () => {
    const photos = Array.from({ length: 12 }, (_, i) => f(`${i}.jpg`, 'image/jpeg'));
    const g = groupFiles(photos, FREE);
    expect(g.imageGroups.map((grp) => grp.length)).toEqual([5, 5, 2]);
  });

  it('못 읽는 파일과 너무 큰 파일은 이유와 함께 뺀다', () => {
    const g = groupFiles(
      [f('big.pdf', 'application/pdf', 21 * MB), f('empty.pdf', 'application/pdf', 0), f('x.hwp'), f('y.zip'), f('huge.jpg', 'image/jpeg', 41 * MB)],
      FREE,
    );
    expect(g.pdfs).toEqual([]);
    expect(g.imageGroups).toEqual([]);
    expect(g.rejected.map((r) => r.name)).toEqual(['big.pdf', 'empty.pdf', 'x.hwp', 'y.zip', 'huge.jpg']);
    expect(g.rejected[0].reason).toContain('20MB');
    expect(g.rejected[2].reason).toContain('PDF로 저장');
  });

  it('사진은 줄여서 올리므로 파일 한도보다 커도 40MB 까지 받는다', () => {
    const g = groupFiles([f('phone.jpg', 'image/jpeg', 30 * MB)], FREE);
    expect(g.imageGroups).toHaveLength(1);
  });
});

describe('quick-add: 입력한 글', () => {
  it('너무 짧거나 길면 알려 준다', () => {
    expect(checkText('짧아요', FREE)).toEqual({ ok: false, reason: expect.stringContaining(`${MIN_TEXT_CHARS}자 이상`) });
    expect(checkText('가'.repeat(20001), FREE)).toEqual({ ok: false, reason: expect.stringContaining('20,000자') });
    const ok = checkText('  광합성은 빛에너지를 이용해 포도당을 만드는 과정이에요.\r\n  ', FREE);
    expect(ok).toEqual({ ok: true, text: '광합성은 빛에너지를 이용해 포도당을 만드는 과정이에요.' });
  });

  it('파일을 붙였으면 짧은 글은 제목, 긴 글은 따로 한 자료', () => {
    expect(splitComposer('세포 단원', 2)).toEqual({ textAsSource: null, titleForFiles: '세포 단원' });
    const long = '세포막은 물질의 출입을 조절하고, 핵은 유전 정보를 담고 있어요.';
    expect(splitComposer(long, 1)).toEqual({ textAsSource: long, titleForFiles: '' });
    expect(splitComposer('  글만 있어요  ', 0)).toEqual({ textAsSource: '글만 있어요', titleForFiles: '' });
  });

  it('엔터는 보내고, Shift+엔터와 한글 조합 중 엔터는 보내지 않는다', () => {
    expect(isSubmitKey({ key: 'Enter', shiftKey: false })).toBe(true);
    expect(isSubmitKey({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isSubmitKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(isSubmitKey({ key: 'Enter', shiftKey: false, keyCode: 229 })).toBe(false);
    expect(isSubmitKey({ key: 'a', shiftKey: false })).toBe(false);
  });
});

describe('카드 미리보기 글', () => {
  it('수식을 읽을 수 있는 글자로 바꾼다', async () => {
    const { previewText, texToText } = await import('@/lib/richtext');
    expect(previewText('식물은 $CO_2$와 물을 포도당으로 바꾼다.')).toBe('식물은 CO₂와 물을 포도당으로 바꾼다.');
    expect(texToText('6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2')).toBe('6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂');
    expect(texToText('x^2 + y^{2} = r^2')).toBe('x² + y² = r²');
    expect(texToText('\\frac{1}{2} \\times 3')).toBe('1/2 × 3');
    expect(texToText('Fe^{3+}')).toBe('Fe³⁺');
    expect(texToText('90^\\circ')).toBe('90°');
    expect(texToText('\\text{속력} = \\frac{거리}{시간}')).toBe('속력 = 거리/시간');
    expect(previewText('**중요** 첫 줄\n둘째 줄')).toBe('중요 첫 줄 둘째 줄');
    expect(previewText('$5 와 $10 은 돈')).toBe('$5 와 $10 은 돈');
  });
});
