import { requireAccount } from '@/lib/server/auth';
import { energyStatus, getAppSettings } from '@/lib/server/account';
import { errorResponse } from '@/lib/server/errors';
import { costMultiplier } from '@/lib/ai/models';
import type { MeResponse } from '@/lib/types';

export async function GET() {
  try {
    const { admin, acc } = await requireAccount({ consent: false });
    const app = await getAppSettings(admin);
    const e = await energyStatus(admin, acc, app.limits);
    const L = app.limits;
    const pro = acc.isPro || acc.isAdmin;
    const body: MeResponse = {
      userId: acc.userId,
      email: acc.email,
      nickname: acc.nickname,
      isAdmin: acc.isAdmin,
      isPro: acc.isPro,
      proUntil: acc.proUntil,
      consented: acc.consented,
      settings: acc.settings,
      energy: {
        unlimited: e.unlimited,
        remaining: e.unlimited ? null : Math.floor(e.remaining * 10) / 10,
        limit: e.unlimited ? null : e.limit,
        period: e.period,
        usedToday: Math.round(e.usedToday * 10) / 10,
        usedMonth: Math.round(e.usedMonth * 10) / 10,
        proDaily: acc.isPro ? L.proDaily : null,
      },
      notice: app.notice,
      aiEnabled: app.aiEnabled,
      plan: {
        pdfPages: pro ? L.pdfPagesPro : L.pdfPagesFree,
        images: pro ? L.imagesPro : L.imagesFree,
        textChars: pro ? L.textCharsPro : L.textCharsFree,
        fileMb: pro ? L.fileMbPro : L.fileMbFree,
        fileDays: pro ? null : L.freeFileDays,
      },
      usdPerEnergy: L.usdPerEnergy,
      models: { fast: app.models.fast, careful: app.models.careful, adminTest: app.models.adminTest },
      multipliers: {
        fast: costMultiplier(app.models.fast),
        careful: costMultiplier(app.models.careful),
        adminTest: costMultiplier(app.models.adminTest),
      },
    };
    return Response.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
