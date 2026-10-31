// 워드(.docx) → 글: 문단·제목·목록·표·글상자·수식(OMML → LaTeX)·코드(고정폭 글꼴·코드 스타일 문단)·그림 자리·차트(값 표)
import { chartTable } from './chart';
import { OfficeError } from './errors';
import { CODE_STYLE, MONO_FONT, TextOut } from './out';
import { cropOf, type Crop, type PictureSink } from './pictures';
import { readRels } from './rels';
import { attr, findAll, first, kids, local, parseXml, type XmlNode } from './xml';

/** 문단 안에서 만난 그림·차트 (관계 번호) */
type Found = { kind: 'pic'; rid: string; crop?: Crop } | { kind: 'chart'; rid: string };

/** a:srcRect (1/1000 %: 10000 = 10%) → 자르기 */
export function srcRectCrop(n: XmlNode | undefined): Crop | undefined {
  if (!n) return undefined;
  const v = (k: string) => Number(attr(n, k) ?? 0) / 100000;
  return cropOf(v('l'), v('t'), v('r'), v('b'));
}

type Styles = Map<string, string>;

/** 스타일 번호 → 이름 (styles.xml: 'Heading1' → 'heading 1') */
function readStyles(xml: string | null): Styles {
  const out: Styles = new Map();
  if (!xml) return out;
  for (const s of findAll(parseXml(xml), 'style')) {
    const id = attr(s, 'styleId');
    const name = first(s, 'name');
    if (id) out.set(id, (name ? attr(name, 'val') : '') || id);
  }
  return out;
}

