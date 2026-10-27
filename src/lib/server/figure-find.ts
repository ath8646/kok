// 자료 그림 자리 찾기 (서버): 쪽(사진)을 그림으로 그려 AI 에 보여 주고, 그림마다 어느 쪽의 어디에 있는지 픽셀로 받는다.
// 정리 파이프라인(새 자료)과 '자료 그림 다시 찾기'(이미 만든 노트)가 같이 쓴다. AI 를 부르는 방법(에너지 계산)은 부르는 쪽이 넘긴다.
import 'server-only';
import { locatePrompt, wrap } from '@/lib/ai/prompts';
import { locateJsonSchema } from '@/lib/ai/schemas';
import { readLocate, scaleQuad, type Quad } from '@/lib/figure-locate';
import type { FigKind } from '@/lib/source-figures';
import { imageBlock, textBlock, type ContentPart } from './claude';
import { visionImage, type FigurePage } from './figure-image';

/** 찾을 그림 (AI 에 보이는 것: 이름·설명·종류) */
export type FindAsk = { kind: FigKind; title: string; caption: string };
/** 보여 줄 쪽: 원래 쪽(사진) 번호와 그려 둔 쪽 */
export type FindPage = { page: number; fp: FigurePage };
/** 찾은 그림: 몇째 쪽(pages 의 차례), 그 쪽 픽셀의 네 꼭짓점 */
export type FindHit = { at: number; quad: Quad };

export type LocateCall = (content: ContentPart[], schema: Record<string, unknown>, maxTokens: number) => Promise<unknown>;

/** 답 길이: 그림마다 상자 하나 + 쪽마다 번호 하나 */
export function locateOutTokens(asks: number, pages: number): number {
  return 300 + asks * 60 + pages * 10;
}

/** AI 에 보낼 예상 입력 토큰 (쪽 그림 하나에 약 1540 + 지시) */
export function locateInTokens(pages: number): number {
  return pages * 1540 + 900;
}

/**
 * 쪽들에서 그림들을 찾는다 (AI 한 번). 돌려주는 hits[i] 는 asks[i] 를 찾은 곳 (없으면 null), printed[k] 는 pages[k] 에 인쇄된 쪽 번호 (없으면 0)
 */
export async function locateOnPages(o: {
  kind: 'pdf' | 'image';
  pages: FindPage[];
  asks: FindAsk[];
  call: LocateCall;
}): Promise<{ hits: Array<FindHit | null>; printed: number[] }> {
  if (!o.pages.length || !o.asks.length) return { hits: o.asks.map(() => null), printed: o.pages.map(() => 0) };
  const shots = await Promise.all(o.pages.map((p) => visionImage(p.fp)));
  const content: ContentPart[] = [];
  // 그림을 먼저, 지시는 뒤에 (그림이 앞에 있을 때 가장 잘 본다)
  shots.forEach((s, k) => {
    content.push(textBlock(`Image ${k + 1} (${o.kind === 'pdf' ? 'page' : 'photo'} ${o.pages[k].page}):`));
    content.push(imageBlock(s.jpeg, 'image/jpeg'));
  });
  content.push(textBlock(wrap('figures', JSON.stringify(o.asks.map((a, index) => ({ index, kind: a.kind, title: a.title, caption: a.caption }))))));
  content.push(textBlock(locatePrompt({ kind: o.kind, images: o.pages.map((p, k) => ({ page: p.page, width: shots[k].width, height: shots[k].height })) })));
  const json = await o.call(content, locateJsonSchema(o.kind), locateOutTokens(o.asks.length, o.pages.length));
  const { located, printed } = readLocate(json, o.asks.length, shots);
  const hits = located.map((l): FindHit | null => {
    if (l.image < 0 || !l.quad) return null;
    const s = shots[l.image];
    return { at: l.image, quad: scaleQuad(l.quad, s.sx, s.sy) };
  });
  return { hits, printed };
}
