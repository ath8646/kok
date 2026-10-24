import { describe, expect, it } from 'vitest';
import { materialLabel, onlyInVersion, removalPlan, toVersionRow, versionItems, type Material, type VersionRow } from '@/lib/versions';
import { applyNoteAddition, applyTerms } from '@/lib/note-edit';
import { zNote } from '@/lib/ai/schemas';

const first: Material = { source_id: 'p', kind: 'pdf', title: '01A79432.pdf', page_count: 12 };
const child: Material = { source_id: 'c1', kind: 'text', title: '', page_count: null };

function row(number: number, materials: Material[] = [first], question_ids: string[] = []): VersionRow {
  return { id: `v${number}`, number, title: '', materials, question_ids, created_at: `2026-10-0${number}T00:00:00Z`, updated_at: '' };
}

describe('버전 기록 목록', () => {
  it('버전 행이 없으면 지금 노트가 버전 1이다', () => {
    const items = versionItems([], 1, { first, questionCount: 7, createdAt: '2026-10-01T00:00:00Z', existing: new Set() });
    expect(items).toEqual([{ number: 1, current: true, kind: 'first', added: [first], materialCount: 1, questionCount: 7, createdAt: '2026-10-01T00:00:00Z' }]);
  });

  it('합친 노트는 버전 행이 없어도 합쳐 들어온 자료까지 센다', () => {
    const items = versionItems([], 1, { first, questionCount: 2, createdAt: null, existing: new Set(), kids: 2 });
    expect(items[0]).toMatchObject({ kind: 'first', materialCount: 3 });
  });

  it('AI로 다시 정리한 버전은 더한 자료 없이 그 까닭으로 보인다', () => {
    const rows: VersionRow[] = [
      { ...row(1, [first, child]), kind: 'first' },
      { ...row(2, [first, child]), kind: 'reorganize' },
      { ...row(3, [first, child, { ...child, source_id: 'c2' }]), kind: 'append' },
    ];
    const items = versionItems(rows, 3, { first, questionCount: 1, createdAt: null, existing: new Set() });
    expect(items.map((i) => i.kind)).toEqual(['first', 'reorganized', 'added']);
    // 처음 버전은 (합친 자료가 있어도) 처음 자료를, 다시 정리한 버전은 자료 없이
    expect(items[0].added).toEqual([first]);
    expect(items[1].added).toEqual([]);
    expect(items[2].added.map((m) => m.source_id)).toEqual(['c2']);
    expect(toVersionRow({ id: 'x', number: 2, kind: 'reorganize' }).kind).toBe('reorganize');
    expect(toVersionRow({ id: 'x', number: 2, kind: 'hack' }).kind).toBeNull();
  });

  it('번호 순으로, 버전마다 그때 더한 자료와 아직 있는 문제 수를 보여 준다', () => {
    const rows = [row(2, [first, child], ['a', 'b', 'gone']), row(1, [first], ['a'])];
    const items = versionItems(rows, 1, { first, questionCount: 3, createdAt: null, existing: new Set(['a', 'b']) });
    expect(items.map((i) => i.number)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ current: true, added: [first], questionCount: 3 });
    // 지난 버전: 지워진 문제(gone)는 세지 않는다
    expect(items[1]).toMatchObject({ current: false, added: [child], materialCount: 2, questionCount: 2 });
  });

  it('노트를 합친 버전은 합쳐 들어온 자료들을 보여 준다 (added 표시)', () => {
    const merged = [
      { ...child, source_id: 'm1', title: '둘째 노트', added: true },
      { ...child, source_id: 'm2', title: '셋째 노트', added: true },
    ];
    const rows: VersionRow[] = [
      { ...row(1, [first]), kind: 'first' },
      { ...row(2, [first, { ...child, added: true }]), kind: 'append' },
      { ...row(3, [first, child, ...merged]), kind: 'merge' },
    ];
    const items = versionItems(rows, 3, { first, questionCount: 4, createdAt: null, existing: new Set() });
    expect(items.map((i) => i.kind)).toEqual(['first', 'added', 'merged']);
    expect(items[1].added.map((m) => m.source_id)).toEqual(['c1']);
    expect(items[2].added.map((m) => m.title)).toEqual(['둘째 노트', '셋째 노트']);
    expect(items[2].materialCount).toBe(4);
    expect(toVersionRow({ id: 'x', number: 3, kind: 'merge', materials: [{ source_id: 'm1', added: true }] }).materials[0].added).toBe(true);
  });

  it('버전을 지우면 같이 지워지는 자료는 그 버전에만 있는 더한 자료다', () => {
    const rows: VersionRow[] = [row(1, [first]), row(2, [first, child]), row(3, [first, child, { ...child, source_id: 'm1', title: '합친 노트' }])];
    expect(onlyInVersion(rows, 3, 'p').map((m) => m.source_id)).toEqual(['m1']);
    expect(onlyInVersion(rows, 2, 'p')).toEqual([]);
    expect(onlyInVersion(rows, 1, 'p')).toEqual([]);
    expect(onlyInVersion(rows, 9, 'p')).toEqual([]);
  });

  it('DB 행의 이상한 값은 버린다', () => {
    const r = toVersionRow({ id: 1, number: '3', materials: [{ source_id: 'x', kind: 'weird' }, null, { kind: 'pdf' }], question_ids: null });
    expect(r.number).toBe(3);
    expect(r.materials).toEqual([{ source_id: 'x', kind: 'text', title: '', page_count: null }]);
    expect(r.question_ids).toEqual([]);
  });

  it('자료 이름이 없으면 종류로 부른다', () => {
    expect(materialLabel(first)).toBe('01A79432.pdf');
    expect(materialLabel({ kind: 'pdf', title: '', page_count: 3 })).toBe('PDF 3쪽');
    expect(materialLabel({ kind: 'image', title: '', page_count: null })).toBe('사진');
    expect(materialLabel(child)).toBe('직접 쓴 글');
  });
});

