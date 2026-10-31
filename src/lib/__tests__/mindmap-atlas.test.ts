import { describe, expect, it } from 'vitest';
import { ATLAS_ROOT_R, ATLAS_W, atlasLayout, atlasMode, atlasOverlaps, fitLabel, pillStyle, pillWidth } from '@/lib/mindmap-atlas';

const labels = [
  '광합성의 재료와 결과물',
  '엽록체',
  '빛의 세기와 광합성량',
  'CO2 농도',
  '온도',
  '기공의 구조',
  '증산 작용',
  '호흡',
  '세포 호흡과 에너지',
  'ATP',
  '미토콘드리아',
  '효소의 성질',
  '물질대사',
  '동화 작용',
  '이화 작용',
  '생태계 에너지 흐름',
];

function layoutOf(n: number, long = false) {
  const st = pillStyle(n);
  const sizes = Array.from({ length: n }, (_, i) => {
    const text = fitLabel(long ? '🌿 아주아주긴가지이름입니다' : labels[i % labels.length], st.font, st.chars);
    return { w: pillWidth(text, st.font), h: st.h };
  });
  return atlasLayout(sizes);
}

describe('한눈 지도: 가지 수에 따라 모양', () => {
  it('8개까지 한 겹 궤도, 16개까지 두 겹 궤도, 그보다 많으면 목차 지도', () => {
    expect(atlasMode(1)).toBe('orbit');
    expect(atlasMode(8)).toBe('orbit');
    expect(atlasMode(9)).toBe('rings');
    expect(atlasMode(16)).toBe('rings');
    expect(atlasMode(17)).toBe('index');
    expect(atlasMode(30)).toBe('index');
  });

  it('궤도의 알약은 서로 겹치지 않고, 가운데 원과도, 판 밖으로도 나가지 않는다 (긴 이름도)', () => {
    for (let n = 1; n <= 16; n++) {
      for (const long of [false, true]) {
        const l = layoutOf(n, long);
        expect(atlasOverlaps(l), `n=${n} long=${long}`).toBe(0);
        for (const p of l.pills) {
          expect(p.x - p.w / 2).toBeGreaterThanOrEqual(0);
          expect(p.x + p.w / 2).toBeLessThanOrEqual(ATLAS_W);
          expect(p.y - p.h / 2).toBeGreaterThanOrEqual(0);
          expect(p.y + p.h / 2).toBeLessThanOrEqual(l.H);
          const dx = Math.max(Math.abs(p.x - ATLAS_W / 2) - p.w / 2, 0);
          const dy = Math.max(Math.abs(p.y - l.H / 2) - p.h / 2, 0);
          expect(Math.hypot(dx, dy), `n=${n} root`).toBeGreaterThanOrEqual(ATLAS_ROOT_R);
        }
      }
    }
  });

  it('두 겹이면 첫 가지가 맨 위에서 시작하고 판이 더 크다', () => {
    const l = layoutOf(12);
    expect(l.H).toBeGreaterThan(layoutOf(8).H);
    const top = Math.min(...l.pills.map((p) => p.y));
    expect(l.pills[0].y).toBe(top);
  });
});
