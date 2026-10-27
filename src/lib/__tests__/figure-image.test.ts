import { describe, expect, it, vi } from 'vitest';

// 서버 전용 표시는 시험에서는 빈 모듈로
vi.mock('server-only', () => ({}));

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FigureImageError, cutFigures, figureImageStats, homography, planCut, type Corners } from '@/lib/server/figure-image';

type Rgba = { width: number; height: number; data: Uint8ClampedArray };

async function pixelsOf(jpeg: Uint8Array): Promise<Rgba> {
  const img = await loadImage(Buffer.from(jpeg));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
}

/** 네모 영역(0~1 비율) 안에서 조건에 맞는 픽셀 비율 */
function share(p: Rgba, area: { x0: number; y0: number; x1: number; y1: number }, test: (r: number, g: number, b: number) => boolean): number {
  let hit = 0;
  let all = 0;
  for (let y = Math.floor(area.y0 * p.height); y < Math.ceil(area.y1 * p.height); y++) {
    for (let x = Math.floor(area.x0 * p.width); x < Math.ceil(area.x1 * p.width); x++) {
      const k = (y * p.width + x) * 4;
      all++;
      if (test(p.data[k], p.data[k + 1], p.data[k + 2])) hit++;
    }
  }
  return all ? hit / all : 0;
}

/** 색 덩어리의 가운데 (0~1 비율) */
function centroid(p: Rgba, test: (r: number, g: number, b: number) => boolean): { x: number; y: number; n: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const k = (y * p.width + x) * 4;
      if (test(p.data[k], p.data[k + 1], p.data[k + 2])) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return { x: n ? sx / n / p.width : -1, y: n ? sy / n / p.height : -1, n };
}

const isRed = (r: number, g: number, b: number) => r > 190 && g < 80 && b < 80;
const isBlue = (r: number, g: number, b: number) => b > 170 && r < 80 && g < 110;
const isGreen = (r: number, g: number, b: number) => g > 150 && r < 90 && b < 110;
const isOrange = (r: number, g: number, b: number) => r > 200 && g > 100 && g < 175 && b < 70;
const isNavy = (r: number, g: number, b: number) => b > 90 && r < 70 && g < 70;
const isWhite = (r: number, g: number, b: number) => r > 235 && g > 235 && b > 235;

/** 파란 사진(가운데 오른쪽 3분의 1 자리에 초록 표시)을 JPEG 로 */
function bluePhoto(): Buffer {
  const c = createCanvas(600, 300);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(20, 60, 220)';
  ctx.fillRect(0, 0, 600, 300);
  ctx.fillStyle = 'rgb(20, 200, 60)';
  ctx.fillRect(400, 100, 100, 100); // 가운데 (450,150) = 가로 0.75, 세로 0.5
  return c.encodeSync('jpeg', 95);
}

// A4 쪽(595×842pt): 빨간 네모(벡터) + 파란 사진(JPEG) + 글
const PAGE = { w: 595, h: 842 };
const RED = { x: 100, y: 500, w: 200, h: 150 }; // pdf 좌표(아래가 0)
const BLUE = { x: 150, y: 100, w: 300, h: 150 };

async function samplePdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await doc.embedJpg(bluePhoto());
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    page.drawText('Figure 1. A red box and a blue photo', { x: 60, y: 780, size: 16, font, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: RED.x, y: RED.y, width: RED.w, height: RED.h, color: rgb(0.9, 0.1, 0.1) });
    page.drawImage(jpg, { x: BLUE.x, y: BLUE.y, width: BLUE.w, height: BLUE.h });
  }
  return doc.save();
}

