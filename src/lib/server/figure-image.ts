// 자료의 그림을 원본에서 잘라 낸다 (PDF 의 한 쪽 또는 사진 한 장). AI 를 부르지 않는다.
// 정리 단계에서 AI 가 알려 준 그림의 네 꼭짓점(0~1000, 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래)으로 자르고,
// 비스듬히 찍힌 사진은 반듯한 네모로 편다(원근 보정). 쪽·사진은 한 번만 그리거나 읽고, 그 위의 그림을 모두 자른다.
// AI 가 준 꼭짓점은 조금 어긋날 수 있어서 바깥으로 조금 넉넉하게 자른다. 꼭짓점이 이상하면 바깥 네모로 자른다.
//
// 쓰는 곳: 정리 단계(파이프라인)가 AI 에 보낸 PDF 조각·사진을 그대로 넘긴다. page 는 넘긴 PDF 안에서의 쪽 번호(1부터)다.
// 쪽·사진을 읽지 못하면 FigureImageError 를 던지고(부르는 쪽이 잡는다), 그림 하나를 못 자르면 그 자리는 null 이다.
//
// 배포(Vercel): pdfjs-dist·@napi-rs/canvas 는 next.config.ts 의 serverExternalPackages 로 묶지 않고 쓰고,
// pdf.js 의 글꼴·CMap·wasm 파일은 outputFileTracingIncludes 로 함수에 같이 싣는다.
// 이 모듈을 새 라우트에서 쓰면 그 라우트를 next.config.ts 의 PIPELINE_ROUTES 에 더한다 (글꼴 파일 싣기, 안 쓰는 pdf.js 파일 빼기).
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Canvas } from '@napi-rs/canvas';

/** 그림의 네 꼭짓점 (0~1000): 왼쪽 위 x,y · 오른쪽 위 x,y · 오른쪽 아래 x,y · 왼쪽 아래 x,y */
export type Corners = [number, number, number, number, number, number, number, number];
/** 자를 원본: PDF(조각) 와 그 안의 쪽 번호(1부터), 또는 사진 한 장 */
export type FigureSource = { kind: 'pdf'; bytes: Uint8Array; page: number } | { kind: 'image'; bytes: Uint8Array };
export type Cut = { jpeg: Uint8Array; width: number; height: number };
export type CutOptions = {
  /** 그림 크기에 대한 여백 비율 (기본 0.03) */
  pad?: number;
  /** 잘라 낸 그림의 긴 변 상한 (기본 1400) */
  maxSide?: number;
  /** JPEG 품질 0~1 (기본 0.85) */
  quality?: number;
};

/** 쪽·사진을 읽지 못했다 (PDF 가 깨졌거나, 쪽이 없거나, 사진 형식을 모른다) */
export class FigureImageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FigureImageError';
  }
}

/** PDF 쪽을 그릴 때 긴 변 (픽셀). 글자가 또렷하면서 메모리는 30MB 안 */
const PAGE_LONG_SIDE = 2000;
/** 쪽이 아주 작아도 이 배율보다 크게 그리지 않는다 */
const MAX_PAGE_SCALE = 8;
/** 사진을 읽을 때 긴 변 상한 (아주 큰 사진도 메모리를 넘지 않게) */
const PHOTO_LONG_SIDE = 3000;
/** PDF 안의 그림 한 장의 픽셀 상한: 300dpi 로 스캔한 쪽(약 900만)은 그리고, 터무니없이 큰 그림은 건너뛴다(메모리) */
const MAX_IMAGE_PIXELS = 40_000_000;
/** PDF 를 열고 쪽을 그리는 시간 상한 (이상한 PDF 때문에 정리 단계가 멈추지 않게) */
const RENDER_TIMEOUT_MS = 20_000;
/** 그림의 변이 쪽 긴 변의 이 비율보다 짧으면 꼭짓점을 믿지 않는다 */
const MIN_SIDE = 0.02;
/** 꼭짓점이 쪽 밖으로 이만큼(0~1000 기준)까지 나간 것은 받는다 (사진 가장자리에 걸친 그림) */
const OUT_OF_RANGE = 100;
/** 변이 가로·세로에서 이 각도 안이면 그냥 네모로 자른다 */
const STRAIGHT_DEG = 2;
/** 원근 보정을 할 네모의 조건: 각 꼭짓점의 각이 직각에서 이 각도 안이고, 마주 보는 변의 길이 비가 이 배 안 (그 밖은 AI 가 꼭짓점을 잘못 준 것) */
const TILT_MAX_DEG = 25;
const OPPOSITE_RATIO_MAX = 1.6;

