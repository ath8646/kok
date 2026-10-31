// 한글·워드·PPT 파일 → 글 자료. 브라우저에서 파일을 읽어 글만 꺼낸다 (서버로는 꺼낸 글만 간다: 글 자료와 같다).
// 무엇인지는 이름이 아니라 내용으로 본다: zip(PK) 이면 워드·PPT·HWPX, 복합 문서(D0CF11E0)면 HWP 5.0(또는 예전 .doc·.ppt), 'HWP Document File V3' 이면 예전 한글.
// 안의 그림은 읽지 않는다 (그림이 중요한 자료는 PDF로 저장해 넣으면 된다).
import { unzipSync } from 'fflate';
import { docxText } from './docx';
import { OfficeError } from './errors';
import { hwpText, isOldHwp } from './hwp';
import { hwpxText } from './hwpx';
import { officeNameProblem } from './names';
import { pptxText } from './pptx';

export { OfficeError };
export { officeNameProblem };

export type OfficeKind = 'docx' | 'pptx' | 'hwpx' | 'hwp';

/** 파일 하나의 가장 큰 크기와 압축을 푼 글의 가장 큰 크기 (zip 폭탄 막기) */
export const OFFICE_MAX_BYTES = 80 * 1024 * 1024;
const MAX_UNZIPPED = 120 * 1024 * 1024;

function zipFiles(data: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(data, {
      // 글이 든 XML 만 푼다 (그림·글꼴은 건너뛴다)
      filter: (f) => {
        if (!/\.(xml|rels|hpf)$/i.test(f.name) && f.name !== 'mimetype') return false;
        total += f.originalSize;
        if (total > MAX_UNZIPPED) throw new OfficeError('파일 안의 내용이 너무 커요. PDF로 저장해서 넣어 주세요.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof OfficeError) throw e;
    throw new OfficeError('파일을 열지 못했어요. 파일이 깨지지 않았는지 확인해 주세요.');
  }
}

/** 파일 내용 → 글 */
export function officeText(data: Uint8Array): { kind: OfficeKind; text: string } {
  if (data.length > OFFICE_MAX_BYTES) throw new OfficeError('파일이 너무 커요. 나눠서 넣거나 PDF로 저장해서 넣어 주세요.');
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const files = zipFiles(data);
    if (files['word/document.xml']) return { kind: 'docx', text: docxText(files) };
    if (files['ppt/presentation.xml']) return { kind: 'pptx', text: pptxText(files) };
    if (Object.keys(files).some((f) => /^Contents\/section\d+\.xml$/i.test(f))) return { kind: 'hwpx', text: hwpxText(files) };
    if (files['xl/workbook.xml']) throw new OfficeError('엑셀 파일은 아직 못 읽어요. PDF로 저장해서 넣어 주세요.');
    throw new OfficeError('한글·워드·PPT 문서가 아니거나 읽을 수 없는 파일이에요.');
  }
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) return { kind: 'hwp', text: hwpText(data) };
  if (isOldHwp(data)) throw new OfficeError("예전 한글 형식(한글 97 이전)이에요. 한글에서 '다른 이름으로 저장'으로 .hwp나 PDF로 저장해서 넣어 주세요.");
  throw new OfficeError('한글·워드·PPT 문서가 아니거나 읽을 수 없는 파일이에요.');
}

/** 브라우저의 파일 → 글. 글이 거의 없으면(그림만 있는 문서) 안내 */
export async function extractOfficeText(file: Blob & { name: string }): Promise<{ kind: OfficeKind; text: string }> {
  const problem = officeNameProblem(file.name);
  if (problem) throw new OfficeError(problem);
  const r = officeText(new Uint8Array(await file.arrayBuffer()));
  const visible = r.text.replace(/^##.*$/gm, '').replace(/[\s|#*-]/g, '').length;
  if (visible < 20)
    throw new OfficeError(
      r.kind === 'pptx'
        ? 'PPT에 글이 거의 없어요. 그림이 많은 PPT는 PDF로 저장해서 넣어 주세요.'
        : '문서에 글이 거의 없어요. 그림이 많은 문서는 PDF로 저장해서 넣어 주세요.',
    );
  return r;
}
