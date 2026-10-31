// 자료 공유 글 하나: 보기(GET: 파일 미리보기·노트 미리보기·댓글·받았는지), 고치기(PATCH: 쓴 사람·운영자), 지우기(DELETE: 쓴 사람·갤러리 만든 사람·운영자)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, assertUuid, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { kstDayStart } from '@/lib/time';
import {
  COMMENT_COLS,
  COMMUNITY_BUCKET,
  FILE_COLS,
  UploadedFile,
  assertCanWrite,
  assertVisible,
  blockedIds,
  profilesOf,
  buildNoteSnapshot,
  checkUploads,
  clearTickets,
  cleanBody,
  cleanTitle,
  commentViews,
  galleryView,
  importedFrom,
  loadGallery,
  loadPost,
  managesGallery,
  notePreview,
  noteFolder,
  noteSaveError,
  postSummary,
  removePaths,
  removePostFiles,
  requireCommunity,
  signUrls,
  type CommentRow,
  type FileRow,
} from '@/lib/server/share';
import { removeFolder } from '@/lib/server/files';
import { SOURCES_BUCKET } from '@/lib/supabase/admin';
import { SHARE_TEXT, type PostDetail } from '@/lib/share';

// 파일 확인·노트 그림 복사·글 지우기(파일 폴더)가 오래 걸릴 수 있다
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: RouteContext<'/api/share/posts/[id]'>) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, '글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const post = await loadPost(admin, id);
    assertVisible(post, acc);
    const mine = post.author_id === acc.userId;
    const blocked = await blockedIds(admin, acc.userId);
    // 차단은 닉네임으로 쓴 글에만 (익명 글까지 막으면 막힌 것으로 익명 글쓴이를 알아낼 수 있다)
    if (!mine && !post.anonymous && blocked.includes(post.author_id)) {
      throw new UserFacingError('blocked', "차단한 사람의 글이에요. '내 활동'의 차단 목록에서 풀 수 있어요.", 403);
    }
    const gallery = await loadGallery(admin, post.gallery_id);
    const [files, note, comments, likedPost, unlockedRow, fav, used] = await Promise.all([
      admin.from('community_files').select(FILE_COLS).eq('post_id', id).order('position'),
      post.has_note
        ? admin.from('community_notes').select('title, subject_name, questions, key_points, snapshot').eq('post_id', id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin.from('community_comments').select(COMMENT_COLS).eq('post_id', id).order('created_at').limit(500),
      admin.from('community_likes').select('target_id').eq('user_id', acc.userId).eq('target_type', 'post').eq('target_id', id).maybeSingle(),
      admin.from('community_downloads').select('post_id').eq('user_id', acc.userId).eq('post_id', id).maybeSingle(),
      admin.from('community_favs').select('gallery_id').eq('user_id', acc.userId).eq('gallery_id', gallery.id).maybeSingle(),
      admin
        .from('community_downloads')
        .select('post_id', { count: 'exact', head: true })
        .eq('user_id', acc.userId)
        .gte('created_at', kstDayStart().toISOString()),
    ]);
    for (const r of [files, note, comments, likedPost, unlockedRow, fav, used]) if (r.error) throw r.error;
    const fileRows = (files.data ?? []) as FileRow[];
    const commentRows = (comments.data ?? []) as CommentRow[];
    // 내가 좋아요한 댓글 (주소가 너무 길어지지 않게 100개씩)
    const likedComments = new Set<string>();
    for (let i = 0; i < commentRows.length; i += 100) {
      const { data, error } = await admin
        .from('community_likes')
        .select('target_id')
        .eq('user_id', acc.userId)
        .eq('target_type', 'comment')
        .in(
          'target_id',
          commentRows.slice(i, i + 100).map((c) => c.id),
        );
      if (error) throw error;
      for (const l of data ?? []) likedComments.add(String(l.target_id));
    }
    const previews = await signUrls(
      admin,
      COMMUNITY_BUCKET,
      fileRows.map((f) => f.preview_path).filter((p): p is string => !!p),
    );
    const manager = managesGallery(acc, gallery);
    const imported = post.has_note && !mine ? await importedFrom(admin, acc.userId, id) : null;
    const limit = acc.lim.downloadsDaily;
    const unlocked = mine || acc.isAdmin || !!unlockedRow.data || (!post.has_files && !post.has_note);
    // 쓴 사람이 아니면 연 수를 센다 (?seen=1: 같은 화면에서 다시 읽을 때(댓글을 단 뒤 등)는 세지 않는다)
    const counted = !mine && req.nextUrl.searchParams.get('seen') !== '1';
    if (counted) await admin.rpc('kok_share_view', { p_post: id });
    // 운영자에게만: 글과 익명 댓글의 실제 글쓴이
    let realAuthor: PostDetail['realAuthor'] = undefined;
    let authors: Awaited<ReturnType<typeof profilesOf>> | undefined;
    if (acc.isAdmin) {
      authors = await profilesOf(admin, [post.author_id, ...commentRows.filter((c) => c.anonymous).map((c) => c.author_id)]);
      realAuthor = authors.get(post.author_id) ?? null;
    }
    const detail: PostDetail = {
      ...postSummary(
        post,
        gallery.name,
        acc,
        fileRows.map((f) => f.kind),
      ),
      views: post.view_count + (counted ? 1 : 0),
      body: post.body,
      edited: !!post.edited_at,
      liked: !!likedPost.data,
      unlocked,
      files: fileRows.map((f) => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        size: Number(f.size),
        pages: f.pages,
        previewUrl: f.preview_path ? (previews.get(f.preview_path) ?? null) : null,
      })),
      note: note.data ? notePreview(note.data as Parameters<typeof notePreview>[0]) : null,
      thread: commentViews(commentRows, post, acc, { blocked: new Set(blocked), liked: likedComments, manager, authors }),
      gallery: galleryView(gallery, acc, new Set(fav.data ? [gallery.id] : [])),
      canEdit: mine || acc.isAdmin,
      canDelete: mine || manager,
      realAuthor,
      imported,
      downloadsLeft: limit === null ? null : Math.max(0, limit - (used.count ?? 0)),
      downloadsDaily: limit,
    };
    return Response.json({ ok: true, post: detail }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}

