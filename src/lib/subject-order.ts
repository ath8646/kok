// 과목 서랍 (과목이 많을 때): 어떤 과목을 어디에 어떤 차례로 보일지.
// - 서랍: 고정한 과목(내가 정한 차례) → 최근 쓴 과목(자료를 넣은 때, 없으면 만든 때가 최근인 것부터) → 보관한 과목(이름 차례)
// - 칩 줄(자료함·복습 고르기): 고정한 과목 모두 + 최근 쓴 과목으로 QUICK_MAX 개까지. 어떤 과목을 보일지는 최근으로 고르지만,
//   보이는 차례는 고정 → 내가 정한 차례(position)로 두어서 자료를 넣을 때마다 칩이 자리를 바꾸지 않는다.
//   지금 고른 과목은 줄에 없으면 끝에 붙인다 (보관한 과목이어도)
// - 고르는 목록(자료 넣기·문제 넣기): 고정 → 최근 쓴 차례, 보관한 과목은 빼고 (지금 고른 것은 남긴다)
// - 찾기: 이름의 한 부분, 또는 첫 자음만 ('ㄱㅎ' → 과학)
import type { SubjectRow } from './types';

export type DrawerSubject = Pick<SubjectRow, 'id' | 'name' | 'position' | 'created_at'> & Pick<SubjectRow, 'pinned' | 'archived' | 'used_at'>;

/** 칩 줄에 보이는 과목 수 (고정한 과목이 더 많으면 고정한 것은 모두) */
export const QUICK_MAX = 5;

const time = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** 최근 쓴 때 (자료를 넣은 때, 없으면 과목을 만든 때) */
export const usedAt = (s: DrawerSubject) => Math.max(time(s.used_at), time(s.created_at));

/** 내가 정한 차례 (같으면 먼저 만든 것) */
export function byPosition<T extends DrawerSubject>(a: T, b: T): number {
  return a.position - b.position || time(a.created_at) - time(b.created_at) || a.id.localeCompare(b.id);
}

/** 최근 쓴 것부터 */
export function byRecent<T extends DrawerSubject>(a: T, b: T): number {
  return usedAt(b) - usedAt(a) || byPosition(a, b);
}

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const isCho = (ch: string) => CHO.includes(ch);

/** 글자마다 첫 자음 (한글 음절이 아니면 그 글자 그대로, 소문자) */
export function initials(name: string): string {
  let out = '';
  for (const ch of name.toLowerCase()) {
    const code = ch.charCodeAt(0);
    out += code >= 0xac00 && code <= 0xd7a3 ? CHO[Math.floor((code - 0xac00) / 588)] : ch;
  }
  return out;
}

/** 이름이 찾는 글과 맞는지: 이름의 한 부분, 또는 첫 자음만 적었으면 첫 자음으로 (빈칸은 무시) */
export function matchesSubject(name: string, query: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  const n = name.toLowerCase().replace(/\s+/g, '');
  if (n.includes(q)) return true;
  // 첫 자음이 하나라도 섞여 있으면 첫 자음으로 견준다 ('ㄱ학' 처럼 섞어 적어도 된다)
  if (![...q].some(isCho)) return false;
  const ini = initials(n);
  const qi = [...q].map((ch) => (isCho(ch) ? ch : initials(ch))).join('');
  return ini.includes(qi);
}

/** 서랍의 세 묶음 (찾는 글이 있으면 맞는 과목만) */
export function drawerGroups<T extends DrawerSubject>(list: T[], query = ''): { pinned: T[]; recent: T[]; archived: T[] } {
  const hit = list.filter((s) => matchesSubject(s.name, query));
  return {
    pinned: hit.filter((s) => s.pinned && !s.archived).sort(byPosition),
    recent: hit.filter((s) => !s.pinned && !s.archived).sort(byRecent),
    archived: hit.filter((s) => s.archived).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }) || byPosition(a, b)),
  };
}

/**
 * 칩 줄에 보일 과목: 고정한 과목 모두 + 최근 쓴 과목으로 max 개까지 (보관한 과목은 빼고).
 * 보이는 차례는 고정 → 내가 정한 차례. keep(지금 고른 과목)은 줄에 없으면 끝에 붙인다
 */
export function quickSubjects<T extends DrawerSubject>(list: T[], max = QUICK_MAX, keep?: string | null): T[] {
  const open = list.filter((s) => !s.archived);
  const pinned = open.filter((s) => s.pinned);
  const room = Math.max(0, max - pinned.length);
  const recent = new Set(
    open
      .filter((s) => !s.pinned)
      .sort(byRecent)
      .slice(0, room)
      .map((s) => s.id),
  );
  const shown = open.filter((s) => s.pinned || recent.has(s.id)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || byPosition(a, b));
  const kept = keep && !shown.some((s) => s.id === keep) ? list.find((s) => s.id === keep) : undefined;
  return kept ? [...shown, kept] : shown;
}

/** 고르는 목록 (자료 넣기·문제 넣기): 고정 → 최근 쓴 차례, 보관한 과목은 빼고 (keep 은 남긴다) */
export function pickerOrder<T extends DrawerSubject>(list: T[], keep?: string | null): T[] {
  const open = list.filter((s) => !s.archived || s.id === keep);
  return [...open.filter((s) => s.pinned && !s.archived).sort(byPosition), ...open.filter((s) => !s.pinned || s.archived).sort(byRecent)];
}
