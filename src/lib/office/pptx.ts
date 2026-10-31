// 파워포인트(.pptx) → 글: 슬라이드 차례대로 제목·글 상자(목록 단계)·표·수식(OMML)·코드(고정폭 글꼴)·발표자 노트.
import { ommlToTex } from './docx';
import { OfficeError } from './errors';
import { MONO_FONT, TextOut } from './out';
import { attr, findAll, first, kids, local, parseXml, type XmlNode } from './xml';

const dec = new TextDecoder();

/** 관계 파일: 번호 → 대상 경로 (기준 폴더에서 푼 경로) */
function rels(files: Record<string, Uint8Array>, relsPath: string, base: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw = files[relsPath];
  if (!raw) return out;
  for (const r of findAll(parseXml(dec.decode(raw)), 'Relationship')) {
    const id = attr(r, 'Id');
    const target = attr(r, 'Target');
    if (id && target) out.set(id, resolve(base, target));
  }
  return out;
}

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

type Para = { text: string; level: number; bullet: boolean; mono: boolean };

/** 글 상자의 문단들 */
function paras(txBody: XmlNode, placeholderBullets: boolean): Para[] {
  const out: Para[] = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kids(p, 'pPr')[0];
    const level = Number((pPr && attr(pPr, 'lvl')) ?? 0) || 0;
    const explicit = pPr ? kids(pPr).some((c) => /^bu(Char|AutoNum|Blip)$/.test(local(c.name))) : false;
    const none = pPr ? kids(pPr, 'buNone').length > 0 : false;
    let text = '';
    let chars = 0;
    let mono = 0;
    const walk = (n: XmlNode) => {
      for (const c of n.children) {
        if (typeof c === 'string') continue;
        const l = local(c.name);
        if (l === 'pPr' || l === 'endParaRPr') continue;
        if (l === 'r' || l === 'fld') {
          const rPr = kids(c, 'rPr')[0];
          const latin = rPr ? kids(rPr, 'latin')[0] : undefined;
          const t = kids(c, 't')
            .map((x) => x.children.filter((y): y is string => typeof y === 'string').join(''))
            .join('');
          text += t;
          const visible = t.replace(/\s/g, '').length;
          chars += visible;
          if (latin && MONO_FONT.test(attr(latin, 'typeface') ?? '')) mono += visible;
        } else if (l === 'br') text += '\n';
        else if (l === 'oMath' || l === 'oMathPara') text += ` $${ommlToTex(c).replace(/\s+/g, ' ').trim()}$ `;
        else if (l === 'Fallback') continue;
        else walk(c);
      }
    };
    walk(p);
    if (!text.trim()) continue;
    out.push({ text: text.replace(/[ \t]+$/gm, ''), level, bullet: !none && (explicit || placeholderBullets || level > 0), mono: chars > 0 && mono === chars });
  }
  return out;
}

const TITLE = new Set(['title', 'ctrTitle']);
const SKIP = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);

/** 슬라이드 하나: 제목과 내용 */
function slideText(xml: XmlNode, out: TextOut, n: number) {
  const tree = first(xml, 'spTree');
  if (!tree) return;
  const titles: string[] = [];
  const body: Array<() => void> = [];
  const shape = (sp: XmlNode) => {
    const ph = first(sp, 'ph');
    const type = ph ? (attr(ph, 'type') ?? 'body') : '';
    if (SKIP.has(type)) return;
    const tx = kids(sp, 'txBody')[0];
    if (!tx) return;
    const list = paras(tx, type === 'body' || type === 'obj');
    if (TITLE.has(type)) {
      titles.push(list.map((p) => p.text.replace(/\s+/g, ' ').trim()).join(' '));
      return;
    }
    body.push(() => {
      for (const p of list) {
        if (p.mono) {
          for (const line of p.text.split('\n')) out.codeLine(`${'  '.repeat(p.level)}${line}`);
          continue;
        }
        const t = p.text.replace(/\n/g, ' ').trim();
        out.para(p.bullet ? `${'  '.repeat(Math.min(p.level, 5))}- ${t}` : t);
      }
    });
  };
  const walk = (n: XmlNode) => {
    for (const c of kids(n)) {
      const l = local(c.name);
      if (l === 'sp') shape(c);
      else if (l === 'grpSp') walk(c);
      else if (l === 'graphicFrame') {
        const tbl = first(c, 'tbl');
        if (tbl) {
          const rows = kids(tbl, 'tr').map((tr) =>
            kids(tr, 'tc').map((tc) => {
              const tx = kids(tc, 'txBody')[0];
              return tx
                ? paras(tx, false)
                    .map((p) => p.text.replace(/\n/g, ' ').trim())
                    .join(' / ')
                : '';
            }),
          );
          body.push(() => out.table(rows));
        }
      } else if (l === 'AlternateContent') {
        const choice = kids(c, 'Choice')[0];
        if (choice) walk(choice);
      }
    }
  };
  walk(tree);
  const title = titles.filter(Boolean).join(' · ');
  out.para(`## ${n}. ${title || '슬라이드'}`);
  for (const f of body) f();
}

/** 발표자 노트의 글 (본문 자리 글만) */
function notesText(xml: XmlNode): string[] {
  const out: string[] = [];
  for (const sp of findAll(xml, 'sp')) {
    const ph = first(sp, 'ph');
    if (!ph || (attr(ph, 'type') ?? 'body') !== 'body') continue;
    const tx = kids(sp, 'txBody')[0];
    if (tx) for (const p of paras(tx, false)) out.push(p.text.replace(/\n/g, ' ').trim());
  }
  return out.filter(Boolean);
}

export function pptxText(files: Record<string, Uint8Array>): string {
  const pres = files['ppt/presentation.xml'];
  if (!pres) throw new OfficeError('PPT 내용을 찾지 못했어요.');
  const presRels = rels(files, 'ppt/_rels/presentation.xml.rels', 'ppt');
  const ids = findAll(parseXml(dec.decode(pres)), 'sldId')
    .map((s) => attr(s, 'id') && Object.entries(s.attrs).find(([k]) => local(k) === 'id' && k.includes(':'))?.[1])
    .filter((x): x is string => !!x);
  let slides = ids.map((id) => presRels.get(id)).filter((p): p is string => !!p && !!files[p]);
  // 차례를 못 읽으면 파일 이름 번호 차례로
  if (!slides.length)
    slides = Object.keys(files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const out = new TextOut();
  slides.forEach((path, i) => {
    const xml = parseXml(dec.decode(files[path]));
    // 숨긴 슬라이드는 뺀다
    const sld = first(xml, 'sld');
    if (sld && attr(sld, 'show') === '0') return;
    slideText(xml, out, i + 1);
    const name = path.split('/').pop()!;
    const notes = [...rels(files, `ppt/slides/_rels/${name}.rels`, 'ppt/slides').values()].find((t) => /notesSlides\/notesSlide\d+\.xml$/.test(t));
    if (notes && files[notes]) {
      const lines = notesText(parseXml(dec.decode(files[notes])));
      if (lines.length) out.para(`(발표자 노트) ${lines.join(' ')}`);
    }
    out.blank();
  });
  return out.toString();
}
