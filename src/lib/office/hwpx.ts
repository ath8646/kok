// 한글(.hwpx, OWPML) → 글: 구역(Contents/section*.xml) 차례대로 문단·표·수식(수식 편집기 글 → LaTeX)·글상자.
// 머리말·꼬리말·각주·미주는 뺀다.
import { OfficeError } from './errors';
import { hwpEqToTex } from './hwp-eq';
import { TextOut } from './out';
import { attr, findAll, kids, local, parseXml, type XmlNode } from './xml';

const dec = new TextDecoder();

/** 문단 하나의 글. 표·글상자는 문단 뒤에 따로 */
function paragraph(p: XmlNode, out: TextOut, inCell: boolean): string {
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
        if (inCell) text += ` ${tableCells(c).flat().filter(Boolean).join(' / ')} `;
        else after.push(() => out.table(tableCells(c)));
      } else if (l === 'drawText') {
        // 글상자: 문단 뒤에
        const list = kids(c, 'subList')[0];
        if (list) after.push(() => paragraphs(list, out, false));
      } else if (l === 'ctrl' || l === 'header' || l === 'footer' || l === 'footNote' || l === 'endNote' || l === 'pic' || l === 'linesegarray') {
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

function tableCells(tbl: XmlNode): string[][] {
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
            .map((p) => paragraph(p, scratch, true).trim())
            .filter(Boolean)
            .join(' / ')
        : '';
    }
  });
  return rows;
}

function paragraphs(list: XmlNode, out: TextOut, inCell: boolean) {
  for (const p of kids(list, 'p')) paragraph(p, out, inCell);
}

export function hwpxText(files: Record<string, Uint8Array>): string {
  // 구역 차례: content.hpf 의 spine, 없으면 파일 이름 번호 차례
  let sections: string[] = [];
  const hpf = files['Contents/content.hpf'];
  if (hpf) {
    const doc = parseXml(dec.decode(hpf));
    const items = new Map(findAll(doc, 'item').map((it) => [attr(it, 'id') ?? '', attr(it, 'href') ?? '']));
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
  for (const s of sections) {
    const root = parseXml(dec.decode(files[s]));
    const sec = findAll(root, 'sec')[0] ?? root;
    paragraphs(sec, out, false);
  }
  return out.toString();
}
