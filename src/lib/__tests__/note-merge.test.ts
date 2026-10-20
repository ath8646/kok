import { describe, expect, it } from 'vitest';
import { MERGED_MAX_NODES, idMaker, mergeNotes, readMergedMark, type MergePart } from '../note-merge';
import { remapKeyPoint, remapMindmap, reorganizeMaxKeyPoints, settleReorganized } from '../note-reorganize';
import { zNote, type Mindmap, type MindNode, type Note } from '../ai/schemas';

const USER = '11111111-1111-1111-1111-111111111111';
const SRC_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const SRC_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

function kp(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, title, explanation: `${title} 설명`, why: '', importance: 'medium', pages: [1, 2], ...extra };
}

function node(id: string, parent_id: string, label: string, key_point_id = ''): MindNode {
  return { id, parent_id, label, icon: '', key_point_id, pages: [3] };
}

function fig(id: string, src: string, key_point_id: string) {
  return { id, kind: 'map', title: '지도', caption: '', asks: '', key_point_id, page: 1, crop: `${USER}/figs/${src}/${id}.jpg`, w: 800, h: 600, art: null };
}

function part(noteId: string, body: Record<string, unknown>, mindmap: Mindmap | null = null, extra: Partial<MergePart> = {}): MergePart {
  return { noteId, body, mindmap, table: null, timeline: null, ...extra };
}

describe('idMaker', () => {
  it('gives the next unused number with the prefix', () => {
    const next = idMaker('k', ['k1', 'k3', 'x9', 'k10x']);
    expect([next(), next()]).toEqual(['k4', 'k5']);
  });
});

