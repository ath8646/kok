// 사진·그림을 올리기 전에 줄이고 JPEG 로 바꾼다 (저장 공간과 AI 비용을 아낀다)

/** 사진: 긴 변 2000px 의 JPEG */
export async function shrinkImage(file: File, maxSide = 2000, quality = 0.85): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`'${file.name}' 사진을 읽지 못했어요. JPG나 PNG로 바꿔서 올려 주세요.`);
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('사진을 줄이지 못했어요.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('사진을 줄이지 못했어요.');
  return blob;
}

/**
 * 문서(한글·워드·PPT)에서 꺼낸 그림 → 올릴 JPEG: 자르기를 하고 긴 변 maxSide 로 줄인다 (투명한 곳은 흰 바탕).
 * Claude 가 줄이지 않고 보는 크기(긴 변 1568)에 맞춘다
 */
export async function pictureToJpeg(
  p: { bytes: Uint8Array; mime: string; width?: number; height?: number; crop?: { l: number; t: number; r: number; b: number } },
  maxSide = 1568,
  quality = 0.85,
): Promise<Blob> {
  const c = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const source = new Blob([new Uint8Array(p.bytes)], { type: p.mime });
  // 아주 큰 그림은 풀 때부터 줄인다 (폰 메모리: 자르기는 비율이라 줄인 그림에도 그대로 맞는다). 줄이기를 모르는 브라우저는 그냥 푼다.
  // 한쪽 길이만 준다: 사진의 회전 표시(EXIF)로 가로세로가 바뀌어도 비율은 그대로 (나머지 줄이기는 아래 캔버스가)
  const k = p.width && p.height ? maxSide / Math.max(p.width, p.height) : 1;
  const full = p.width && p.height ? { w: p.width / Math.max(0.1, 1 - c.l - c.r), h: p.height / Math.max(0.1, 1 - c.t - c.b) } : null;
  const bitmap =
    full && k < 0.5
      ? await createImageBitmap(
          source,
          full.w >= full.h
            ? { resizeWidth: Math.max(1, Math.round(full.w * k)), resizeQuality: 'high' }
            : { resizeHeight: Math.max(1, Math.round(full.h * k)), resizeQuality: 'high' },
        )
      : await createImageBitmap(source);
  const sx = Math.round(bitmap.width * c.l);
  const sy = Math.round(bitmap.height * c.t);
  const sw = Math.max(1, Math.round(bitmap.width * (1 - c.l - c.r)));
  const sh = Math.max(1, Math.round(bitmap.height * (1 - c.t - c.b)));
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('그림을 바꾸지 못했어요.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('그림을 바꾸지 못했어요.');
  return blob;
}
