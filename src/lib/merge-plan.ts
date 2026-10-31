// 정리 조각 합치기·노트에 자료 더하기: AI 는 '합치는 계획'만 쓴다 (개념의 차례, 같은 것을 말하는 개념끼리 묶기, 묶은 개념의 새 설명).
// 앱이 그 계획대로 개념·용어·공식·함정·예시·확인해 볼 것을 옮긴다. 합친 노트 전체를 AI 가 다시 쓰지 않아서
// 노트가 커도 답이 잘리지 않고(예전: 개념 24개면 답 12600토큰에서 잘려 정리가 멈췄다) 빠르고 싸다.
// 서버의 처리 파이프라인(pipeline stepMerge·stepAppendMerge)과 시험(merge-plan.test.ts)이 같이 쓴다.
import { z } from 'zod';
import type { KeyPoint, Note } from './ai/schemas';
import { addMissingTerms, mergeTerms } from './material-questions';

/** AI 가 쓴 합치기 계획: 합친 노트의 개념을 차례대로, from = 그 개념이 된 개념들의 번호 */
export const zMergePlan = z.object({
  title: z.string().catch(''),
  unit: z.string().catch(''),
  summary: z.string().catch(''),
  key_points: z
    .array(
      z.object({
        from: z.array(z.string()).catch([]),
        title: z.string().catch(''),
        explanation: z.string().catch(''),
        why: z.string().catch(''),
      }),
    )
    .catch([]),
});
export type MergePlan = z.infer<typeof zMergePlan>;

/** 조각의 개념 번호 (계획에 쓰는 번호): 조각 n 의 k3 → "p1.k3". 지금 노트(더하기)의 개념은 번호 그대로 ("k3") */
export const partId = (part: number, id: string) => `p${part + 1}.${id}`;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const normKey = (s: string) => norm(s).toLowerCase();
/** 공식은 빈칸을 빼고 견준다 */
const latexKey = (s: string) => s.replace(/\s+/g, '');

/** AI 가 번호를 조금 다르게 적어도 읽는다: "P1.K3"·"p1-k3"·"1.k3" → "p1.k3", "K3" → "k3" */
export function readPlanId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^p?(\d+)[.\-_:/]?(k\d+)$/);
  if (m) return `p${Number(m[1])}.${m[2]}`;
  return s;
}

const MAX_LIST_CHARS = 4000;
const clipText = (s: string) => (s.length > MAX_LIST_CHARS ? `${s.slice(0, MAX_LIST_CHARS - 1)}…` : s);

/** AI 에 보낼 개념 (번호·이름·설명·왜 중요한지·중요도). 용어·공식 등은 앱이 옮기니 보내지 않는다 */
function listKeyPoints(kps: KeyPoint[], idOf: (id: string) => string) {
  return kps.map((k) => ({ id: idOf(k.id), title: k.title, explanation: clipText(k.explanation), why: clipText(k.why), importance: k.importance }));
}

/** 새 노트: 조각마다 개념 목록 (<parts>) */
export function partsForPlan(parts: Note[]): string {
  return JSON.stringify(
    parts.map((p, i) => ({
      part: i + 1,
      title: p.title,
      unit: p.unit,
      summary: p.summary,
      key_points: listKeyPoints(p.key_points, (id) => partId(i, id)),
    })),
  );
}

/** 노트에 더하기: 지금 노트의 개념 목록 (<note>) */
export function noteForPlan(note: Note): string {
  return JSON.stringify({ title: note.title, unit: note.unit, summary: note.summary, key_points: listKeyPoints(note.key_points, (id) => id) });
}

/**
 * 계획의 답 길이(토큰): 개념 하나에 번호 몇 개(약 40토큰), 묶은 개념은 새 설명(약 350토큰)을 쓰니 노트 끝 개념 수만큼 넉넉히.
 * 답은 쓴 만큼만 낸다 (같은 것이 적으면 짧다)
 */
