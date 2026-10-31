import { describe, expect, it } from 'vitest';
import { applyMergePlan, fallbackMergePlan, noteForPlan, partsForPlan, planOutTokens, readPlanId, zMergePlan, type MergePlan } from '@/lib/merge-plan';
import { keepFromCurrent } from '@/lib/append-merge';
import { zNote, type Note } from '@/lib/ai/schemas';
import { schemaProps, SCHEMA_PROPS_MAX } from '@/lib/ai/schema-registry';
import { mergePlanJsonSchema } from '@/lib/ai/schemas';

const kp = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  explanation: `${title} 설명`,
  why: `${title} 중요`,
  importance: 'medium',
  pages: [],
  ...over,
});

const note = (over: Record<string, unknown>): Note =>
  zNote.parse({
    title: '자료',
    unit: '1단원',
    summary: '요약',
    key_points: [],
    terms: [],
    formulas: [],
    pitfalls: [],
    examples: [],
    checks: [],
    changes: [],
    ...over,
  });

const plan = (items: Array<{ from: string[]; title?: string; explanation?: string; why?: string }>, over: Partial<MergePlan> = {}): MergePlan =>
  zMergePlan.parse({
    title: '합친 제목',
    unit: '1단원',
    summary: '합친 요약',
    key_points: items.map((i) => ({ title: '', explanation: '', why: '', ...i })),
    ...over,
  });

const p1 = note({
  title: '세포 1',
  key_points: [kp('k1', '세포막', { pages: [1], importance: 'high' }), kp('k2', '핵', { pages: [2] })],
  terms: [{ term: '세포막', meaning: '세포를 둘러싼 막' }],
  formulas: [{ latex: 'a + b', label: '식' }],
  pitfalls: [{ text: '핵과 핵막을 헷갈려요', key_point_id: 'k2' }],
  examples: [{ text: '양파 표피 세포', key_point_id: 'k1' }],
  checks: [{ text: '확인 1' }],
});
const p2 = note({
  title: '세포 2',
  key_points: [kp('k1', '세포막의 기능', { pages: [16], importance: 'low' }), kp('k2', '미토콘드리아', { pages: [17] }), kp('k3', '엽록체', { pages: [18] })],
  terms: [
    { term: '세포막', meaning: '다른 뜻' },
    { term: '엽록체', meaning: '광합성 장소' },
  ],
  formulas: [{ latex: 'a+b', label: '같은 식' }],
  pitfalls: [{ text: '미토콘드리아는 동물에만?', key_point_id: 'k2' }],
  examples: [{ text: '양파 표피 세포', key_point_id: 'k1' }],
  checks: [{ text: '확인 1' }, { text: '확인 2' }],
});

describe('합치기 계획: AI 에 보내는 것과 받는 모양', () => {
  it('조각의 개념에는 조각 번호를 붙이고, 지금 노트의 개념은 번호 그대로 보낸다 (용어 등은 보내지 않는다)', () => {
    const parts = JSON.parse(partsForPlan([p1, p2]));
    expect(parts[1].key_points.map((k: { id: string }) => k.id)).toEqual(['p2.k1', 'p2.k2', 'p2.k3']);
    expect(parts[0]).not.toHaveProperty('terms');
    const cur = JSON.parse(noteForPlan(p1));
    expect(cur.key_points.map((k: { id: string }) => k.id)).toEqual(['k1', 'k2']);
  });

  it('번호를 조금 다르게 적어도 읽는다', () => {
    expect(readPlanId('P1.K3')).toBe('p1.k3');
    expect(readPlanId('p2-k1')).toBe('p2.k1');
    expect(readPlanId('2.k4')).toBe('p2.k4');
    expect(readPlanId(' K5 ')).toBe('k5');
  });

  it('답 모양은 작고(문법 한도 안), 답 길이는 노트 크기와 상관없이 정해진 끝 안', () => {
    expect(schemaProps(mergePlanJsonSchema)).toBeLessThanOrEqual(SCHEMA_PROPS_MAX);
    expect(planOutTokens(80, 24)).toBeLessThanOrEqual(16_000);
    expect(planOutTokens(10, 9)).toBeLessThan(planOutTokens(60, 24));
  });
});

