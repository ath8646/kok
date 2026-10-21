// 관리자: 앱이 AI 에 보내는 모든 답 모양(JSON 스키마)을 실제 API 가 받는지 시험한다.
// Claude 는 스키마가 너무 크면 "compiled grammar is too large" 로 거절하는데, 가짜 서버로는 알 수 없어서 배포한 뒤 여기서 확인한다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { testSchema } from '@/lib/server/claude';
import { getAppSettings } from '@/lib/server/account';
import { aiSchemas, schemaProps } from '@/lib/ai/schema-registry';

export const maxDuration = 120;

/** 한 번에 같이 보내는 요청 수 (요청 한도에 걸리지 않게) */
const PARALLEL = 5;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin } = await requireAccount({ admin: true });
    const app = await getAppSettings(admin);
    const body = z
      .object({ model: z.string().max(80).optional() })
      .catch({})
      .parse(await readJson(req, 2_000));
    const model = body.model && /^claude-[a-z0-9.-]+$/.test(body.model) ? body.model : app.models.fast;
    const list = aiSchemas();
    const results: Array<{ name: string; props: number; ok: boolean | null; message: string; ms: number }> = new Array(list.length);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        const started = Date.now();
        const r = await testSchema(model, list[i].schema);
        results[i] = { name: list[i].name, props: schemaProps(list[i].schema), ...r, ms: Date.now() - started };
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    const failed = results.filter((r) => r.ok === false);
    if (failed.length) console.error('[kok] schemas rejected', model, failed.map((r) => `${r.name}: ${r.message}`).join(' | '));
    return Response.json({ ok: true, model, results });
  } catch (e) {
    return errorResponse(e);
  }
}