export function planOutTokens(items: number, maxKeyPoints: number): number {
  return Math.min(16_000, 2500 + items * 40 + maxKeyPoints * 350);
}

type Src = { kp: KeyPoint; current: boolean };
/** 합친 노트의 개념 하나: ids = 이 개념이 된 개념들 (지금 노트의 개념이 먼저), folded = 개념 수가 넘쳐 이 개념 끝에 붙인 개념들 */
type Entry = { ids: string[]; title: string; explanation: string; why: string; folded: Entry[] };

const RANK = { high: 3, medium: 2, low: 1 } as const;

const entryOf = (ids: string[], text?: { title: string; explanation: string; why: string }): Entry => ({
  ids,
  title: text ? norm(text.title) : '',
  explanation: text ? text.explanation.trim() : '',
  why: text ? text.why.trim() : '',
  folded: [],
});

/**
 * 계획대로 합친 노트를 만든다.
 * - 계획에 없는 번호(AI 가 빠뜨린 개념)는 같은 곳에서 바로 앞 개념의 뒤에 넣는다: 개념이 사라지지 않게
 * - 모르는 번호·두 번 나온 번호는 건너뛴다. 번호 하나인 개념은 글을 그대로 옮긴다 (AI 가 글을 써도 쓰지 않는다: 내가 고친 글·표시를 지킨다)
 * - 지금 노트의 개념끼리는 묶지 않는다 (번호·글·문제가 따로라서: 묶으려 했으면 따로 두고 묶으려던 글은 쓰지 않는다)
 * - 둘 이상을 묶은 개념은 AI 가 쓴 이름·설명·왜(빈 칸이면 원래 글을 이어 붙임), 중요도는 가장 높은 것.
 *   지금 노트의 개념이 든 묶음은 그 개념의 이름·왜를 지키고, 설명은 AI 글이 지금 설명을 그대로 담았을 때만 AI 글 (아니면 지금 설명 + 새 설명)
 * - 쪽 번호: 새 노트는 묶은 개념들의 쪽을 모두, 더하기는 지금 노트의 쪽만 (새 자료의 쪽 번호는 다른 자료의 쪽이라)
 * - 개념이 maxKeyPoints 보다 많으면 지금 노트에 없던 것 중 덜 중요한 것부터 가까운 개념의 끝에 붙인다 (빼지 않는다: 내용이 사라지지 않게)
 * - 번호: 새 노트는 k1, k2 … 차례로. 더하기는 지금 노트의 번호를 그대로 두고, 새 개념은 지금 노트·reserved(문제·마인드맵·그림이 가리키는 번호)에
 *   없는 다음 번호부터 (지운 개념의 문제가 새 개념에 붙지 않게)
 * - 용어(같은 낱말은 한 번: 단어장 조각을 합칠 때는 낱말·뜻이 같을 때만)·공식(같은 식은 한 번)·함정·예시(같은 글은 한 번, 개념 번호는 새 번호로)·
 *   확인해 볼 것·바꾼 것은 지금 노트 → 조각 차례로 모두 옮긴다. 내가 고친 요약은 그대로
 */
