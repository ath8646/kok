import { describe, expect, it } from 'vitest';
import { normalizeCover, type CoverV2 } from '@/lib/cover';
import { COVER_RESERVE, coverFont, coverGeo, fitText, layoutCover, measure, primBounds, type Area, type CoverFont, type Prim } from '@/lib/cover-layout';

const item = (text: string, o: Record<string, unknown> = {}) => ({ text, sub: '', key: false, side: '', ...o });
const BLANK = { view: { x_min: 0, x_max: 0, y_min: 0, y_max: 0 }, axes: false, items: [] };
const cover = (o: Record<string, unknown>): CoverV2 => normalizeCover({ title: '', left: '', right: '', items: [], figure: BLANK, alt: '', ...o })!;

/** 실제 노트에서 나올 만한 표지 (짧은 낱말) */
const REAL: Record<string, CoverV2> = {
  timeline4: cover({
    kind: 'timeline',
    items: [
      item('조선 건국', { sub: '1392' }),
      item('훈민정음 반포', { sub: '1446' }),
      item('임진왜란', { sub: '1592', key: true }),
      item('병자호란', { sub: '1636' }),
    ],
  }),
  timeline3: cover({
    kind: 'timeline',
    items: [item('3·1 운동', { sub: '1919' }), item('광복', { sub: '1945', key: true }), item('정부 수립', { sub: '1948' })],
  }),
  flow4: cover({ kind: 'flow', items: [item('빛 흡수'), item('물 분해'), item('ATP 생성'), item('포도당 합성', { key: true })] }),
  flow3: cover({ kind: 'flow', items: [item('수요 증가', { sub: '원인' }), item('가격 상승', { key: true }), item('공급 증가', { sub: '결과' })] }),
  flow2: cover({ kind: 'flow', items: [item('Input'), item('Output', { key: true })] }),
  tree4: cover({ kind: 'tree', title: '지구계', items: [item('지권'), item('수권'), item('기권', { key: true }), item('생물권')] }),
  tree3: cover({ kind: 'tree', title: '정부 형태', items: [item('대통령제'), item('의원 내각제', { key: true }), item('이원 집정부제')] }),
  cycle4: cover({ kind: 'cycle', title: '물의 순환', items: [item('증발'), item('응결'), item('강수', { key: true }), item('지하수 흐름')] }),
  cycle3: cover({ kind: 'cycle', items: [item('계획'), item('실행'), item('평가')] }),
  cycle5: cover({ kind: 'cycle', title: '세포 주기', items: [item('G1기'), item('S기'), item('G2기'), item('M기', { key: true }), item('세포질 분열')] }),
  compare3: cover({
    kind: 'compare',
    left: '광합성',
    right: '세포 호흡',
    items: [
      item('엽록체', { side: 'left' }),
      item('빛에너지 저장', { side: 'left' }),
      item('CO₂ 흡수', { side: 'left' }),
      item('미토콘드리아', { side: 'right' }),
      item('에너지 방출', { side: 'right' }),
      item('O₂ 사용', { side: 'right' }),
    ],
  }),
  compare2: cover({
    kind: 'compare',
    left: '동맥',
    right: '정맥',
    items: [
      item('심장 → 몸', { side: 'left' }),
      item('벽이 두꺼움', { side: 'left' }),
      item('몸 → 심장', { side: 'right' }),
      item('판막 있음', { side: 'right' }),
    ],
  }),
  hub4: cover({ kind: 'hub', title: '삼권 분립', items: [item('입법부'), item('행정부'), item('사법부'), item('견제와 균형', { key: true })] }),
  hub5: cover({ kind: 'hub', title: '민주주의', items: [item('국민 주권'), item('자유'), item('평등'), item('다수결', { key: true }), item('법치주의')] }),
  hub2: cover({ kind: 'hub', title: '훈민정음', items: [item('세종'), item('1443년 창제')] }),
};

