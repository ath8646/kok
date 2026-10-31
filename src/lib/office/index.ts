// 한글·워드·PPT 파일 → 글 자료 + 그림. 브라우저에서 파일을 읽어 글과 그림을 꺼낸다
// (서버로는 꺼낸 글과, JPEG 로 바꾼 그림만 간다: 파일 자체는 올리지 않는다).
// 무엇인지는 이름이 아니라 내용으로 본다: zip(PK) 이면 워드·PPT·HWPX, 복합 문서(D0CF11E0)면 HWP 5.0(또는 예전 .doc·.ppt), 'HWP Document File V3' 이면 예전 한글.
// 글에는 그림 자리마다 '[[picture N]]' 줄이 들어가고(lib/doc-pictures.ts), pictures[N-1] 이 그 그림이다 (작은 그림·장식·못 읽는 형식은 뺀다).
import { unzipSync } from 'fflate';
import { stripPictureMarks } from '../doc-pictures';
import { docxText } from './docx';
import { OfficeError } from './errors';
import { hwpContent, isOldHwp } from './hwp';
import { hwpxText } from './hwpx';
import { officeNameProblem } from './names';
import { collectPictures, PictureSink, type DocPicture } from './pictures';
import { pptxText } from './pptx';

export { OfficeError, officeNameProblem };
export type { DocPicture };

export type OfficeKind = 'docx' | 'pptx' | 'hwpx' | 'hwp';

export type OfficeContent = { kind: OfficeKind; text: string; pictures: DocPicture[] };

/** 파일 하나의 가장 큰 크기와 압축을 푼 글의 가장 큰 크기 (zip 폭탄 막기) */
export const OFFICE_MAX_BYTES = 80 * 1024 * 1024;
const MAX_UNZIPPED = 120 * 1024 * 1024;
/** 그림 파일: 모두 합친 크기와 한 장의 가장 큰 크기 (넘는 그림은 뺀다) */
const MAX_PICTURE_BYTES = 160 * 1024 * 1024;
const MAX_ONE_PICTURE = 40 * 1024 * 1024;

function zipFiles(data: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(data, {
      // 글이 든 XML 만 푼다 (그림·글꼴은 건너뛴다: 그림은 쓰는 것만 나중에 푼다)
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

/** 글에 자리가 있는 그림 파일만 zip 에서 푼다 (이름은 대소문자를 가리지 않는다). 너무 크면 그 그림은 뺀다 */
function zipPictures(data: Uint8Array, wanted: string[]): (key: string) => Uint8Array | null {
  if (!wanted.length) return () => null;
  const want = new Set(wanted.map((w) => w.toLowerCase()));
  let total = 0;
  let files: Record<string, Uint8Array> = {};
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!want.has(f.name.toLowerCase()) || f.originalSize > MAX_ONE_PICTURE) return false;
        total += f.originalSize;
        return total <= MAX_PICTURE_BYTES;
      },
    });
  } catch {
    files = {};
  }
  const byName = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  return (key) => byName.get(key.toLowerCase()) ?? null;
}

/** 파일 내용 → 글과 그림 */
export function officeContent(data: Uint8Array): OfficeContent {
  if (data.length > OFFICE_MAX_BYTES) throw new OfficeError('파일이 너무 커요. 나눠서 넣거나 PDF로 저장해서 넣어 주세요.');
  const sink = new PictureSink();
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const files = zipFiles(data);
    let kind: OfficeKind;
    let text: string;
    if (files['word/document.xml']) [kind, text] = ['docx', docxText(files, sink)];
    else if (files['ppt/presentation.xml']) [kind, text] = ['pptx', pptxText(files, sink)];
    else if (Object.keys(files).some((f) => /^Contents\/section\d+\.xml$/i.test(f))) [kind, text] = ['hwpx', hwpxText(files, sink)];
    else if (files['xl/workbook.xml']) throw new OfficeError('엑셀 파일은 아직 못 읽어요. PDF로 저장해서 넣어 주세요.');
    else throw new OfficeError('한글·워드·PPT 문서가 아니거나 읽을 수 없는 파일이에요.');
    return {
      kind,
      ...collectPictures(
        text,
        sink,
        zipPictures(
          data,
          sink.refs.map((r) => r.key),
        ),
      ),
    };
  }
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) {
    const { text, load } = hwpContent(data, sink);
    return { kind: 'hwp', ...collectPictures(text, sink, load) };
  }
  if (isOldHwp(data)) throw new OfficeError("예전 한글 형식(한글 97 이전)이에요. 한글에서 '다른 이름으로 저장'으로 .hwp나 PDF로 저장해서 넣어 주세요.");
  throw new OfficeError('한글·워드·PPT 문서가 아니거나 읽을 수 없는 파일이에요.');
}

/** 파일 내용 → 글만 (그림 자리 줄은 뺀다) */
export function officeText(data: Uint8Array): { kind: OfficeKind; text: string } {
  const r = officeContent(data);
  return { kind: r.kind, text: stripPictureMarks(r.text) };
}

/** 브라우저의 파일 → 글과 그림. 글도 그림도 거의 없으면 안내 */
export async function extractOffice(file: Blob & { name: string }): Promise<OfficeContent> {
  const problem = officeNameProblem(file.name);
  if (problem) throw new OfficeError(problem);
  const r = officeContent(new Uint8Array(await file.arrayBuffer()));
  const visible = stripPictureMarks(r.text)
    .replace(/^##.*$/gm, '')
    .replace(/[\s|#*-]/g, '').length;
  if (visible < 20 && !r.pictures.length)
    throw new OfficeError(
      r.kind === 'pptx'
        ? 'PPT에 글이 거의 없어요. 그림이 많은 PPT는 PDF로 저장해서 넣어 주세요.'
        : '문서에 글이 거의 없어요. 그림이 많은 문서는 PDF로 저장해서 넣어 주세요.',
    );
  return r;
}
