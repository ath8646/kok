// 마인드맵을 가지(1단계)별로 묶기: 한눈 지도·가지 카드·가지 자세히에 쓴다 (화면 공통, 시험 있음)
import type { Mindmap } from '@/lib/ai/schemas';
import { SUBJECT_COLOR_INDEX } from './colors';
import { ROOT_ID, buildTree, type TreeNode } from './mindmap-layout';

export type Branch = {
  id: string;
  label: string;
  icon: string;
  /** 외우기 한 줄 (AI, 예전 그림에는 없다) */
  hint: string;
  keyPointId: string;
  /** 가지 번호 (색) */
  index: number;
  children: TreeNode[];
  /** 아래 가지 모두의 수 */
  size: number;
};

function count(t: TreeNode): number {
  return t.children.reduce((a, c) => a + 1 + count(c), 0);
}

/** 가운데 주제와 가지들 (AI 가 준 순서대로) */
export function branchesOf(spec: Mindmap): { rootLabel: string; branches: Branch[] } {
  const root = buildTree(spec);
  const hints = new Map(spec.nodes.map((n) => [n.id, (n.hint ?? '').trim()]));
  return {
    rootLabel: root.label,
    branches: root.children.map((c, i) => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      hint: hints.get(c.id) ?? '',
      keyPointId: c.keyPointId,
      index: i,
      children: c.children,
      size: count(c),
    })),
  };
}

/** 어느 가지 아래의 노드인지 (1단계 가지 번호). 가운데 주제면 null */
export function branchOfNode(spec: Mindmap, nodeId: string): string | null {
  if (nodeId === ROOT_ID) return null;
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  let cur = byId.get(nodeId);
  const seen = new Set<string>();
  while (cur && cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parent_id);
  }
  return cur?.id ?? null;
}

/** 이 개념이 걸린 가지 (가지 자신 또는 그 아래 노드). 없으면 null */
export function branchOfKeyPoint(branches: Branch[], keyPointId: string | null | undefined): string | null {
  if (!keyPointId) return null;
  const has = (t: TreeNode): boolean => t.keyPointId === keyPointId || t.children.some(has);
  return branches.find((b) => b.keyPointId === keyPointId || b.children.some(has))?.id ?? null;
}

/** 가지 색 (화면 색 변수): 가지마다·과목 색·흑백 설정을 따른다 */
export function branchColor(index: number, mode: 'branch' | 'subject' | 'mono', subjectColor: string): string {
  if (mode === 'mono') return 'var(--ink)';
  if (mode === 'subject') return `var(--b${(SUBJECT_COLOR_INDEX[subjectColor] ?? 0) + 1})`;
  return `var(--b${(((index % 8) + 8) % 8) + 1})`;
}
