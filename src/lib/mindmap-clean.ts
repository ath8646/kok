// 마인드맵 정리 (AI 가 준 가지를 고르고 다듬는다). 노트 만들기(파이프라인)와 그림 다시 만들기 라우트가 같이 쓴다.
// 파이프라인 파일과 나눠 두어서, 그림 다시 만들기 라우트가 자료 처리용 라이브러리(pdf.js·그림 자르기)를 싣지 않게 한다
import type { Mindmap } from '@/lib/ai/schemas';

export function maxNodesFor(depth: number): number {
  return depth <= 2 ? 24 : depth === 3 ? 42 : 60;
}

/** 마인드맵 정리: id 겹침 제거, 개수 제한, 잠긴(편집된) 노드 유지 */
export function cleanMindmap(raw: Mindmap, maxNodes: number, locked: Mindmap['nodes'] = []): Mindmap {
  const seen = new Set<string>();
  const nodes: Mindmap['nodes'] = [];
  for (const n of locked) {
    if (!n.id || seen.has(n.id)) continue;
    seen.add(n.id);
    nodes.push({ ...n, edited: true });
  }
  for (const n of raw.nodes) {
    const id = (n.id || '').trim();
    if (!id || seen.has(id) || id === '__root__') continue;
    if (nodes.length >= maxNodes + locked.length) break;
    seen.add(id);
    const hint = (n.hint ?? '').trim().slice(0, 80);
    nodes.push({ ...n, id, label: (n.label || '').trim().slice(0, 60) || '…', ...(hint ? { hint } : { hint: undefined }), edited: false });
  }
  return { root_label: (raw.root_label || '주제').trim().slice(0, 30), nodes };
}