/** 글자가 가장 긴 표지 (검사가 받아 주는 끝까지) */
const LONG: Record<string, CoverV2> = {
  timeline5: cover({ kind: 'timeline', items: Array.from({ length: 5 }, (_, k) => item(`아주 긴 사건 이름 ${k}`, { sub: `기원전 ${k}세기쯤` })) }),
  flow4: cover({ kind: 'flow', items: Array.from({ length: 4 }, (_, k) => item(`긴 단계 이름입니다${k}`)) }),
  tree4: cover({ kind: 'tree', title: '아주 긴 전체 이름이에요', items: Array.from({ length: 4 }, (_, k) => item(`긴 부분 이름${k}`)) }),
  cycle5: cover({ kind: 'cycle', title: '아주 긴 순환 이름', items: Array.from({ length: 5 }, (_, k) => item(`긴 단계 이름${k}`)) }),
  compare: cover({
    kind: 'compare',
    left: '아주 긴 왼쪽 이름',
    right: '아주 긴 오른쪽 이름',
    items: [0, 1, 2].flatMap((k) => [item(`긴 특징 글자 ${k}`, { side: 'left' }), item(`긴 특징 글자 ${k}`, { side: 'right' })]),
  }),
  hub5: cover({ kind: 'hub', title: '아주 긴 가운데 이름', items: Array.from({ length: 5 }, (_, k) => item(`긴 핵심어${k}`)) }),
};

/** 폰 카드(360·390·430px 화면, 제목 두 줄·한 줄), 넓은 화면 카드, 표지 그림 창 (단추 자리 없음) */
const SIZES = [
  { w: 146, h: 104 },
  { w: 146, h: 125 },
  { w: 161, h: 104 },
  { w: 161, h: 125 },
  { w: 187, h: 125 },
  { w: 212, h: 125 },
  { w: 236, h: 125 },
  { w: 330, h: 220, reserve: { w: 0, h: 0 } },
];
/** 320px 화면 (아주 좁은 폰): 글은 잘려도 판 밖으로는 넘치지 않게 */
const TINY = { w: 126, h: 104 };

const inside = (o: Area, b: Area) => b.x >= o.x - 1 && b.y >= o.y - 1 && b.x + b.w <= o.x + o.w + 1 && b.y + b.h <= o.y + o.h + 1;
const meets = (a: Area, b: Area) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** 상자(바탕색·꽉 칠한 네모, 옅은 칸·알약 바탕은 빼고) */
const isBox = (p: Prim): p is Extract<Prim, { t: 'rect' }> => p.t === 'rect' && p.fillOp === undefined;

function check(c: CoverV2, size: (typeof SIZES)[number], o: { noCut: boolean; font?: CoverFont }) {
  const plan = layoutCover(c, { ...size, font: o.font });
  const where = `${c.kind} ${size.w}×${size.h}`;
  expect(plan.prims.length, where).toBeGreaterThan(0);
  const card = { x: 0, y: 0, w: size.w, h: size.h };
  const reserve = size.reserve ?? COVER_RESERVE;
  const corner = { x: size.w - reserve.w, y: 0, w: reserve.w, h: reserve.h };
  const boxes = plan.prims.filter(isBox);
  const texts: Area[] = [];
  for (const p of plan.prims) {
    const b = primBounds(p, o.font)!;
    // 판 안에, 오른쪽 위 단추 자리는 비운다
    expect(inside(card, b), `${where} 판 밖: ${JSON.stringify(p).slice(0, 120)}`).toBe(true);
    if (reserve.w > 0) expect(meets(corner, b), `${where} 단추 자리: ${JSON.stringify(p).slice(0, 120)}`).toBe(false);
    if (p.t !== 'text') continue;
    if (o.noCut)
      expect(
        p.lines.some((l) => l.endsWith('…')),
        `${where} 잘린 글: ${p.lines.join('/')}`,
      ).toBe(false);
    expect(p.size, where).toBeGreaterThanOrEqual(9);
    // 글끼리 겹치지 않는다 (줄 높이의 위아래 여백끼리 닿는 것은 괜찮다)
    const ink = { x: b.x + 0.5, y: b.y + 1, w: b.w - 1, h: b.h - 2 };
    for (const t of texts) expect(meets(t, ink), `${where} 겹친 글: ${p.lines.join('/')}`).toBe(false);
    texts.push(ink);
    // 상자 안의 글은 상자 안에 들어간다
    const cx = p.anchor === 'middle' ? p.x : p.anchor === 'start' ? b.x + b.w / 2 : b.x + b.w / 2;
    const host = boxes.filter((r) => cx > r.x && cx < r.x + r.w && p.y > r.y && p.y < r.y + r.h);
    for (const r of host) expect(inside(r, b), `${where} 상자 밖 글: ${p.lines.join('/')}`).toBe(true);
  }
  // 상자끼리 겹치지 않는다 (알약은 옅은 칸 안이라 상자로 세지 않는다)
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const nested = inside(a, b) || inside(b, a);
      expect(!nested && meets(a, b), `${where} 겹친 상자 ${i}·${j}`).toBe(false);
    }
  return plan;
}

