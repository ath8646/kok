// 한글(.hwpx, OWPML) → 글: 구역(Contents/section*.xml) 차례대로 문단·표·수식(수식 편집기 글 → LaTeX)·글상자·그림 자리(+ 그림 설명).
// 머리말·꼬리말·각주·미주는 뺀다. 그림 파일은 content.hpf 의 목록(id → BinData/…)으로 찾는다.
import { OfficeError } from './errors';
import { hwpEqToTex } from './hwp-eq';
import { TextOut } from './out';
import { cropOf, type Crop, type PictureSink } from './pictures';
import { attr, findAll, kids, local, parseXml, type XmlNode } from './xml';

const dec = new TextDecoder();

/** 읽는 동안 함께 쓰는 것: 그림을 모으는 곳, 그림 번호 → 꾸러미 안의 경로, 표 칸 안에서 만난 그림 (표 다음에 넣는다) */
type Ctx = { sink?: PictureSink; bin: Map<string, string>; cellPics?: Array<{ path: string; crop?: Crop }> };

/** 그림 개체(hp:pic) → 그림 파일 경로와 자르기 (hp:imgClip 을 hp:imgDim 에 대한 비율로) */
function picOf(pic: XmlNode, ctx: Ctx): { path: string; crop?: Crop } | null {
  const img = findAll(pic, 'img')[0];
  const ref = img ? attr(img, 'binaryItemIDRef') : undefined;
  const path = ref ? ctx.bin.get(ref) : undefined;
  if (!path) return null;
  const clip = kids(pic, 'imgClip')[0];
  const dim = kids(pic, 'imgDim')[0];
  const w = Number(dim ? attr(dim, 'dimwidth') : 0);
  const h = Number(dim ? attr(dim, 'dimheight') : 0);
  if (!clip || !(w > 0) || !(h > 0)) return { path };
  // 자른 뒤 남은 사각형 (imgDim 과 같은 단위). 오른쪽·아래가 없거나 왼쪽·위보다 작으면 자르기 정보가 아니다
  const n = (k: string) => Number(attr(clip, k) ?? NaN);
  const [left, top, right, bottom] = [n('left'), n('top'), n('right'), n('bottom')];
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return { path };
  return { path, crop: cropOf(left / w, top / h, 1 - right / w, 1 - bottom / h) };
}

/** 문단 하나의 글. 표·글상자·그림은 문단 뒤에 따로 */
function paragraph(p: XmlNode, out: TextOut, inCell: boolean, ctx: Ctx): string {
  let text = '';
  const after: Array<() => void> = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      const l = local(c.name);
      if (l === 't') {
        for (const x of c.children) {
          if (typeof x === 'string') text += x;
          else {
            const xl = local(x.name);
            if (xl === 'lineBreak') text += '\n';
            else if (xl === 'tab') text += '\t';
            else if (xl === 'fwSpace' || xl === 'nbSpace') text += ' ';
            else if (xl === 'hyphen') text += '-';
          }
        }
      } else if (l === 'equation') {
        const script = kids(c, 'script')[0];
        const tex = script ? hwpEqToTex(script.children.filter((y): y is string => typeof y === 'string').join('')) : '';
        if (tex) text += ` $${tex}$ `;
      } else if (l === 'tbl') {
        if (inCell) text += ` ${tableCells(c, ctx).flat().filter(Boolean).join(' / ')} `;
        else
          after.push(() => {
            const pics: Array<{ path: string; crop?: Crop }> = [];
            out.table(tableCells(c, { ...ctx, cellPics: pics }));
            for (const pic of pics) out.picture(ctx.sink?.add(pic.path, pic.crop));
          });
      } else if (l === 'pic') {
        const pic = picOf(c, ctx);
        const caption = kids(c, 'caption')[0];
        const list = caption ? kids(caption, 'subList')[0] : undefined;
        if (inCell) {
          if (pic) ctx.cellPics?.push(pic);
        } else
          after.push(() => {
            if (pic) out.picture(ctx.sink?.add(pic.path, pic.crop));
            // 그림 설명 (그림 아래 '[그림 1] …')
            if (list) paragraphs(list, out, false, ctx);
          });
      } else if (l === 'drawText') {
        // 글상자: 문단 뒤에
        const list = kids(c, 'subList')[0];
        if (list) after.push(() => paragraphs(list, out, false, ctx));
      } else if (l === 'ctrl' || l === 'header' || l === 'footer' || l === 'footNote' || l === 'endNote' || l === 'linesegarray') {
        continue;
      } else walk(c);
    }
  };
  walk(p);
  const line = text.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ');
  if (!inCell) {
    if (line.trim()) out.para(line.replace(/\s+$/, ''));
    else out.blank();
    for (const f of after) f();
  }
  return line;
}

