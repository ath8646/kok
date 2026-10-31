// 실패한 자료를 실패한 단계부터 다시 처리한다
import { after, type NextRequest } from 'next/server';
import { assertSameOrigin, assertUuid, requireAccount } from '@/lib/server/auth';
import { MAX_PARALLEL_SOURCES, assertAiAllowed, energyWindows, getAppSettings, getFeatures, reserveError, type ReserveResult } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { driveSource } from '@/lib/server/drive';

export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: RouteContext<'/api/sources/[id]/retry'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    // 노트에 더한 자료 칸(parent_id)은 schema.sql 을 다시 실행한 뒤에만 있다
    const { versions } = await getFeatures(admin);
    const { data } = await admin
      .from('sources')
      .select(`id, user_id, status, file_paths, kind${versions ? ', parent_id' : ''}`)
      .eq('id', id)
      .maybeSingle();
    const src = data as { id: string; user_id: string; status: string; file_paths: string[] | null; kind: string; parent_id?: string | null } | null;
    if (!src || src.user_id !== acc.userId) throw new UserFacingError('not_found', '자료를 찾을 수 없어요.', 404);
    if (src.status !== 'error') return Response.json({ ok: true, status: src.status });
    if (src.parent_id && !acc.canAppend) {
      throw new UserFacingError('pro_only', '노트에 자료 더하기는 Pro 기능이에요. 이 자료는 지우고 새 노트로 넣을 수 있어요.', 403);
    }
    if (src.kind !== 'text' && !(src.file_paths ?? []).length) {
      throw new UserFacingError('file_gone', '원본 파일이 없어서 다시 할 수 없어요. 자료를 새로 넣어 주세요.', 400);
    }
    const app = await getAppSettings(admin);
    await assertAiAllowed(admin, acc, app, { estimate: 1, rateLimit: true });
    // 동시에 정리하는 수와 에너지(정리 중인 것까지)는 DB 가 한 번에 검사하고 '대기'로 돌린다
    const { data: verdict, error } = await admin.rpc('kok_retry_source', {
      p_id: id,
      p_user: acc.userId,
      p_max_parallel: acc.isAdmin ? null : MAX_PARALLEL_SOURCES,
      ...energyWindows(acc),
    });
    if (error) throw error;
    const v = verdict as ReserveResult;
    const refusal = reserveError(v, acc.plan);
    if (refusal) throw refusal;
    if (v.result === 'not_error') return Response.json({ ok: true, status: v.status ?? 'queued' });
    const origin = req.nextUrl.origin;
    after(() => driveSource(id, origin));
    return Response.json({ ok: true, status: 'queued' });
  } catch (e) {
    return errorResponse(e);
  }
}
