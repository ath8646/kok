// 화면들끼리 알리는 이벤트 이름 (window 에 보낸다)

/** 자료 목록이 바뀌었다 (새 자료, 지움) */
export const SOURCES_CHANGED = 'kok:sources-changed';
/** 과목이 바뀌었다 */
export const SUBJECTS_CHANGED = 'kok:subjects-changed';

/**
 * 다른 화면에서 자료 넣기로 넘기는 파일 (자료 공유의 'KOK으로 정리'): 넘긴 뒤 자료함으로 가면 자료 넣기가 받아 바로 정리한다.
 * 한 번 꺼내면 비워진다 (QuickAdd 가 켜질 때 꺼낸다)
 */
let handed: { files: File[]; subjectId: string } | null = null;
export function handOffFiles(files: File[], subjectId: string): void {
  handed = { files, subjectId };
}
export function takeHandOff(): { files: File[]; subjectId: string } | null {
  const h = handed;
  handed = null;
  return h;
}
