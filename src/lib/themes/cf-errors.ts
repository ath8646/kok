// Cloudflare Workers AI 오류 나누기 (https://developers.cloudflare.com/workers-ai/platform/errors/)
// - 3036 (429): 오늘 무료 몫(10,000 뉴런)을 다 썼다 → 내일(UTC 0시) 다시
// - 3040 (429): 잠깐 바쁘다 → 다음에 다시 하면 될 수 있다 (몫과 상관없음)
// 그 밖에는 모두 '그리지 못함'으로 본다.

export type CfFail = 'quota' | 'refused' | 'failed';

type CfBody = { success?: boolean; errors?: Array<{ code?: unknown; message?: unknown }> } | null;

export function classifyCfError(body: CfBody): CfFail {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const codes = errors.map((e) => Number(e?.code)).filter((n) => Number.isFinite(n));
  const text = errors.map((e) => String(e?.message ?? '')).join(' ');
  if (codes.includes(3036) || /daily free allocation|neurons? (limit|allocation)/i.test(text)) return 'quota';
  if (/nsfw|unsafe content/i.test(text)) return 'refused';
  return 'failed';
}
