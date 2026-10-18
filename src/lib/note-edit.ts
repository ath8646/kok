// 노트 본문 고치기 (화면·서버 공통, 계산만)
import type { Note, NoteAddition } from './ai/schemas';

/** 채팅에서 동의한 내용을 노트에 넣는다: 그 개념의 설명 뒤에 붙이거나, 맞는 개념이 없으면 새 개념으로 */
export function applyNoteAddition<T extends Pick<Note, 'key_points'>>(note: T, add: NoteAddition): T {
  const text = add.text.trim();
  if (!text) return note;
  const kps = note.key_points ?? [];
  const i = add.key_point_id ? kps.findIndex((k) => k.id === add.key_point_id) : -1;
  if (i >= 0) {
    const kp = kps[i];
    const explanation = kp.explanation.trim() ? `${kp.explanation.trim()} ${text}` : text;
    return { ...note, key_points: kps.map((k, j) => (j === i ? { ...k, explanation, edited: true } : k)) };
  }
  const used = new Set(kps.map((k) => k.id));
  let n = kps.length + 1;
  while (used.has(`k${n}`)) n++;
  const title = add.title.trim().slice(0, 40) || text.slice(0, 20);
  return {
    ...note,
    key_points: [...kps, { id: `k${n}`, title, explanation: text, why: '', importance: 'medium' as const, pages: [], edited: true }],
  };
}