describe('mergeNotes', () => {
  const main = part(
    'n-main',
    {
      title: '광합성',
      unit: '3단원',
      summary: '빛으로 양분을 만든다.',
      key_points: [kp('k1', '엽록체', { starred: true }), kp('k2', '빛')],
      terms: [{ term: '엽록소', meaning: '초록 색소' }],
      formulas: [{ latex: 'CO_2', label: '이산화탄소' }],
      pitfalls: [{ text: '밤에도 한다?', key_point_id: 'k2' }],
      examples: [],
      checks: [{ text: '그림을 확인해요' }],
      changes: [],
      view: { mode: 'map' },
      figures: [fig('f1', SRC_A, 'k1')],
    },
    { root_label: '광합성', root_edited: true, nodes: [node('n1', '', '엽록체', 'k1'), node('n2', 'n1', '틸라코이드')] },
  );
  const other = part(
    'n-other',
    {
      title: '호흡',
      unit: '4단원',
      summary: '양분을 태워 에너지를 얻는다.',
      key_points: [kp('k1', '미토콘드리아'), kp('k2', '산소')],
      terms: [
        { term: '엽록소', meaning: '초록 색소' },
        { term: 'ATP', meaning: '에너지 화폐' },
      ],
      formulas: [{ latex: 'CO_2', label: '이산화탄소' }],
      pitfalls: [{ text: '식물은 호흡 안 한다?', key_point_id: 'k2' }],
      examples: [{ text: '운동할 때', key_point_id: 'k1' }],
      checks: [{ text: '그림을 확인해요' }, { text: '단위를 확인해요' }],
      changes: [{ text: '맞춤법을 고쳤어요' }],
      figures: [fig('f1', SRC_B, 'k2')],
    },
    { root_label: '호흡', nodes: [node('n1', '', '미토콘드리아', 'k1'), node('n2', 'n1', '크리스타'), node('n3', '', '산소', 'k2')] },
    { timeline: { title: '연표', events: [{ date: '1', label: 'a', detail: '' }] } },
  );

  it('keeps the main note and appends the other with new concept numbers', () => {
    const r = mergeNotes(main, [other], { reserved: ['k3'], at: '2026-10-20T00:00:00.000Z' });
    const note = zNote.parse(r.body);
    expect(note.title).toBe('광합성');
    expect(note.unit).toBe('3단원');
    expect(note.key_points.map((k) => k.id)).toEqual(['k1', 'k2', 'k4', 'k5']);
    expect(note.key_points[0].starred).toBe(true);
    // 다른 자료의 쪽은 비운다, 남길 노트의 쪽은 그대로
    expect(note.key_points[0].pages).toEqual([1, 2]);
    expect(note.key_points[2].pages).toEqual([]);
    expect(r.maps).toEqual({ 'n-other': { k1: 'k4', k2: 'k5' } });
    expect(note.pitfalls.map((p) => p.key_point_id)).toEqual(['k2', 'k5']);
    expect(note.examples.map((p) => p.key_point_id)).toEqual(['k4']);
    expect(note.summary).toBe('빛으로 양분을 만든다.\n양분을 태워 에너지를 얻는다.');
  });

  it('drops repeated terms and formulas but keeps every check and change once', () => {
    const note = zNote.parse(mergeNotes(main, [other]).body);
    expect(note.terms.map((t) => t.term)).toEqual(['엽록소', 'ATP']);
    expect(note.formulas).toHaveLength(1);
    expect(note.checks.map((c) => c.text)).toEqual(['그림을 확인해요', '단위를 확인해요']);
    expect(note.changes.map((c) => c.text)).toEqual(['맞춤법을 고쳤어요']);
  });

  it('keeps other fields of the main note and marks the note as merged', () => {
    const r = mergeNotes(main, [other], { at: '2026-10-20T00:00:00.000Z' });
    expect(r.body.view).toEqual({ mode: 'map' });
    expect(readMergedMark(r.body)).toEqual({ count: 2, at: '2026-10-20T00:00:00.000Z' });
    // 이미 합친 노트에 또 합치면 모인 노트 수를 이어서 센다
    const again = mergeNotes(part('n-main', r.body, null), [part('n-x', { key_points: [] }), part('n-y', { merged: { count: 3 } })]);
    expect(readMergedMark(again.body)?.count).toBe(6);
  });

  it('renumbers figures of the other note and points them at the new concepts', () => {
    const r = mergeNotes(main, [other]);
    const figures = r.body.figures as Array<{ id: string; key_point_id: string; crop: string }>;
    expect(figures.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(figures[1].key_point_id).toBe('k4');
    expect(figures[1].crop).toContain(SRC_B);
  });

  it('adds the branches of the other mind map as first-level branches with new ids', () => {
    const r = mergeNotes(main, [other], { reserved: ['k3'] });
    const map = r.visuals.find((v) => v.type === 'mindmap')?.spec as Mindmap;
    expect(map.root_label).toBe('광합성');
    expect(map.root_edited).toBe(true);
    expect(map.nodes.map((n) => [n.id, n.parent_id, n.key_point_id])).toEqual([
      ['n1', '', 'k1'],
      ['n2', 'n1', ''],
      ['n3', '', 'k4'],
      ['n4', 'n3', ''],
      ['n5', '', 'k5'],
    ]);
    expect(map.nodes[2].pages).toEqual([]);
    // 표·연표: 남길 노트에 없으면 합쳐지는 노트의 것
    expect(r.visuals.find((v) => v.type === 'timeline')).toBeTruthy();
    expect(r.visuals.find((v) => v.type === 'table')).toBeUndefined();
  });

  it('uses the first mind map when the main note has none, and keeps the map small', () => {
    const big: MindNode[] = [];
    for (let i = 1; i <= 10; i++) {
      big.push(node(`a${i}`, '', `가지 ${i}`));
      for (let j = 1; j <= 5; j++) big.push(node(`a${i}-${j}`, `a${i}`, `잎 ${i}-${j}`));
    }
    const r = mergeNotes(part('m', { key_points: [] }, null), [part('o', { key_points: [] }, { root_label: '큰 지도', nodes: big })], { maxNodes: 20 });
    const map = r.visuals[0].spec as Mindmap;
    expect(map.root_label).toBe('큰 지도');
    expect(map.nodes).toHaveLength(20);
    // 1단계 가지는 모두 들어가고 (원래 차례대로), 남는 자리에 2단계 가지
    expect(map.nodes.filter((n) => n.parent_id === '')).toHaveLength(10);
    expect(map.nodes.slice(0, 3).map((n) => n.label)).toEqual(['가지 1', '잎 1-1', '잎 1-2']);
    expect(MERGED_MAX_NODES).toBeGreaterThanOrEqual(60);
  });

  it('keeps the manual mark only when every note was made by hand', () => {
    expect(mergeNotes(part('a', { manual: true }), [part('b', { manual: true })]).body.manual).toBe(true);
    expect(mergeNotes(part('a', { manual: true }), [part('b', {})]).body.manual).toBeUndefined();
    expect(mergeNotes(part('a', {}), [part('b', { summary_edited: true })]).body.summary_edited).toBe(true);
  });
});

describe('settleReorganized', () => {
  const current: Note = zNote.parse({
    title: '광합성과 호흡',
    summary: '요약',
    key_points: [kp('k1', '엽록체', { starred: true, edited: true }), kp('k2', '빛'), kp('k4', '엽록체 구조'), kp('k5', '산소')],
    checks: [{ text: '확인 1' }],
    pitfalls: [{ text: '밤에도?', key_point_id: 'k2', edited: true }],
  });

  it('follows the id map, renames new ids that are taken and drops unknown concepts', () => {
    const ai = zNote.parse({
      title: '다른 제목',
      summary: '새 요약',
      key_points: [kp('k1', '엽록체', { explanation: '빛을 받는 곳으로 고쳐 쓴 설명' }), kp('k2', '빛'), kp('k7', '새 개념')],
      pitfalls: [
        { text: '밤에도?', key_point_id: 'k2' },
        { text: '새 함정', key_point_id: 'k7' },
        { text: '없는 개념', key_point_id: 'k99' },
      ],
      checks: [{ text: '확인 2' }],
    });
    const r = settleReorganized(
      current,
      ai,
      [
        { from: 'k1', to: 'k1' },
        { from: 'k4', to: 'k1' },
        { from: 'k2', to: 'k2' },
      ],
      { maxKeyPoints: 9, reserved: ['k7'] },
    );
    expect(r.note.title).toBe('광합성과 호흡');
    // k7 은 예전 문제가 쓰는 번호라 새 번호를 받는다
    expect(r.note.key_points.map((k) => k.id)).toEqual(['k1', 'k2', 'k8']);
    expect(r.qmap).toEqual({ k4: 'k1', k5: '' });
    expect(r.note.pitfalls.map((p) => p.key_point_id)).toEqual(['k2', 'k8', '']);
    // 별표는 따라가고, '고침' 표시는 글이 그대로일 때만
    expect(r.note.key_points[0].starred).toBe(true);
    expect(r.note.key_points[0].edited).toBeUndefined();
    expect(r.note.pitfalls[0].edited).toBe(true);
    expect(r.note.checks.map((c) => c.text)).toEqual(['확인 1', '확인 2']);
  });

  it('stars the combined concept when a starred concept went into it', () => {
    const ai = zNote.parse({ key_points: [kp('k2', '빛과 엽록체')] });
    const r = settleReorganized(current, ai, [{ from: 'k1', to: 'k2' }], { maxKeyPoints: 9 });
    expect(r.qmap.k1).toBe('k2');
    expect(r.note.key_points[0].starred).toBe(true);
  });

  it('gives a second key point with the same id a new id, and caps the count', () => {
    const ai = zNote.parse({ key_points: [kp('k1', 'a'), kp('k1', 'b'), kp('', 'c'), kp('k2', 'd')] });
    const r = settleReorganized(current, ai, [], { maxKeyPoints: 3 });
    expect(r.note.key_points.map((k) => k.id)).toEqual(['k1', 'k6', 'k7']);
  });

  it('remaps mind map concepts only when something changed', () => {
    const map: Mindmap = { root_label: '지도', nodes: [node('n1', '', '엽록체', 'k1'), node('n2', '', '구조', 'k4')] };
    const finalIds = new Set(['k1', 'k2']);
    expect(remapMindmap(map, { k4: 'k1' }, finalIds)?.nodes.map((n) => n.key_point_id)).toEqual(['k1', 'k1']);
    expect(remapMindmap({ ...map, nodes: [map.nodes[0]] }, { k4: 'k1' }, finalIds)).toBeNull();
    expect(remapKeyPoint('k9', {}, finalIds)).toBe('');
  });

  it('asks for at least 9 and at most 12 concepts', () => {
    expect(reorganizeMaxKeyPoints(4)).toBe(9);
    expect(reorganizeMaxKeyPoints(11)).toBe(11);
    expect(reorganizeMaxKeyPoints(20)).toBe(12);
  });
});
