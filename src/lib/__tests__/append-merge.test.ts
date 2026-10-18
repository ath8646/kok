import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  growthOfParts,
  keepFromCurrent,
  mergeFits,
  mergeGrowth,
  noteForMerge,
  remergeState,
  MAX_REMERGES,
  MERGE_GROWTH_MAX,
  MERGE_GROWTH_MIN,
  MERGE_OUT_TOKENS,
  NOTE_MERGE_MAX_CHARS,
} from '@/lib/append-merge';
import { zNote, type Note } from '@/lib/ai/schemas';

const note = (over: Partial<Note> = {}): Note =>
  zNote.parse({
    title: '전기',
    unit: '1. 전기',
    summary: '전기 요약',
    key_points: [
      { id: 'k1', title: '전류', explanation: '전하의 흐름', why: '자주 나온다', importance: 'high', pages: [1] },
      { id: 'k2', title: '전압', explanation: '전기를 흐르게 하는 능력', why: '', importance: 'medium', pages: [2] },
    ],
    terms: [{ term: '저항', meaning: '전류를 방해하는 정도' }],
    formulas: [],
    pitfalls: [],
    examples: [],
    checks: [],
    changes: [],
    ...over,
  });

describe('노트에 자료 더하기: AI 에 보낼 지금 노트', () => {
  it('긴 설명도 자르지 않고, 확인해 볼 것·바꾼 것까지 보낸다', () => {
    const long = '가'.repeat(5000);
    const n = note({
      key_points: [{ id: 'k1', title: '긴 개념', explanation: long, why: '', importance: 'high', pages: [] }],
      checks: [{ text: '확인해 보세요' }],
      changes: [{ text: '순서를 바꿨어요' }],
    });
    const out = noteForMerge(n);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.key_points[0].explanation).toBe(long);
    expect(parsed.checks).toEqual([{ text: '확인해 보세요' }]);
    expect(parsed.changes).toEqual([{ text: '순서를 바꿨어요' }]);
    // 화면 표시용 칸(별표·고침)은 보내지 않는다
    expect(JSON.stringify(noteForMerge(note({ key_points: [{ ...n.key_points[0], starred: true, edited: true }] })))).not.toContain('starred');
  });

  it('너무 길면 null (합치지 않고 새 노트로 넣으라고 안내)', () => {
    const n = note({ summary: '나'.repeat(NOTE_MERGE_MAX_CHARS) });
    expect(noteForMerge(n)).toBeNull();
  });
});

describe('노트에 자료 더하기: 합친 노트에 지금 노트의 것을 지킨다', () => {
  it("'확인해 보세요'·'바꾼 것'은 AI 가 빠뜨려도 지금 노트·새 자료의 것을 모두 남긴다 (같은 글은 한 번)", () => {
    const current = note({ checks: [{ text: '밤에도 광합성? 확인' }], changes: [{ text: '문단 순서를 바꿨어요' }] });
    const part = note({ checks: [{ text: '새 자료 확인할 것' }], changes: [{ text: '새 자료 고친 것' }] });
    const merged = note({ checks: [{ text: '새 자료 확인할 것' }], changes: [] });
    const out = keepFromCurrent(current, merged, [part]);
    expect(out.checks.map((c) => c.text)).toEqual(['밤에도 광합성? 확인', '새 자료 확인할 것']);
    expect(out.changes.map((c) => c.text)).toEqual(['문단 순서를 바꿨어요', '새 자료 고친 것']);
  });

  it('별표는 그대로, 내가 고친 개념은 AI 가 그대로 두었을 때만 고침 표시', () => {
    const current = note();
    current.key_points[0] = { ...current.key_points[0], starred: true, edited: true };
    current.key_points[1] = { ...current.key_points[1], edited: true };
    const merged = note();
    merged.key_points[1] = { ...merged.key_points[1], explanation: '새 자료로 보탠 설명' };
    const out = keepFromCurrent(current, merged);
    expect(out.key_points[0]).toMatchObject({ id: 'k1', starred: true, edited: true });
    expect(out.key_points[1].edited).toBeUndefined();
    expect(out.key_points[1].starred).toBeUndefined();
  });

  it('내가 고친 용어와 요약도 그대로면 표시가 남는다', () => {
    const current = note({ terms: [{ term: '저항', meaning: '전류를 방해하는 정도', edited: true }], summary_edited: true });
    const same = keepFromCurrent(current, note());
    expect(same.terms[0].edited).toBe(true);
    expect(same.summary_edited).toBe(true);
    const changed = keepFromCurrent(current, note({ summary: '새 요약', terms: [{ term: '저항', meaning: '바뀐 뜻' }] }));
    expect(changed.terms[0].edited).toBeUndefined();
    expect(changed.summary_edited).toBeUndefined();
  });
});

