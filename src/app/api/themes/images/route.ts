// 테마 배경 그림 올리기 (Pro): 화면이 줄여서 보낸 그림을 검사하고(앞부분 바이트·크기) 저장한다 → 그림 번호
import type { NextRequest } from 'next/server';
import { assertSameOrigin, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { hitDaily, requireThemes, storeThemeImage, UPLOAD_MAX_BYTES, UPLOADS_PER_DAY } from '@/lib/server/themes';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireThemes(admin, acc);
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > UPLOAD_MAX_BYTES) throw new UserFacingError('image_too_big', '그림이 너무 커요. 3MB보다 작은 그림을 넣어 주세요.', 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) throw new UserFacingError('no_image', '그림을 골라 주세요.', 400);
    if (bytes.length > UPLOAD_MAX_BYTES) throw new UserFacingError('image_too_big', '그림이 너무 커요. 3MB보다 작은 그림을 넣어 주세요.', 413);
    await hitDaily(admin, acc.userId, 'theme_upload', UPLOADS_PER_DAY, `그림은 하루 ${UPLOADS_PER_DAY}장까지 올릴 수 있어요. 내일 다시 해 주세요.`);
    const id = await storeThemeImage(admin, acc.userId, bytes, { kind: 'upload' });
    return Response.json({ ok: true, id });
  } catch (e) {
    return errorResponse(e);
  }
}
