import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfError, pdfPageCount, splitPdfBySize, type PdfPartBytes } from '@/lib/pdf';

/** 쪽마다 대략 kb 만큼 무거운 PDF (쪽 내용은 잘 압축되지 않는 글자) */
async function makePdf(pageKb: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (const kb of pageKb) {
    const page = doc.addPage([595, 842]);
    let text = '';
    while (text.length < kb * 1024) text += String.fromCharCode(33 + (rnd() % 90));
    for (let i = 0, line = 0; i < text.length; i += 300, line++) {
      page.drawText(text.slice(i, i + 300).replace(/[()\\]/g, 'x'), { x: 10, y: 830 - (line % 200) * 4, size: 3, font });
    }
  }
  return doc.save();
}

async function split(bytes: Uint8Array, maxBytes: number, maxPages?: number) {
  const parts: PdfPartBytes[] = [];
  const ranges = await splitPdfBySize(bytes, maxBytes, async (p) => void parts.push(p), maxPages);
  return { parts, ranges };
}

function expectCovers(ranges: Array<{ start: number; end: number }>, total: number) {
  let next = 1;
  for (const r of ranges) {
    expect(r.start).toBe(next);
    expect(r.end).toBeGreaterThanOrEqual(r.start);
    next = r.end + 1;
  }
  expect(next - 1).toBe(total);
}

describe('큰 PDF 나누기', () => {
  it('작은 PDF 는 한 조각', async () => {
    const pdf = await makePdf([2, 2, 2]);
    const { parts, ranges } = await split(pdf, pdf.byteLength * 2);
    expect(ranges).toEqual([{ start: 1, end: 3 }]);
    expect(await pdfPageCount(parts[0].bytes)).toBe(3);
  });

  it('조각은 모두 한도 안이고, 빠짐없이 차례대로 이어진다', async () => {
    const pdf = await makePdf(Array.from({ length: 12 }, () => 12));
    const max = Math.round(pdf.byteLength / 4);
    const { parts, ranges } = await split(pdf, max);
    expect(parts.length).toBeGreaterThan(3);
    expectCovers(ranges, 12);
    for (const p of parts) {
      expect(p.bytes.byteLength).toBeLessThanOrEqual(max);
      expect(await pdfPageCount(p.bytes)).toBe(p.end - p.start + 1);
    }
  });

  it('한 쪽만 무거우면 그 근처만 더 잘게 나눈다', async () => {
    const pdf = await makePdf([4, 4, 4, 4, 40, 4, 4, 4]);
    // 무거운 쪽 하나는 들어가지만, 무거운 쪽과 다른 쪽 여럿은 함께 들어가지 않는 한도
    const one = await split(pdf, pdf.byteLength, 1);
    const heavy = one.parts[4].bytes.byteLength;
    const light = Math.max(...one.parts.filter((_, i) => i !== 4).map((p) => p.bytes.byteLength));
    const max = heavy + Math.round(light / 2);
    const { parts, ranges } = await split(pdf, max);
    expectCovers(ranges, 8);
    for (const p of parts) expect(p.bytes.byteLength).toBeLessThanOrEqual(max);
    const withHeavy = ranges.find((r) => r.start <= 5 && r.end >= 5)!;
    expect(withHeavy.end - withHeavy.start + 1).toBeLessThanOrEqual(2);
  });

  it('15쪽보다 많이 묶지 않는다', async () => {
    const pdf = await makePdf(Array.from({ length: 20 }, () => 1));
    const { ranges } = await split(pdf, pdf.byteLength * 2);
    expectCovers(ranges, 20);
    for (const r of ranges) expect(r.end - r.start + 1).toBeLessThanOrEqual(15);
  });

  it('한 쪽만으로도 한도를 넘으면 알아듣기 쉬운 오류', async () => {
    const pdf = await makePdf([2, 40, 2]);
    const one = await split(pdf, pdf.byteLength, 1);
    const tooSmall = one.parts[1].bytes.byteLength - 1;
    await expect(split(pdf, tooSmall)).rejects.toMatchObject({ code: 'page_too_big' });
    await expect(split(pdf, tooSmall)).rejects.toBeInstanceOf(PdfError);
  });
});
