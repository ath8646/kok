// 자료 옮기기: 고른 자료(노트)를 다른 과목으로. 노트·문제·복습 카드·푼 기록이 함께 옮겨진다 (kok_move_sources).
// 노트에 더한 자료 번호가 섞여 오면 건너뛴다 (그 노트를 따라간다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertMergeReady, dbError } from '@/lib/server/organize';
import { BULK_MAX } from '@/lib/library-order';

const Body = z.object({ ids: z.array(z.string().uuid()).min(1).max(BULK_MAX), subject: z.string().uuid() });

const MESSAGES = {
  subject_not_found: ['옮길 과목을 찾을 수 없어요. 새로 고친 뒤 다시 골라 주세요.', 404],
  too_many: [`한 번에 ${BULK_MAX}개까지 옮길 수 있어요.`, 400],
} as const;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 8_000));
    if (!parsed.success) throw new UserFacingError('bad_body', `한 번에 ${BULK_MAX}개까지 옮길 수 있어요.`, 400);
    await assertMergeReady(admin);
    const { data, error } = await admin.rpc('kok_move_sources', {
      p_user: acc.userId,
      p_ids: [...new Set(parsed.data.ids)],
      p_subject: parsed.data.subject,
    });
    if (error) throw dbError(error, MESSAGES);
    return Response.json({ ok: true, moved: Number(data ?? 0) });
  } catch (e) {
    return errorResponse(e);
  }
}
