// 한글·워드·PPT 에서 꺼낸 글 속의 그림 자리.
// 글 한 줄 '[[picture N]]' 이 그 자리에 문서의 N 번째 그림이 있다는 표시다. 그림은 브라우저가 JPEG 로 바꿔
// 자료 파일(file_paths 의 N 번째)로 올리고, 파이프라인은 글과 함께 AI 에 보여 준다('Picture N:').
// 원본 탭은 표시 줄 자리에 그림을 그린다. 서버·화면·시험이 같은 규칙을 쓴다 (화면 없이 계산만).
import { splitText } from './text-split';

/** 그림 표시 줄 하나 (줄 전체가 이것이어야 한다) */
export const PICTURE_LINE = /^\[\[picture (\d{1,3})\]\]$/;

/** 그림 표시 줄 모두 (매번 새로: g 플래그의 lastIndex 가 남지 않게) */
const lines = () => /^\[\[picture (\d{1,3})\]\]$/gm;

/** 한 번 AI 에 보내는 글 조각에 넣는 그림 수 (요청 크기와 시간을 넘지 않게: 넘으면 조각을 나눈다) */
export const DOC_PICTURES_PER_CHUNK = 10;

/** 그림 N 의 표시 줄 */
export function pictureMark(n: number): string {
  return `[[picture ${n}]]`;
}

/** 글에 든 그림 번호 (처음 나온 차례, 같은 번호는 한 번) */
export function pictureNumbers(text: string | null | undefined): number[] {
  const out: number[] = [];
  for (const m of (text ?? '').matchAll(lines())) {
    const n = Number(m[1]);
    if (n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** 그림 줄마다 바꾼다 (null 이면 그 줄을 지운다). 지운 줄이 있을 때만 빈 줄이 셋 넘게 이어지지 않게 합친다 (그 밖의 글은 그대로) */
function mapLines(text: string, f: (n: number) => string | null): string {
  const out: string[] = [];
  let removed = false;
  for (const line of text.split('\n')) {
    const m = PICTURE_LINE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const to = f(Number(m[1]));
    if (to !== null) out.push(to);
    else removed = true;
  }
  const joined = out.join('\n');
  return removed ? joined.replace(/\n{3,}/g, '\n\n') : joined;
}

/** keep[i] 번 그림을 i+1 번으로 바꾸고, 나머지 그림 줄은 지운다 (같은 그림이 또 나오면 처음 것만) */
export function renumberPictures(text: string, keep: readonly number[]): string {
  const to = new Map(keep.map((n, i) => [n, i + 1]));
  const seen = new Set<number>();
  return mapLines(text, (n) => {
    const m = to.get(n);
    if (!m || seen.has(m)) return null;
    seen.add(m);
    return pictureMark(m);
  });
}

/** 서버: 올린 그림 수(count)보다 큰 번호와 겹친 번호의 줄은 지운다 (번호는 그대로: 파일 차례와 같다) */
export function keepPictureMarks(text: string, count: number): string {
  const seen = new Set<number>();
  return mapLines(text, (n) => {
    if (n > count || seen.has(n)) return null;
    seen.add(n);
    return pictureMark(n);
  });
}

/** 그림 줄을 모두 지운 글 */
export function stripPictureMarks(text: string): string {
  return mapLines(text, () => null);
}

/**
 * 정리할 글 조각: 글자 수(splitText 와 같게)로 나누고, 그림이 maxPictures 개를 넘는 조각은 그림 줄 앞에서 한 번 더 나눈다.
 * 그림 줄이 없으면 splitText 와 똑같다 (정리 중인 예전 자료의 조각 수가 바뀌지 않게)
 */
export function splitDocText(text: string, maxChars: number, maxPictures = DOC_PICTURES_PER_CHUNK): string[] {
  const parts = splitText(text, maxChars);
  if (!lines().test(text)) return parts;
  const out: string[] = [];
  for (const part of parts) {
    let rest = part;
    for (;;) {
      const marks = [...rest.matchAll(lines())];
      if (marks.length <= maxPictures) {
        out.push(rest);
        break;
      }
      const cut = marks[maxPictures].index ?? rest.length;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
  }
  return out;
}
