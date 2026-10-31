// 문서 속 그림: 읽는 코드(docx·pptx·hwpx·hwp)가 그림을 만난 자리에 표시 줄('[[picture N]]', lib/doc-pictures.ts)을 넣고
// (PictureSink), 다 읽은 뒤 그림 파일을 꺼내 형식·크기를 머리만 보고(풀지 않는다) 쓸 그림만 남긴다 (collectPictures).
// 작은 그림(아이콘·글머리표)·가늘고 긴 줄·여러 번 나오는 그림(로고·장식)·읽을 수 없는 형식(WMF·EMF·TIFF·SVG)은 뺀다.
// 브라우저가 남은 그림을 JPEG 로 바꿔 자료 파일로 올린다 (pictureToJpeg, lib/image.ts).
import { pictureNumbers, renumberPictures } from '../doc-pictures';
import { IMAGE_MIME, imageInfo, type ImageFormat } from '../image-size';

/** 그림에서 잘라 낼 양 (0~1: 왼쪽·위·오른쪽·아래에서 각각 그 비율만큼) */
export type Crop = { l: number; t: number; r: number; b: number };

/** 그림의 픽셀 크기를 알아야 정할 수 있는 자르기 (한글 HWP: 자르기가 원래 그림 크기의 HWPUNIT 으로 적혀 있다) */
export type CropFor = (width: number, height: number) => Crop | undefined;

export type DocPicture = {
  /** 글의 표시 줄 번호 (1부터, 나온 차례) */
  n: number;
  format: ImageFormat;
  mime: string;
  bytes: Uint8Array;
  /** 자른 뒤의 크기 (픽셀) */
  width: number;
  height: number;
  crop?: Crop;
};

/** 이보다 작은 그림은 아이콘·글머리표로 본다 (짧은 변·넓이, 픽셀) */
export const PICTURE_MIN_SIDE = 60;
export const PICTURE_MIN_AREA = 150 * 150;
/** 긴 변이 짧은 변의 이만큼 넘으면 줄·띠로 본다 */
export const PICTURE_MAX_RATIO = 10;
/** 문서에 이만큼 나오는 그림은 로고·장식으로 본다 */
export const DECORATION_USES = 3;

export class PictureSink {
  readonly refs: Array<{ key: string; crop?: Crop | CropFor }> = [];
  readonly uses = new Map<string, number>();
  private seen = new Map<string, number>();

  /** 그림 하나를 만났다: 처음 나온 그림이면 새 번호(그 자리에 표시 줄을 넣는다), 또 나온 그림이면 null */
  add(key: string, crop?: Crop | CropFor): number | null {
    this.uses.set(key, (this.uses.get(key) ?? 0) + 1);
    if (this.seen.has(key)) return null;
    this.refs.push({ key, ...(crop ? { crop } : {}) });
    this.seen.set(key, this.refs.length);
    return this.refs.length;
  }
}

/**
 * 자르기 값 (각각 0~1, 음수는 0: 워드의 '넓히기'). 한쪽을 90% 넘게 자르거나 읽을 수 없는 값이면 잘못 읽은 것으로 보고 자르지 않는다.
 * 거의 다 잘라 내거나 안 자르면 없음
 */
export function cropOf(l: number, t: number, r: number, b: number): Crop | undefined {
  if ([l, t, r, b].some((v) => !Number.isFinite(v) || v > 0.9)) return undefined;
  const c = (v: number) => Math.round(Math.max(0, v) * 10000) / 10000;
  const crop = { l: c(l), t: c(t), r: c(r), b: c(b) };
  if (crop.l + crop.r >= 0.95 || crop.t + crop.b >= 0.95) return undefined;
  if (crop.l < 0.002 && crop.t < 0.002 && crop.r < 0.002 && crop.b < 0.002) return undefined;
  return crop;
}

