// 아주 작은 XML 읽기 (워드·PPT·한글(HWPX) 문서 안의 XML 만 읽는다: 잘 짜인 XML 이라 검사는 느슨하게).
// 브라우저의 DOMParser 없이 돌아서 시험(node)과 화면이 같은 코드를 쓴다.

export type XmlNode = { name: string; attrs: Record<string, string>; children: Array<XmlNode | string> };

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e] ?? m;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** XML 글 → 나무. 맨 위 노드의 이름은 '#doc' */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#doc', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      const t = xml.slice(i);
      if (t) top.children.push(decodeEntities(t));
      break;
    }
    if (lt > i) top.children.push(decodeEntities(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      top.children.push(xml.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt + 1);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) break;
    const tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      // 짝이 맞는 열린 태그까지 닫는다 (짝이 없으면 무시)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const self = tag.endsWith('/');
    const body = self ? tag.slice(0, -1) : tag;
    const sp = body.search(/\s/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      ATTR.lastIndex = 0;
      for (let m = ATTR.exec(body); m; m = ATTR.exec(body)) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    }
    const node: XmlNode = { name, attrs, children: [] };
    top.children.push(node);
    if (!self) stack.push(node);
  }
  return root;
}

/** 이름에서 앞의 'w:'·'a:' 같은 이름표를 뗀 것 */
export function local(name: string): string {
  const c = name.indexOf(':');
  return c < 0 ? name : name.slice(c + 1);
}

/** 이름표를 뗀 이름이 name 인 바로 아래 노드들 */
export function kids(node: XmlNode, name?: string): XmlNode[] {
  const out: XmlNode[] = [];
  for (const c of node.children) if (typeof c !== 'string' && (!name || local(c.name) === name)) out.push(c);
  return out;
}

/** 아래 어디든 (깊이 우선, 문서 차례대로) 이름이 name 인 노드들. stop 에 든 이름의 노드 안으로는 들어가지 않는다 */
export function findAll(node: XmlNode, name: string, stop: string[] = []): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      const l = local(c.name);
      if (l === name) out.push(c);
      else if (!stop.includes(l)) walk(c);
    }
  };
  walk(node);
  return out;
}

export function first(node: XmlNode, name: string): XmlNode | null {
  return findAll(node, name)[0] ?? null;
}

/** 이름표를 뗀 이름으로 속성 읽기 */
export function attr(node: XmlNode, name: string): string | undefined {
  if (name in node.attrs) return node.attrs[name];
  for (const k of Object.keys(node.attrs)) if (local(k) === name) return node.attrs[k];
  return undefined;
}
