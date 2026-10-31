// 한글(.hwp, HWP 5.0 문서) → 글: 문단·표·수식(수식 편집기 글 → LaTeX)·글상자. 머리말·꼬리말·각주는 뺀다.
// HWP 5.0 은 복합 문서(CFB) 안에 FileHeader·DocInfo·BodyText/Section0… 이 있고, 구역마다 레코드(꼬리표·깊이·크기)가 이어진다.
// 압축된 문서는 구역이 raw deflate. 배포용·암호 문서는 내용이 암호화돼 있어 읽지 않는다.
import CFB from 'cfb';
import { inflateSync } from 'fflate';
import { hwpEqToTex } from './hwp-eq';
import { TextOut } from './out';
import { OfficeError } from './errors';

const TAG = {
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  TABLE: 77,
  EQEDIT: 88,
} as const;

type Rec = { tag: number; level: number; data: Uint8Array };

/** 구역 하나의 레코드들 */
function records(buf: Uint8Array): Rec[] {
  const out: Rec[] = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  while (p + 4 <= buf.length) {
    const h = dv.getUint32(p, true);
    p += 4;
    let size = h >>> 20;
    if (size === 0xfff) {
      if (p + 4 > buf.length) break;
      size = dv.getUint32(p, true);
      p += 4;
    }
    if (p + size > buf.length) break;
    out.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: buf.subarray(p, p + size) });
    p += size;
  }
  return out;
}

/** 4 글자 컨트롤 이름 (레코드 안에는 거꾸로 적혀 있다: 'tbl ' → ' lbt') */
function ctrlId(data: Uint8Array, at = 0): string {
  if (data.length < at + 4) return '';
  return String.fromCharCode(data[at + 3], data[at + 2], data[at + 1], data[at]);
}

const INLINE_CTRL = new Set([4, 5, 6, 7, 8, 9, 19, 20]);
const EXTENDED_CTRL = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

type Piece = { text: string } | { ctrl: string };

/** 문단 글 (UTF-16): 글자와 컨트롤 자리 */
function paraPieces(data: Uint8Array): Piece[] {
  const out: Piece[] = [];
  let text = '';
  const n = Math.floor(data.length / 2);
  const at = (i: number) => data[i * 2] | (data[i * 2 + 1] << 8);
  for (let i = 0; i < n; i++) {
    const c = at(i);
    if (c >= 32) {
      text += String.fromCharCode(c);
      continue;
    }
    if (INLINE_CTRL.has(c) || EXTENDED_CTRL.has(c)) {
      if (c === 9) text += '\t';
      if (EXTENDED_CTRL.has(c)) {
        if (text) out.push({ text });
        text = '';
        out.push({ ctrl: ctrlId(data, (i + 1) * 2) });
      }
      i += 7;
      continue;
    }
    if (c === 10) text += '\n';
    else if (c === 24) text += '-';
    else if (c === 30 || c === 31) text += ' ';
  }
  if (text) out.push({ text });
  return out;
}

class Reader {
  constructor(
    private recs: Rec[],
    private out: TextOut,
  ) {}

  /** recs[i] 아래(깊이가 더 깊은 것)가 끝나는 자리 */
  private end(i: number): number {
    const lv = this.recs[i].level;
    let j = i + 1;
    while (j < this.recs.length && this.recs[j].level > lv) j++;
    return j;
  }

  /** from~to 사이의 문단들 (깊이가 level 인 PARA_HEADER) */
  paragraphs(from: number, to: number, level: number, emit: (text: string) => void) {
    for (let i = from; i < to; i++) {
      const r = this.recs[i];
      if (r.tag === TAG.PARA_HEADER && r.level === level) {
        const e = this.end(i);
        this.paragraph(i, e, emit);
        i = e - 1;
      }
    }
  }