describe('노트에 자료 더하기: 지금 버전에 다시 합치기', () => {
  const draft = {
    note: { summary: '옛 버전에 합친 노트' },
    visual: { mindmap: {} },
    questions: [{ prompt: 'q' }],
    base: 'abc123',
    newParts: [{ title: '새 자료' }],
    parentNoteId: 'n1',
    pdfParts: [{ start: 1, end: 15, path: 'p' }],
    attempts: 2,
  };

  it('합치기 단계로 돌아가고, 새 자료의 정리는 그대로 쓰고, 옛 버전으로 만든 것은 버린다', () => {
    const s = remergeState(draft)!;
    expect(s.step).toBe('merge');
    expect(s.partials).toEqual(draft.newParts);
    expect(s.draft).toMatchObject({ newParts: draft.newParts, parentNoteId: 'n1', pdfParts: draft.pdfParts, attempts: 0, remerged: 1 });
    for (const k of ['note', 'visual', 'questions', 'base']) expect(s.draft).not.toHaveProperty(k);
  });

  it('새 자료의 정리가 없으면 처음부터 다시 정리한다', () => {
    const s = remergeState({ ...draft, newParts: [] })!;
    expect(s).toMatchObject({ step: 'organize', chunk_index: 0, partials: [] });
  });

  it('끝없이 다시 하지 않는다', () => {
    expect(remergeState({ ...draft, remerged: MAX_REMERGES - 1 })?.draft.remerged).toBe(MAX_REMERGES);
    expect(remergeState({ ...draft, remerged: MAX_REMERGES })).toBeNull();
  });
});

describe('노트에 자료 더하기: 합친 노트가 답 길이에 들어갈지', () => {
  it('한글은 한 글자에 1, 영어·기호는 0.3 으로 넉넉히 센다', () => {
    expect(estimateTokens('가나다')).toBe(3);
    expect(estimateTokens('abcdefghij')).toBe(3);
    expect(estimateTokens('{"a":"가"}')).toBe(1 + Math.ceil(8 * 0.3));
  });

  it('지금 노트가 답 길이의 대부분을 쓰면 합치지 않는다', () => {
    const short = noteForMerge(note())!;
    expect(mergeFits(short)).toBe(true);
    const long = noteForMerge(note({ summary: '가'.repeat(MERGE_OUT_TOKENS) }))!;
    expect(long).not.toBeNull();
    expect(mergeFits(long)).toBe(false);
  });

  it('새 자료가 늘리는 양은 정해진 범위 안으로 본다 (개념 수가 정해져 있어서)', () => {
    expect(mergeGrowth(0)).toBe(MERGE_GROWTH_MIN);
    expect(mergeGrowth(900)).toBe(900);
    expect(mergeGrowth(50_000)).toBe(MERGE_GROWTH_MAX);
    expect(mergeGrowth(Number.NaN)).toBe(MERGE_GROWTH_MAX);
    expect(growthOfParts(JSON.stringify({ summary: '나'.repeat(4000) }))).toBeGreaterThan(2000);
  });

  it('짧은 노트에 아주 긴 자료(90쪽 PDF 정리 여러 개)를 더해도 합친다', () => {
    const short = noteForMerge(note())!;
    const parts = JSON.stringify(Array.from({ length: 10 }, () => ({ summary: '가'.repeat(1900) })));
    expect(estimateTokens(parts)).toBeGreaterThan(MERGE_OUT_TOKENS * 2);
    expect(mergeFits(short, growthOfParts(parts))).toBe(true);
  });

  it('노트가 길면 새 자료가 늘릴 양까지 보고 막는다', () => {
    const big = noteForMerge(note({ summary: '가'.repeat(5600) }))!;
    expect(mergeFits(big)).toBe(true);
    expect(mergeFits(big, MERGE_GROWTH_MAX)).toBe(false);
    expect(mergeFits(big, growthOfParts(JSON.stringify({ summary: '나'.repeat(4000) })))).toBe(false);
  });
});
