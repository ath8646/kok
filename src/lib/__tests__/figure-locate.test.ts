import { describe, expect, it } from 'vitest';
import { nextPages, quadOf, readLocate, scaleQuad, visionSize, visionTokens, VISION_MAX_EDGE, VISION_MAX_TOKENS } from '@/lib/figure-locate';
import { snapRect, contentMask, backgroundOf, padEmpty, type Pixels } from '@/lib/figure-snap';

describe('자료 그림 자리 찾기: AI 에 보여 줄 쪽 그림 크기', () => {
  it('Claude 가 줄이지 않는 크기 (긴 변·토큰 끝 안, 가로세로 비율 그대로)', () => {
    for (const [w, h] of [
      [1572, 2000],
      [2000, 1414],
      [3000, 4000],
      [1075, 1520],
      [8000, 300],
    ]) {
      const s = visionSize(w, h);
      expect(Math.ceil(s.width / 28) * 28).toBeLessThanOrEqual(VISION_MAX_EDGE);
      expect(Math.ceil(s.height / 28) * 28).toBeLessThanOrEqual(VISION_MAX_EDGE);
      expect(visionTokens(s.width, s.height)).toBeLessThanOrEqual(VISION_MAX_TOKENS);
      expect(Math.abs(s.width / s.height - w / h)).toBeLessThan(0.02 * (w / h));
      // 너무 작게 줄이지 않는다: 조금만 더 키우면 긴 변이나 토큰 끝을 넘는다
      const bw = s.width + 28;
      const bh = Math.round((bw * h) / w);
      expect(Math.max(bw, bh) > VISION_MAX_EDGE || visionTokens(bw, bh) > VISION_MAX_TOKENS).toBe(true);
    }
    // 이미 작은 그림은 그대로
    expect(visionSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('자료 그림 자리 찾기: AI 답 읽기', () => {
  const sizes = [
    { width: 966, height: 1229 },
    { width: 966, height: 1229 },
  ];

  it('상자 [x1, y1, x2, y2] 는 네 꼭짓점으로, 몇째 그림인지(1부터)는 차례(0부터)로', () => {
    const r = readLocate(
      {
        printed: [145, 0],
        figures: [
          { index: 0, image: 2, box: [600, 300, 900, 700] },
          { index: 1, image: 0, box: [0, 0, 0, 0] },
        ],
      },
      2,
      sizes,
    );
    expect(r.located[0]).toEqual({ image: 1, quad: [600, 300, 900, 300, 900, 700, 600, 700] });
    expect(r.located[1]).toEqual({ image: -1, quad: null });
    expect(r.printed).toEqual([145, 0]);
  });

  it('거꾸로 준 상자는 바로잡고, 너무 작거나 그림 밖으로 많이 나가거나 숫자가 아니면 못 찾은 것', () => {
    const one = (box: unknown) => readLocate({ figures: [{ index: 0, image: 1, box }] }, 1, sizes).located[0];
    expect(one([900, 700, 600, 300]).quad).toEqual([600, 300, 900, 300, 900, 700, 600, 700]);
    expect(one([100, 100, 120, 500]).image).toBe(-1);
    expect(one([100, 100, 2000, 500]).image).toBe(-1);
    expect(one([100, 'x', 500, 500]).image).toBe(-1);
    expect(one([100, 100, 500]).image).toBe(-1);
  });

  it('사진은 네 꼭짓점 (비스듬해도 그대로), 없는 그림 번호·차례가 이상하면 답의 차례', () => {
    const r = readLocate(
      {
        figures: [
          { index: 7, image: 1, corners: [100, 120, 800, 160, 780, 900, 90, 860] },
          { index: 1, image: 3, corners: [1, 2, 3, 4, 5, 6, 7, 8] },
        ],
      },
      2,
      [{ width: 1000, height: 1000 }],
    );
    expect(r.located[0].quad).toEqual([100, 120, 800, 160, 780, 900, 90, 860]);
    expect(r.located[1].image).toBe(-1);
    expect(r.printed).toEqual([0]);
    expect(readLocate(null, 1, sizes).located).toEqual([{ image: -1, quad: null }]);
  });

  it('보낸 그림의 픽셀 → 그린 쪽의 픽셀', () => {
    expect(scaleQuad([10, 20, 30, 20, 30, 40, 10, 40], 2, 3)).toEqual([20, 60, 60, 60, 60, 120, 20, 120]);
    expect(quadOf([0, 0, 50, 50], { width: 100, height: 100 })).toEqual([0, 0, 50, 0, 50, 50, 0, 50]);
  });
});

describe('자료 그림 자리 찾기: 다음에 볼 쪽', () => {
  it('처음에는 AI 가 말한 쪽만, 그다음은 인쇄된 번호로 짐작한 쪽 → 가까운 쪽부터 (조각 안, 본 쪽 빼고)', () => {
    expect(nextPages({ claimed: 27, from: 27, to: 33, tried: [] })).toEqual([27]);
    expect(nextPages({ claimed: 27, hints: [32], from: 27, to: 33, tried: [27] })).toEqual([32, 28, 29, 30]);
    expect(nextPages({ claimed: 27, hints: [32], from: 27, to: 33, tried: [27, 32, 28, 29, 30] })).toEqual([31, 33]);
    expect(nextPages({ claimed: 36, from: 34, to: 39, tried: [36] })).toEqual([35, 37, 34, 38]);
    expect(nextPages({ claimed: 5, from: 1, to: 5, tried: [1, 2, 3, 4, 5] })).toEqual([]);
  });

  it('범위 밖이나 이상한 짐작은 넘기고, 처음 쪽이 범위 밖이면 이웃부터', () => {
    expect(nextPages({ claimed: 3, hints: [99, 3, 2.5], from: 1, to: 4, tried: [3] })).toEqual([2, 4, 1]);
    expect(nextPages({ claimed: 9, from: 1, to: 4, tried: [], batch: 2 })).toEqual([4, 3]);
  });
});

/** 흰 쪽에 회색 그림(안에 흰 틈이 있다)과 그 위·아래 글 한 줄 */
function page(): Pixels {
  const W = 1000;
  const H = 1300;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([v, v, v, 255], (y * W + x) * 4);
  };
  fill(200, 300, 700, 800, 120); // 그림
  fill(300, 500, 600, 520, 255); // 그림 안의 흰 틈 (띠 하나: 그림을 자르지 않아야 한다)
  fill(200, 812, 640, 826, 30); // 그림 아래 설명 한 줄
  fill(200, 272, 900, 286, 30); // 그림 위 본문 한 줄
  fill(100, 1000, 900, 1200, 200); // 다른 그림
  return { data, width: W, height: H };
}

describe('자료 그림 상자 다듬기 (쪽의 여백에 맞춘다)', () => {
  const px = page();
  const mask = { m: contentMask(px), W: px.width, H: px.height };
  const near = (got: number, want: number, tol = 10) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

  it('바탕색은 쪽 가장자리에서 가장 많은 색', () => {
    expect(backgroundOf(px).map(Math.round)).toEqual([255, 255, 255]);
  });

  it('조금 좁은 상자는 잘린 그림을 마저 넣는다', () => {
    const r = snapRect(mask, { x0: 230, y0: 330, x1: 670, y1: 770 });
    near(r.x0, 200);
    near(r.y0, 300);
    near(r.x1, 700);
    near(r.y1, 800);
  });

  it('여백까지 넓은 상자는 여백만 줄이고, 변에 걸친 글 한 줄(설명·본문)은 뺀다', () => {
    const wide = snapRect(mask, { x0: 170, y0: 291, x1: 730, y1: 806 });
    near(wide.x0, 200);
    near(wide.y0, 300);
    near(wide.x1, 700);
    near(wide.y1, 800);
    // 아래 변이 설명 줄을 가로지른다 (그림 쪽 여백이 더 가깝다) → 설명은 빼고 그림까지
    const cutCaption = snapRect(mask, { x0: 200, y0: 300, x1: 700, y1: 815 });
    expect(cutCaption.y1).toBeLessThan(812);
    near(cutCaption.y1, 800);
    // 위 변이 본문 줄을 가로지른다 → 본문은 빼고
    const cutText = snapRect(mask, { x0: 200, y0: 283, x1: 700, y1: 800 });
    expect(cutText.y0).toBeGreaterThanOrEqual(286);
  });

  it('둘레의 여백은 빈 곳으로만 (아래 설명 줄에 닿으면 멈춘다)', () => {
    const r = padEmpty(mask, { x0: 200, y0: 300, x1: 700, y1: 800 }, 30);
    expect(r).toEqual({ x0: 170, y0: 286, x1: 730, y1: 812 });
  });

  it('그림 안의 흰 틈은 자르지 않는다', () => {
    const r = snapRect(mask, { x0: 205, y0: 305, x1: 695, y1: 795 });
    expect(r.y0).toBeLessThan(500);
    expect(r.y1).toBeGreaterThan(520);
  });

  it('많이 바뀌면(넓이가 반 아래·1.7배 위) 처음 상자 그대로', () => {
    // 그림 한가운데의 아주 작은 상자: 여유만 둘러도 넓이가 두 배를 넘는다
    const small = { x0: 400, y0: 600, x1: 430, y1: 630 };
    expect(snapRect(mask, small)).toEqual(small);
  });
});