const Patch = z.object({
  title: z.string().max(400).optional(),
  body: z.string().max(20_000).optional(),
  removeFiles: z.array(z.string().uuid()).max(30).optional(),
  addFiles: z.array(UploadedFile).max(30).optional(),
  /** 붙일 노트 (자료 번호), null 이면 노트를 뗀다, 없으면 그대로 */
  note: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/share/posts/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    assertCanWrite(acc);
    const parsed = Patch.safeParse(await readJson(req, 60_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const b = parsed.data;
    const post = await loadPost(admin, id);
    const mine = post.author_id === acc.userId;
    if (!mine && !acc.isAdmin) throw new UserFacingError('forbidden', '내가 쓴 글만 고칠 수 있어요.', 403);
    // 운영자는 남의 글의 글자·파일 빼기만 (파일·노트를 붙이는 것은 쓴 사람만)
    if (!mine && (b.addFiles?.length || b.note)) throw new UserFacingError('forbidden', '파일과 노트는 쓴 사람만 붙일 수 있어요.', 403);

    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) {
      const t = cleanTitle(b.title);
      if (!t) throw new UserFacingError('no_title', '제목을 적어 주세요.', 400);
      if (t.length > SHARE_TEXT.title) throw new UserFacingError('long_title', `제목은 ${SHARE_TEXT.title}자까지예요.`, 400);
      patch.title = t;
    }
    if (b.body !== undefined) {
      const t = cleanBody(b.body);
      if (t.length > SHARE_TEXT.body) throw new UserFacingError('long_body', `내용은 ${SHARE_TEXT.body.toLocaleString('ko-KR')}자까지예요.`, 400);
      patch.body = t;
    }

    const { data: curFiles, error: fErr } = await admin.from('community_files').select(FILE_COLS).eq('post_id', id).order('position');
    if (fErr) throw fErr;
    const files = (curFiles ?? []) as FileRow[];
    const removing = files.filter((f) => b.removeFiles?.includes(f.id));
    const keep = files.length - removing.length;
    const adding = b.addFiles ?? [];
    if (keep + adding.length > acc.lim.shareFiles && adding.length) {
      throw new UserFacingError('too_many_files', `글 하나에 파일은 ${acc.lim.shareFiles}개까지 붙일 수 있어요.`, 400);
    }
    const added = await checkUploads(
      admin,
      acc,
      id,
      adding,
      files.reduce((m, f) => Math.max(m, f.position + 1), 0),
    );

    // 노트: 새 모습을 다 만든 뒤에 바꾸고, 그 다음에 예전 모습의 그림을 지운다 (새 모습을 못 만들면 예전 노트가 그대로 남는다.
    // 그림은 붙일 때마다 새 폴더라 바꾸는 동안에도 받는 사람이 예전 그림을 복사할 수 있다)
    if (b.note !== undefined) {
      const { data: old, error: oErr } = await admin.from('community_notes').select('figure_paths').eq('post_id', id).maybeSingle();
      if (oErr) throw oErr;
      const oldPaths = ((old?.figure_paths as string[] | null) ?? []).filter((x) => x.startsWith(`${noteFolder(post.author_id, id)}/`));
      if (b.note) {
        const shared = await buildNoteSnapshot(admin, acc, b.note, id);
        const { error } = await admin.from('community_notes').upsert(
          {
            post_id: id,
            owner_id: acc.userId,
            title: shared.title,
            subject_name: shared.subject,
            key_points: shared.keyPoints,
            questions: shared.questions,
            snapshot: shared.snapshot,
            figure_paths: shared.figurePaths,
          },
          { onConflict: 'post_id' },
        );
        if (error) {
          await removeFolder(admin, shared.folder).catch(() => 0);
          throw noteSaveError(error);
        }
        patch.has_note = true;
      } else {
        const { error } = await admin.from('community_notes').delete().eq('post_id', id);
        if (error) throw error;
        patch.has_note = false;
      }
      await removePaths(admin, SOURCES_BUCKET, oldPaths).catch(() => 0);
    }
    if (removing.length) {
      const { error } = await admin
        .from('community_files')
        .delete()
        .in(
          'id',
          removing.map((f) => f.id),
        );
      if (error) throw error;
      const paths = removing.flatMap((f) => [f.path, ...(f.preview_path ? [f.preview_path] : [])]);
      await admin.storage.from(COMMUNITY_BUCKET).remove(paths);
    }
    if (added.length) {
      const { error } = await admin.from('community_files').insert(added);
      if (error) throw error;
      await clearTickets(admin, acc.userId, id, added);
    }
    if (removing.length || added.length) patch.has_files = keep + added.length > 0;
    if (Object.keys(patch).length) {
      patch.edited_at = new Date().toISOString();
      const { error } = await admin.from('community_posts').update(patch).eq('id', id);
      if (error) throw error;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<'/api/share/posts/[id]'>) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, '글 번호');
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const post = await loadPost(admin, id);
    const gallery = await loadGallery(admin, post.gallery_id);
    if (post.author_id !== acc.userId && !managesGallery(acc, gallery)) {
      throw new UserFacingError('forbidden', '내 글이나 내가 만든 갤러리의 글만 지울 수 있어요.', 403);
    }
    const { error } = await admin.from('community_posts').delete().eq('id', id);
    if (error) throw error;
    await removePostFiles(admin, [post]);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