describe('합치기 계획: 새 노트 (조각 합치기)', () => {
  it('계획의 차례대로, 같은 것을 묶은 개념은 AI 가 쓴 글로, 하나짜리는 그대로 옮기고 번호는 k1부터', () => {
    const n = applyMergePlan(
      plan([
        { from: ['p1.k1', 'p2.k1'], title: '세포막', explanation: '합친 설명', why: '합친 이유' },
        { from: ['p1.k2'], explanation: '무시' },
        { from: ['p2.k2'] },
        { from: ['p2.k3'] },
      ]),
      [p1, p2],
      { maxKeyPoints: 10 },
    );
    expect(n.key_points.map((k) => k.id)).toEqual(['k1', 'k2', 'k3', 'k4']);
    expect(n.key_points[0]).toMatchObject({ title: '세포막', explanation: '합친 설명', why: '합친 이유', importance: 'high', pages: [1, 16] });
    // 하나짜리는 AI 가 글을 써도 원래 글 그대로
    expect(n.key_points[1]).toMatchObject({ title: '핵', explanation: '핵 설명', pages: [2] });
    expect(n.title).toBe('합친 제목');
    expect(n.summary).toBe('합친 요약');
  });

  it('용어(같은 낱말은 한 번)·공식(빈칸 빼고 같은 식은 한 번)·함정·예시(새 번호로, 같은 글은 한 번)·확인해 볼 것을 모두 옮긴다', () => {
    const n = applyMergePlan(plan([{ from: ['p1.k1', 'p2.k1'] }, { from: ['p1.k2'] }, { from: ['p2.k2'] }, { from: ['p2.k3'] }]), [p1, p2], {
      maxKeyPoints: 10,
    });
    expect(n.terms.map((t) => `${t.term}=${t.meaning}`)).toEqual(['세포막=세포를 둘러싼 막', '엽록체=광합성 장소']);
    expect(n.formulas).toHaveLength(1);
    expect(n.pitfalls).toEqual([
      { text: '핵과 핵막을 헷갈려요', key_point_id: 'k2' },
      { text: '미토콘드리아는 동물에만?', key_point_id: 'k3' },
    ]);
    expect(n.examples).toEqual([{ text: '양파 표피 세포', key_point_id: 'k1' }]);
    expect(n.checks.map((c) => c.text)).toEqual(['확인 1', '확인 2']);
    // 묶었는데 AI 가 글을 안 쓰면 원래 글을 이어 붙인다 (빠뜨리지 않게)
    expect(n.key_points[0].explanation).toBe('세포막 설명\n세포막의 기능 설명');
  });

  it('단어장을 합칠 때는 같은 낱말의 다른 뜻을 둘 다 둔다', () => {
    const n = applyMergePlan(fallbackMergePlan([p1, p2]), [p1, p2], { maxKeyPoints: 10, wordLists: true });
    expect(n.terms.filter((t) => t.term === '세포막')).toHaveLength(2);
  });

  it('AI 가 빠뜨린 개념은 같은 조각의 바로 앞 개념 뒤에 넣고, 모르는 번호·두 번 나온 번호는 건너뛴다', () => {
    const n = applyMergePlan(plan([{ from: ['p1.k1', 'p1.k1', 'p9.k9'] }, { from: ['p2.k1'] }, { from: ['p2.k3'] }]), [p1, p2], { maxKeyPoints: 10 });
    expect(n.key_points.map((k) => k.title)).toEqual(['세포막', '핵', '세포막의 기능', '미토콘드리아', '엽록체']);
  });

  it('개념이 끝보다 많으면 덜 중요한 것부터 같은 조각의 가까운 개념 끝에 붙인다 (빼지 않는다: 내용·함정·예시가 따라간다)', () => {
    const n = applyMergePlan(fallbackMergePlan([p1, p2]), [p1, p2], { maxKeyPoints: 4 });
    expect(n.key_points.map((k) => k.title)).toEqual(['세포막', '핵', '미토콘드리아', '엽록체']);
    // 세포막의 기능(가장 덜 중요)은 같은 조각의 미토콘드리아 끝에 이름과 함께
    expect(n.key_points[2].explanation).toBe('미토콘드리아 설명\n**세포막의 기능**: 세포막의 기능 설명');
    expect(n.key_points[2].pages).toEqual([16, 17]);
    // 개념이 몇 개든 모든 설명이 남는다
    const all = n.key_points.map((k) => k.explanation).join('\n');
    for (const k of [...p1.key_points, ...p2.key_points]) expect(all).toContain(k.explanation);
    // 한 개념으로 줄여도 그렇다
    const one = applyMergePlan(fallbackMergePlan([p1, p2]), [p1, p2], { maxKeyPoints: 1 });
    expect(one.key_points).toHaveLength(1);
    for (const k of [...p1.key_points, ...p2.key_points]) expect(one.key_points[0].explanation).toContain(k.explanation);
    expect(one.pitfalls.every((p) => p.key_point_id === 'k1')).toBe(true);
  });

  it('AI 가 개념 수를 지키지 않아도 내용은 그대로 (묶은 개념의 AI 글에 붙인다)', () => {
    const n = applyMergePlan(
      plan([{ from: ['p1.k1', 'p2.k1'], title: '세포막', explanation: '합친 설명' }, { from: ['p1.k2'] }, { from: ['p2.k2'] }, { from: ['p2.k3'] }]),
      [p1, p2],
      { maxKeyPoints: 2 },
    );
    expect(n.key_points).toHaveLength(2);
    const all = n.key_points.map((k) => k.explanation).join('\n');
    expect(all).toContain('합친 설명');
    for (const t of ['핵 설명', '미토콘드리아 설명', '엽록체 설명']) expect(all).toContain(t);
  });

  it('AI 계획이 없을 때: 이름이 같은 개념만 묶는다', () => {
    const a = note({ key_points: [kp('k1', '광합성'), kp('k2', '호흡')] });
    const b = note({ key_points: [kp('k1', ' 광합성 '), kp('k2', '증산 작용')] });
    const n = applyMergePlan(fallbackMergePlan([a, b]), [a, b], { maxKeyPoints: 10 });
    expect(n.key_points.map((k) => k.title)).toEqual(['광합성', '호흡', '증산 작용']);
    expect(n.title).toBe('자료');
  });
});

