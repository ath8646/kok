// 한눈 지도(MindAtlas)의 자리: 가지 수에 따라 모양을 바꾼다 (화면과 상관없는 계산, 시험 mindmap-atlas.test.ts).
// - 8개까지: 가운데 주제 둘레에 한 겹 궤도 (예전 그대로)
// - 9~16개: 두 겹 궤도. 안쪽·바깥쪽 자리를 엇갈려 놓고, 가지는 위에서부터 시계 방향 차례로 자리를 채운다
// - 17개부터: 궤도 대신 '목차 지도' (번호 붙은 가지 목록: 화면이 HTML 로 그린다, atlasMode)
// 자리를 정한 뒤 겹치는 알약은 서로 밀어내고(relax), 가운데 원과도 겹치지 않게 한다
import { textWidth } from './mindmap-layout';

export const ATLAS_W = 360;
/** 궤도로 그리는 가지 수의 끝 (넘으면 목차 지도) */
export const ORBIT_MAX = 16;
/** 한 겹 궤도로 그리는 가지 수의 끝 */
export const ONE_RING_MAX = 8;
/** 가운데 주제 원의 반지름 */
export const ATLAS_ROOT_R = 44;

export type AtlasMode = 'orbit' | 'rings' | 'index';
export function atlasMode(n: number): AtlasMode {
  return n <= ONE_RING_MAX ? 'orbit' : n <= ORBIT_MAX ? 'rings' : 'index';
}

/** 알약 글자 크기와 글자 수 (두 겹이면 조금 작게·짧게) */
export function pillStyle(n: number): { font: number; chars: number; h: number } {
  return n <= ONE_RING_MAX ? { font: 13.5, chars: 9, h: 34 } : { font: 12.5, chars: 7, h: 30 };
}

/** 긴 이름은 줄인다 (지도에서는 짧게, 카드에서 다 보인다) */
export function shortLabel(s: string, max = 9): string {
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

/** 알약 너비의 끝: 맨 왼쪽·오른쪽에 붙어도 가운데 원과 겹치지 않는 너비 */
export const PILL_MAX_W = ATLAS_W / 2 - ATLAS_ROOT_R - 6 - 4;

/** 알약 글: 글자 수 끝까지 줄이고, 그래도 너비 끝을 넘으면 더 줄인다 */
export function fitLabel(text: string, font: number, chars: number): string {
  let t = shortLabel(text, chars);
  while (textWidth(t, font) + 24 > PILL_MAX_W && [...t].length > 2) {
    const c = [...t].filter((x) => x !== '…');
    t = `${c.slice(0, c.length - 1).join('')}…`;
  }
  return t;
}

export function pillWidth(text: string, font: number): number {
  return Math.min(PILL_MAX_W, Math.max(52, textWidth(text, font) + 24));
}

export type AtlasPill = { x: number; y: number; w: number; h: number };
export type AtlasLayout = { H: number; rings: Array<{ rx: number; ry: number }>; pills: AtlasPill[] };

const GAP = 6;

function overlaps(a: AtlasPill, b: AtlasPill): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + GAP && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + GAP;
}

/** 알약이 가운데 원(반지름 r)과 겹치는지: 알약 상자에서 원 중심까지 가장 가까운 거리 */
function hitsRoot(p: AtlasPill, cx: number, cy: number, r: number): boolean {
  const dx = Math.max(Math.abs(p.x - cx) - p.w / 2, 0);
  const dy = Math.max(Math.abs(p.y - cy) - p.h / 2, 0);
  return Math.hypot(dx, dy) < r + GAP;
}

