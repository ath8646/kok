// 과목 색 → 화면 색 (가지 색과 같은 판)
import type { SubjectColor } from './settings';

export const SUBJECT_COLOR_INDEX: Record<string, number> = {
  blue: 0,
  orange: 1,
  green: 2,
  navy: 3,
  pink: 4,
  purple: 5,
  teal: 6,
  yellow: 7,
  red: 4,
};

export const SUBJECT_COLOR_LABEL: Record<SubjectColor, string> = {
  blue: '파랑',
  green: '초록',
  orange: '주황',
  pink: '분홍',
  purple: '보라',
  teal: '청록',
  red: '빨강',
  yellow: '노랑',
};

export function subjectVar(color: string | null | undefined): string {
  const i = SUBJECT_COLOR_INDEX[color ?? 'blue'] ?? 0;
  return `var(--b${i + 1})`;
}
