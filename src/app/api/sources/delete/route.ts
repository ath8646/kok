// 자료 여러 개 한꺼번에 지우기 (자료함에서 꾹 눌러 고른 것). 하나씩 지우는 것과 같다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { deleteOwnSources } from '@/lib/server/delete-sources';
import { BULK_MAX } from '@/lib/library-order';

// 올린 파일을 지우는 데 시간이 걸릴 수 있다
export const maxDuration = 60;

const Body = z.object({ ids: z.array(z.string().uuid()).min(1).max(BULK_MAX) });

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount({ consent: false });
    const parsed = Body.safeParse(await readJson(req, 8_000));
    if (!parsed.success) throw new UserFacingError('bad_body', `한 번에 ${BULK_MAX}개까지 지울 수 있어요.`, 400);
    const deleted = await deleteOwnSources(admin, acc.userId, parsed.data.ids);
    if (!deleted) throw new UserFacingError('not_found', '지울 자료를 찾을 수 없어요.', 404);
    return Response.json({ ok: true, deleted });
  } catch (e) {
    return errorResponse(e);
  }
}
