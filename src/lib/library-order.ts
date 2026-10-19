// 자료함 정리: 카드 순서(별표 먼저 → 내가 정한 순서 → 새 자료 먼저)와 순서 바꾸기 (화면·시험 공통)

/** 한 번에 고쳐 바꾸거나 지울 수 있는 자료 수 (자료함에서 여러 개 고르기) */
export const BULK_MAX = 100;

export type Orderable = { id: string; created_at: string; starred?: boolean | null; position?: number | null };

/**
 * 자료함 카드 순서. 별표한 자료가 먼저, 그다음 내가 정한 순서(byPosition: 과목 안에서만. 번호가 없는 새 자료는 맨 앞),
 * 같으면 새 자료 먼저. 받은 목록은 바꾸지 않는다
 */
export function libraryOrder<T extends Orderable>(list: T[], byPosition: boolean): T[] {
  return [...list].sort((a, b) => {
    const s = Number(!!b.starred) - Number(!!a.starred);
    if (s) return s;
    if (byPosition) {
      const pa = a.position ?? null;
      const pb = b.position ?? null;
      if (pa === null && pb !== null) return -1;
      if (pb === null && pa !== null) return 1;
      if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    }
    const t = Date.parse(b.created_at) - Date.parse(a.created_at);
    return t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** 순서 바꾸기 화면에서 묶음(단원·별표)마다 옮긴 결과 → 과목 전체의 새 순서 (화면에 보이는 차례 그대로) */
export function flattenOrder<T extends { id: string }>(groups: T[][]): string[] {
  return groups.flatMap((g) => g.map((x) => x.id));
}

/** 새 순서대로 position 을 0, 1, 2 … 로 붙인다 (서버 함수 kok_reorder_sources 와 같게: 화면을 바로 바꿀 때) */
export function withPositions<T extends { id: string; position?: number | null }>(list: T[], order: string[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return list.map((x) => (at.has(x.id) ? { ...x, position: at.get(x.id)! } : x));
}

/**
 * 고른 자료들에 한꺼번에 할 일: star = 별표하기(하나라도 별표가 없으면. 모두 별표면 false = 별표 빼기),
 * review = 복습에 넣기(하나라도 복습을 끈 자료가 있으면. 모두 복습에 들어가 있으면 false = 복습 끄기)
 */
export function bulkLabels(picked: Array<{ starred?: boolean | null; in_review?: boolean | null }>): { star: boolean; review: boolean } {
  return {
    star: !picked.length || picked.some((p) => !p.starred),
    review: picked.some((p) => p.in_review === false),
  };
}
