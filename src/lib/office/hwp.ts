// 한글(.hwp, HWP 5.0 문서) → 글: 문단·표·수식(수식 편집기 글 → LaTeX)·글상자·그림 자리. 머리말·꼬리말·각주는 뺀다.
// HWP 5.0 은 복합 문서(CFB) 안에 FileHeader·DocInfo·BodyText/Section0·BinData/BIN0001.jpg … 이 있고, 구역마다 레코드(꼬리표·깊이·크기)가 이어진다.
// 압축된 문서는 구역·DocInfo·그림이 raw deflate. 배포용·암호 문서는 내용이 암호화돼 있어 읽지 않는다.
// 그림: 그리기 개체('gso ') 아래의 그림 레코드(SHAPE_COMPONENT_PICTURE)가 DocInfo 의 그림 목록(BIN_DATA, 1부터) 번호를 가리키고,
// 그 목록에 저장 번호·확장자가 있다 (파일 이름 BIN{저장 번호 16진 4자리}.{확장자}).
import CFB from 'cfb';
import { inflateSync } from 'fflate';
import { hwpEqToTex } from './hwp-eq';
import { TextOut } from './out';
import { OfficeError } from './errors';
import { cropOf, type CropFor, type PictureSink } from './pictures';

const TAG = {
  BIN_DATA: 18,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  TABLE: 77,
  SHAPE_PICTURE: 85,
  EQEDIT: 88,
} as const;

/** 그림 레코드 안의 그림 목록 번호 자리 (테두리 12 + 사각형 32 + 자르기 16 + 여백 8 + 밝기·명암·효과 3) */
const PICTURE_BIN_AT = 71;

/**
 * 그림 레코드의 자르기: 자른 뒤 남은 사각형(44~59바이트: 왼쪽·위·오른쪽·아래, 원래 그림 크기의 HWPUNIT)을 원래 크기에 대한 비율로.
 * 원래 크기는 새 문서면 레코드 끝 8바이트(가로·세로, 그림의 가로세로 비와 맞을 때만), 아니면 픽셀 수 × 사각형에서 잰 HWPUNIT/픽셀
 * (안 자른 쪽이 그대로 원래 크기라서 오른쪽·아래 중 큰 비를 쓴다. 두 쪽 다 자른 예전 문서는 덜 자를 수 있다: 원본 그대로보다는 낫다)
 */
function pictureCrop(d: Uint8Array): CropFor | undefined {
  if (d.length < 60) return undefined;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const [left, top, right, bottom] = [44, 48, 52, 56].map((o) => dv.getInt32(o, true));
  if (right <= left || bottom <= top || right <= 0 || bottom <= 0) return undefined;
  const tail = d.length >= 86 ? [dv.getInt32(d.length - 8, true), dv.getInt32(d.length - 4, true)] : null;
  return (w, h) => {
    let [W, H] = [0, 0];
    if (tail && tail[0] > 0 && tail[1] > 0 && Math.abs(tail[0] / w - tail[1] / h) <= 0.05 * (tail[0] / w)) [W, H] = tail;
    else {
      const s = Math.max(right / w, bottom / h);
      [W, H] = [w * s, h * s];
    }
    return cropOf(left / W, top / H, 1 - right / W, 1 - bottom / H);
  };
}

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
    private sink?: PictureSink,
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
        after.push(() => this.shape(k));
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

  /** 그리기 개체: 그림이면 그림 자리, 글상자·그림 설명은 문단으로 */
  private shape(k: number) {
    const e = this.end(k);
    // 이 개체의 그림 (안에 든 다른 개체(글상자 속 그림)는 그 개체를 읽을 때: 두 번 넣지 않게)
    for (let j = k + 1; j < e; j++) {
      const r = this.recs[j];
      if (r.tag === TAG.CTRL_HEADER) {
        j = this.end(j) - 1;
        continue;
      }
      if (r.tag === TAG.SHAPE_PICTURE && r.data.length >= PICTURE_BIN_AT + 2) {
        const id = r.data[PICTURE_BIN_AT] | (r.data[PICTURE_BIN_AT + 1] << 8);
        if (id > 0) this.out.picture(this.sink?.add(`bin:${id}`, pictureCrop(r.data)));
      }
    }
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

/** DocInfo 의 그림 목록 (1부터): 파일에 든 그림(EMBEDDING)만 저장 번호·확장자·압축 */
type BinItem = { storage: number; ext: string; compress: 0 | 1 | 2 } | null;

function binItems(docInfo: Uint8Array | null): BinItem[] {
  if (!docInfo) return [];
  const out: BinItem[] = [];
  for (const r of records(docInfo)) {
    if (r.tag !== TAG.BIN_DATA) continue;
    const d = r.data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (d.length < 6) {
      out.push(null);
      continue;
    }
    const props = dv.getUint16(0, true);
    // 0 = 밖의 파일에 이어 둠(LINK), 1 = 문서 안 그림(EMBEDDING), 2 = OLE 저장소(STORAGE)
    if ((props & 0x0f) !== 1) {
      out.push(null);
      continue;
    }
    const storage = dv.getUint16(2, true);
    const len = dv.getUint16(4, true);
    let ext = '';
    for (let c = 0; c < len && 6 + c * 2 + 1 < d.length; c++) ext += String.fromCharCode(dv.getUint16(6 + c * 2, true));
    out.push({
      storage,
      ext: ext
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase()
        .slice(0, 8),
      compress: ((props >> 4) & 3) as 0 | 1 | 2,
    });
  }
  return out;
}

/**
 * HWP 5.0 문서의 글과 그림 꺼내기. sink 가 있으면 그림 자리에 표시 줄을 넣고('bin:목록 번호'),
 * load 가 그 그림 파일을 꺼낸다 (못 꺼내면 null)
 */
export function hwpContent(data: Uint8Array, sink?: PictureSink): { text: string; load: (key: string) => Uint8Array | null } {
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
    const r = new Reader(recs, out, sink);
    r.paragraphs(0, recs.length, 0, (t) => {
      if (t.trim()) out.para(t.replace(/\s+$/, ''));
      else out.blank();
    });
  }
  const text = out.toString();
  if (!sink?.refs.length) return { text, load: () => null };

  // 그림 목록은 그림이 있을 때만 읽는다 (DocInfo 가 깨졌어도 글은 그대로)
  let bins: BinItem[] = [];
  try {
    const raw = content(CFB.find(doc, '/DocInfo'));
    bins = binItems(raw ? (compressed ? inflateSync(raw) : raw) : null);
  } catch {
    bins = [];
  }
  const load = (key: string): Uint8Array | null => {
    const m = /^bin:(\d+)$/.exec(key);
    const item = m ? bins[Number(m[1]) - 1] : null;
    if (!item) return null;
    const hex = item.storage.toString(16).toUpperCase().padStart(4, '0');
    const raw = content(CFB.find(doc, `/BinData/BIN${hex}.${item.ext}`)) ?? content(CFB.find(doc, `/BinData/BIN${hex.toLowerCase()}.${item.ext}`));
    if (!raw) return null;
    // 압축: 0 = 문서를 따른다, 1 = 압축, 2 = 압축 안 함. 풀리지 않으면 그대로 (압축하지 않은 그림)
    if (item.compress === 1 || (item.compress === 0 && compressed)) {
      try {
        return inflateSync(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  };
  return { text, load };
}

/** HWP 3 이하 (복합 문서가 아닌 예전 한글) */
export function isOldHwp(data: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(data.subarray(0, 23)) === 'HWP Document File V3.00';
}
