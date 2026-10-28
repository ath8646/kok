// 화면을 오갈 때 방금 본 화면을 바로 보여 주려고, 마지막으로 읽은 것을 메모리에 잠깐 둔다.
// (다시 들어올 때 '불러오는 중' 자리나 임시 글이 잠깐 보였다가 바뀌지 않게)
// - 계정마다 따로 둔다 (같은 기기에서 다른 계정으로 바꿔도 남의 목록이 보이지 않게)
// - 새로 고침하면 사라지고, 오래된 것(5분)은 쓰지 않는다
// - 읽은 뒤에 이 브라우저에서 데이터를 바꾸는 요청(저장·지우기·AI 작업)이 있었으면 쓰지 않는다: 바뀌기 전 모습이 잠깐
//   보였다가 바뀌지 않게, 그때는 새로 읽는다. 요청은 시작할 때와 끝날 때 모두 센다(trackedFetch). 읽기를 시작할 때
//   viewStamp() 를 받아 writeView 에 넘기면, 읽는 사이에 시작했거나 끝난 저장이 있던 목록은 기억하지 않는다
// - 보여 준 뒤에는 늘 새로 읽어서 덮는다. 자료·과목이 바뀌었다는 알림이 오면 모두 버린다
import { SOURCES_CHANGED, SUBJECTS_CHANGED } from './events';

const MAX_AGE_MS = 5 * 60_000;

type Entry = { owner: string; at: number; stamp: number; value: unknown };
const store = new Map<string, Entry>();

/** 데이터를 바꾸는 요청이 시작되거나 끝난 횟수 */
let writes = 0;
/** 아직 끝나지 않은 쓰기 요청 수와, 모두 끝나기를 기다리는 쪽 */
let inflight = 0;
let waiters: Array<() => void> = [];

let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  for (const ev of [SOURCES_CHANGED, SUBJECTS_CHANGED]) window.addEventListener(ev, () => store.clear());
}

/** 지금까지 센 쓰기: 읽기를 시작할 때 받아 두었다가 writeView 에 넘긴다 */
export function viewStamp(): number {
  return writes;
}

/** 데이터를 바꾸는 요청이 시작되거나 끝났다 (기억해 둔 화면은 모두 옛것이 된다) */
export function noteWrite(): void {
  writes += 1;
}

/** 지금 진행 중인 쓰기 요청이 모두 끝나면 (없으면 바로). 미리 읽어 둘 때 저장이 끝나기를 기다린다 */
export function writesSettled(): Promise<void> {
  if (!inflight) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

function writeEnded(): void {
  noteWrite();
  inflight = Math.max(0, inflight - 1);
  if (inflight) return;
  const done = waiters;
  waiters = [];
  for (const w of done) w();
}

export function readView<T>(key: string, owner: string | null | undefined, now = Date.now()): T | undefined {
  if (!owner) return undefined;
  const e = store.get(key);
  if (!e || e.owner !== owner || e.stamp !== writes || now - e.at > MAX_AGE_MS) return undefined;
  return e.value as T;
}

/**
 * 화면에 보인 것을 기억한다. stamp: 그 내용을 읽기 시작할 때의 viewStamp() (없으면 지금: 저장이 끝난 뒤 화면에서
 * 바로 고친 내용을 적을 때). 그 뒤에 쓰기가 있었으면 기억하지 않는다 (다음에 열 때 새로 읽는다)
 */
export function writeView<T>(key: string, owner: string | null | undefined, value: T, opts: { stamp?: number; now?: number } = {}): void {
  if (!owner) return;
  listen();
  const stamp = opts.stamp ?? writes;
  if (stamp !== writes) {
    store.delete(key);
    return;
  }
  store.set(key, { owner, at: opts.now ?? Date.now(), stamp, value });
}

/** key 를 주면 그것만, 없으면 모두 버린다 (로그아웃·탈퇴, 다른 화면에서 자료를 지웠을 때) */
export function dropView(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}

// ------------------------------------------------------------- 데이터를 바꾸는 요청 세기

/** POST 로 부르지만 읽기만 하는 Supabase 함수 */
const READ_RPCS = new Set(['kok_my_study_days']);
/** 데이터를 바꾸지 않는 앱 API: 멈춘 정리 이어 달리기(끝나면 정리 목록이 따로 알린다), 홈 채팅(대화는 저장하지 않는다), 올리기 주소 받기 */
const READ_POSTS = [/^\/api\/sources\/[^/]+\/process$/, /^\/api\/chat$/, /^\/api\/uploads$/];

/**
 * 이 요청이 데이터를 바꿀 수 있는지: Supabase 표 쓰기(POST·PATCH·DELETE)와 읽기 함수가 아닌 함수, 앱 API 의 GET 이 아닌 요청.
 * 로그인(auth)·파일(storage: 서명 주소 받기. 올리기는 뒤따르는 /api 요청이 센다)은 세지 않는다.
 * 모르는 것은 바꾸는 것으로 센다 (덜 세면 바뀌기 전 화면이 보이고, 더 세면 한 번 새로 읽을 뿐이다)
 */
export function writesData(method: string | undefined, url: string): boolean {
  const m = (method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  let path = url;
  try {
    path = new URL(url, 'http://kok.invalid').pathname;
  } catch {
    // 그대로
  }
  const rpc = /\/rest\/v1\/rpc\/([^/]+)$/.exec(path);
  if (rpc) return !READ_RPCS.has(rpc[1]);
  if (path.includes('/rest/v1/')) return true;
  if (path.startsWith('/api/')) return !READ_POSTS.some((re) => re.test(path));
  return !path.includes('/auth/v1/') && !path.includes('/storage/v1/');
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string | undefined {
  if (init?.method) return init.method;
  return typeof Request !== 'undefined' && input instanceof Request ? input.method : undefined;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** fetch 와 같고, 데이터를 바꾸는 요청이면 시작할 때와 끝날 때 센다 (Supabase 브라우저 클라이언트·api() 가 쓴다) */
export function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const counts = writesData(requestMethod(input, init), requestUrl(input));
  if (!counts) return fetch(input, init);
  noteWrite();
  inflight += 1;
  let res: Promise<Response>;
  try {
    res = fetch(input, init);
  } catch (e) {
    writeEnded();
    throw e;
  }
  res.then(writeEnded, writeEnded);
  return res;
}