/** 시험용: 쪽을 그리거나 사진을 읽은 횟수 */
export const figureImageStats = { pdfRenders: 0, imageDecodes: 0 };

// ------------------------------------------------------------- 라이브러리 (처음 쓸 때 한 번만 읽는다)
type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type CanvasLib = typeof import('@napi-rs/canvas');

let pdfjsPromise: Promise<Pdfjs> | null = null;
let canvasPromise: Promise<CanvasLib> | null = null;

function loadCanvas(): Promise<CanvasLib> {
  canvasPromise ??= import('@napi-rs/canvas').catch((e) => {
    canvasPromise = null;
    throw e;
  });
  return canvasPromise;
}

function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= (async () => {
    // pdf.js 가 그림 그리기에 쓰는 DOMMatrix·Path2D 를 @napi-rs/canvas 로 채우게 먼저 읽어 둔다
    await loadCanvas();
    // 일꾼(worker)을 따로 띄우지 않고 같은 스레드에서 돌린다 (서버에는 Web Worker 가 없다).
    // 문자열로 바로 읽어야 배포할 때 이 파일도 함수에 같이 실린다
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })().catch((e) => {
    pdfjsPromise = null;
    throw e;
  });
  return pdfjsPromise;
}

/** pdf.js 가 읽는 글꼴·CMap·wasm·색 프로필 폴더 (끝에 / 가 있어야 한다) */
type PdfAssets = { cMapUrl: string; standardFontDataUrl: string; wasmUrl: string; iccUrl: string };
let assetsCache: PdfAssets | null = null;

function pdfAssets(): PdfAssets {
  if (assetsCache) return assetsCache;
  const candidates: string[] = [];
  try {
    // 묶지 않고 쓰는 패키지라 실행할 때 node_modules 에서 찾는다
    candidates.push(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')));
  } catch {
    /* 아래 자리로 찾는다 */
  }
  candidates.push(path.join(process.cwd(), 'node_modules', 'pdfjs-dist'));
  const root = candidates.find((dir) => fs.existsSync(path.join(dir, 'cmaps')) && fs.existsSync(path.join(dir, 'standard_fonts')));
  if (!root) throw new FigureImageError('pdf.js 글꼴 파일을 찾지 못했어요.');
  // pdf.js 는 폴더 주소가 / 로 끝나야 받는다 (윈도에서도 /)
  const dir = (name: string) => `${path.join(root, name)}/`;
  assetsCache = { cMapUrl: dir('cmaps'), standardFontDataUrl: dir('standard_fonts'), wasmUrl: dir('wasm'), iccUrl: dir('iccs') };
  return assetsCache;
}

// ------------------------------------------------------------- 쪽 그리기·사진 읽기
/** 그림을 자를 바탕: 그린 쪽(또는 읽은 사진)과, 원근 보정에 쓸 픽셀 (처음 쓸 때 한 번 읽는다) */
type Page = { canvas: Canvas; width: number; height: number; pixels: () => Uint8ClampedArray };

function pageOf(canvas: Canvas): Page {
  let data: Uint8ClampedArray | null = null;
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    pixels: () => (data ??= canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data),
  };
}

async function renderPdfPage(bytes: Uint8Array, pageNumber: number): Promise<Page> {
  const pdfjs = await loadPdfjs();
  const { createCanvas } = await loadCanvas();
  const task = pdfjs.getDocument({
    // pdf.js 가 받은 버퍼를 일꾼에게 넘겨 버리므로(부르는 쪽 버퍼가 비지 않게) 복사해서 준다
    data: bytes.slice(),
    ...pdfAssets(),
    cMapPacked: true,
    // 서버에는 글꼴을 설치하지 않는다: PDF 에 든 글꼴과 pdf.js 기본 글꼴로 그린다
    useSystemFonts: false,
    disableFontFace: true,
    maxImageSize: MAX_IMAGE_PIXELS,
    verbosity: 0,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FigureImageError('PDF 쪽을 그리는 데 너무 오래 걸려요.')), RENDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([drawPage(task, pageNumber, createCanvas), timeout]);
  } catch (e) {
    if (e instanceof FigureImageError) throw e;
    throw new FigureImageError('PDF 쪽을 그리지 못했어요.', { cause: e });
  } finally {
    clearTimeout(timer);
    // 시간이 넘었으면 그리던 것도 여기서 멈춘다
    await task.destroy().catch(() => {});
  }
}

