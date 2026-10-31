// 워드·PPT 의 관계 파일(_rels/*.rels): 문서 안의 번호(rId) → 꾸러미 안의 경로 (그림·차트·발표자 노트·슬라이드)
import { attr, findAll, parseXml } from './xml';

const dec = new TextDecoder();

/** 기준 폴더에서 푼 경로 ('ppt/slides' + '../media/a.png' → 'ppt/media/a.png') */
export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** 관계 파일 읽기: 번호 → 대상 경로. 문서 밖(인터넷 주소·다른 파일)을 가리키는 관계는 뺀다 */
export function readRels(files: Record<string, Uint8Array>, relsPath: string, base: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw = files[relsPath];
  if (!raw) return out;
  for (const r of findAll(parseXml(dec.decode(raw)), 'Relationship')) {
    const id = attr(r, 'Id');
    const target = attr(r, 'Target');
    if (!id || !target || /^external$/i.test(attr(r, 'TargetMode') ?? '') || /^[a-z]+:/i.test(target)) continue;
    out.set(id, resolvePath(base, decodeURIComponentSafe(target)));
  }
  return out;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
