// 화면을 오갈 때 방금 본 목록을 바로 보여 주려고, 마지막으로 읽은 것을 메모리에 잠깐 둔다.
// - 계정마다 따로 둔다 (같은 기기에서 다른 계정으로 바꿔도 남의 목록이 보이지 않게)
// - 새로 고침하면 사라지고, 오래된 것(5분)은 쓰지 않는다
// - 보여 준 뒤에는 늘 새로 읽어서 덮는다. 자료·과목이 바뀌었다는 알림이 오면 모두 버린다
import { SOURCES_CHANGED, SUBJECTS_CHANGED } from './events';

const MAX_AGE_MS = 5 * 60_000;

type Entry = { owner: string; at: number; value: unknown };
const store = new Map<string, Entry>();

let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  for (const ev of [SOURCES_CHANGED, SUBJECTS_CHANGED]) window.addEventListener(ev, () => store.clear());
}

export function readView<T>(key: string, owner: string | null | undefined, now = Date.now()): T | undefined {
  if (!owner) return undefined;
  const e = store.get(key);
  if (!e || e.owner !== owner || now - e.at > MAX_AGE_MS) return undefined;
  return e.value as T;
}

export function writeView<T>(key: string, owner: string | null | undefined, value: T, now = Date.now()): void {
  if (!owner) return;
  listen();
  store.set(key, { owner, at: now, value });
}

/** key 를 주면 그것만, 없으면 모두 버린다 (로그아웃·탈퇴, 다른 화면에서 자료를 지웠을 때) */
export function dropView(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