/** 쓸 만한 그림인지 (크기·모양·나온 수) */
export function usablePicture(width: number, height: number, uses = 1): boolean {
  if (uses >= DECORATION_USES) return false;
  const lo = Math.min(width, height);
  const hi = Math.max(width, height);
  return lo >= PICTURE_MIN_SIDE && width * height >= PICTURE_MIN_AREA && hi / lo <= PICTURE_MAX_RATIO;
}

/**
 * 읽은 글과 그림 자리 → 쓸 그림만 남긴 글과 그림 (번호는 남은 그림의 나온 차례로 1, 2, 3 …).
 * load: 그림 파일 (못 꺼내면 null)
 */
export function collectPictures(text: string, sink: PictureSink, load: (key: string) => Uint8Array | null): { text: string; pictures: DocPicture[] } {
  const kept: DocPicture[] = [];
  sink.refs.forEach((ref, i) => {
    let bytes: Uint8Array | null = null;
    try {
      bytes = load(ref.key);
    } catch {
      bytes = null;
    }
    const info = bytes ? imageInfo(bytes) : null;
    if (!bytes || !info) return;
    const crop = typeof ref.crop === 'function' ? ref.crop(info.width, info.height) : ref.crop;
    const width = Math.round(info.width * (crop ? 1 - crop.l - crop.r : 1));
    const height = Math.round(info.height * (crop ? 1 - crop.t - crop.b : 1));
    if (!usablePicture(width, height, sink.uses.get(ref.key) ?? 1)) return;
    kept.push({ n: i + 1, format: info.format, mime: IMAGE_MIME[info.format], bytes, width, height, ...(crop ? { crop } : {}) });
  });
  const out = renumberPictures(
    text,
    kept.map((p) => p.n),
  );
  return { text: out, pictures: kept.map((p, i) => ({ ...p, n: i + 1 })) };
}

/** 글 조각에 든 그림을 넣을 차례: 큰 그림부터 (같으면 먼저 나온 것). 그림 수 한도를 넘으면 앞에서부터 쓴다 */
export function picturePriority(text: string, pictures: readonly DocPicture[]): number[] {
  const byN = new Map(pictures.map((p) => [p.n, p]));
  return pictureNumbers(text)
    .filter((n) => byN.has(n))
    .sort((a, b) => {
      const pa = byN.get(a)!;
      const pb = byN.get(b)!;
      return pb.width * pb.height - pa.width * pa.height || a - b;
    });
}

/**
 * 자료 조각마다 넣을 그림을 정해 바꾼다: 큰 그림부터 max 장까지 (바꾸지 못한 그림은 건너뛰고 다음 그림),
 * 글의 그림 줄은 넣은 그림만 나온 차례로 1부터 다시 매긴다. convert: 그림 → 올릴 파일 (브라우저는 JPEG).
 * left: 한도 때문에 넣지 못한 그림 수 (알려 준다)
 */
export async function picturesForParts<T>(
  parts: readonly string[],
  pictures: readonly DocPicture[],
  max: number,
  convert: (p: DocPicture) => Promise<T>,
  progress?: (done: number, total: number) => void,
): Promise<{ parts: Array<{ text: string; files: T[] }>; left: number }> {
  const byN = new Map(pictures.map((p) => [p.n, p]));
  const orders = parts.map((t) => picturePriority(t, pictures));
  const total = orders.reduce((a, o) => a + Math.min(o.length, Math.max(0, max)), 0);
  let done = 0;
  let left = 0;
  const out: Array<{ text: string; files: T[] }> = [];
  for (let i = 0; i < parts.length; i++) {
    const ok: number[] = [];
    const files = new Map<number, T>();
    for (const n of orders[i]) {
      if (ok.length >= max) {
        left++;
        continue;
      }
      try {
        files.set(n, await convert(byN.get(n)!));
        ok.push(n);
      } catch {
        // 이 기기가 못 읽는 그림 (뺀다)
      }
      progress?.(++done, total);
    }
    ok.sort((a, b) => a - b);
    out.push({ text: renumberPictures(parts[i], ok), files: ok.map((n) => files.get(n)!) });
  }
  return { parts: out, left };
}
