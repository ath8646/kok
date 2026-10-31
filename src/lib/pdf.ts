// PDF 쪽수 세기와 쪽 나누기 (서버에서 사용)
import { PDFDocument } from 'pdf-lib';

export const PAGES_PER_CHUNK = 15;

export class PdfError extends Error {
  constructor(
    public code: 'encrypted' | 'broken' | 'page_too_big',
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

export type PdfPartBytes = { start: number; end: number; bytes: Uint8Array };

/**
 * 큰 PDF 를 AI 한 번에 보낼 수 있는 크기(maxBytes)와 쪽 수(maxPages) 안의 조각으로 나눈다.
 * 한 번만 읽고, 조각이 생길 때마다 onPart 로 넘긴다 (조각을 모두 메모리에 쌓지 않는다).
 * 쪽마다 크기가 달라 조각이 너무 크면 반으로 나눠 다시 만든다. 한 쪽만으로도 너무 크면 PdfError('page_too_big').
 */
export async function splitPdfBySize(
  bytes: Uint8Array,
  maxBytes: number,
  onPart: (part: PdfPartBytes) => Promise<void>,
  maxPages: number = PAGES_PER_CHUNK,
): Promise<Array<{ start: number; end: number }>> {
  const src = await load(bytes);
  const total = src.getPageCount();
  const avg = bytes.byteLength / Math.max(1, total);
  const per = Math.max(1, Math.min(maxPages, Math.floor(maxBytes / Math.max(1, avg))));
  const ranges: Array<{ start: number; end: number }> = [];
  const make = async (s: number, e: number) => {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(
      src,
      Array.from({ length: e - s + 1 }, (_, i) => s - 1 + i),
    );
    pages.forEach((pg) => out.addPage(pg));
    return out.save();
  };
  const emit = async (s: number, e: number): Promise<void> => {
    const part = await make(s, e);
    if (part.byteLength <= maxBytes) {
      ranges.push({ start: s, end: e });
      await onPart({ start: s, end: e, bytes: part });
      return;
    }
    if (s === e) {
      throw new PdfError('page_too_big', `${s}쪽이 너무 커서 AI에 보낼 수 없어요. 사진 해상도를 낮춰 PDF를 다시 저장해 올려 주세요.`);
    }
    const mid = Math.floor((s + e) / 2);
    await emit(s, mid);
    await emit(mid + 1, e);
  };
  for (let s = 1; s <= total; s += per) await emit(s, Math.min(total, s + per - 1));
  return ranges;
}

export function planChunks(total: number, size: number = PAGES_PER_CHUNK): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = [];
  for (let s = 1; s <= total; s += size) chunks.push({ start: s, end: Math.min(total, s + size - 1) });
  return chunks.length ? chunks : [{ start: 1, end: 1 }];
}

/** 글 나누기는 화면도 쓰니 pdf-lib 없는 파일에 있다 */
export { splitText } from './text-split';