  /** 문단 하나: 글과 그 안의 컨트롤(표·수식·글상자) */
  private paragraph(i: number, e: number, emit: (text: string) => void) {
    const level = this.recs[i].level;
    const kids: number[] = [];
    let textRec: Rec | null = null;
    for (let j = i + 1; j < e; j++) {
      const r = this.recs[j];
      if (r.level !== level + 1) continue;
      if (r.tag === TAG.PARA_TEXT) textRec = r;
      else if (r.tag === TAG.CTRL_HEADER) kids.push(j);
    }
    const used = new Set<number>();
    const takeCtrl = (id: string): number | null => {
      for (const k of kids) {
        if (!used.has(k) && ctrlId(this.recs[k].data) === id) {
          used.add(k);
          return k;
        }
      }
      return null;
    };
    let line = '';
    const after: Array<() => void> = [];
    for (const p of textRec ? paraPieces(textRec.data) : []) {
      if ('text' in p) {
        line += p.text;
        continue;
      }
      const k = takeCtrl(p.ctrl);
      if (k === null) continue;
      if (p.ctrl === 'eqed') {
        const tex = this.equation(k);
        if (tex) line += ` $${tex}$ `;
      } else if (p.ctrl === 'tbl ') {
        // 표는 문단 글 다음에
        after.push(() => this.table(k));
      } else if (p.ctrl === 'gso ') {
        after.push(() => this.boxes(k));
      }
      // 머리말·꼬리말(head·foot)·각주(fn·en)·쪽 번호·책갈피 등은 뺀다
    }
    emit(line.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' '));
    for (const f of after) f();
  }

  private equation(k: number): string {
    const e = this.end(k);
    for (let j = k + 1; j < e; j++) {
      const r = this.recs[j];
      if (r.tag !== TAG.EQEDIT || r.data.length < 6) continue;
      const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const len = dv.getUint16(4, true);
      let s = '';
      for (let c = 0; c < len && 6 + c * 2 + 1 < r.data.length; c++) s += String.fromCharCode(dv.getUint16(6 + c * 2, true));
      return hwpEqToTex(s);
    }
    return '';
  }

  /** 표: 칸마다 LIST_HEADER(열·행 번호) 다음에 그 칸의 문단들 */
  private table(k: number) {
    const e = this.end(k);
    const cells: Array<{ row: number; col: number; text: string[] }> = [];
    for (let j = k + 1; j < e; j++) {
      const r = this.recs[j];
      if (r.tag !== TAG.LIST_HEADER) continue;
      const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const col = r.data.length >= 12 ? dv.getUint16(8, true) : cells.length;
      const row = r.data.length >= 12 ? dv.getUint16(10, true) : 0;
      const cell = { row, col, text: [] as string[] };
      cells.push(cell);
      // 이 칸의 문단: 다음 LIST_HEADER 까지, 깊이가 LIST_HEADER 와 같은 PARA_HEADER
      let stop = j + 1;
      while (stop < e && !(this.recs[stop].tag === TAG.LIST_HEADER && this.recs[stop].level === r.level)) stop++;
      // 칸 안의 표·수식은 글로 (줄 하나)
      this.paragraphs(j + 1, stop, r.level, (t) => {
        if (t.trim()) cell.text.push(t.trim());
      });
      j = stop - 1;
    }
    if (!cells.length) return;
    const rows: string[][] = [];
    for (const c of cells) {
      while (rows.length <= c.row) rows.push([]);
      const row = rows[c.row];
      while (row.length < c.col) row.push('');
      row[c.col] = c.text.join(' / ');
    }
    this.out.table(rows);
  }

  /** 그리기 개체 안의 글상자 문단 */
  private boxes(k: number) {
    const e = this.end(k);
    for (let j = k + 1; j < e; j++) {
      const r = this.recs[j];
      if (r.tag !== TAG.LIST_HEADER) continue;
      let stop = j + 1;
      while (stop < e && !(this.recs[stop].tag === TAG.LIST_HEADER && this.recs[stop].level <= r.level)) stop++;
      this.paragraphs(j + 1, stop, r.level, (t) => (t.trim() ? this.out.para(t.trim()) : undefined));
      j = stop - 1;
    }
  }
}

function content(entry: { content?: unknown } | null): Uint8Array | null {
  const c = entry?.content;
  if (!c) return null;
  return c instanceof Uint8Array ? c : new Uint8Array(c as ArrayLike<number>);
}

/** HWP 5.0 문서의 글 */
export function hwpText(data: Uint8Array): string {
  let doc: CFB.CFB$Container;
  try {
    doc = CFB.read(data, { type: 'array' });
  } catch {
    throw new OfficeError('한글 파일을 열지 못했어요. 파일이 깨지지 않았는지 확인해 주세요.');
  }
  const header = content(CFB.find(doc, '/FileHeader'));
  if (!header || header.length < 40) {
    if (CFB.find(doc, '/WordDocument'))
      throw new OfficeError("예전 워드 형식(.doc)이에요. 워드에서 '다른 이름으로 저장'으로 .docx나 PDF로 저장해서 넣어 주세요.");
    if (CFB.find(doc, '/PowerPoint Document'))
      throw new OfficeError("예전 PPT 형식(.ppt)이에요. 파워포인트에서 '다른 이름으로 저장'으로 .pptx나 PDF로 저장해서 넣어 주세요.");
    throw new OfficeError('한글 문서가 아니거나 읽을 수 없는 파일이에요.');
  }
  if (!new TextDecoder('latin1').decode(header.subarray(0, 17)).startsWith('HWP Document File'))
    throw new OfficeError('한글 문서가 아니거나 읽을 수 없는 파일이에요.');
  const props = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(36, true);
  const compressed = (props & 1) !== 0;
  if (props & 2) throw new OfficeError('암호가 걸린 한글 문서예요. 한글에서 암호를 풀고 저장한 뒤 넣어 주세요.');
  if (props & 4) throw new OfficeError("배포용 한글 문서라 내용을 읽을 수 없어요. 한글에서 'PDF로 저장하기'로 PDF를 만들어 넣어 주세요.");

  const out = new TextOut();
  for (let s = 0; ; s++) {
    const raw = content(CFB.find(doc, `/BodyText/Section${s}`));
    if (!raw) break;
    let buf: Uint8Array;
    try {
      buf = compressed ? inflateSync(raw) : raw;
    } catch {
      throw new OfficeError('한글 파일을 열지 못했어요. 파일이 깨지지 않았는지 확인해 주세요.');
    }
    const recs = records(buf);
    const r = new Reader(recs, out);
    r.paragraphs(0, recs.length, 0, (t) => {
      if (t.trim()) out.para(t.replace(/\s+$/, ''));
      else out.blank();
    });
  }
  return out.toString();
}

/** HWP 3 이하 (복합 문서가 아닌 예전 한글) */
export function isOldHwp(data: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(data.subarray(0, 23)) === 'HWP Document File V3.00';
}
