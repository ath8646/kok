// 빈칸 문제의 답 자리 (복습 문제·레슨이 같이 쓴다, 시험 course.test.ts '빈칸 자리'):
// 코드(`조각`·``` 블록) 밖에서 밑줄 셋 이상 → 밑줄 둘 → ( )·[ ] 차례로 첫 빈칸
import { codeRanges } from './richtext';

/** 빈칸 자리 찾기 차례: 밑줄 셋 이상 → 밑줄 둘 → ( )·[ ]. 낱말에 붙은 것(snake_case·__init__·print())은 빈칸이 아니다 */
const BLANKS = [/(?<![A-Za-z0-9_])_{3,}(?![A-Za-z0-9_])/g, /(?<![A-Za-z0-9_])__(?![A-Za-z0-9_])/g, /(?<![A-Za-z0-9_])(?:\(\s*\)|\[\s*\])/g];

/**
 * 빈칸 문제의 답 자리 (글에서 [start, end)): 코드(`조각`·``` 블록) 밖의 첫 빈칸. 없으면 null
 * (코드 안의 빈칸은 코드 그대로 보이고 고른 낱말은 문제 아래 칸에)
 */
export function clozeBlank(prompt: string): { start: number; end: number } | null {
  const code = codeRanges(prompt);
  for (const re of BLANKS) {
    for (const m of prompt.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!code.some(([a, b]) => start < b && end > a)) return { start, end };
    }
  }
  return null;
}
