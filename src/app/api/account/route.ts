// 탈퇴: 올린 파일을 지우고 계정을 지운다 (모든 표의 행은 cascade 로 같이 지워진다).
// AI 비용 기록은 누구 것인지만 지우고 남긴다. 같은 이메일로 바로 다시 가입해 무료 에너지를 또 받지 못하게
// 이메일을 알아볼 수 없는 값(HMAC)과 시각을 2일 동안 둔다.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { removeFolder } from '@/lib/server/files';
import { recordDeletion } from '@/lib/server/tombstone';

export const maxDuration = 120;

const Body = z.object({ confirm: z.literal('탈퇴') });

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount({ consent: false });
    if (!Body.safeParse(await readJson(req, 2_000)).success) {
      throw new UserFacingError('confirm', '확인 글자 "탈퇴"를 적어 주세요.', 400);
    }
    await recordDeletion(admin, acc.email);
    await removeFolder(admin, acc.userId);
    const { error } = await admin.auth.admin.deleteUser(acc.userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
