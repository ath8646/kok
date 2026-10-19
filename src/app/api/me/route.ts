import { requireAccount } from '@/lib/server/auth';
import { energyStatus, getAppSettings, getFeatures, limitsFor } from '@/lib/server/account';
import { errorResponse } from '@/lib/server/errors';
import { costMultiplier } from '@/lib/ai/models';
import { cloudflareReady } from '@/lib/server/cloudflare';
import type { MeResponse } from '@/lib/types';

export async function GET() {
  try {
    const { admin, acc } = await requireAccount({ consent: false });
    const app = await getAppSettings(admin);
    const [e, features] = await Promise.all([energyStatus(admin, acc, app.limits), getFeatures(admin)]);
    const L = app.limits;
    const lim = limitsFor(acc, L);
    const body: MeResponse = {
      userId: acc.userId,
      email: acc.email,
      provider: acc.provider,
      nickname: acc.nickname,
      isAdmin: acc.isAdmin,
      isPro: acc.isPro,
      proUntil: acc.proUntil,
      planInfo: acc.plan,
      canCareful: acc.canCareful,
      canAppend: acc.canAppend,
      canTheme: acc.canTheme,
      canFigures: acc.canFigures,
      keepChatFiles: acc.keepFiles,
      features,
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
        usedPlan: e.usedPlan === undefined ? null : Math.round(e.usedPlan * 10) / 10,
        planDaily: e.planDaily ?? null,
      },
      notice: app.notice,
      aiEnabled: app.aiEnabled,
      themePictures: cloudflareReady(),
      plan: {
        pdfPages: lim.pdfPages,
        images: lim.images,
        textChars: lim.textChars,
        fileMb: lim.fileMb,
        fileDays: lim.keepFiles ? null : L.freeFileDays,
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
