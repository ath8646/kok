// 자료 그림 다시 찾기 (이미 만든 노트): 그림 하나의 자리를 원본 파일에서 새 방법으로 다시 찾아 자른다.
// 그 쪽을 그림으로 그려 AI 에 보여 주고 픽셀 상자를 받아(없으면 가까운 쪽부터 더 본다) 쪽의 여백에 맞춰 자르고, 같은 파일에 덮어쓴다.
// Pro 는 다시 그린 그림도 새로 만든다. 끝내 찾지 못한 그림은 노트에서 빼고 그 그림 문제는 쉬게 한다 (엉뚱한 곳을 자른 그림이었을 수 있어서).
// 화면이 그림마다 한 번씩 부른다 (한 번에 그림 하나: 시간 안에 끝나게). anchors: 앞서 읽은 인쇄된 쪽 번호 (쪽 번호를 모르는 노트에 채운다)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { getAppSettings, getFeatures } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertNoAppendRunning, loadOwnedNote, updateNoteBody } from '@/lib/server/notes';
import { runTask } from '@/lib/server/tasks';
import { imageBlock, textBlock } from '@/lib/server/claude';
import { cutOnPage, openFigurePage, openPdfPages, type FigurePage } from '@/lib/server/figure-image';
import { locateInTokens, locateOnPages, type FindPage } from '@/lib/server/figure-find';
import { SOURCES_BUCKET } from '@/lib/supabase/admin';
import { redrawPrompt } from '@/lib/ai/prompts';
import { artJsonSchema, normalizeArt, type Art } from '@/lib/art/spec';
import { nextPages, SEARCH_BATCH, type Quad } from '@/lib/figure-locate';
import { labelsFromAnchors, pageName, printedPage, readPageLabels, type PageAnchor, type PageLabels } from '@/lib/page-labels';
import { canRedraw, readFigures, type SourceFigure } from '@/lib/source-figures';
import { pdfPageCount } from '@/lib/pdf';

// 원본 받기(큰 PDF) + 자리 찾기 몇 번 + (Pro) 다시 그리기
export const maxDuration = 300;

/** 한 그림을 찾느라 AI 에 묻는 수: 그 쪽 → 가까운 쪽 4쪽씩 세 번 (앞뒤 6쪽까지) */
const RELOCATE_CALLS = 4;
/** 다시 그린 그림 한 장의 답 길이 (파이프라인과 같게) */
const REDRAW_OUT_TOKENS = 8000;

const Body = z.object({
  figure: z.string().regex(/^f\d{1,4}$/),
  anchors: z
    .array(z.object({ page: z.number().int().min(1).max(100000), printed: z.number().int().min(1).max(99999) }))
    .max(100)
    .catch([]),
});

export type RelocateResult = {
  ok: true;
  /** found: 다시 찾아 잘랐다, removed: 찾지 못해 노트에서 뺐다 */
  outcome: 'found' | 'removed';
  /** 찾은 쪽 이름 ('116쪽', '사진 2') */
  where?: string;
  /** 쉬게 한 그림 문제 수 (removed) */
  rested?: number;
  /** 지금까지 읽은 인쇄된 쪽 번호 (다음 그림을 찾을 때 다시 보낸다) */
  anchors: PageAnchor[];
};

