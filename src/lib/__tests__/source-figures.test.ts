import { describe, expect, it } from 'vitest';
import {
  canRedraw,
  figuresByKeyPoint,
  figuresForPrompt,
  matchKeyPoint,
  questionFigure,
  readCorners,
  readFigures,
  readFoundFigures,
  readQuestionFigure,
  toSourceFigures,
  MAX_FIGURES,
  type SourceFigure,
} from '@/lib/source-figures';

const U = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

const fig = (over: Partial<SourceFigure> = {}): SourceFigure => ({
  id: 'f1',
  kind: 'map',
  title: '5세기 고구려의 영토',
  caption: '(가) 나라가 한강 유역까지 내려온 모습',
  asks: '(가) 나라의 왕',
  key_point_id: 'k1',
  page: 3,
  crop: `${U}/figs/${S}/f1.jpg`,
  w: 800,
  h: 600,
  art: null,
  ...over,
});

describe('자료 그림: AI 가 찾은 그림 읽기', () => {
  const found = (over: Record<string, unknown> = {}) => ({
    page: 3,
    kind: 'map',
    title: '고구려 영토',
    caption: '5세기 고구려',
    asks: '',
    key_point_title: '광개토 대왕',
    corners: [100, 100, 900, 100, 900, 600, 100, 600],
    ...over,
  });

  it('쪽 범위 안의 그림만, 모서리가 올바른 것만 읽는다', () => {
    const got = readFoundFigures(
      [found(), found({ page: 9 }), found({ corners: [1, 2, 3] }), found({ corners: [10, 10, 20, 10, 20, 20, 10, 20] })],
      { from: 1, to: 5 },
      4,
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ page: 3, kind: 'map', title: '고구려 영토', kpTitle: '광개토 대왕' });
  });

  it('같은 자리를 두 번 찾으면 하나로, 최대 수까지만', () => {
    const got = readFoundFigures(
      [found(), found({ corners: [110, 105, 905, 100, 900, 610, 100, 600] }), found({ page: 4 }), found({ page: 5 })],
      { from: 1, to: 5 },
      2,
    );
    expect(got.map((f) => f.page)).toEqual([3, 4]);
  });

  it('사진 한 장짜리 조각이면 쪽 번호를 잘못 적어도 그 사진이다', () => {
    expect(readFoundFigures([found({ page: 0 })], { from: 2, to: 2 }, 4)[0].page).toBe(2);
  });

  it('모르는 종류는 그림(other), 이름이 없으면 종류 이름', () => {
    const got = readFoundFigures([found({ kind: 'Painting', title: '' })], { from: 3, to: 3 }, 4);
    expect(got[0]).toMatchObject({ kind: 'other', title: '그림' });
  });

  it('네 모서리: 네 수(상자)도 받고, 0~1 비율도 1000 배로, 너무 작으면 뺀다', () => {
    expect(readCorners([100, 200, 500, 800])).toEqual([100, 200, 500, 200, 500, 800, 100, 800]);
    expect(readCorners([0.1, 0.2, 0.9, 0.2, 0.9, 0.8, 0.1, 0.8])).toEqual([100, 200, 900, 200, 900, 800, 100, 800]);
    expect(readCorners([100, 100, 110, 100, 110, 400, 100, 400])).toBeNull();
    expect(readCorners([100, NaN, 500, 800])).toBeNull();
    // 쪽 밖으로 조금 나간 꼭짓점은 그대로 (비스듬한 그림이 찌그러지지 않게), 너무 나간 것은 100 까지
    expect(readCorners([-50, 0, 1200, 0, 1200, 900, -50, 900])).toEqual([-50, 0, 1100, 0, 1100, 900, -50, 900]);
  });

  it('목록이 아니면 빈 목록', () => {
    expect(readFoundFigures(null, { from: 1, to: 1 }, 4)).toEqual([]);
    expect(readFoundFigures([found()], { from: 1, to: 9 }, 0)).toEqual([]);
  });
});

