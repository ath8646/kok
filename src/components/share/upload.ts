'use client';
// 자료 공유 파일 올리기 (브라우저): 미리보기 그림 만들기(사진은 작게, PDF 는 첫 쪽), 올리기 자리 받기, 한 번짜리 주소로 올리기.
// 서버는 글을 만들 때 올린 파일이 내 자리인지·크기·앞부분 바이트를 다시 본다 (/api/share/posts)
import { api } from '@/components/ui';
import { sb } from '@/lib/data';
import { shrinkImage } from '@/lib/image';
import { shareContentType, shareKindOf, type ShareKind } from '@/lib/share';

const WORKER_SRC = '/pdfjs/pdf.worker.min.mjs';
/** 미리보기 그림의 긴 변 */
const PREVIEW_SIDE = 640;

/** 붙일 파일 (화면에서 고른 것) */
export type Pick = { key: string; file: File; kind: ShareKind };

/** 서버에 넘길 올린 파일 */
export type Uploaded = { path: string; previewPath: string | null; name: string; pages: number | null };

/** 파일 이름으로 붙일 수 있는지 보고 고른 파일로 */
export function toPicks(files: File[]): { picks: Pick[]; refused: string[] } {
  const picks: Pick[] = [];
  const refused: string[] = [];
  for (const file of files) {
    const kind = shareKindOf(file.name);
    if (!kind) refused.push(file.name);
    else picks.push({ key: crypto.randomUUID().slice(0, 12), file, kind });
  }
  return { picks, refused };
}

/** PDF 첫 쪽 그림과 쪽 수 (못 읽으면 null) */
async function pdfFirstPage(file: File): Promise<{ blob: Blob | null; pages: number | null }> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = PREVIEW_SIDE / Math.max(base.width, base.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return { blob: null, pages: doc.numPages };
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      return { blob, pages: doc.numPages };
    } finally {
      void doc.loadingTask.destroy();
    }
  } catch {
    return { blob: null, pages: null };
  }
}

/** 미리보기 그림 (사진: 작게 줄인 것, PDF: 첫 쪽, 그 밖: 없음) */
async function previewOf(p: Pick): Promise<{ blob: Blob | null; pages: number | null }> {
  if (p.kind === 'image') {
    try {
      return { blob: await shrinkImage(p.file, PREVIEW_SIDE, 0.8), pages: null };
    } catch {
      return { blob: null, pages: null };
    }
  }
  if (p.kind === 'pdf') return pdfFirstPage(p.file);
  return { blob: null, pages: null };
}

type Ticket = { key: string; path: string; token: string; contentType: string; previewPath: string | null; previewToken: string | null };

/**
 * 고른 파일을 글(postId)의 자리에 올린다. onStep(끝낸 수, 모두): 화면의 '올리는 중 2/5'.
 * 저장소가 거절하면(크기 등) 한국어로 던진다
 */
export async function uploadPicks(postId: string, picks: Pick[], onStep?: (done: number, total: number) => void): Promise<Uploaded[]> {
  if (!picks.length) return [];
  onStep?.(0, picks.length);
  const previews = await Promise.all(picks.map(previewOf));
  const { uploads } = await api<{ uploads: Ticket[] }>('/api/share/uploads', {
    method: 'POST',
    body: JSON.stringify({
      postId,
      files: picks.map((p, i) => ({ key: p.key, name: p.file.name, size: p.file.size, preview: !!previews[i].blob })),
    }),
  });
  const bucket = sb().storage.from('community');
  const out: Uploaded[] = [];
  for (const [i, p] of picks.entries()) {
    const t = uploads.find((u) => u.key === p.key);
    if (!t) throw new Error('파일을 올릴 준비를 하지 못했어요. 다시 해 주세요.');
    const { error } = await bucket.uploadToSignedUrl(t.path, t.token, p.file, { contentType: t.contentType || shareContentType(p.kind, p.file.name) });
    if (error) {
      const tooBig = /exceed|too large|maximum allowed size|payload/i.test(error.message ?? '') || (error as { status?: number }).status === 413;
      throw new Error(tooBig ? `'${p.file.name}' 파일이 너무 커서 올리지 못했어요.` : '파일을 올리지 못했어요. 인터넷 연결을 확인해 주세요.');
    }
    let previewPath: string | null = null;
    const blob = previews[i].blob;
    if (blob && t.previewPath && t.previewToken) {
      const pv = await bucket.uploadToSignedUrl(t.previewPath, t.previewToken, blob, { contentType: 'image/jpeg' });
      // 미리보기는 없어도 된다 (파일 아이콘으로 보인다)
      if (!pv.error) previewPath = t.previewPath;
    }
    out.push({ path: t.path, previewPath, name: p.file.name, pages: previews[i].pages });
    onStep?.(i + 1, picks.length);
  }
  return out;
}

/** 받은 자료의 파일 주소 (10분). download 면 원래 이름으로 내려받는 주소 */
export async function fileUrl(fileId: string, download: boolean): Promise<{ url: string; name: string; kind: ShareKind }> {
  return api<{ url: string; name: string; kind: ShareKind }>(`/api/share/files/${fileId}`, { method: 'POST', body: JSON.stringify({ download }) });
}

/** 받은 파일을 File 로 (KOK 으로 정리할 때 자료 넣기에 그대로 넘긴다) */
export async function fileAsFile(fileId: string): Promise<File> {
  const { url, name, kind } = await fileUrl(fileId, false);
  const res = await fetch(url);
  if (!res.ok) throw new Error('파일을 받지 못했어요. 다시 해 주세요.');
  const blob = await res.blob();
  return new File([blob], name, { type: shareContentType(kind, name) });
}