describe('합치기 계획: 노트에 자료 더하기', () => {
  const current = note({
    title: '세포',
    summary: '내가 고친 요약',
    summary_edited: true,
    key_points: [kp('k1', '세포막', { starred: true, edited: true, explanation: '**내가** 쓴 설명', pages: [3] }), kp('k4', '핵')],
    terms: [{ term: '세포막', meaning: '내가 고친 뜻', edited: true }],
    pitfalls: [{ text: '내 함정', key_point_id: 'k4' }],
    checks: [{ text: '확인 1' }],
  });

  it('지금 노트의 개념은 번호·글·별표·고침 그대로, 새 개념은 다음 번호, 새 자료의 쪽 번호는 쓰지 않는다', () => {
    const merged = applyMergePlan(plan([{ from: ['k1'] }, { from: ['p1.k2'] }, { from: ['k4'] }, { from: ['p1.k3'] }]), [p2], { current, maxKeyPoints: 12 });
    // 빠뜨린 p1.k1 은 새 자료의 처음이라 앞에 둘 개념이 없어 끝에
    expect(merged.key_points.map((k) => k.id)).toEqual(['k1', 'k5', 'k4', 'k6', 'k7']);
    expect(merged.key_points.at(-1)?.title).toBe('세포막의 기능');
    expect(merged.key_points[0]).toMatchObject({ explanation: '**내가** 쓴 설명', starred: true, edited: true, pages: [3] });
    expect(merged.key_points[1].pages).toEqual([]);
  });

  it('새 개념을 지금 개념에 넣으면 지금 번호로, 글은 AI 가 쓴 것 (별표는 그대로), 지금 노트의 쪽만', () => {
    const merged = applyMergePlan(
      plan([
        { from: ['p1.k1', 'k1'], title: '세포막', explanation: '**내가** 쓴 설명 + 새 사실', why: '이유' },
        { from: ['k4'] },
        { from: ['p1.k2'] },
        { from: ['p1.k3'] },
      ]),
      [p2],
      { current, maxKeyPoints: 12 },
    );
    expect(merged.key_points[0]).toMatchObject({ id: 'k1', explanation: '**내가** 쓴 설명 + 새 사실', starred: true, pages: [3] });
    expect(merged.key_points[0].edited).toBeUndefined();
  });

  it('용어는 내가 고친 뜻 그대로 (같은 낱말은 더하지 않는다), 확인해 볼 것·요약 고침 표시도 남는다', () => {
    const merged = applyMergePlan(plan([{ from: ['k1'] }, { from: ['k4'] }], { summary: '내가 고친 요약' }), [p2], { current, maxKeyPoints: 12 });
    expect(merged.terms).toEqual([
      { term: '세포막', meaning: '내가 고친 뜻', edited: true },
      { term: '엽록체', meaning: '광합성 장소' },
    ]);
    expect(merged.summary_edited).toBe(true);
    expect(merged.checks.map((c) => c.text)).toEqual(['확인 1', '확인 2']);
    expect(merged.pitfalls[0]).toEqual({ text: '내 함정', key_point_id: 'k4' });
  });

  it('AI 가 지금 설명을 바꿔 쓰면 지금 설명 + 새 설명으로 (이름·왜도 지금 그대로)', () => {
    const merged = applyMergePlan(
      plan([
        { from: ['p1.k1', 'k1'], title: '세포막과 기능', explanation: '새로 쓴 설명', why: '새 이유' },
        { from: ['k4'] },
        { from: ['p1.k2'] },
        { from: ['p1.k3'] },
      ]),
      [p2],
      { current, maxKeyPoints: 12 },
    );
    expect(merged.key_points[0]).toMatchObject({
      id: 'k1',
      title: '세포막',
      explanation: '**내가** 쓴 설명\n세포막의 기능 설명',
      why: '세포막 중요',
      starred: true,
    });
  });

  it('지금 노트의 개념끼리는 묶지 않는다 (AI 계획이든, 이름이 같아도)', () => {
    const merged = applyMergePlan(plan([{ from: ['k1', 'k4', 'p1.k1'], title: '합침', explanation: '세 개를 합친 글' }]), [p2], { current, maxKeyPoints: 12 });
    const byId = new Map(merged.key_points.map((k) => [k.id, k]));
    expect(byId.get('k1')?.explanation).toBe('**내가** 쓴 설명\n세포막의 기능 설명');
    expect(byId.get('k4')).toMatchObject({ title: '핵', explanation: '핵 설명' });
    expect(merged.key_points.map((k) => k.title)).not.toContain('합침');
    const twin = note({ key_points: [kp('k1', '세포'), kp('k2', '세포'), kp('k3', '핵')] });
    const fb = fallbackMergePlan([note({ key_points: [kp('k1', '세포')] })], twin);
    expect(fb.key_points.map((k) => k.from)).toEqual([['k1', 'p1.k1'], ['k2'], ['k3']]);
  });

  it('새 개념 번호는 문제·마인드맵·그림이 가리키는 번호(reserved)를 피한다', () => {
    const merged = applyMergePlan(plan([{ from: ['k1'] }, { from: ['k4'] }, { from: ['p1.k2'] }, { from: ['p1.k3'] }, { from: ['p1.k1'] }]), [p2], {
      current,
      maxKeyPoints: 12,
      reserved: ['k5', 'k9', 'k4'],
    });
    expect(merged.key_points.map((k) => k.id)).toEqual(['k1', 'k4', 'k10', 'k11', 'k12']);
  });

  it('내가 고친 요약은 AI 가 새 요약을 써도 그대로', () => {
    const merged = applyMergePlan(plan([{ from: ['k1'] }, { from: ['k4'] }], { summary: 'AI 가 쓴 새 요약' }), [p2], { current, maxKeyPoints: 12 });
    expect(merged.summary).toBe('내가 고친 요약');
    expect(merged.summary_edited).toBe(true);
    expect(keepFromCurrent(current, merged, [p2]).summary_edited).toBe(true);
  });

  it('넘치는 새 개념은 붙이고 지금 개념은 그대로 둔다', () => {
    const merged = applyMergePlan(plan([{ from: ['k1'] }, { from: ['k4'] }, { from: ['p1.k1'] }, { from: ['p1.k2'] }, { from: ['p1.k3'] }]), [p2], {
      current,
      maxKeyPoints: 3,
    });
    expect(merged.key_points.map((k) => k.id)).toEqual(['k1', 'k4', 'k5']);
    expect(merged.key_points[0]).toMatchObject({ explanation: '**내가** 쓴 설명', edited: true });
    const all = merged.key_points.map((k) => k.explanation).join('\n');
    for (const k of p2.key_points) expect(all).toContain(k.explanation);
  });

  it('지금 노트의 개념은 개념 수 끝을 넘어도 빼지 않는다 (keepFromCurrent 가 지금 차례로)', () => {
    const merged = applyMergePlan(plan([{ from: ['k4'] }, { from: ['k1'] }]), [p2], { current, maxKeyPoints: 2 });
    expect(merged.key_points.map((k) => k.id)).toEqual(['k4', 'k1']);
    const kept = keepFromCurrent(current, merged, [p2]);
    expect(kept.key_points.map((k) => k.id)).toEqual(['k1', 'k4']);
  });
});
