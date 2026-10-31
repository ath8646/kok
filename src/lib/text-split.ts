// 긴 글을 정리할 조각으로 나누기 (서버의 정리·화면의 그림 표시 계산이 같이 쓴다: pdf-lib 없이)

/** 글을 약 maxChars 단위로 문단 경계에서 나눈다 */
export function splitText(text: string, maxChars = 40000): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n\n', maxChars);
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}