/** pdf 좌표의 네모 → 꼭짓점(0~1000, 위가 0) */
function cornersOf(r: { x: number; y: number; w: number; h: number }): Corners {
  const x0 = (r.x / PAGE.w) * 1000;
  const x1 = ((r.x + r.w) / PAGE.w) * 1000;
  const y0 = ((PAGE.h - r.y - r.h) / PAGE.h) * 1000;
  const y1 = ((PAGE.h - r.y) / PAGE.h) * 1000;
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

describe('PDF 쪽에서 그림 자르기', () => {
  it('벡터로 그린 네모와 들어 있는 사진을 한 번 그린 쪽에서 둘 다 자른다 (여백 조금)', async () => {
    const pdf = await samplePdf();
    const before = figureImageStats.pdfRenders;
    const t0 = performance.now();
    const [red, blue] = await cutFigures({ kind: 'pdf', bytes: pdf, page: 1 }, [cornersOf(RED), cornersOf(BLUE)]);
    const ms = performance.now() - t0;
    console.log(`[figure-image] A4 쪽 그리기 + 그림 2개 자르기: ${ms.toFixed(0)}ms`);
    expect(figureImageStats.pdfRenders - before).toBe(1);
    expect(red && blue).toBeTruthy();

    const r = await pixelsOf(red!.jpeg);
    expect(r.width).toBe(red!.width);
    expect(Math.abs(r.width / r.height - RED.w / RED.h)).toBeLessThan(0.05);
    expect(share(r, { x0: 0.15, y0: 0.15, x1: 0.85, y1: 0.85 }, isRed)).toBeGreaterThan(0.97);
    // 바깥으로 조금 넉넉하게: 가장자리 한 줄은 쪽 바탕(흰색)
    expect(share(r, { x0: 0, y0: 0, x1: 1, y1: 0.005 }, isWhite)).toBeGreaterThan(0.9);

    const b = await pixelsOf(blue!.jpeg);
    expect(Math.abs(b.width / b.height - BLUE.w / BLUE.h)).toBeLessThan(0.06);
    expect(share(b, { x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.9 }, isBlue)).toBeGreaterThan(0.95);
    const mark = centroid(b, isGreen);
    expect(Math.abs(mark.x - 0.75)).toBeLessThan(0.03);
    expect(Math.abs(mark.y - 0.5)).toBeLessThan(0.03);
  });

  it('여러 쪽 PDF 에서는 넘긴 쪽 번호(1부터)의 쪽을 그린다', async () => {
    const pdf = await samplePdf(3);
    const [cut] = await cutFigures({ kind: 'pdf', bytes: pdf, page: 3 }, [cornersOf(RED)]);
    const r = await pixelsOf(cut!.jpeg);
    expect(share(r, { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }, isRed)).toBeGreaterThan(0.95);
  });

  it('스캔한 쪽(쪽 전체가 300dpi 사진)도 그린다', async () => {
    // A4 300dpi 스캔 (2480×3508): 위쪽에 보라 네모
    const scan = createCanvas(2480, 3508);
    const ctx = scan.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2480, 3508);
    ctx.fillStyle = 'rgb(130, 40, 200)';
    ctx.fillRect(400, 600, 1200, 800);
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(scan.encodeSync('jpeg', 80));
    doc.addPage([PAGE.w, PAGE.h]).drawImage(img, { x: 0, y: 0, width: PAGE.w, height: PAGE.h });
    const pdf = await doc.save();
    const corners: Corners = [
      (400 / 2480) * 1000,
      (600 / 3508) * 1000,
      (1600 / 2480) * 1000,
      (600 / 3508) * 1000,
      (1600 / 2480) * 1000,
      (1400 / 3508) * 1000,
      (400 / 2480) * 1000,
      (1400 / 3508) * 1000,
    ];
    const t0 = performance.now();
    const [cut] = await cutFigures({ kind: 'pdf', bytes: pdf, page: 1 }, [corners]);
    console.log(`[figure-image] 스캔한 쪽 그리기 + 자르기: ${(performance.now() - t0).toFixed(0)}ms`);
    const p = await pixelsOf(cut!.jpeg);
    expect(share(p, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, (r, g, b) => r > 100 && r < 170 && g < 80 && b > 160)).toBeGreaterThan(0.95);
    expect(Math.abs(p.width / p.height - 1.5)).toBeLessThan(0.05);
  });

  it('부르는 쪽의 PDF 바이트는 그대로 남는다 (pdf.js 에 복사해서 넘긴다)', async () => {
    const pdf = await samplePdf();
    const size = pdf.byteLength;
    await cutFigures({ kind: 'pdf', bytes: pdf, page: 1 }, [cornersOf(RED)]);
    expect(pdf.byteLength).toBe(size);
    expect(pdf[0]).toBe(0x25); // %
  });

  it('없는 쪽이나 깨진 PDF 는 FigureImageError', async () => {
    const pdf = await samplePdf();
    await expect(cutFigures({ kind: 'pdf', bytes: pdf, page: 5 }, [cornersOf(RED)])).rejects.toBeInstanceOf(FigureImageError);
    await expect(cutFigures({ kind: 'pdf', bytes: new Uint8Array([1, 2, 3, 4]), page: 1 }, [cornersOf(RED)])).rejects.toBeInstanceOf(FigureImageError);
  });

  it('자를 그림이 없으면 쪽을 그리지 않는다', async () => {
    const before = figureImageStats.pdfRenders;
    expect(await cutFigures({ kind: 'pdf', bytes: new Uint8Array([1]), page: 1 }, [])).toEqual([]);
    expect(figureImageStats.pdfRenders).toBe(before);
  });
});

