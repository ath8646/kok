// 복습을 무엇으로 할지(주소에서 읽기)와 노트 문제 풀기 주소.
// 화면은 주소를 그리는 동안 읽는데, 다른 화면에서 눌러 들어오면 그때 window.location 은 아직 앞 화면 주소다
// (Next.js 는 새 화면을 그린 뒤에 주소를 바꾼다). 그래서 useSearchParams 로 읽은 값을 여기에 넘긴다.

/** 오늘 복습, 과목 복습, 노트 문제 풀기, 오답 다시 풀기, 약점 개념 풀기 */
export type ReviewMode =
  | { kind: 'today' }
  | { kind: 'subject'; id: string }
  /** 노트 문제 풀기: 노트 화면에서는 자료 id(source), 예전 주소 /review?note= 는 노트 id(note) */
  | { kind: 'practice'; by: 'source' | 'note'; id: string }
  | { kind: 'wrong' }
  | { kind: 'kp'; note: string; kp: string };

type Params = { get(name: string): string | null };

/** /review 주소: ?subject= · ?note= · ?mode=wrong · ?kp=노트:개념, 없으면 오늘 복습 */
export function reviewModeFrom(p: Params): ReviewMode {
  const subject = p.get('subject');
  if (subject) return { kind: 'subject', id: subject };
  const note = p.get('note');
  if (note) return { kind: 'practice', by: 'note', id: note };
  if (p.get('mode') === 'wrong') return { kind: 'wrong' };
  const kp = p.get('kp');
  const at = kp ? kp.indexOf(':') : -1;
  if (kp && at >= 0) return { kind: 'kp', note: kp.slice(0, at), kp: kp.slice(at + 1) };
  return { kind: 'today' };
}

/** 같은 방법이면 같은 글 (주소가 바뀌면 세션을 새로 시작하는 열쇠) */
export function reviewModeKey(m: ReviewMode): string {
  return JSON.stringify(m);
}

/**
 * 노트 화면에서 가는 노트 문제 풀기 주소. from=note 가 있으면 돌아갈 때 뒤로 가기를 쓴다
 * (같은 노트가 방문 기록에 두 번 쌓이지 않고, 노트가 보던 탭 그대로 열린다. 새로 고쳐도 주소에 남는다)
 */
export function practiceHref(sourceId: string): string {
  return `/notes/${encodeURIComponent(sourceId)}/practice?from=note`;
}

// 노트 화면에서 들어올 때 노트 제목을 남겨 두면, 문제를 읽기 전에 위 띠에 노트 이름을 바로 보여 줄 수 있다
let opened: { sourceId: string; title: string } | null = null;

/** 노트 화면에서 문제 풀기로 갈 때 */
export function rememberPracticeFrom(sourceId: string, title: string): void {
  opened = { sourceId, title };
}

/** 이 노트에서 들어올 때 남긴 노트 제목 */
export function practiceFrom(sourceId: string): { title: string } | null {
  return opened && opened.sourceId === sourceId ? { title: opened.title } : null;
}
