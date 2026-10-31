// 관리자: 자료 그림 자르기(pdf.js + 네이티브 그림 라이브러리: 쪽 그리기 → AI 에 보낼 그림 → 여백에 맞춰 자르기)가 배포된 서버에서 되는지 시험한다 (AI 없음).
// 작은 PDF 한 쪽에 네모를 그려 잘라 보고, 자료 그림이 켜지는 조건(DB 칸·내 설정)도 같이 알려 준다
import type { NextRequest } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import { assertSameOrigin, requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { getFeatures } from '@/lib/server/account';
import { cutOnPage, openPdfPages, visionImage } from '@/lib/server/figure-image';
import type { Quad } from '@/lib/figure-locate';

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
    let cut: { ok: boolean; message: string; size?: string; vision?: string };
    try {
      // 자료 그림과 같은 길: 쪽을 그리고 → AI 에 보낼 크기로 줄이고 → 그 그림의 픽셀 상자(가운데 네모를 조금 넉넉히)로 → 여백에 맞춰 자른다
      const [fp] = await openPdfPages(bytes, [1]);
      if (!fp) throw new Error('쪽을 그리지 못했어요');
      const v = await visionImage(fp);
      const box = [0.22 * v.width, 0.22 * v.height, 0.78 * v.width, 0.53 * v.height];
      const quad = [box[0], box[1], box[2], box[1], box[2], box[3], box[0], box[3]].map((n, i) => n * (i % 2 === 0 ? v.sx : v.sy)) as Quad;
      const c = await cutOnPage(fp, quad);
      cut = c ? { ok: true, message: '', size: `${c.width}×${c.height}`, vision: `${v.width}×${v.height}` } : { ok: false, message: '자른 그림이 비었어요' };
    } catch (e) {
      cut = { ok: false, message: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 400) : String(e) };
    }
    return Response.json({
      ok: true,
      cut: { ...cut, ms: Date.now() - started },
      dbReady: features.sourceFigures,
      settingOn: acc.settings.quiz.sourceFigures,
      redraw: acc.canRedraw,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