/** 문서를 열고 쪽 하나를 흰 바탕에 그린다 (긴 변 PAGE_LONG_SIDE) */
async function drawPage(task: ReturnType<Pdfjs['getDocument']>, pageNumber: number, createCanvas: CanvasLib['createCanvas']): Promise<Page> {
  const doc = await task.promise;
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
    throw new FigureImageError(`쪽 번호가 PDF 밖이에요: ${pageNumber} / ${doc.numPages}`);
  }
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(PAGE_LONG_SIDE / Math.max(base.width, base.height, 1), MAX_PAGE_SCALE);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: '#ffffff' }).promise;
  page.cleanup();
  figureImageStats.pdfRenders++;
  return pageOf(canvas);
}

async function decodeImage(bytes: Uint8Array): Promise<Page> {
  const { createCanvas, loadImage } = await loadCanvas();
  let img: Awaited<ReturnType<CanvasLib['loadImage']>>;
  try {
    // 글(경로·주소)이 아니라 바이트로만 읽는다
    img = await loadImage(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (e) {
    throw new FigureImageError('사진을 읽지 못했어요.', { cause: e });
  }
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) throw new FigureImageError('사진 크기를 알 수 없어요.');
  const s = Math.min(1, PHOTO_LONG_SIDE / Math.max(iw, ih));
  const canvas = createCanvas(Math.max(1, Math.round(iw * s)), Math.max(1, Math.round(ih * s)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  figureImageStats.imageDecodes++;
  return pageOf(canvas);
}

// ------------------------------------------------------------- 어떻게 자를지 (순수 계산, 시험 있음)
type Pt = { x: number; y: number };

/** 자르는 방법: 네모(쪽 픽셀 좌표) 또는 원근 보정(쪽 위의 네 꼭짓점 → 반듯한 네모) */
export type CutPlan =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'warp'; quad: [Pt, Pt, Pt, Pt]; outW: number; outH: number; padW: number; padH: number };

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** 화면에서 시계 방향(왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래)으로 도는 볼록한 네모인지 */
function clockwiseConvex(q: Pt[]): boolean {
  for (let i = 0; i < 4; i++) {
    if (cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) <= 0) return false;
  }
  return true;
}

/** 꼭짓점 순서가 뒤집혀(거울) 왔을 때: 위치로 왼쪽 위·오른쪽 위·오른쪽 아래·왼쪽 아래를 다시 고른다 */
function reorder(q: Pt[]): Pt[] {
  const by = (f: (p: Pt) => number) => q.reduce((best, p) => (f(p) > f(best) ? p : best));
  const tl = by((p) => -(p.x + p.y));
  const br = by((p) => p.x + p.y);
  const tr = by((p) => p.x - p.y);
  const bl = by((p) => p.y - p.x);
  return [tl, tr, br, bl];
}

/** 변이 가로·세로와 거의 나란한 네모인지 (그러면 그냥 자른다) */
function straight(q: Pt[]): boolean {
  const t = Math.tan((STRAIGHT_DEG * Math.PI) / 180);
  const [tl, tr, br, bl] = q;
  const flat = (a: Pt, b: Pt, dir: 1 | -1) => (b.x - a.x) * dir > 0 && Math.abs(b.y - a.y) <= t * Math.abs(b.x - a.x);
  const upright = (a: Pt, b: Pt, dir: 1 | -1) => (b.y - a.y) * dir > 0 && Math.abs(b.x - a.x) <= t * Math.abs(b.y - a.y);
  return flat(tl, tr, 1) && upright(tr, br, 1) && flat(br, bl, -1) && upright(bl, tl, -1);
}

/**
 * 비스듬히 찍힌 사진 속 네모처럼 보이는지: 네 각이 직각에 가깝고 마주 보는 변의 길이가 비슷하다.
 * AI 가 꼭짓점 하나를 엉뚱한 곳에 주면(순서가 꼬이거나 한 점만 어긋남) 원근 보정이 그림을 심하게 찌그러뜨려서, 그런 네모는 바깥 네모로 자른다
 */
function tiltedRect(q: Pt[]): boolean {
  const [tl, tr, br, bl] = q;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (Math.max(top, bottom) / Math.min(top, bottom) > OPPOSITE_RATIO_MAX) return false;
  if (Math.max(left, right) / Math.min(left, right) > OPPOSITE_RATIO_MAX) return false;
  for (let i = 0; i < 4; i++) {
    const o = q[i];
    const a = q[(i + 3) % 4];
    const b = q[(i + 1) % 4];
    const cos = ((a.x - o.x) * (b.x - o.x) + (a.y - o.y) * (b.y - o.y)) / (dist(o, a) * dist(o, b));
    if (Math.abs((Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI - 90) > TILT_MAX_DEG) return false;
  }
  return true;
}

/** 점들을 감싸는 네모에 여백을 더하고 쪽 안으로 줄인다. 너무 작으면 null */
function boxPlan(pts: Pt[], W: number, H: number, pad: number): CutPlan | null {
  const xs = pts.map((p) => Math.min(Math.max(p.x, 0), W));
  const ys = pts.map((p) => Math.min(Math.max(p.y, 0), H));
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const min = MIN_SIDE * Math.max(W, H);
  if (x1 - x0 < min || y1 - y0 < min) return null;
  // 여백: 그림 크기의 pad 비율 (여백을 주면 적어도 2픽셀)
  const px = pad > 0 ? Math.max(2, (x1 - x0) * pad) : 0;
  const py = pad > 0 ? Math.max(2, (y1 - y0) * pad) : 0;
  x0 = Math.max(0, Math.floor(x0 - px));
  y0 = Math.max(0, Math.floor(y0 - py));
  x1 = Math.min(W, Math.ceil(x1 + px));
  y1 = Math.min(H, Math.ceil(y1 + py));
  return { kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 꼭짓점(0~1000)을 쪽(W×H 픽셀) 위의 자르기 방법으로 바꾼다.
 * 반듯한 네모면 네모로, 비스듬한 볼록 네모(사진만: PDF 쪽은 평평하다)면 원근 보정으로,
 * 이상한 꼭짓점(꼬임·찌그러짐·너무 작음·숫자 아님·쪽 밖·네모 같지 않음)이면 바깥 네모로.
 */
export function planCut(corners: Corners, W: number, H: number, pad = 0.03, flat = false): CutPlan | null {
  if (!(W > 0 && H > 0) || !Array.isArray(corners) || corners.length !== 8) return null;
  const pts: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const cx = Number(corners[i * 2]);
    const cy = Number(corners[i * 2 + 1]);
    if (Number.isFinite(cx) && Number.isFinite(cy)) pts.push({ x: (cx / 1000) * W, y: (cy / 1000) * H });
  }
  if (pts.length < 2) return null;
  // 숫자가 빠진 꼭짓점이 있으면 남은 점을 감싸는 네모로
  if (pts.length < 4) return boxPlan(pts, W, H, pad);
  const lo = (-OUT_OF_RANGE / 1000) * Math.max(W, H);
  const outside = pts.some((p) => p.x < lo || p.y < lo || p.x > W - lo || p.y > H - lo);
  let q = pts;
  if (!clockwiseConvex(q)) {
    const r = reorder(q);
    q = new Set(r).size === 4 && clockwiseConvex(r) ? r : [];
  }
  const min = MIN_SIDE * Math.max(W, H);
  const okQuad = !outside && q.length === 4 && [0, 1, 2, 3].every((i) => dist(q[i], q[(i + 1) % 4]) >= min);
  if (!okQuad) return boxPlan(pts, W, H, pad);
  if (flat || straight(q) || !tiltedRect(q)) return boxPlan(q, W, H, pad);
  const [tl, tr, br, bl] = q;
  const outW = (dist(tl, tr) + dist(bl, br)) / 2;
  const outH = (dist(tl, bl) + dist(tr, br)) / 2;
  const padW = pad > 0 ? Math.max(2, outW * pad) : 0;
  const padH = pad > 0 ? Math.max(2, outH * pad) : 0;
  return { kind: 'warp', quad: [tl, tr, br, bl], outW, outH, padW, padH };
}

/** 네 점 대응(src[i] → dst[i])으로 원근 변환(호모그래피) 3×3 행렬(h33 = 1)을 푼다 */
export function homography(src: Pt[], dst: Pt[]): number[] | null {
  // 8×9 확대 행렬을 가우스 소거로 푼다
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

// ------------------------------------------------------------- 자르기
async function encode(canvas: Canvas, quality: number): Promise<Cut> {
  const buf = await canvas.encode('jpeg', Math.round(Math.min(Math.max(quality, 0.3), 1) * 100));
  return { jpeg: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), width: canvas.width, height: canvas.height };
}

async function cutRect(page: Page, plan: Extract<CutPlan, { kind: 'rect' }>, maxSide: number, quality: number): Promise<Cut> {
  const { createCanvas } = await loadCanvas();
  const s = Math.min(1, maxSide / Math.max(plan.w, plan.h));
  const out = createCanvas(Math.max(1, Math.round(plan.w * s)), Math.max(1, Math.round(plan.h * s)));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(page.canvas, plan.x, plan.y, plan.w, plan.h, 0, 0, out.width, out.height);
  return encode(out, quality);
}

async function cutWarp(page: Page, plan: Extract<CutPlan, { kind: 'warp' }>, maxSide: number, quality: number): Promise<Cut | null> {
  const { createCanvas } = await loadCanvas();
  const { outW, outH, padW, padH } = plan;
  const fullW = outW + 2 * padW;
  const fullH = outH + 2 * padH;
  const s = Math.min(1, maxSide / Math.max(fullW, fullH));
  const w = Math.max(1, Math.round(fullW * s));
  const h = Math.max(1, Math.round(fullH * s));
  // 결과 그림 좌표(여백 포함, 줄이기 전) → 쪽 좌표
  const rect: Pt[] = [
    { x: padW, y: padH },
    { x: padW + outW, y: padH },
    { x: padW + outW, y: padH + outH },
    { x: padW, y: padH + outH },
  ];
  const m = homography(rect, plan.quad);
  if (!m) return null;
  const src = page.pixels();
  const W = page.width;
  const H = page.height;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / s;
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / s;
      const z = m[6] * u + m[7] * v + m[8];
      const o = (j * w + i) * 4;
      // 쪽 밖은 흰색
      let r = 255;
      let g = 255;
      let b = 255;
      if (z > 1e-9) {
        const x = (m[0] * u + m[1] * v + m[2]) / z - 0.5;
        const y = (m[3] * u + m[4] * v + m[5]) / z - 0.5;
        if (x > -1 && y > -1 && x < W && y < H) {
          // 둘레 네 픽셀을 섞는다 (쪽 밖 픽셀은 흰색으로 보고)
          const x0 = Math.floor(x);
          const y0 = Math.floor(y);
          const fx = x - x0;
          const fy = y - y0;
          r = g = b = 0;
          for (let dy = 0; dy < 2; dy++) {
            const yy = y0 + dy;
            const wy = dy ? fy : 1 - fy;
            for (let dx = 0; dx < 2; dx++) {
              const xx = x0 + dx;
              const wgt = (dx ? fx : 1 - fx) * wy;
              if (!wgt) continue;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) {
                r += 255 * wgt;
                g += 255 * wgt;
                b += 255 * wgt;
              } else {
                const k = (yy * W + xx) * 4;
                r += src[k] * wgt;
                g += src[k + 1] * wgt;
                b += src[k + 2] * wgt;
              }
            }
          }
        }
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  const canvas = createCanvas(w, h);
  const { ImageData } = await loadCanvas();
  canvas.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return encode(canvas, quality);
}

/**
 * 한 쪽(또는 사진 한 장)에서 그림 여러 개를 자른다. 쪽은 한 번만 그린다.
 * 돌려주는 차례는 cuts 와 같고, 자르지 못한 그림은 null. 쪽·사진을 읽지 못하면 FigureImageError.
 */
export async function cutFigures(src: FigureSource, cuts: Corners[], opts: CutOptions = {}): Promise<Array<Cut | null>> {
  if (!cuts.length) return [];
  const pad = Math.min(Math.max(opts.pad ?? 0.03, 0), 0.25);
  const maxSide = Math.max(64, Math.round(opts.maxSide ?? 1400));
  const quality = opts.quality ?? 0.85;
  const page = src.kind === 'pdf' ? await renderPdfPage(src.bytes, src.page) : await decodeImage(src.bytes);
  const out: Array<Cut | null> = [];
  for (const c of cuts) {
    try {
      // PDF 쪽은 평평해서 늘 네모로 자른다 (AI 가 꼭짓점을 조금 어긋나게 줘도 그림이 찌그러지지 않게)
      const plan = planCut(c, page.width, page.height, pad, src.kind === 'pdf');
      if (!plan) out.push(null);
      else if (plan.kind === 'rect') out.push(await cutRect(page, plan, maxSide, quality));
      else out.push(await cutWarp(page, plan, maxSide, quality));
    } catch (e) {
      console.warn('[kok] figure cut failed', e);
      out.push(null);
    }
  }
  return out;
}
