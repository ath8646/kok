// PDF 요약 정리: 화면과 서버가 같이 쓰는 모양·한도 (만드는 것은 src/lib/server/note-pdf.ts)

export const PDF_LIMITS = {
  /** 이름 글자 수 (note_pdfs.name 검사와 같게) */
  name: 60,
  /** 노트마다 둘 수 있는 PDF 수 */
  perNote: 30,
  /** 한 PDF 에 넣는 자료 그림 수 */
  figures: 12,
} as const;

export type PdfTheme = 'dark' | 'light';

export type NotePdfRow = {
  id: string;
  name: string;
  path: string;
  bytes: number;
  pages: number;
  /** 만들 때의 노트 버전 (버전 칸이 없던 노트는 null) */
  version: number | null;
  created_at: string;
  updated_at: string;
};

export function pdfSizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