/** 자리를 정한다. sizes: 가지마다 알약 크기 (가지 차례) */
export function atlasLayout(sizes: Array<{ w: number; h: number }>): AtlasLayout {
  const n = sizes.length;
  const W = ATLAS_W;
  const H = n <= 3 ? 220 : n <= 6 ? 276 : n <= ONE_RING_MAX ? 316 : n <= 12 ? 400 : 440;
  const cx = W / 2;
  const cy = H / 2;
  const clampPill = (p: AtlasPill) => {
    p.x = Math.max(p.w / 2 + 4, Math.min(W - p.w / 2 - 4, p.x));
    p.y = Math.max(p.h / 2 + 4, Math.min(H - p.h / 2 - 4, p.y));
  };
  let pills: AtlasPill[];
  let rings: AtlasLayout['rings'];
  if (n <= ONE_RING_MAX) {
    // 한 겹: 위에서 시작해 시계 방향 (둘이면 왼쪽·오른쪽)
    const start = n === 2 ? Math.PI : -Math.PI / 2;
    const ry = H / 2 - 25;
    rings = [{ rx: Math.min(126, W / 2 - 40), ry: H / 2 - 24 }];
    pills = sizes.map((s, i) => {
      const a = start + (i * Math.PI * 2) / Math.max(1, n);
      const rx = Math.min(126, W / 2 - s.w / 2 - 6);
      const p = { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * Math.min(ry, H / 2 - s.h / 2 - 8), w: s.w, h: s.h };
      clampPill(p);
      return p;
    });
  } else {
    // 두 겹: 안쪽에 약 3분의 1, 바깥에 나머지. 바깥 자리는 안쪽 자리 사이로 엇갈린다
    const inner = Math.max(3, Math.round(n * 0.375));
    const outer = n - inner;
    const ri = { rx: 96, ry: H * 0.26 };
    const ro = { rx: W / 2 - 52, ry: H / 2 - 22 };
    rings = [ri, ro];
    const slots: Array<{ a: number; ring: 0 | 1 }> = [];
    for (let k = 0; k < inner; k++) slots.push({ a: -Math.PI / 2 + Math.PI / inner + (k * 2 * Math.PI) / inner, ring: 0 });
    for (let k = 0; k < outer; k++) slots.push({ a: -Math.PI / 2 + (k * 2 * Math.PI) / outer, ring: 1 });
    // 위에서부터 시계 방향 차례 (같은 각도면 바깥이 먼저: 맨 위 가지가 첫 가지)
    const norm = (a: number) => (((a + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    slots.sort((s, t) => norm(s.a) - norm(t.a) || t.ring - s.ring);
    pills = sizes.map((s, i) => {
      const slot = slots[i];
      const r = slot.ring === 0 ? ri : ro;
      const rx = slot.ring === 0 ? r.rx : Math.min(r.rx, W / 2 - s.w / 2 - 4);
      const ry = slot.ring === 0 ? r.ry : Math.min(r.ry, H / 2 - s.h / 2 - 4);
      const p = { x: cx + Math.cos(slot.a) * rx, y: cy + Math.sin(slot.a) * ry, w: s.w, h: s.h };
      clampPill(p);
      return p;
    });
  }
  // 겹치는 알약은 서로 밀어낸다 (가운데 원에서도). 판 밖으로는 나가지 않는다
  for (let round = 0; round < 80; round++) {
    let moved = false;
    for (let i = 0; i < pills.length; i++) {
      const p = pills[i];
      if (hitsRoot(p, cx, cy, ATLAS_ROOT_R)) {
        const dx = p.x - cx || 0.01;
        const dy = p.y - cy || 0.01;
        const len = Math.hypot(dx, dy);
        p.x += (dx / len) * 3;
        p.y += (dy / len) * 3;
        clampPill(p);
        moved = true;
      }
      for (let j = i + 1; j < pills.length; j++) {
        const q = pills[j];
        if (!overlaps(p, q)) continue;
        // 덜 겹친 쪽(가로·세로)으로 반씩 민다
        const ox = (p.w + q.w) / 2 + GAP - Math.abs(p.x - q.x);
        const oy = (p.h + q.h) / 2 + GAP - Math.abs(p.y - q.y);
        if (oy <= ox) {
          const s = (p.y <= q.y ? -1 : 1) * (oy / 2 + 0.5);
          p.y += s;
          q.y -= s;
        } else {
          const s = (p.x <= q.x ? -1 : 1) * (ox / 2 + 0.5);
          p.x += s;
          q.x -= s;
        }
        clampPill(p);
        clampPill(q);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { H, rings, pills };
}

/** 겹치는 알약 쌍의 수 (시험·확인용) */
export function atlasOverlaps(layout: AtlasLayout): number {
  let n = 0;
  const { pills } = layout;
  for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) if (overlaps(pills[i], pills[j])) n++;
  return n;
}