describe('비스듬히 찍은 사진에서 그림을 반듯하게 펴서 자르기', () => {
  // 1600×1200 사진 위의 비스듬한 주황 네모 (왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래)
  const QUAD = [
    { x: 300, y: 250 },
    { x: 1250, y: 170 },
    { x: 1360, y: 960 },
    { x: 240, y: 1010 },
  ];
  const W = 1600;
  const H = 1200;

  function tiltedPhoto(): Buffer {
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(232, 230, 222)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgb(255, 140, 0)';
    ctx.beginPath();
    QUAD.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    // 그림 안의 표시: 반듯하게 폈을 때 가로 0.8·세로 0.25 자리 (같은 원근 변환으로 사진 위 자리를 구한다)
    const m = homography(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      QUAD,
    )!;
    const at = (u: number, v: number) => {
      const z = m[6] * u + m[7] * v + m[8];
      return { x: (m[0] * u + m[1] * v + m[2]) / z, y: (m[3] * u + m[4] * v + m[5]) / z };
    };
    const mk = at(0.8, 0.25);
    ctx.fillStyle = 'rgb(20, 30, 140)';
    ctx.beginPath();
    ctx.arc(mk.x, mk.y, 40, 0, Math.PI * 2);
    ctx.fill();
    return c.encodeSync('jpeg', 92);
  }

  const corners = QUAD.flatMap((p) => [(p.x / W) * 1000, (p.y / H) * 1000]) as Corners;

  it('원근을 바로잡아 반듯한 네모로 (모서리까지 주황, 표시는 제자리)', async () => {
    const before = figureImageStats.imageDecodes;
    const t0 = performance.now();
    const [cut] = await cutFigures({ kind: 'image', bytes: tiltedPhoto() }, [corners], { pad: 0 });
    console.log(`[figure-image] 1600×1200 사진 읽기 + 원근 보정: ${(performance.now() - t0).toFixed(0)}ms (${cut?.width}×${cut?.height})`);
    expect(figureImageStats.imageDecodes - before).toBe(1);
    const p = await pixelsOf(cut!.jpeg);
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const wantW = (d(QUAD[0], QUAD[1]) + d(QUAD[3], QUAD[2])) / 2;
    const wantH = (d(QUAD[0], QUAD[3]) + d(QUAD[1], QUAD[2])) / 2;
    expect(Math.abs(p.width / p.height - wantW / wantH)).toBeLessThan(0.02);
    // 반듯해졌으면 네 모서리 근처도 주황 (비스듬하면 모서리에 바탕색이 보인다)
    for (const [x0, y0] of [
      [0.01, 0.01],
      [0.95, 0.01],
      [0.95, 0.95],
      [0.01, 0.95],
    ]) {
      expect(share(p, { x0, y0, x1: x0 + 0.04, y1: y0 + 0.04 }, isOrange)).toBeGreaterThan(0.85);
    }
    const mark = centroid(p, isNavy);
    expect(mark.n).toBeGreaterThan(100);
    expect(Math.abs(mark.x - 0.8)).toBeLessThan(0.02);
    expect(Math.abs(mark.y - 0.25)).toBeLessThan(0.02);
  });

  it('꼭짓점 순서가 거꾸로(거울) 와도 뒤집지 않고 편다', async () => {
    // 왼쪽 위 → 왼쪽 아래 → 오른쪽 아래 → 오른쪽 위 (반시계)
    const mirrored = [QUAD[0], QUAD[3], QUAD[2], QUAD[1]].flatMap((p) => [(p.x / W) * 1000, (p.y / H) * 1000]) as Corners;
    const [cut] = await cutFigures({ kind: 'image', bytes: tiltedPhoto() }, [mirrored], { pad: 0 });
    const mark = centroid(await pixelsOf(cut!.jpeg), isNavy);
    expect(Math.abs(mark.x - 0.8)).toBeLessThan(0.03);
    expect(Math.abs(mark.y - 0.25)).toBeLessThan(0.03);
  });

  it('긴 변은 maxSide 를 넘지 않는다', async () => {
    const [cut] = await cutFigures({ kind: 'image', bytes: tiltedPhoto() }, [corners], { maxSide: 300 });
    expect(Math.max(cut!.width, cut!.height)).toBeLessThanOrEqual(300);
    const p = await pixelsOf(cut!.jpeg);
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(300);
  });

  it('읽을 수 없는 사진은 FigureImageError', async () => {
    await expect(cutFigures({ kind: 'image', bytes: new Uint8Array([1, 2, 3]) }, [corners])).rejects.toBeInstanceOf(FigureImageError);
  });
});