describe('표지 그림 배치 (lib/cover-layout.ts)', () => {
  it('실제 같은 표지는 어느 카드 크기에서도 판 안에, 단추 자리를 비우고, 겹치지 않고, 글을 자르지 않는다', () => {
    for (const c of Object.values(REAL)) for (const size of SIZES) check(c, size, { noCut: true });
  });

  it('가장 긴 글도 판 밖·단추 자리로 넘치지 않는다 (… 로 자르거나 덜 중요한 것을 뺀다)', () => {
    for (const c of [...Object.values(LONG), ...Object.values(REAL)]) for (const size of [...SIZES, TINY]) check(c, size, { noCut: false });
  });

  it('글꼴이 표보다 넓으면(터미널 테마의 고정폭 글꼴) 그 배율로 배치해서 글이 넘치거나 붙지 않는다', () => {
    // 표보다 좁은 글꼴(기본 글꼴 굵게: 한글 약 0.9em)은 표 그대로, 잴 수 없으면 표 그대로
    expect(coverFont({ hangul: 9, latin: 11 })).toEqual({ hangul: 1, latin: 1 });
    expect(coverFont({ hangul: 0, latin: Number.NaN })).toEqual({ hangul: 1, latin: 1 });
    // 고정폭 글꼴: 한글 1em(표보다 넓다), 영문 0.5em(표보다 좁다)
    const mono = coverFont({ hangul: 10, latin: 10.5 });
    expect(mono.hangul).toBeGreaterThan(1.04);
    expect(mono.latin).toBe(1);
    expect(measure('훈민정음', 12, 700, mono)).toBeGreaterThan(48);
    for (const c of Object.values(REAL)) for (const size of SIZES) check(c, size, { noCut: false, font: mono });
    for (const c of Object.values(LONG)) for (const size of [...SIZES, TINY]) check(c, size, { noCut: false, font: mono });
    // 배치가 끝나면 표 그대로 돌아온다
    expect(measure('가', 10)).toBeCloseTo(0.94 * 10 * 1.03, 5);
  });

  it('연표의 사건 이름은 이웃과 붙지 않는다 (한 줄에 나란한 이름 사이 7px 넘게)', () => {
    const mono = coverFont({ hangul: 10, latin: 10.5 });
    for (const c of [REAL.timeline4, REAL.timeline3, LONG.timeline5])
      for (const size of SIZES)
        for (const font of [undefined, mono]) {
          const texts = layoutCover(c, { ...size, font }).prims.filter((p): p is Extract<Prim, { t: 'text' }> => p.t === 'text');
          const rows = new Map<number, Area[]>();
          for (const p of texts) {
            const key = Math.round(p.y);
            rows.set(key, [...(rows.get(key) ?? []), primBounds(p, font)!]);
          }
          for (const row of rows.values()) {
            row.sort((a, b) => a.x - b.x);
            for (let k = 1; k < row.length; k++)
              expect(row[k].x - (row[k - 1].x + row[k - 1].w), `${size.w}×${size.h} ${font ? 'mono' : ''}`).toBeGreaterThanOrEqual(6.5);
          }
        }
  });

  it('흐름·순환은 단계를 빼지 않는다 (빠진 단계가 있으면 틀린 그림)', () => {
    for (const c of [REAL.flow4, REAL.cycle5, LONG.flow4, LONG.cycle5])
      for (const size of SIZES) {
        const texts = layoutCover(c, size).prims.flatMap((p) => (p.t === 'text' ? p.lines : []));
        const words = c.items.map((i) => i.text);
        // 잘린 글(…)도 그 단계의 앞부분이다
        for (const w of words)
          expect(
            texts.some((t) => t === w || (t.endsWith('…') && w.startsWith(t.slice(0, -1).trim().split(' ')[0]))) || texts.join(' ').includes(w),
            `${c.kind} ${size.w}×${size.h} ${w}`,
          ).toBe(true);
      }
  });

  it('넓은 카드는 큰 카드다운 배치(가로 흐름·조직도·고리), 좁은 카드는 단계 목록으로 바뀐다', () => {
    const wide = layoutCover(REAL.flow3, { w: 330, h: 220, reserve: { w: 0, h: 0 } }).prims;
    // 가로 흐름: 상자 셋이 한 줄
    const ys = new Set(wide.filter(isBox).map((b) => Math.round(b.y)));
    expect(ys.size).toBe(1);
    // 좁은 폰 카드의 4단계 흐름은 번호 동그라미(단계 목록)나 ㄹ자
    const narrow = layoutCover(REAL.flow4, { w: 161, h: 104 }).prims;
    const numbers = narrow.filter((p) => p.t === 'text' && /^[1-4]$/.test(p.lines[0]));
    const rows = new Set(narrow.filter(isBox).map((b) => Math.round(b.y)));
    expect(numbers.length === 4 || rows.size === 2).toBe(true);
  });

  it('비교는 폰 카드(제목 한 줄)에서도 특징을 모두 보인다 (나란히 안 되면 두 줄 목록)', () => {
    const texts = (c: CoverV2, size: { w: number; h: number }) => layoutCover(c, size).prims.flatMap((p) => (p.t === 'text' ? p.lines : []));
    for (const size of [
      { w: 146, h: 125 },
      { w: 161, h: 125 },
    ])
      for (const w of ['심장 → 몸', '벽이 두꺼움', '몸 → 심장', '판막 있음']) expect(texts(REAL.compare2, size), `${size.w}×${size.h}`).toContain(w);
    const photo = cover({
      kind: 'compare',
      left: '광합성',
      right: '세포 호흡',
      items: [
        item('엽록체', { side: 'left' }),
        item('에너지 저장', { side: 'left' }),
        item('미토콘드리아', { side: 'right' }),
        item('에너지 방출', { side: 'right' }),
      ],
    });
    for (const w of ['엽록체', '에너지 저장', '미토콘드리아', '에너지 방출']) expect(texts(photo, { w: 161, h: 125 })).toContain(w);
  });

  it('공식은 HTML 로 그릴 자리(단추 자리 아래)를, 그래프는 그림 자리를 준다', () => {
    const f = layoutCover(cover({ kind: 'formula', title: 'F = ma', items: [item('F', { sub: '힘' })] }), { w: 161, h: 125 });
    expect(f.prims).toEqual([]);
    expect(f.formula!.y).toBeGreaterThanOrEqual(COVER_RESERVE.h);
    expect(f.formula!.chipH).toBeGreaterThan(0);
    const g = layoutCover(
      cover({
        kind: 'figure',
        figure: {
          view: { x_min: -2, x_max: 4, y_min: -2, y_max: 4 },
          axes: true,
          items: [{ id: 'f', type: 'function', refs: [], x: 0, y: 0, w: 0, h: 0, r: 0, expr: 'x^2', from: -2, to: 2, label: '', style: 'given', marks: 0 }],
        },
      }),
      { w: 161, h: 125 },
    );
    const a = g.figure!;
    expect(inside({ x: 0, y: 0, w: 161, h: 125 }, a)).toBe(true);
    expect(meets({ x: 161 - COVER_RESERVE.w, y: 0, w: COVER_RESERVE.w, h: COVER_RESERVE.h }, a)).toBe(false);
  });

  it('글자 크기는 카드 크기를 따른다 (폰 11.5px, 넓은 카드 13px 쯤, 표지 그림 창 16px)', () => {
    expect(coverGeo({ w: 161, h: 125 }).f).toBe(11.5);
    expect(coverGeo({ w: 236, h: 125 }).f).toBeGreaterThan(13);
    expect(coverGeo({ w: 330, h: 220 }).f).toBe(16);
  });

  it('글 맞추기: 한 줄 → 두 줄(첫 줄이 길게) → 작게 → … ', () => {
    expect(fitText('가격 상승', 100, [12]).lines).toEqual(['가격 상승']);
    // 두 줄의 길이가 같으면 첫 줄이 긴 쪽
    const two = fitText('증기 기관 개량', 54, [12]);
    expect(two.lines).toEqual(['증기 기관', '개량']);
    const small = fitText('미토콘드리아', 64, [12, 11, 10], { lines: 1 });
    expect(small.size).toBe(11);
    const cut = fitText('미토콘드리아', 40, [10], { lines: 1 });
    expect(cut.lines[0].endsWith('…')).toBe(true);
    expect(measure(cut.lines[0], 10)).toBeLessThanOrEqual(40);
    // 한글은 0.94em (설정 글꼴 가운데 가장 넓은 것보다 조금 넉넉히), m 은 i 보다 넓다
    expect(measure('가', 10, 400)).toBeCloseTo(9.4);
    expect(measure('m', 10, 400)).toBeGreaterThan(measure('i', 10, 400) * 2);
  });
});
