// PDF 쪽수 세기와 쪽 나누기 (서버에서 사용)
import { PDFDocument } from 'pdf-lib';

export const PAGES_PER_CHUNK = 15;

export class PdfError extends Error {
  constructor(
    public code: 'encrypted' | 'broken',
    message: string,
  ) {
    super(message);
  }
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (doc.isEncrypted) throw new PdfError('encrypted', '암호가 걸린 PDF는 읽을 수 없어요. 암호를 풀고 다시 올려 주세요.');
    return doc;
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw new PdfError('broken', 'PDF 파일을 열 수 없어요. 다른 프로그램에서 PDF로 다시 저장해 올려 주세요.');
  }
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await load(bytes);
  return doc.getPageCount();
}

/** 1부터 시작하는 쪽 번호 [start, end] 만 담은 새 PDF */
export async function slicePdf(bytes: Uint8Array, start: number, end: number): Promise<Uint8Array> {
  const src = await load(bytes);
  const total = src.getPageCount();
  const s = Math.max(1, start);
  const e = Math.min(total, end);
  if (s === 1 && e === total) return bytes;
  const out = await PDFDocument.create();
  const indices = Array.from({ length: e - s + 1 }, (_, i) => s - 1 + i);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

export function planChunks(total: number, size: number = PAGES_PER_CHUNK): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = [];
  for (let s = 1; s <= total; s += size) chunks.push({ start: s, end: Math.min(total, s + size - 1) });
  return chunks.length ? chunks : [{ start: 1, end: 1 }];
}

/** 글을 약 maxChars 단위로 문단 경계에서 나눈다 */
export function splitText(text: string, maxChars = 40000): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n\n', maxChars);
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}