export async function POST(req: NextRequest, ctx: RouteContext<'/api/notes/[id]/figures/relocate'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) throw new UserFacingError('bad_request', '요청이 올바르지 않아요.', 400);
    const body = parsed.data;
    if (!(await getFeatures(admin)).sourceFigures) throw new UserFacingError('figures_off', '자료 그림을 아직 쓸 수 없어요.', 400);

    const note = await loadOwnedNote(admin, id, acc.userId);
    // 자료를 더하는 중에는 노트를 바꾸지 않는다 (합치는 바탕이 바뀌면 처음부터 다시 합쳐야 해서)
    await assertNoAppendRunning(admin, note.source_id);
    const fig = readFigures(note.raw).find((f) => f.id === body.figure);
    if (!fig) throw new UserFacingError('not_found', '그림을 찾을 수 없어요. 노트를 새로 읽어 주세요.', 404);

    // 원본: 그림을 자른 자료 (처음 자료, 더한 자료, 합쳐 들어온 노트의 자료). 자른 그림의 경로에 자료 번호가 있다
    const sourceId = fig.crop.split('/')[2];
    const { data: src, error: srcErr } = await admin.from('sources').select('id, user_id, kind, file_paths, page_count').eq('id', sourceId).maybeSingle();
    if (srcErr) throw srcErr;
    if (!src || src.user_id !== acc.userId) throw new UserFacingError('not_found', '그림을 자른 원본 자료를 찾을 수 없어요.', 404);
    const paths: string[] = Array.isArray(src.file_paths) ? src.file_paths : [];
    if ((src.kind !== 'pdf' && src.kind !== 'image') || !paths.length) {
      throw new UserFacingError('original_gone', '원본 파일이 지워져서 이 그림은 다시 찾을 수 없어요.', 410);
    }
    const kind = src.kind as 'pdf' | 'image';

    const app = await getAppSettings(admin);
    let calls = 0;
    // AI 부르기: 에너지 확인·기록은 runTask (1분 요청 수는 이 요청에서 처음 한 번만 센다)
    const ask = (images: number) => (content: Parameters<typeof runTask>[3]['content'], schema: Record<string, unknown>, maxTokens: number) =>
      runTask(admin, acc, app, {
        task: 'locate',
        effortOf: 'locate',
        tier: acc.settings.models.organize,
        content,
        schema,
        maxTokens,
        outTokens: maxTokens,
        extraInputTokens: locateInTokens(images),
        timeoutMs: 60_000,
        sourceId: note.source_id,
        rateLimit: calls++ === 0,
      });

    // 그림이 있는 쪽 찾기: 그 쪽 → 가까운 쪽부터 4쪽씩
    let bytes: Uint8Array | null = null;
    const download = async (path: string) => {
      const { data, error } = await admin.storage.from(SOURCES_BUCKET).download(path);
      if (error || !data) throw new UserFacingError('original_gone', '원본 파일을 받지 못했어요. 원본이 지워졌을 수 있어요.', 410);
      return new Uint8Array(await data.arrayBuffer());
    };
    let total = 1;
    if (kind === 'pdf') {
      bytes = await download(paths[0]);
      total = Number(src.page_count) > 0 ? Number(src.page_count) : await pdfPageCount(bytes);
    } else total = paths.length;
    const claimed = Math.min(total, Math.max(1, fig.page || 1));
    let anchors: PageAnchor[] = [...body.anchors];
    const tried: number[] = [];
    let hit: { page: number; fp: FigurePage; quad: Quad } | null = null;
    for (let k = 0; k < RELOCATE_CALLS && !hit; k++) {
      // 사진은 그 사진만 (정리할 때 사진마다 번호를 붙여 보내서 사진 번호는 틀리지 않는다)
      const pages = kind === 'image' ? (k ? [] : [claimed]) : nextPages({ claimed, from: 1, to: total, tried, batch: k ? SEARCH_BATCH : 1 });
      if (!pages.length) break;
      tried.push(...pages);
      let shown: FindPage[] = [];
      if (kind === 'pdf' && bytes) {
        const drawn = await openPdfPages(bytes, pages);
        shown = drawn.flatMap((fp, i) => (fp ? [{ page: pages[i], fp }] : []));
      } else {
        const photo = paths[claimed - 1];
        if (photo) shown = [{ page: claimed, fp: await openFigurePage({ kind: 'image', bytes: await download(photo) }) }];
      }
      if (!shown.length) continue;
      const found = await locateOnPages({ kind, pages: shown, asks: [{ kind: fig.kind, title: fig.title, caption: fig.caption }], call: ask(shown.length) });
      shown.forEach((p, i) => {
        if (found.printed[i] > 0 && !anchors.some((a) => a.page === p.page)) anchors.push({ page: p.page, printed: found.printed[i] });
      });
      const h = found.hits[0];
      if (h) hit = { page: shown[h.at].page, fp: shown[h.at].fp, quad: h.quad };
    }
    anchors = anchors.slice(-100);
    // 쪽 번호를 모르는 노트: 읽은 번호들이 같은 차이로 이어지면 노트의 쪽 표시를 책의 쪽 번호로 (노트의 처음 자료일 때만)
    const ownSource = sourceId === note.source_id;
    const known = readPageLabels(note.raw);
    const labels: PageLabels = kind === 'pdf' && ownSource && !known.length ? labelsFromAnchors(anchors, total) : [];
    const useLabels = known.length ? known : labels;

    const cut = hit ? await cutOnPage(hit.fp, hit.quad).catch(() => null) : null;
    if (!hit || !cut) {
      // 끝내 찾지 못했다: 노트에서 빼고, 그 그림으로 만든 문제는 쉬게 한다 (지우지 않는다: 쉬는 문제에서 다시 켤 수 있다)
      await updateNoteBody(admin, note.id, acc.userId, (cur) => ({
        ...cur.raw,
        figures: readFigures(cur.raw).filter((f) => f.id !== fig.id),
        ...(labels.length && !readPageLabels(cur.raw).length ? { page_labels: labels } : {}),
      }));
      const { data: rested, error: qErr } = await admin
        .from('questions')
        .update({ status: 'suspended' })
        .eq('note_id', note.id)
        .eq('status', 'active')
        .eq('source_figure->>id', fig.id)
        .select('id');
      if (qErr) throw qErr;
      return Response.json({ ok: true, outcome: 'removed', rested: rested?.length ?? 0, anchors } satisfies RelocateResult);
    }

    // 찾았다: 같은 파일에 덮어쓴다 (노트·문제가 같은 경로를 가리킨다)
    const { error: upErr } = await admin.storage.from(SOURCES_BUCKET).upload(fig.crop, cut.jpeg, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw new UserFacingError('upload_failed', '자른 그림을 저장하지 못했어요. 다시 해 주세요.', 500);
    const read = anchors.find((a) => a.page === hit.page)?.printed;
    const printed = (ownSource ? printedPage(useLabels, hit.page) : null) ?? read ?? null;

    // Pro: 다시 그린 그림도 새 그림으로 (못 그리면 원본만)
    let art: Art | null = null;
    if (acc.canFigures && canRedraw(fig.kind)) {
      try {
        const json = await runTask(admin, acc, app, {
          task: 'redraw',
          effortOf: 'redraw',
          tier: acc.settings.models.visual,
          content: [imageBlock(cut.jpeg, 'image/jpeg'), textBlock(redrawPrompt({ kind: fig.kind }))],
          schema: artJsonSchema(fig.kind),
          maxTokens: REDRAW_OUT_TOKENS,
          outTokens: 3500,
          extraInputTokens: 1600,
          timeoutMs: 150_000,
          sourceId: note.source_id,
          rateLimit: false,
        });
        art = normalizeArt(fig.kind, json);
      } catch (e) {
        console.warn('[kok] relocate: redraw failed, keeping the original only', note.id, fig.id, e);
      }
    }

    const next = (f: SourceFigure): SourceFigure => {
      const { printed: _p, ...rest } = f;
      void _p;
      return { ...rest, page: hit.page, ...(printed ? { printed } : {}), w: cut.width, h: cut.height, art };
    };
    await updateNoteBody(admin, note.id, acc.userId, (cur) => ({
      ...cur.raw,
      figures: readFigures(cur.raw).map((f) => (f.id === fig.id ? next(f) : f)),
      ...(labels.length && !readPageLabels(cur.raw).length ? { page_labels: labels } : {}),
    }));
    // 문제에 남긴 그림도 같은 그림으로 (자리·크기·다시 그린 그림)
    const { data: qs, error: qErr } = await admin.from('questions').select('id, source_figure').eq('note_id', note.id).eq('source_figure->>id', fig.id);
    if (qErr) throw qErr;
    for (const q of qs ?? []) {
      const old = q.source_figure as Record<string, unknown> | null;
      if (!old || old.crop !== fig.crop) continue;
      const { printed: _p, ...rest } = old;
      void _p;
      const { error } = await admin
        .from('questions')
        .update({ source_figure: { ...rest, page: hit.page, ...(printed ? { printed } : {}), w: cut.width, h: cut.height, art } })
        .eq('id', q.id);
      if (error) throw error;
    }
    return Response.json({
      ok: true,
      outcome: 'found',
      where: pageName(kind, hit.page, ownSource ? useLabels : [], printed),
      anchors,
    } satisfies RelocateResult);
  } catch (e) {
    return errorResponse(e);
  }
}
