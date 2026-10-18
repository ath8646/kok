// 관리자: Claude API 키 시험 (아주 짧은 요청 한 번)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { testKey } from '@/lib/server/claude';
import { getAppSettings } from '@/lib/server/account';

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
    const started = Date.now();
    const r = await testKey(model);
    return Response.json({ ...r, ms: Date.now() - started });
  } catch (e) {
    return errorResponse(e);
  }
}