describe('자료 그림: 개념에 붙이기', () => {
  const kps = [
    { id: 'k1', title: '**광개토 대왕**의 영토 확장' },
    { id: 'k2', title: '장수왕의 남진 정책' },
    { id: 'k3', title: '백제의 전성기' },
  ];

  it('같은 이름 → 꾸미기·띄어쓰기를 빼고 비교', () => {
    expect(matchKeyPoint('광개토대왕의 영토 확장', kps)).toBe('k1');
  });

  it('한쪽이 다른 쪽을 품으면 그 개념', () => {
    expect(matchKeyPoint('남진 정책', kps)).toBe('k2');
  });

  it('비슷한 글자가 많으면 그 개념, 아니면 붙이지 않는다', () => {
    expect(matchKeyPoint('백제 전성기', kps)).toBe('k3');
    // 다른 나라의 전성기에는 붙이지 않는다
    expect(matchKeyPoint('고구려의 전성기', kps)).toBe('');
    expect(matchKeyPoint('조선의 신분 제도', kps)).toBe('');
    expect(matchKeyPoint('', kps)).toBe('');
  });

  it('자른 그림 → 노트 그림: 번호를 차례로, 최대 수까지', () => {
    const cut = {
      page: 3,
      kind: 'map' as const,
      title: '지도',
      caption: '설명',
      asks: '',
      kpTitle: '장수왕의 남진 정책',
      corners: [0, 0, 1000, 0, 1000, 1000, 0, 1000] as [number, number, number, number, number, number, number, number],
      crop: `${U}/figs/${S}/f1.jpg`,
      w: 900,
      h: 700,
    };
    const out = toSourceFigures(
      Array.from({ length: MAX_FIGURES + 2 }, () => cut),
      kps,
      4,
    );
    expect(out).toHaveLength(MAX_FIGURES);
    expect(out[0]).toMatchObject({ id: 'f4', key_point_id: 'k2', art: null });
    expect(out[1].id).toBe('f5');
  });

  it('개념이 없어진 그림은 따로 모은다', () => {
    const { byKp, loose } = figuresByKeyPoint([fig(), fig({ id: 'f2', key_point_id: 'k9' }), fig({ id: 'f3', key_point_id: '' })], new Set(['k1']));
    expect(byKp.get('k1')?.map((f) => f.id)).toEqual(['f1']);
    expect(loose.map((f) => f.id)).toEqual(['f2', 'f3']);
  });
});

describe('자료 그림: 노트·문제에 둔 그림 읽기', () => {
  it('노트의 그림: 모양이 올바른 것만, 같은 번호는 한 번', () => {
    const body = {
      figures: [fig(), fig(), fig({ id: 'f2', crop: '../../etc/passwd' }), { id: 'f3' }, fig({ id: 'f4', kind: 'photo', art: { v: 1 } as never })],
    };
    const got = readFigures(body);
    expect(got.map((f) => f.id)).toEqual(['f1', 'f4']);
    // 사진은 다시 그리지 않는다 (그림이 들어 있어도 읽지 않는다)
    expect(got[1].art).toBeNull();
    expect(readFigures({})).toEqual([]);
    expect(readFigures(null)).toEqual([]);
  });

  it('문제에 남기는 그림에는 시험 포인트·개념이 없다', () => {
    const q = questionFigure(fig());
    expect(q).not.toHaveProperty('asks');
    expect(q).not.toHaveProperty('key_point_id');
    expect(readQuestionFigure(q)).toEqual(q);
    expect(readQuestionFigure({ id: 'f1' })).toBeNull();
  });

  it('다시 그리는 그림은 지도·그래프·표·연표·도식만', () => {
    expect(['map', 'chart', 'table', 'timeline', 'diagram'].every((k) => canRedraw(k as never))).toBe(true);
    expect(['photo', 'artwork', 'document', 'cartoon', 'other'].some((k) => canRedraw(k as never))).toBe(false);
  });

  it('AI 에는 그림 대신 설명을 보낸다 (저장 위치는 보내지 않는다)', () => {
    const sent = figuresForPrompt([fig()]);
    expect(sent[0]).toEqual({
      id: 'f1',
      kind: 'map',
      title: '5세기 고구려의 영토',
      caption: '(가) 나라가 한강 유역까지 내려온 모습',
      asks: '(가) 나라의 왕',
      key_point_id: 'k1',
    });
  });
});