describe('문제를 버전에서 빼기', () => {
  const rows = [row(1, [first], ['q1', 'shared']), row(2, [first, child], ['shared', 'q2']), row(3, [first, child], ['q3'])];

  it('지금 버전: 다른 버전에도 있으면 숨기고, 없으면 지운다', () => {
    expect(removalPlan('shared', rows, 2, 2, true)).toBe('hide');
    expect(removalPlan('q2', rows, 2, 2, true)).toBe('delete');
  });

  it('지금 버전 행은 오래됐을 수 있어서 보지 않는다', () => {
    // 버전 3이 지금 버전이면 행의 q3 는 믿지 않는다 (지금 노트에서는 이미 지웠을 수 있다)
    expect(removalPlan('q1', rows, 1, 3, false)).toBe('delete');
  });

  it('지난 버전: 지금 버전이나 다른 지난 버전에 있으면 목록에서만 빼고, 없으면 지운다', () => {
    expect(removalPlan('shared', rows, 3, 1, false)).toBe('unlist');
    expect(removalPlan('q1', rows, 3, 1, true)).toBe('unlist');
    expect(removalPlan('q1', rows, 3, 1, false)).toBe('delete');
  });
});

describe('채팅에서 노트에 넣기', () => {
  const note = zNote.parse({
    summary: '요약',
    key_points: [
      { id: 'k1', title: '전력', explanation: '전력은 일률이다.', importance: 'high' },
      { id: 'k2', title: '전력량', explanation: '전력량은 에너지다.' },
    ],
  });

  it('맞는 개념이 있으면 그 개념 설명 끝에 붙인다', () => {
    const next = applyNoteAddition(note, { key_point_id: 'k2', title: '', text: '단위는 Wh 예요.' });
    expect(next.key_points).toHaveLength(2);
    expect(next.key_points[1].explanation).toContain('전력량은 에너지다.');
    expect(next.key_points[1].explanation).toContain('단위는 Wh 예요.');
    expect(next.key_points[0]).toEqual(note.key_points[0]);
  });

  it('맞는 개념이 없으면 새 개념으로 더한다 (번호가 겹치지 않게)', () => {
    const next = applyNoteAddition(note, { key_point_id: 'zz', title: '전압', text: '전압은 전기를 미는 힘이에요.' });
    expect(next.key_points).toHaveLength(3);
    const added = next.key_points[2];
    expect(added.title).toBe('전압');
    expect(added.explanation).toBe('전압은 전기를 미는 힘이에요.');
    expect(['k1', 'k2']).not.toContain(added.id);
  });
});

describe('채팅에서 용어 넣기', () => {
  const note = { terms: [{ term: '엽록체', meaning: '광합성이 일어나는 곳' }] };
  it('새 용어는 뒤에, 이미 있는 용어(띄어쓰기·대소문자 무시)는 뜻만 바꾸고 고친 표시를 남긴다', () => {
    const r = applyTerms(note, [
      { term: '엽 록체', meaning: '식물 세포의 초록색 소기관' },
      { term: '기공', meaning: '잎의 작은 구멍' },
      { term: ' ', meaning: '빈 용어' },
      { term: '없는 뜻', meaning: '' },
    ]);
    expect(r.added).toBe(2);
    expect(r.note.terms).toEqual([
      { term: '엽록체', meaning: '식물 세포의 초록색 소기관', edited: true },
      { term: '기공', meaning: '잎의 작은 구멍', edited: true },
    ]);
  });
  it('뜻까지 같은 용어는 세지 않고 노트를 바꾸지 않는다', () => {
    const r = applyTerms(note, [{ term: '엽록체', meaning: '광합성이 일어나는 곳' }]);
    expect(r.added).toBe(0);
    expect(r.note).toBe(note);
  });
});
