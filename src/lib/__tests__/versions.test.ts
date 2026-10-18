import { describe, expect, it } from 'vitest';
import { materialLabel, removalPlan, toVersionRow, versionItems, type Material, type VersionRow } from '@/lib/versions';
import { applyNoteAddition } from '@/lib/note-edit';
import { zNote } from '@/lib/ai/schemas';

const first: Material = { source_id: 'p', kind: 'pdf', title: '01A79432.pdf', page_count: 12 };
const child: Material = { source_id: 'c1', kind: 'text', title: '', page_count: null };

function row(number: number, materials: Material[] = [first], question_ids: string[] = []): VersionRow {
  return { id: `v${number}`, number, title: '', materials, question_ids, created_at: `2026-10-0${number}T00:00:00Z`, updated_at: '' };
}

describe('버전 기록 목록', () => {
  it('버전 행이 없으면 지금 노트가 버전 1이다', () => {
    const items = versionItems([], 1, { first, questionCount: 7, createdAt: '2026-10-01T00:00:00Z', existing: new Set() });
    expect(items).toEqual([{ number: 1, current: true, added: first, materialCount: 1, questionCount: 7, createdAt: '2026-10-01T00:00:00Z' }]);
  });

  it('번호 순으로, 버전마다 그때 더한 자료와 아직 있는 문제 수를 보여 준다', () => {
    const rows = [row(2, [first, child], ['a', 'b', 'gone']), row(1, [first], ['a'])];
    const items = versionItems(rows, 1, { first, questionCount: 3, createdAt: null, existing: new Set(['a', 'b']) });
    expect(items.map((i) => i.number)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ current: true, added: first, questionCount: 3 });
    // 지난 버전: 지워진 문제(gone)는 세지 않는다
    expect(items[1]).toMatchObject({ current: false, added: child, materialCount: 2, questionCount: 2 });
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
