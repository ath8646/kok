// 그림 파일의 형식과 크기를 머리만 읽어 알아낸다 (그림을 풀지 않는다: 화면·서버·시험이 같이 쓴다).
// 문서 속 그림을 고르거나(작은 장식은 뺀다) 서버가 받은 JPEG 의 크기를 적을 때 쓴다.

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp';

export const IMAGE_MIME: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

export type ImageInfo = { format: ImageFormat; width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const i32le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function sane(format: ImageFormat, width: number, height: number): ImageInfo | null {
  return width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { format, width, height } : null;
}

function jpeg(b: Uint8Array): ImageInfo | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    // 채우는 0xFF·홀로 서는 표시(SOI·TEM·RST0~7)는 길이가 없다
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    // 그림의 시작(SOF0~15, 허프만 표 C4·JPG C8·산술 표 CC 는 빼고): 높이·너비
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return sane('jpeg', u16be(b, i + 7), u16be(b, i + 5));
    if (m === 0xd9 || m === 0xda) return null;
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X') return sane('webp', 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
  if (chunk === 'VP8 ') return sane('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  if (chunk === 'VP8L') return sane('webp', 1 + (((b[22] & 0x3f) << 8) | b[21]), 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)));
  return null;
}

/** 그림 파일이면 형식과 크기, 못 읽는 형식(WMF·EMF·TIFF·SVG …)이나 깨진 파일이면 null */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 26) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b);
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') return sane('png', u32be(b, 16), u32be(b, 20));
  if (ascii(b, 0, 4) === 'GIF8') return sane('gif', u16le(b, 6), u16le(b, 8));
  if (b[0] === 0x42 && b[1] === 0x4d) {
    // DIB 머리 크기 12 는 예전 OS/2 모양 (16비트 크기)
    const dib = i32le(b, 14);
    if (dib === 12) return sane('bmp', u16le(b, 18), u16le(b, 20));
    return sane('bmp', i32le(b, 18), Math.abs(i32le(b, 22)));
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webp(b);
  return null;
}