function tableCells(tbl: XmlNode, ctx: Ctx): string[][] {
  const rows: string[][] = [];
  kids(tbl, 'tr').forEach((tr, ri) => {
    for (const tc of kids(tr, 'tc')) {
      const addr = kids(tc, 'cellAddr')[0];
      const row = addr ? Number(attr(addr, 'rowAddr') ?? ri) : ri;
      while (rows.length <= row) rows.push([]);
      const r = rows[row];
      const col = addr ? Number(attr(addr, 'colAddr') ?? r.length) : r.length;
      while (r.length < col) r.push('');
      const list = kids(tc, 'subList')[0];
      const scratch = new TextOut();
      r[col] = list
        ? kids(list, 'p')
            .map((p) => paragraph(p, scratch, true, ctx).trim())
            .filter(Boolean)
            .join(' / ')
        : '';
    }
  });
  return rows;
}

function paragraphs(list: XmlNode, out: TextOut, inCell: boolean, ctx: Ctx) {
  for (const p of kids(list, 'p')) paragraph(p, out, inCell, ctx);
}

/** 한글(HWPX) 문서의 글. sink 가 있으면 그림 자리에 표시 줄을 넣는다 (그림 파일은 꾸러미 안의 경로로 sink 에) */
export function hwpxText(files: Record<string, Uint8Array>, sink?: PictureSink): string {
  // 구역 차례: content.hpf 의 spine, 없으면 파일 이름 번호 차례. 그림 파일: manifest 의 id → 경로
  let sections: string[] = [];
  const bin = new Map<string, string>();
  const hpf = files['Contents/content.hpf'];
  if (hpf) {
    const doc = parseXml(dec.decode(hpf));
    const items = new Map(findAll(doc, 'item').map((it) => [attr(it, 'id') ?? '', attr(it, 'href') ?? '']));
    for (const [id, href] of items) {
      const h = href.replace(/^\.?\//, '');
      const path = files[h] !== undefined || !files[`Contents/${h}`] ? h : `Contents/${h}`;
      if (id && h && !/\.(xml|hpf)$/i.test(h)) bin.set(id, path);
    }
    sections = findAll(doc, 'itemref')
      .map((r) => items.get(attr(r, 'idref') ?? '') ?? '')
      .map((h) => (h.startsWith('Contents/') ? h : `Contents/${h.replace(/^\.?\//, '')}`))
      .filter((h) => /section\d+\.xml$/i.test(h) && files[h]);
  }
  if (!sections.length)
    sections = Object.keys(files)
      .filter((f) => /^Contents\/section\d+\.xml$/i.test(f))
      .sort((a, b) => Number(/(\d+)\.xml$/i.exec(a)![1]) - Number(/(\d+)\.xml$/i.exec(b)![1]));
  if (!sections.length) throw new OfficeError('한글 문서 내용을 찾지 못했어요.');
  const out = new TextOut();
  const ctx: Ctx = { sink, bin };
  for (const s of sections) {
    const root = parseXml(dec.decode(files[s]));
    const sec = findAll(root, 'sec')[0] ?? root;
    paragraphs(sec, out, false, ctx);
  }
  return out.toString();
}
