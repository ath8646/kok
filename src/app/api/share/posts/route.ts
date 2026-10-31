// 자료 공유 글 목록·찾기(GET)와 글 쓰기(POST). 글쓰기: 올린 파일이 내 자리인지·그 종류의 파일인지(앞부분 바이트)·크기를 보고,
// 노트를 붙이면 지금 노트의 모습(정리·그림·문제)을 글에 담는다 (AI·에너지 없음)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import {
  UploadedFile,
  assertCanWrite,
  blockedIds,
  buildNoteSnapshot,
  checkUploads,
  cleanBody,
  cleanTitle,
  hitShare,
  loadGallery,
  noteFolder,
  requireCommunity,
  summaries,
  writerName,
  type PostRow,
} from '@/lib/server/share';
import { removeFolder } from '@/lib/server/files';
import { SHARE_TEXT, searchWords } from '@/lib/share';

const PAGE = 20;

export async function GET(req: NextRequest) {
  try {
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const sp = req.nextUrl.searchParams;
    const gallery = sp.get('gallery');
    const mine = sp.get('mine') === '1';
    const kind = sp.get('kind');
    const sort = sp.get('sort') === 'hot' ? 'hot' : 'new';
    const offset = Math.max(0, Math.min(10_000, Number(sp.get('offset') ?? 0) || 0));
    const words = searchWords(sp.get('q') ?? '');
    const blocked = mine ? [] : await blockedIds(admin, acc.userId);
    const { data, error } = await admin.rpc('kok_share_posts', {
      p_gallery: gallery && /^[0-9a-f-]{36}$/i.test(gallery) ? gallery : null,
      p_words: words.length ? words : null,
      p_kind: kind === 'material' || kind === 'text' ? kind : null,
      p_sort: sort,
      p_author: mine ? acc.userId : null,
      p_exclude: blocked.length ? blocked : null,
      p_hidden: acc.isAdmin || mine,
      p_limit: PAGE,
      p_offset: offset,
    });
    if (error) throw error;
    const rows = (data ?? []) as PostRow[];
    return Response.json(
      { ok: true, posts: await summaries(admin, rows, acc), more: rows.length === PAGE },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({
  id: z.string().uuid(),
  galleryId: z.string().uuid(),
  title: z.string().max(400),
  body: z.string().max(20_000).catch(''),
  anonymous: z.boolean().catch(false),
  files: z.array(UploadedFile).max(30).catch([]),
  noteSourceId: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    assertCanWrite(acc);
    const parsed = Body.safeParse(await readJson(req, 60_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const b = parsed.data;
    const title = cleanTitle(b.title);
    const body = cleanBody(b.body);
    if (!title) throw new UserFacingError('no_title', '제목을 적어 주세요.', 400);
    if (title.length > SHARE_TEXT.title) throw new UserFacingError('long_title', `제목은 ${SHARE_TEXT.title}자까지예요.`, 400);
    if (body.length > SHARE_TEXT.body) throw new UserFacingError('long_body', `내용은 ${SHARE_TEXT.body.toLocaleString('ko-KR')}자까지예요.`, 400);
    if (b.files.length > acc.lim.shareFiles) throw new UserFacingError('too_many_files', `글 하나에 파일은 ${acc.lim.shareFiles}개까지 붙일 수 있어요.`, 400);
    const author = writerName(acc, b.anonymous);
    const gallery = await loadGallery(admin, b.galleryId);
    const { data: exists } = await admin.from('community_posts').select('id').eq('id', b.id).maybeSingle();
    if (exists) throw new UserFacingError('duplicate', '이미 올린 글이에요.', 409);
    await hitShare(admin, acc, 'share_post', 15, 3600, '글을 너무 많이 썼어요. 한 시간 뒤에 다시 써 주세요.');

    const files = await checkUploads(admin, acc, b.id, b.files);
    const shared = b.noteSourceId ? await buildNoteSnapshot(admin, acc, b.noteSourceId, b.id) : null;
    const { error: pErr } = await admin.from('community_posts').insert({
      id: b.id,
      gallery_id: gallery.id,
      author_id: acc.userId,
      author_name: author,
      anonymous: b.anonymous,
      title,
      body,
      has_files: files.length > 0,
      has_note: !!shared,
    });
    if (pErr) {
      if (shared) await removeFolder(admin, noteFolder(acc.userId, b.id)).catch(() => 0);
      throw pErr;
    }
    try {
      if (files.length) {
        const { error } = await admin.from('community_files').insert(files);
        if (error) throw error;
      }
      if (shared) {
        const { error } = await admin.from('community_notes').insert({
          post_id: b.id,
          owner_id: acc.userId,
          title: shared.title,
          subject_name: shared.subject,
          key_points: shared.keyPoints,
          questions: shared.questions,
          snapshot: shared.snapshot,
          figure_paths: shared.figurePaths,
        });
        if (error) throw error;
      }
    } catch (e) {
      // 반만 만든 글은 남기지 않는다 (파일은 하루 뒤 청소가 지운다)
      await admin.from('community_posts').delete().eq('id', b.id);
      if (shared) await removeFolder(admin, noteFolder(acc.userId, b.id)).catch(() => 0);
      throw e;
    }
    await admin.from('community_uploads').delete().eq('user_id', acc.userId).eq('post_id', b.id);
    return Response.json({ ok: true, id: b.id });
  } catch (e) {
    return errorResponse(e);
  }
}
