// Claude 모델 요금표와 비용·에너지 계산.
// 요금 출처: https://platform.claude.com/docs/en/about-claude/pricing (2026-10 기준, 100만 토큰당 달러)

export type ModelId = string;

export type Price = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

type PriceRule = {
  base: Price;
  /** 프롬프트(입력+캐시)가 이 토큰 수를 넘으면 longPrice 를 쓴다 */
  longThreshold?: number;
  long?: Price;
};

const PRICES: Record<string, PriceRule> = {
  'claude-haiku-5-5': {
    base: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    longThreshold: 100_000,
    long: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
  },
  'claude-sonnet-5-5': {
    base: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  },
  'claude-opus-5-5': {
    base: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  },
};

/** 모르는 모델이면 가장 비싼 요금으로 계산해서 손해를 막는다 */
const FALLBACK: PriceRule = { base: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 } };

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function priceFor(model: ModelId, promptTokens: number): Price {
  const rule = PRICES[model] ?? FALLBACK;
  if (rule.longThreshold && rule.long && promptTokens > rule.longThreshold) return rule.long;
  return rule.base;
}

/** 한 번의 API 호출 비용(달러) */
export function costUsd(model: ModelId, usage: Usage): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const prompt = usage.input_tokens + cacheWrite + cacheRead;
  const p = priceFor(model, prompt);
  const usd = (usage.input_tokens * p.input + usage.output_tokens * p.output + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** 달러 → 에너지 (소수 첫째 자리까지) */
export function usdToEnergy(usd: number, usdPerEnergy: number): number {
  if (usdPerEnergy <= 0) return 0;
  return Math.round((usd / usdPerEnergy) * 10) / 10;
}

/** Haiku 5.5 대비 몇 배 비싼지 (설정 화면 표시용) */
export function costMultiplier(model: ModelId): number {
  const base = PRICES['claude-haiku-5-5'].base;
  const p = (PRICES[model] ?? FALLBACK).base;
  return Math.round(((p.input + p.output) / (base.input + base.output)) * 10) / 10;
}

export type MaterialEstimate = {
  kind: 'text' | 'pdf' | 'image';
  pages?: number;
  /** 사진 수, 글 자료면 문서(한글·워드·PPT) 속 그림 수 */
  images?: number;
  chars?: number;
};

/** 문서 속 그림 한 장의 입력 토큰 (긴 변 1568 이하 JPEG: Claude 는 넓이/750 토큰, 1.15MP 까지) */
export const DOC_PICTURE_TOKENS = 1600;

/**
 * 작업 전에 보여 줄 대략적인 에너지 (정리+합치기+그림+문제+검사 전체).
 * 실제로는 부를 때마다 따로 요금이 붙으므로(긴 프롬프트 요금도 한 번 부를 때 기준) 호출별로 더한다.
 */
export function estimateEnergy(m: MaterialEstimate, model: ModelId, usdPerEnergy: number): number {
  let materialTokens = 0;
  if (m.kind === 'pdf') materialTokens = (m.pages ?? 1) * 3500;
  else if (m.kind === 'image') materialTokens = (m.images ?? 1) * 2600;
  else materialTokens = Math.ceil((m.chars ?? 0) * 0.9) + (m.images ?? 0) * DOC_PICTURE_TOKENS;

  const chunks =
    m.kind === 'pdf'
      ? Math.max(1, Math.ceil((m.pages ?? 1) / 15))
      : m.kind === 'image'
        ? Math.max(1, Math.ceil((m.images ?? 1) / 6))
        : Math.max(1, Math.ceil((m.chars ?? 0) / 40000), Math.ceil((m.images ?? 0) / 10));
  // 자료가 길수록 개념이 늘어(lib/ai/scale.ts) 정리·합치기·그림·문제 답도 길어진다
  const noteTokens = Math.min(12_000, 1500 + materialTokens * 0.1);
  const perChunk = materialTokens / chunks;
  const calls: Usage[] = [];
  for (let i = 0; i < chunks; i++) {
    calls.push({ input_tokens: Math.round(perChunk + 2500), output_tokens: Math.round(Math.min(6000, 800 + perChunk * 0.15)) });
  }
  if (chunks > 1) calls.push({ input_tokens: chunks * 4000 + 1500, output_tokens: Math.min(10_000, 1500 + chunks * 2500) }); // 합치기
  // 자료 그림 자리 찾기 (PDF·사진): 그림이 있는 쪽을 그림으로 보여 준다 (그림 몇 개, 못 찾으면 가까운 쪽까지)
  if (m.kind !== 'text') for (let i = 0; i < 3; i++) calls.push({ input_tokens: 2 * 1540 + 900, output_tokens: 400 });
  calls.push({ input_tokens: Math.round(noteTokens + 1500), output_tokens: Math.round(Math.min(5000, 1200 + noteTokens * 0.3)) }); // 그림
  calls.push({ input_tokens: Math.round(noteTokens + 2000), output_tokens: Math.round(Math.min(9000, 1500 + noteTokens * 0.6)) }); // 문제
  calls.push({ input_tokens: Math.round(noteTokens + 5500), output_tokens: 800 }); // 검사
  const usd = calls.reduce((a, c) => a + costUsd(model, c), 0);
  return Math.max(1, Math.ceil(usdToEnergy(usd, usdPerEnergy)));
}

/** 작은 AI 작업 하나(채점, 문제 고치기 등)의 예상 에너지 */
export function estimateSmallTask(model: ModelId, usdPerEnergy: number, inputTokens = 3000, outputTokens = 800): number {
  const usd = costUsd(model, { input_tokens: inputTokens, output_tokens: outputTokens });
  return Math.max(0.1, Math.round(usdToEnergy(usd, usdPerEnergy) * 10) / 10);
}

/**
 * 먼저 생각하고 답하는 작은 작업의 예상 답 길이 (생각한 토큰도 답으로 센다). 서버의 에너지 확인과 화면의 예상이 같은 값을 쓴다
 * chat: 노트 채팅 (파일 없음), chatSolve: 사진·파일을 붙인 채팅과 AI에게 물어보기, solveOne: 문제 하나 그림 풀이 만들기
 */
export const THINK_OUT = { chat: 1200, chatSolve: 3500, solveOne: 6000 } as const;

/** 채팅 풀이의 그림(Pro, 풀이 뒤 두 번째 호출)의 예상 답 길이: 그림 설계도 + 단계마다 add·focus */
export const CHAT_FIGURE_OUT = 2500;

/**
 * Pro 그림 풀이(문제 그림·단계 풀이)의 예상 에너지: 문제 몇 개씩 한두 번 (먼저 생각하고 답해서 답이 길다).
 * 노트 만들기 예상에 더한다 (model: 문제 모델)
 */
export function estimateFigures(model: ModelId, usdPerEnergy: number): number {
  const usd = costUsd(model, { input_tokens: 8000, output_tokens: 7000 }) * 1.5;
  return Math.max(1, Math.ceil(usdToEnergy(usd, usdPerEnergy)));
}

/**
 * Pro 자료 그림 다시 그리기의 예상 에너지: PDF·사진에서 찾은 지도·그래프·표·연표·도식을 그림마다 한 번 (4장으로 센다).
 * 노트 만들기 예상에 더한다 (model: 그림 모델)
 */
export function estimateRedraws(model: ModelId, usdPerEnergy: number): number {
  const usd = costUsd(model, { input_tokens: 2500, output_tokens: 3500 }) * 4;
  return Math.max(1, Math.ceil(usdToEnergy(usd, usdPerEnergy)));
}

/**
 * Pro 표지 그림 한 장의 예상 에너지: 노트 줄임(약 1500토큰) + 지시·스키마를 보내고 도표의 모양과 짧은 낱말(그래프면 설계도)을 받는다.
 * 자료를 넣을 때 자동으로 그리면 노트 만들기 예상에 더하고, 다시 그리기 화면에도 보인다 (model: 그림 모델)
 */
export function estimateCover(model: ModelId, usdPerEnergy: number): number {
  // 답 길이는 lib/cover.ts 의 COVER_OUT_TYPICAL 과 같게 (이 파일은 다른 파일을 불러오지 않는다)
  return estimateSmallTask(model, usdPerEnergy, 4000, 900);
}

/** 자료를 넣을 때 표지 그림을 그리는지 (Pro 혜택, 설정에서 켜 둠, DB 칸이 있음. 노트에 더하는 자료는 그리지 않는다) */
export function coverWanted(o: { canFigures: boolean; autoCover: boolean; featureOn: boolean; append?: boolean }): boolean {
  return o.canFigures && o.autoCover && o.featureOn && !o.append;
}

/**
 * 자료를 넣을 때 자료 그림을 KOK 스타일로 다시 그리는지 (PDF·사진·그림이 든 한글·워드·PPT, Pro 혜택, 설정에서 켜 둠, DB 칸이 있음).
 * pictures: 글 자료에 딸린 문서 속 그림 수
 */
export function redrawsWanted(o: {
  kind: 'text' | 'pdf' | 'image';
  pictures?: number;
  canFigures: boolean;
  sourceFiguresSetting: boolean;
  featureOn: boolean;
}): boolean {
  return (o.kind !== 'text' || (o.pictures ?? 0) > 0) && o.canFigures && o.sourceFiguresSetting && o.featureOn;
}

/** 노트를 만들 때 그림 풀이를 만드는지 (Pro 혜택, 설정에서 켜 둠, DB 칸이 있음) */
export function figuresWanted(o: { canFigures: boolean; figuresSetting: boolean; featureOn: boolean }): boolean {
  return o.canFigures && o.figuresSetting && o.featureOn;
}
