// 노트 안의 순서: 별표한 개념은 위에 (별표끼리는 내가 정한 순서), 그다음 나머지 (그 순서대로).
// 끌어서 옮기기는 같은 묶음(별표·별표 아님) 안에서만 한다. 저장하는 배열 순서가 '내가 정한 순서'다.

export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const a = arr.slice();
  if (from < 0 || from >= a.length || to < 0 || to >= a.length) return a;
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

/** 화면에 보일 순서: 별표 먼저 */
export function starredFirst<T extends { starred?: boolean }>(items: T[]): T[] {
  return [...items.filter((x) => x.starred), ...items.filter((x) => !x.starred)];
}

/** 같은 묶음 안에서 activeId 를 overId 자리로 옮긴 새 배열 (묶음이 다르거나 없으면 null) */
export function moveInGroup<T extends { id: string; starred?: boolean }>(items: T[], activeId: string, overId: string): T[] | null {
  if (activeId === overId) return null;
  const a = items.find((k) => k.id === activeId);
  const o = items.find((k) => k.id === overId);
  if (!a || !o || !!a.starred !== !!o.starred) return null;
  const inGroup = (k: T) => !!k.starred === !!a.starred;
  const group = items.filter(inGroup);
  const moved = arrayMove(
    group,
    group.findIndex((k) => k.id === activeId),
    group.findIndex((k) => k.id === overId),
  );
  let g = 0;
  return items.map((k) => (inGroup(k) ? moved[g++] : k));
}

/** 목록 칸에 쓸 번호가 없으면 붙인다 (공식·용어: 끌어서 옮길 때 같은 칸을 알아보려고) */
export function withIds<T extends { id?: string }>(items: T[], prefix: string): Array<T & { id: string }> {
  const used = new Set(items.map((x) => x.id).filter(Boolean));
  let n = 0;
  return items.map((x) => {
    if (x.id) return x as T & { id: string };
    let id = `${prefix}${++n}`;
    while (used.has(id)) id = `${prefix}${++n}`;
    used.add(id);
    return { ...x, id };
  });
}
