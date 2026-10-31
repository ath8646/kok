// 자료 종류: 정리할 때 AI 가 조각마다 읽고 고르거나(자동) 학생이 자료 넣기 창에서 고른다.
// 종류마다 정리·문제·검사 지침을 더한다. 지금 지침(general)은 그대로 두고 그 위에 더하기만 한다:
// 잘못 골라도 크게 나빠지지 않게. 섞였거나 애매한 자료는 general (예전과 같다).
// 서버·화면·시험이 같이 쓴다 (화면 없이 계산만).

export const MATERIAL_TYPES = ['general', 'exam', 'vocab', 'math', 'reading'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

/** 학생이 고른 것. 'auto' 면 AI 가 조각마다 고른다 */
export type MaterialPick = 'auto' | MaterialType;
export const MATERIAL_PICKS: readonly MaterialPick[] = ['auto', ...MATERIAL_TYPES];

export const MATERIAL_LABEL: Record<MaterialType, string> = {
  general: '개념 정리',
  exam: '기출·문제집',
  vocab: '단어장',
  math: '수학·과학 풀이',
  reading: '국어·영어 지문',
};

/** 고르는 칸의 한 줄 설명 */
export const MATERIAL_HINT: Record<MaterialPick, string> = {
  auto: 'AI가 자료를 읽고 알맞게 골라요',
  general: '교과서·필기·강의 자료를 개념으로',
  exam: '시험지·문제집의 원래 문제를 카드로',
  vocab: '낱말마다 뜻을 묻는 카드로',
  math: '공식·풀이 단계와 계산 문제로',
  reading: '작품·지문 분석과 내용 일치 문제로',
};

const isType = (v: unknown): v is MaterialType => typeof v === 'string' && (MATERIAL_TYPES as readonly string[]).includes(v);

/** AI 가 적은 종류 (모르는 값은 general) */
export function readMaterialType(v: unknown): MaterialType {
  return isType(v) ? v : 'general';
}

/** 학생이 고른 것 (모르는 값은 auto) */
export function readMaterialPick(v: unknown): MaterialPick {
  return isType(v) ? v : 'auto';
}

/** 조각마다 고른 종류. w: 조각의 양 (쪽 수로 어림, lib/ai/scale.ts pageWeight) */
export type PartType = { type: MaterialType; w: number };

export function readPartTypes(v: unknown): PartType[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === 'object' ? { type: readMaterialType((x as PartType).type), w: Number((x as PartType).w) } : null))
    .filter((x): x is PartType => !!x && Number.isFinite(x.w) && x.w > 0);
}

/**
 * 노트 하나의 종류: 학생이 고른 것, 아니면 조각들 가운데 양이 반을 넘는 종류.
 * 반을 넘는 종류가 없으면(섞인 자료) general. 기출 조각의 원래 문제는 노트 종류와 상관없이 그 조각에서 꺼낸다
 */
export function noteMaterialType(parts: readonly PartType[], pick: MaterialPick = 'auto'): MaterialType {
  if (pick !== 'auto') return pick;
  const total = parts.reduce((a, p) => a + p.w, 0);
  if (!total) return 'general';
  const by = new Map<MaterialType, number>();
  for (const p of parts) by.set(p.type, (by.get(p.type) ?? 0) + p.w);
  let best: MaterialType = 'general';
  let bestW = 0;
  for (const [t, w] of by) {
    if (w > bestW) {
      best = t;
      bestW = w;
    }
  }
  return bestW * 2 > total ? best : 'general';
}

/** 노트 body.material: 어떤 종류로 정리했는지 (by: 학생이 골랐는지 AI 가 골랐는지) */
export type NoteMaterial = { type: MaterialType; by: 'ai' | 'student' };

export function readNoteMaterial(body: unknown): NoteMaterial | null {
  const m = body && typeof body === 'object' ? (body as { material?: unknown }).material : null;
  if (!m || typeof m !== 'object') return null;
  const t = (m as { type?: unknown }).type;
  if (!isType(t)) return null;
  return { type: t, by: (m as { by?: unknown }).by === 'student' ? 'student' : 'ai' };
}
