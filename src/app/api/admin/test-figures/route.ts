// 관리자: 자료 그림 자르기(pdf.js + 네이티브 그림 라이브러리)가 배포된 서버에서 되는지 시험한다 (AI 없음).
// 작은 PDF 한 쪽에 네모를 그려 잘라 보고, 자료 그림이 켜지는 조건(DB 칸·내 설정)도 같이 알려 준다
import type { NextRequest } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import { assertSameOrigin, requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { getFeatures } from '@/lib/server/account';
import { cutFigures } from '@/lib/server/figure-image';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount({ admin: true });
    const features = await getFeatures(admin);
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.drawRectangle({ x: 150, y: 400, width: 300, height: 200, color: rgb(0.85, 0.2, 0.2) });
    const bytes = await doc.save();
    const started = Date.now();
    let cut: { ok: boolean; message: string; size?: string };
    try {
      // 네 모서리 (0~1000): 쪽의 가운데 네모
      const [c] = await cutFigures({ kind: 'pdf', bytes, page: 1 }, [[250, 250, 750, 250, 750, 500, 250, 500]]);
      cut = c ? { ok: true, message: '', size: `${c.width}×${c.height}` } : { ok: false, message: '자른 그림이 비었어요' };
    } catch (e) {
      cut = { ok: false, message: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 400) : String(e) };
    }
    return Response.json({
      ok: true,
      cut: { ...cut, ms: Date.now() - started },
      dbReady: features.sourceFigures,
      settingOn: acc.settings.quiz.sourceFigures,
      redraw: acc.canFigures,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