describe('꼭짓점 읽기 (어떻게 자를지)', () => {
  const W = 2000;
  const H = 1500;

  it('반듯한 네모는 그냥 자르고, 여백을 붙인 뒤 쪽 안으로 줄인다', () => {
    const plan = planCut([100, 100, 500, 100, 500, 400, 100, 400], W, H, 0.05);
    expect(plan?.kind).toBe('rect');
    if (plan?.kind !== 'rect') return;
    expect(plan.x).toBe(Math.floor(200 - 800 * 0.05));
    expect(plan.w).toBe(Math.ceil(1000 + 800 * 0.05) - Math.floor(200 - 800 * 0.05));
    const edge = planCut([0, 0, 1000, 0, 1000, 1000, 0, 1000], W, H, 0.05);
    expect(edge).toEqual({ kind: 'rect', x: 0, y: 0, w: W, h: H });
  });

  it('2도 안쪽으로 기운 네모도 그냥 자른다', () => {
    expect(planCut([100, 100, 500, 105, 500, 400, 100, 400], W, H)?.kind).toBe('rect');
    expect(planCut([100, 100, 500, 140, 505, 400, 100, 400], W, H)?.kind).toBe('warp');
  });

  it('PDF 쪽(평평함)은 기운 꼭짓점을 줘도 바깥 네모로 자른다', () => {
    const plan = planCut([100, 100, 500, 140, 505, 400, 100, 400], W, H, 0, true);
    expect(plan).toEqual({ kind: 'rect', x: 200, y: 150, w: 810, h: 450 });
  });

  it('네모 같지 않은 꼭짓점(한 점이 엉뚱한 곳, 마주 보는 변이 크게 다름)은 원근 보정하지 않고 바깥 네모로', () => {
    // 오른쪽 아래 점이 멀리 어긋남: 각이 직각에서 25도 넘게 벗어난다
    expect(planCut([100, 100, 500, 100, 900, 700, 100, 400], W, H, 0)?.kind).toBe('rect');
    // 아래 변이 위 변의 두 배
    expect(planCut([300, 100, 600, 100, 900, 500, 100, 500], W, H, 0)?.kind).toBe('rect');
    // 조금 기운 사진 속 네모(각 10도쯤)는 원근 보정
    expect(planCut([120, 100, 520, 150, 500, 450, 100, 400], W, H, 0)?.kind).toBe('warp');
  });

  it('꼬인 꼭짓점(나비 모양)은 위치로 순서를 다시 잡는다', () => {
    // 왼쪽 위 → 오른쪽 아래 → 오른쪽 위 → 왼쪽 아래
    const plan = planCut([100, 100, 500, 400, 500, 100, 100, 400], W, H, 0);
    expect(plan?.kind).toBe('rect');
  });

  it('찌그러진(볼록하지 않은) 꼭짓점은 바깥 네모로', () => {
    const plan = planCut([100, 100, 500, 100, 300, 150, 100, 400], W, H, 0);
    expect(plan).toEqual({ kind: 'rect', x: 200, y: 150, w: 800, h: 450 });
  });

  it('숫자가 아닌 꼭짓점은 빼고 남은 점의 바깥 네모로, 쪽 밖은 쪽 안으로', () => {
    const plan = planCut([100, 100, Number.NaN, 100, 500, 400, 100, 400], W, H, 0);
    expect(plan).toEqual({ kind: 'rect', x: 200, y: 150, w: 800, h: 450 });
    const out = planCut([-500, 100, 1500, 100, 1500, 400, -500, 400], W, H, 0);
    expect(out).toEqual({ kind: 'rect', x: 0, y: 150, w: W, h: 450 });
  });

  it('너무 작거나 한 점으로 모인 그림은 자르지 않는다', () => {
    expect(planCut([500, 500, 505, 500, 505, 505, 500, 505], W, H)).toBeNull();
    expect(planCut([500, 500, 500, 500, 500, 500, 500, 500], W, H)).toBeNull();
    expect(planCut([Number.NaN, 0, 0, Number.NaN, Number.NaN, 1, 2, Number.NaN] as Corners, W, H)).toBeNull();
  });

  it('원근 변환은 네 꼭짓점을 정확히 옮긴다', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];
    const dst = [
      { x: 3, y: 2 },
      { x: 40, y: 1 },
      { x: 45, y: 30 },
      { x: 1, y: 28 },
    ];
    const m = homography(src, dst)!;
    src.forEach((p, i) => {
      const z = m[6] * p.x + m[7] * p.y + m[8];
      expect((m[0] * p.x + m[1] * p.y + m[2]) / z).toBeCloseTo(dst[i].x, 6);
      expect((m[3] * p.x + m[4] * p.y + m[5]) / z).toBeCloseTo(dst[i].y, 6);
    });
  });
});
