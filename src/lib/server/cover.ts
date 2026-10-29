// 자료함 카드의 표지 그림 (Pro): 자료를 넣을 때(파이프라인 마지막, 설정 visual.autoCover)와
// 카드 메뉴의 '표지 그림'(POST /api/sources/[id]/cover)이 같이 쓴다
import 'server-only';
import { coverPrompt, wrap } from '@/lib/ai/prompts';
import { normalizeCover, packCover } from '@/lib/cover';
import { textBlock, type ContentPart } from './claude';

/** AI 에게 보낼 것: 노트 줄임(coverNoteExcerpt) + 지시 */
export function coverContent(excerpt: string): ContentPart[] {
  return [textBlock(wrap('note', excerpt)), textBlock(coverPrompt())];
}

/** AI 답 → 저장할 모양 (그릴 것이 없으면 null) */
export function settleCover(json: unknown): Record<string, unknown> | null {
  const c = normalizeCover(json);
  return c ? packCover(c) : null;
}
