// 노트 버전 바꾸기·지우기 (버전 보기와 지난 버전 고치기는 화면이 직접 한다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getFeatures } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { removePaths } from '@/lib/server/files';

const Body = z.object({ action: z.enum(['switch', 'delete']), number: z.number().int().min(1).max(10_000) });

const MESSAGES: Record<string, [string, number]> = {
  note_not_found: ['노트를 찾을 수 없어요.', 404],
  version_not_found: ['그 버전을 찾을 수 없어요. 새로 고쳐 주세요.', 404],
  append_running: ['자료를 더하는 중에는 버전을 바꾸거나 지울 수 없어요. 끝난 뒤에 해 주세요.', 409],
  last_version: ['마지막 남은 버전은 지울 수 없어요.', 400],
};

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/versions'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 2_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    if (!(await getFeatures(admin)).versions) {
      throw new UserFacingError('schema_outdated', '버전을 쓰려면 관리자가 Supabase 에서 schema.sql 을 다시 실행해야 해요.', 503);
    }
    const { action, number } = parsed.data;
    const fn = action === 'switch' ? 'kok_switch_version' : 'kok_delete_version';
    const { data, error } = await admin.rpc(fn, { p_note: id, p_user: acc.userId, p_number: number });
    if (error) {
      const key = Object.keys(MESSAGES).find((k) => error.message?.includes(k));
      if (key) throw new UserFacingError(key, MESSAGES[key][0], MESSAGES[key][1]);
      throw error;
    }
    if (action === 'delete') {
      const r = (data ?? {}) as { paths?: string[]; current?: number };
      // 어느 버전에도 안 쓰이게 된 더한 자료의 파일 (내 폴더 것만)
      const paths = (r.paths ?? []).filter((p) => typeof p === 'string' && p.startsWith(`${acc.userId}/`));
      if (paths.length) {
        try {
          await removePaths(admin, paths);
        } catch (e) {
          console.warn('[kok] could not remove version files', e);
        }
      }
      return Response.json({ ok: true, current: r.current ?? null });
    }
    return Response.json({ ok: true, current: Number(data ?? number) });
  } catch (e) {
    return errorResponse(e);
  }
}