export function applyMergePlan(
  plan: MergePlan,
  parts: Note[],
  o: { current?: Note; maxKeyPoints: number; wordLists?: boolean; reserved?: Iterable<string> },
): Note {
  const current = o.current;
  const pool = new Map<string, Src>();
  const order: string[] = [];
  for (const k of current?.key_points ?? []) {
    if (!k.id || pool.has(k.id)) continue;
    pool.set(k.id, { kp: k, current: true });
    order.push(k.id);
  }
  parts.forEach((p, i) => {
    for (const k of p.key_points) {
      const id = partId(i, k.id);
      if (!k.id || pool.has(id)) continue;
      pool.set(id, { kp: k, current: false });
      order.push(id);
    }
  });
  const own = (id: string) => pool.get(id)!.current;

  // 1. 계획대로 (모르는 번호·두 번 나온 번호는 건너뛴다)
  const used = new Set<string>();
  const entries: Entry[] = [];
  for (const item of plan.key_points) {
    const ids: string[] = [];
    for (const raw of item.from) {
      const id = readPlanId(raw);
      if (!pool.has(id) || used.has(id)) continue;
      used.add(id);
      ids.push(id);
    }
    if (!ids.length) continue;
    // 지금 노트의 개념이 먼저 (번호를 지키는 개념)
    ids.sort((a, b) => Number(!own(a)) - Number(!own(b)));
    const mine = ids.filter(own);
    if (mine.length > 1) {
      // 지금 노트의 개념 둘 이상을 묶으려 했다: 첫 개념(+ 새 개념)과 나머지를 따로 (묶으려던 글은 쓰지 않는다)
      entries.push(entryOf(ids.filter((id) => id === mine[0] || !own(id))));
      for (const id of mine.slice(1)) entries.push(entryOf([id]));
      continue;
    }
    entries.push(entryOf(ids, item));
  }
  // 2. 빠뜨린 개념: 같은 곳(지금 노트·같은 조각)에서 바로 앞 개념이 든 자리 뒤에
  const sourceOf = (id: string) => (own(id) ? 'n' : id.split('.')[0]);
  const at = (id: string) => entries.findIndex((e) => e.ids.includes(id));
  let prev: string | null = null;
  for (const id of order) {
    if (prev && sourceOf(prev) !== sourceOf(id)) prev = null;
    if (!used.has(id)) {
      used.add(id);
      const after = prev ? at(prev) : -1;
      // 앞 개념이 없으면: 지금 노트의 첫 개념은 맨 앞, 조각의 첫 개념은 앞 조각의 마지막 개념 뒤 (없으면 끝)
      let pos = after >= 0 ? after + 1 : sourceOf(id) === 'n' ? 0 : entries.length;
      if (after < 0 && sourceOf(id) !== 'n') {
        const n = Number(sourceOf(id).slice(1));
        for (let j = order.indexOf(id) - 1; j >= 0; j--) {
          const before = order[j];
          if (sourceOf(before) !== 'n' && Number(sourceOf(before).slice(1)) < n && at(before) >= 0) {
            pos = at(before) + 1;
            break;
          }
        }
      }
      entries.splice(pos, 0, entryOf([id]));
    }
    prev = id;
  }

  // 3. 개념 수가 넘치면 지금 노트에 없던 것 중 덜 중요한 것부터 (뒤에서부터) 가까운 개념에 붙인다:
  //    같은 곳(같은 조각)의 가장 가까운 앞 개념 → 뒤 개념, 없으면 바로 앞(맨 앞이면 바로 뒤) 개념. 개념 수만 줄고 내용은 그대로
  const idsOf = (e: Entry) => [...e.ids, ...e.folded.flatMap((f) => f.ids)];
  const importanceOf = (e: Entry) => Math.max(...idsOf(e).map((id) => RANK[pool.get(id)!.kp.importance] ?? 2));
  const hasCurrent = (e: Entry) => e.ids.some(own);
  const max = Math.max(1, o.maxKeyPoints, entries.filter(hasCurrent).length);
  while (entries.length > max) {
    let victim = -1;
    for (let level = 1; level <= 3 && victim < 0; level++) {
      for (let j = entries.length - 1; j >= 0; j--) {
        if (!hasCurrent(entries[j]) && importanceOf(entries[j]) === level) {
          victim = j;
          break;
        }
      }
    }
    if (victim < 0) break;
    const v = entries[victim];
    const from = sourceOf(v.ids[0]);
    const same = (j: number) => sourceOf(entries[j].ids[0]) === from;
    let into = -1;
    for (let j = victim - 1; j >= 0 && into < 0; j--) if (same(j)) into = j;
    for (let j = victim + 1; j < entries.length && into < 0; j++) if (same(j)) into = j;
    if (into < 0) into = victim > 0 ? victim - 1 : victim + 1;
    entries[into].folded.push({ ...v, folded: [] }, ...v.folded);
    entries.splice(victim, 1);
  }

  // 4. 개념을 만들고 번호를 붙인다
  const taken = new Set([...(current?.key_points ?? []).map((k) => k.id), ...(o.reserved ?? [])]);
  let next = Math.max(0, ...[...taken].map((id) => Number(id.replace(/\D/g, '')) || 0)) + 1;
  const newId = () => {
    while (taken.has(`k${next}`)) next++;
    const id = `k${next++}`;
    taken.add(id);
    return id;
  };
  const joinedOf = (srcs: Src[], pick: (k: KeyPoint) => string) => {
    const seen = new Set<string>();
    return srcs
      .map((s) => pick(s.kp).trim())
      .filter((t) => t && !seen.has(norm(t)) && (seen.add(norm(t)), true))
      .join('\n');
  };
  /** 개념 하나(묶음)의 이름·설명·왜 */
  const textOf = (e: Entry): { title: string; explanation: string; why: string } => {
    const srcs = e.ids.map((id) => pool.get(id)!);
    const first = srcs[0];
    if (srcs.length === 1) return { title: first.kp.title, explanation: first.kp.explanation, why: first.kp.why };
    if (first.current) {
      // 지금 노트의 개념이 든 묶음: 이름·왜는 지금 그대로, 설명은 AI 글이 지금 설명을 그대로 담았을 때만 (고친 글·표시를 잃지 않게)
      const keeps = !!e.explanation && norm(e.explanation).includes(norm(first.kp.explanation));
      return {
        title: first.kp.title || e.title,
        explanation: keeps ? e.explanation : joinedOf(srcs, (k) => k.explanation),
        why: first.kp.why || e.why || joinedOf(srcs, (k) => k.why),
      };
    }
    return {
      title: e.title || first.kp.title,
      explanation: e.explanation || joinedOf(srcs, (k) => k.explanation),
      why: e.why || first.kp.why || joinedOf(srcs, (k) => k.why),
    };
  };
  const idMap = new Map<string, string>();
  const key_points: KeyPoint[] = entries.map((e, i) => {
    const main = e.ids.map((id) => pool.get(id)!);
    const all = idsOf(e).map((id) => pool.get(id)!);
    const first = main[0];
    const id = current ? (first.current ? first.kp.id : newId()) : `k${i + 1}`;
    for (const sid of idsOf(e)) idMap.set(sid, id);
    const pages = [...new Set(all.filter((s) => !current || s.current).flatMap((s) => s.kp.pages ?? []))].sort((a, b) => a - b);
    // 붙인 개념: 이름과 설명을 이 개념의 설명 끝에 한 줄씩
    const extra = e.folded
      .map((f) => {
        const t = textOf(f);
        const body = t.explanation.trim();
        return t.title ? `**${norm(t.title)}**: ${body}` : body;
      })
      .filter(Boolean);
    const importance = (['high', 'medium', 'low'] as const)[3 - importanceOf(e)];
    if (main.length === 1) {
      const kp: KeyPoint = { ...first.kp, id, pages, importance };
      // 새 자료의 개념에는 고침·별표 표시가 없다 (조각은 AI 정리)
      if (!first.current) {
        delete kp.starred;
        delete kp.edited;
      }
      if (extra.length) {
        kp.explanation = [kp.explanation.trim(), ...extra].filter(Boolean).join('\n');
        // 내가 쓴 글에 새 글이 붙었다: 고친 표시는 지운다 (keepFromCurrent 가 글이 그대로일 때만 되살린다)
        delete kp.edited;
      }
      return kp;
    }
    const t = textOf(e);
    const kp: KeyPoint = {
      id,
      title: t.title,
      explanation: [t.explanation.trim(), ...extra].filter(Boolean).join('\n'),
      why: t.why,
      importance,
      pages,
    };
    if (main.some((s) => s.current && s.kp.starred)) kp.starred = true;
    return kp;
  });

  // 5. 용어·공식·함정·예시·확인해 볼 것·바꾼 것: 지금 노트 → 조각 차례로
  const cur = current ? [current] : [];
  const mapId = (sid: string) => idMap.get(sid) ?? '';
  const terms = current
    ? addMissingTerms(
        current.terms,
        parts.flatMap((p) => p.terms),
      )
    : o.wordLists
      ? mergeTerms(...parts.map((p) => p.terms))
      : addMissingTerms(
          [],
          parts.flatMap((p) => p.terms),
        );
  const formulas: Note['formulas'] = [];
  const seenLatex = new Set<string>();
  for (const f of [...cur.flatMap((n) => n.formulas), ...parts.flatMap((p) => p.formulas)]) {
    const k = latexKey(f.latex);
    if (!k || seenLatex.has(k)) continue;
    seenLatex.add(k);
    formulas.push(f);
  }
  const linked = <T extends { text: string; key_point_id: string; edited?: boolean }>(pick: (n: Note) => T[]): T[] => {
    const out: T[] = [];
    const seen = new Set<string>();
    const add = (item: T, sid: string) => {
      const k = normKey(item.text);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({ ...item, key_point_id: item.key_point_id ? mapId(sid) : '' });
    };
    // 지금 노트의 것은 가리키던 번호 그대로 (지운 개념을 가리키던 것도 그대로 둔다)
    for (const n of cur) for (const item of pick(n)) add(item, item.key_point_id);
    parts.forEach((p, i) => {
      for (const item of pick(p)) {
        // 새 자료의 것에는 고침 표시가 없다
        const copy: T = { ...item };
        delete copy.edited;
        add(copy, partId(i, item.key_point_id));
      }
    });
    return out;
  };
  const texts = (pick: (n: Note) => Array<{ text: string }>) => {
    const out: Array<{ text: string }> = [];
    const seen = new Set<string>();
    for (const n of [...cur, ...parts]) {
      for (const item of pick(n)) {
        const k = normKey(item.text);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push({ text: item.text });
      }
    }
    return out;
  };

  const base = current ?? parts[0];
  const note: Note = {
    title: norm(plan.title) || base?.title || '',
    unit: norm(plan.unit) || base?.unit || '',
    // 내가 고친 요약은 그대로 (새 자료의 내용은 개념에 들어간다)
    summary: current?.summary_edited ? current.summary : plan.summary.trim() || base?.summary || '',
    key_points,
    terms,
    formulas,
    pitfalls: linked((n) => n.pitfalls),
    examples: linked((n) => n.examples),
    checks: texts((n) => n.checks),
    changes: texts((n) => n.changes),
  };
  if (current?.summary_edited) note.summary_edited = true;
  if (current?.manual) note.manual = true;
  return note;
}

/** AI 계획이 없을 때(답이 잘림·읽을 수 없음): 모든 개념을 차례대로, 이름이 같은 개념만 묶는다 (AI 없이 노트를 만든다) */
export function fallbackMergePlan(parts: Note[], current?: Note): MergePlan {
  const groups = new Map<string, string[]>();
  const items: MergePlan['key_points'] = [];
  const add = (id: string, title: string, own: boolean) => {
    const key = normKey(title);
    const g = key ? groups.get(key) : undefined;
    // 지금 노트의 개념끼리는 이름이 같아도 묶지 않는다 (번호·글·문제가 따로라서). 새 개념은 이름이 같은 첫 개념에
    if (g && !own) {
      g.push(id);
      return;
    }
    const ids = [id];
    if (key && !g) groups.set(key, ids);
    items.push({ from: ids, title: '', explanation: '', why: '' });
  };
  for (const k of current?.key_points ?? []) add(k.id, k.title, true);
  parts.forEach((p, i) => p.key_points.forEach((k) => add(partId(i, k.id), k.title, false)));
  return { title: '', unit: '', summary: '', key_points: items };
}