/** OMML 수식 → LaTeX (자주 쓰는 모양만: 분수·위아래 첨자·근호·괄호·합·함수) */
export function ommlToTex(n: XmlNode): string {
  const all = (x: XmlNode | null): string => (x ? x.children.map((c) => (typeof c === 'string' ? '' : ommlToTex(c))).join('') : '');
  const part = (name: string) => all(kids(n, name)[0] ?? null);
  switch (local(n.name)) {
    case 't':
      return n.children.filter((c): c is string => typeof c === 'string').join('');
    case 'f':
      return `\\frac{${part('num')}}{${part('den')}}`;
    case 'sSup':
      return `{${part('e')}}^{${part('sup')}}`;
    case 'sSub':
      return `{${part('e')}}_{${part('sub')}}`;
    case 'sSubSup':
      return `{${part('e')}}_{${part('sub')}}^{${part('sup')}}`;
    case 'rad': {
      const deg = part('deg');
      return deg ? `\\sqrt[${deg}]{${part('e')}}` : `\\sqrt{${part('e')}}`;
    }
    case 'd': {
      const pr = kids(n, 'dPr')[0];
      const beg = (pr && kids(pr, 'begChr')[0] && attr(kids(pr, 'begChr')[0], 'val')) ?? '(';
      const end = (pr && kids(pr, 'endChr')[0] && attr(kids(pr, 'endChr')[0], 'val')) ?? ')';
      const inner = kids(n, 'e').map(all).join(', ');
      const esc = (c: string) => (c === '{' ? '\\{' : c === '}' ? '\\}' : c || '.');
      return `\\left${esc(beg)}${inner}\\right${esc(end)}`;
    }
    case 'nary': {
      const pr = kids(n, 'naryPr')[0];
      const chr = (pr && kids(pr, 'chr')[0] && attr(kids(pr, 'chr')[0], 'val')) ?? '∫';
      const op = chr === '∑' ? '\\sum' : chr === '∏' ? '\\prod' : chr === '∮' ? '\\oint' : '\\int';
      const sub = part('sub');
      const sup = part('sup');
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${part('e')}`;
    }
    case 'func':
      return `${part('fName')} ${part('e')}`;
    case 'bar':
      return `\\overline{${part('e')}}`;
    case 'acc': {
      const pr = kids(n, 'accPr')[0];
      const chr = (pr && kids(pr, 'chr')[0] && attr(kids(pr, 'chr')[0], 'val')) ?? '^';
      const cmd = chr === '→' || chr === '⃗' ? '\\vec' : chr === '¯' || chr === '‾' ? '\\bar' : chr === '˙' ? '\\dot' : '\\hat';
      return `${cmd}{${part('e')}}`;
    }
    case 'rPr':
    case 'ctrlPr':
    case 'fPr':
    case 'dPr':
    case 'naryPr':
    case 'radPr':
    case 'sSupPr':
    case 'sSubPr':
    case 'sSubSupPr':
    case 'funcPr':
    case 'accPr':
    case 'barPr':
      return '';
    default:
      return all(n);
  }
}

/** 문단 하나의 글 (글상자 안 문단은 따로 boxes 에, 그림·차트는 found 에 모은다) */
function paraText(p: XmlNode, boxes: XmlNode[][], found: Found[] = []): { text: string; mono: boolean } {
  let text = '';
  let chars = 0;
  let monoChars = 0;
  const walk = (n: XmlNode, mono: boolean) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      const l = local(c.name);
      // mc:Fallback 은 mc:Choice 와 같은 내용의 예전 모양이다 (두 번 읽지 않게)
      if (l === 'pPr' || l === 'rPr' || l === 'del' || l === 'delText' || l === 'instrText' || l === 'fldChar' || l === 'Fallback') continue;
      if (l === 'blipFill') {
        const blip = kids(c, 'blip')[0];
        const rid = blip ? attr(blip, 'embed') : undefined;
        if (rid) found.push({ kind: 'pic', rid, crop: srcRectCrop(kids(c, 'srcRect')[0]) });
        continue;
      }
      if (l === 'imagedata') {
        // 예전 모양(VML) 그림
        const rid = attr(c, 'id');
        if (rid) found.push({ kind: 'pic', rid });
        continue;
      }
      if (l === 'chart') {
        const rid = attr(c, 'id');
        if (rid) found.push({ kind: 'chart', rid });
        continue;
      }
      if (l === 'txbxContent') {
        boxes.push(kids(c, 'p'));
        continue;
      }
      if (l === 'oMath') {
        text += ` $${ommlToTex(c).replace(/\s+/g, ' ').trim()}$ `;
        continue;
      }
      if (l === 'r') {
        const rPr = kids(c, 'rPr')[0];
        const fonts = rPr ? kids(rPr, 'rFonts')[0] : undefined;
        const face = fonts ? `${attr(fonts, 'ascii') ?? ''} ${attr(fonts, 'hAnsi') ?? ''}` : '';
        walk(c, MONO_FONT.test(face));
        continue;
      }
      if (l === 't') {
        const t = c.children.filter((x): x is string => typeof x === 'string').join('');
        text += t;
        const visible = t.replace(/\s/g, '').length;
        chars += visible;
        if (mono) monoChars += visible;
        continue;
      }
      if (l === 'tab') text += '\t';
      else if (l === 'br' || l === 'cr') text += '\n';
      else if (l === 'noBreakHyphen') text += '-';
      else walk(c, mono);
    }
  };
  walk(p, false);
  return { text, mono: chars > 0 && monoChars === chars };
}

/** 워드 문서의 글. sink 가 있으면 그림 자리에 표시 줄을 넣는다 (그림 파일은 꾸러미 안의 경로로 sink 에) */
export function docxText(files: Record<string, Uint8Array>, sink?: PictureSink): string {
  const dec = new TextDecoder();
  const read = (name: string) => (files[name] ? dec.decode(files[name]) : null);
  const doc = read('word/document.xml');
  if (!doc) throw new OfficeError('워드 문서 내용을 찾지 못했어요.');
  const styles = readStyles(read('word/styles.xml'));
  const rels = readRels(files, 'word/_rels/document.xml.rels', 'word');
  const out = new TextOut();
  const body = first(parseXml(doc), 'body');
  if (!body) return '';

  /** 문단·표 다음에 그 안의 그림 자리와 차트 */
  const after = (found: Found[]) => {
    for (const f of found) {
      const path = rels.get(f.rid);
      if (!path) continue;
      if (f.kind === 'pic') out.picture(sink?.add(path, f.crop));
      else if (files[path]) out.chart(chartTable(dec.decode(files[path])));
    }
  };

  const para = (p: XmlNode) => {
    const pPr = kids(p, 'pPr')[0];
    const styleId = pPr && kids(pPr, 'pStyle')[0] ? (attr(kids(pPr, 'pStyle')[0], 'val') ?? '') : '';
    const style = styles.get(styleId) ?? styleId;
    const boxes: XmlNode[][] = [];
    const found: Found[] = [];
    const { text, mono } = paraText(p, boxes, found);
    if (CODE_STYLE.test(style) || (mono && text.trim()) || (out.inCode && !text.trim())) {
      for (const line of text.split('\n')) out.codeLine(line);
    } else {
      const heading = /^(?:heading|제목)\s*(\d)/i.exec(style) ?? (/^title$/i.test(style) ? ['', '1'] : null);
      const numPr = pPr ? kids(pPr, 'numPr')[0] : undefined;
      const lvl = numPr && kids(numPr, 'ilvl')[0] ? Number(attr(kids(numPr, 'ilvl')[0], 'val') ?? 0) : 0;
      const t = text.trim();
      if (!t) out.blank();
      else if (heading) out.para(`${'#'.repeat(Math.min(3, Number(heading[1]) || 1))} ${t}`);
      else if (numPr) out.para(`${'  '.repeat(Math.max(0, Math.min(5, lvl)))}- ${t}`);
      else out.para(t);
    }
    after(found);
    for (const box of boxes) for (const bp of box) para(bp);
  };

  const block = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      const l = local(c.name);
      if (l === 'p') para(c);
      else if (l === 'tbl') {
        // 칸 안의 그림은 표 다음에 (표 줄 안에 그림 줄을 넣지 않는다)
        const found: Found[] = [];
        const rows = kids(c, 'tr').map((tr) =>
          kids(tr, 'tc').map((tc) =>
            kids(tc, 'p')
              .map((p) => paraText(p, [], found).text.trim())
              .filter(Boolean)
              .join('\n'),
          ),
        );
        out.table(rows);
        after(found);
      } else if (l === 'sdt') {
        const content = kids(c, 'sdtContent')[0];
        if (content) block(content);
      } else if (l !== 'sectPr') block(c);
    }
  };
  block(body);
  return out.toString();
}
