// 멈춘 자료 처리를 이어서 한다 (화면이 열려 있을 때 부른다)
import { after, type NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { driveSource } from '@/lib/server/drive';

export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: RouteContext<'/api/sources/[id]/process'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const { data: src } = await admin.from('sources').select('id, user_id, status, locked_until').eq('id', id).maybeSingle();
    if (!src || src.user_id !== acc.userId) throw new UserFacingError('not_found', '자료를 찾을 수 없어요.', 404);
    if (src.status === 'ready' || src.status === 'error') return Response.json({ ok: true, status: src.status });
    const locked = src.locked_until && Date.parse(src.locked_until) > Date.now();
    if (!locked) {
      const origin = req.nextUrl.origin;
      after(() => driveSource(id, origin));
    }
    return Response.json({ ok: true, status: src.status, resumed: !locked });
  } catch (e) {
    return errorResponse(e);
  }
}
