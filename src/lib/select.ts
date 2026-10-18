// 고르기 칸(src/components/Select.tsx)의 규칙: 펼침 목록을 놓을 자리, 화살표로 옮기기, 글자로 찾기 (시험 있음)

/** 칸과 목록 사이 */
export const LIST_GAP = 6;
/** 화면 가장자리에서 띄울 거리 */
export const LIST_EDGE = 8;
/** 목록 최대 높이 (화면 높이의 절반과 비교해 작은 쪽) */
export const LIST_MAX_HEIGHT = 320;
/** 내용이 길면 칸보다 넓어질 수 있는 폭 */
export const LIST_MAX_WIDTH = 360;
/** 자리가 아주 좁아도 이만큼(두 줄 남짓)은 보인다 */
export const LIST_MIN_HEIGHT = 120;

export type Box = { top: number; bottom: number; left: number; right: number };
/** 보이는 화면 (확대했으면 확대한 부분) */
export type View = { left: number; top: number; width: number; height: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** 목록 폭: 칸보다 좁지 않게, 내용이 길면 LIST_MAX_WIDTH 까지 (화면 안쪽으로) */
export function listWidthRange(triggerWidth: number, view: View): { min: number; max: number } {
  const room = Math.max(0, view.width - LIST_EDGE * 2);
  const min = Math.min(triggerWidth, room);
  return { min, max: Math.max(min, Math.min(room, LIST_MAX_WIDTH)) };
}

/**
 * 목록 자리: 칸 바로 아래. 아래가 모자라고 위가 더 넓으면 위로 뒤집는다.
 * 화면 가장자리에서 LIST_EDGE 만큼 안쪽에 두고, 높이는 min(320px, 화면 절반)을 넘으면 목록 안에서 스크롤한다.
 * originX: 펼쳐지는 움직임의 기준점 (칸 가운데)
 */
export function placeList(trigger: Box, view: View, list: { width: number; contentHeight: number }) {
  const cap = Math.min(LIST_MAX_HEIGHT, view.height * 0.5);
  const below = view.top + view.height - LIST_EDGE - (trigger.bottom + LIST_GAP);
  const above = trigger.top - LIST_GAP - (view.top + LIST_EDGE);
  const want = Math.min(list.contentHeight, cap);
  const up = want > below && above > below;
  const room = Math.max(0, up ? above : below);
  const maxHeight = Math.min(Math.max(Math.min(cap, room), Math.min(want, LIST_MIN_HEIGHT)), Math.max(0, view.height - LIST_EDGE * 2));
  const height = Math.min(list.contentHeight, maxHeight);
  const top = clamp(up ? trigger.top - LIST_GAP - height : trigger.bottom + LIST_GAP, view.top + LIST_EDGE, view.top + view.height - LIST_EDGE - height);
  const left = clamp(trigger.left, view.left + LIST_EDGE, view.left + view.width - LIST_EDGE - list.width);
  const originX = clamp((trigger.left + trigger.right) / 2 - left, 0, list.width);
  return { top, left, maxHeight, up, originX };
}

type Item = { label: string; disabled?: boolean };

/** from 에서 dir 쪽으로 가장 가까운 고를 수 있는 줄. 끝이면 그대로, 고를 수 있는 줄이 없으면 -1 */
export function stepEnabled(items: ReadonlyArray<Item>, from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < items.length; i += dir) if (!items[i].disabled) return i;
  return from >= 0 && from < items.length && !items[from].disabled ? from : -1;
}

/** 한글 첫소리 (가 = 0xAC00 부터 588 글자마다 바뀐다) */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 친 글자로 시작하는지 (대소문자 무시). 한글 자음 하나는 그 자음으로 시작하는 글자와 맞춘다: 'ㄱ' → '광합성' */
export function startsWithTyped(label: string, typed: string): boolean {
  const s = label.trim().toLocaleLowerCase('ko-KR');
  const q = typed.toLocaleLowerCase('ko-KR');
  if (!q || s.length < q.length) return false;
  for (let i = 0; i < q.length; i++) {
    if (s[i] === q[i]) continue;
    const code = s.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3 && CHO[Math.floor((code - 0xac00) / 588)] === q[i]) continue;
    return false;
  }
  return true;
}

/**
 * 글자로 찾기: typed 로 시작하는 줄 (from 다음부터 돌아가며, 고를 수 없는 줄은 건너뛴다). 없으면 -1.
 * 같은 글자를 거듭 치면(b, b, b) 그 글자로 시작하는 다음 줄로 넘어가고, 이어서 치면(ba) 지금 줄부터 다시 본다.
 */
export function findTyped(items: ReadonlyArray<Item>, typed: string, from: number): number {
  const n = items.length;
  if (!typed || !n) return -1;
  const repeat = [...typed].every((c) => c === typed[0]);
  const needle = repeat ? typed[0] : typed;
  const start = repeat ? from + 1 : Math.max(from, 0);
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (!items[i].disabled && startsWithTyped(items[i].label, needle)) return i;
  }
  return -1;
}
