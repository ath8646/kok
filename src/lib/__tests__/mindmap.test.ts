import { describe, expect, it } from 'vitest';
import { branchColor, branchOfKeyPoint, branchOfNode, branchesOf } from '@/lib/mindmap-branches';
import type { Mindmap } from '@/lib/ai/schemas';

const node = (id: string, parent_id: string, label: string, key_point_id = '', hint?: string) => ({
  id,
  parent_id,
  label,
  icon: '',
  key_point_id,
  pages: [],
  hint,
});

const map: Mindmap = {
  root_label: '광합성',
  nodes: [
    node('n1', '', '재료', 'k1', '  물과 이산화탄소를 먼저 떠올려요 '),
    node('n2', '', '장소', 'k2'),
    node('n3', 'n1', '물'),
    node('n4', 'n3', '뿌리에서 흡수', 'k9'),
    node('n5', 'n2', '엽록체'),
    // 고리: 가운데에 붙는다
    node('x1', 'x2', '고리 1'),
    node('x2', 'x1', '고리 2'),
  ],
};

describe('마인드맵 가지 묶기', () => {
  it('1단계 가지마다 이름·외우기 한 줄·아래 가지 수', () => {
    const { rootLabel, branches } = branchesOf(map);
    expect(rootLabel).toBe('광합성');
    expect(branches.map((b) => b.id)).toEqual(['n1', 'n2', 'x1', 'x2']);
    expect(branches[0]).toMatchObject({ label: '재료', hint: '물과 이산화탄소를 먼저 떠올려요', keyPointId: 'k1', index: 0, size: 2 });
    expect(branches[1]).toMatchObject({ hint: '', size: 1, index: 1 });
  });

  it('노드가 어느 가지 아래인지', () => {
    expect(branchOfNode(map, 'n4')).toBe('n1');
    expect(branchOfNode(map, 'n2')).toBe('n2');
    expect(branchOfNode(map, '__root__')).toBeNull();
  });

  it('개념이 걸린 가지: 가지 자신이나 그 아래 노드', () => {
    const { branches } = branchesOf(map);
    expect(branchOfKeyPoint(branches, 'k1')).toBe('n1');
    expect(branchOfKeyPoint(branches, 'k9')).toBe('n1');
    expect(branchOfKeyPoint(branches, 'k2')).toBe('n2');
    expect(branchOfKeyPoint(branches, 'k7')).toBeNull();
    expect(branchOfKeyPoint(branches, null)).toBeNull();
    expect(branchOfKeyPoint(branches, '')).toBeNull();
  });

  it('가지 색: 가지마다 돌아가며, 과목 색, 흑백', () => {
    expect(branchColor(0, 'branch', 'blue')).toBe('var(--b1)');
    expect(branchColor(9, 'branch', 'blue')).toBe('var(--b2)');
    expect(branchColor(3, 'mono', 'blue')).toBe('var(--ink)');
    expect(branchColor(3, 'subject', 'nope')).toBe('var(--b1)');
  });
});
