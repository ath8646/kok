// 과목 합치기: from 과목의 자료·노트·문제·복습 카드·푼 기록을 모두 into 과목으로 옮기고 from 과목은 없앤다 (kok_merge_subjects).
// 파일은 자료 폴더(`내id/자료id`)에 있어서 옮길 것이 없다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertMergeReady, dbError } from '@/lib/server/organize';

export const maxDuration = 60;

const Body = z.object({ from: z.string().uuid(), into: z.string().uuid() });

const MESSAGES = {
  subject_not_found: ['과목을 찾을 수 없어요. 새로 고친 뒤 다시 해 주세요.', 404],
  same_subject: ['합칠 다른 과목을 골라 주세요.', 400],
} as const;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 2_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '합칠 과목을 다시 골라 주세요.', 400);
    await assertMergeReady(admin);
    const { data, error } = await admin.rpc('kok_merge_subjects', { p_user: acc.userId, p_from: parsed.data.from, p_into: parsed.data.into });
    if (error) throw dbError(error, MESSAGES);
    return Response.json({ ok: true, moved: Number(data ?? 0) });
  } catch (e) {
    return errorResponse(e);
  }
}
