// 한글·워드·PPT 파일 이름 규칙 (화면에서 바로 쓴다: 문서 읽기 코드(cfb·fflate)는 파일을 넣을 때만 불러온다)

/** 읽을 수 있는 파일 이름 */
export const OFFICE_READABLE = /\.(hwp|hwpx|docx|pptx)$/i;

/** 이름만 보고 못 읽는 형식이면 안내 (읽을 수 있으면 null) */
export function officeNameProblem(name: string): string | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  if (ext === 'doc') return "예전 워드 형식(.doc)이에요. 워드에서 '다른 이름으로 저장'으로 .docx나 PDF로 저장해서 넣어 주세요.";
  if (ext === 'ppt') return "예전 PPT 형식(.ppt)이에요. 파워포인트에서 '다른 이름으로 저장'으로 .pptx나 PDF로 저장해서 넣어 주세요.";
  if (ext === 'xls' || ext === 'xlsx') return '엑셀 파일은 아직 못 읽어요. PDF로 저장해서 넣어 주세요.';
  if (ext === 'key' || ext === 'pages' || ext === 'numbers') return "애플 문서는 못 읽어요. '보내기'로 PDF를 만들어 넣어 주세요.";
  return null;
}

/** 첨부 칸에 보이는 종류 이름 */
export function officeLabel(name: string): string {
  if (/\.hwpx?$/i.test(name)) return '한글';
  if (/\.docx$/i.test(name)) return '워드';
  if (/\.pptx$/i.test(name)) return 'PPT';
  return '문서';
}

/** 문서에서 꺼낸 글의 첫 줄 표시: 원본 탭에서 어느 파일인지 보이고, 정리는 '학생이 직접 쓴 글'로 다루지 않는다 */
export function officeTextHeader(name: string): string {
  return `(파일: ${name.replace(/\s+/g, ' ').trim().slice(0, 120)})\n\n`;
}

/** 문서에서 꺼낸 글인지 (첫 줄의 표시로) */
export function isOfficeText(text: string | null | undefined): boolean {
  return /^\(파일: [^\n]+\)\n/.test(text ?? '');
}
