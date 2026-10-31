// 자료 공유(커뮤니티) 서버 쪽: 권한, 화면에 보낼 모양(익명 글쓴이는 숨김), 파일 검사·주소, 노트 공유·가져오기.
// 표는 모두 서버만 읽고 쓴다 (schema.sql '자료 공유' 구역). 학생 화면은 /api/share/* 를 거친다.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { zNote } from '@/lib/ai/schemas';
import { josa } from '@/lib/josa';
import { readFigures, readQuestionFigure } from '@/lib/source-figures';
import { readPageLabels } from '@/lib/page-labels';
import { readNoteMaterial } from '@/lib/material-type';
import {
  anonymousNames,
  cleanFileName,
  isOfficialGallery,
  nicknameProblem,
  readSharedMark,
  shareKindOf,
  sniffJpeg,
  sniffShareFile,
  type CommentView,
  type GalleryCategory,
  type GalleryView,
  type NotePreview,
  type PostSummary,
  type ShareKind,
} from '@/lib/share';
import { SOURCES_BUCKET } from '@/lib/supabase/admin';
import { getFeatures, type Account } from './account';
import { UserFacingError } from './errors';
import { removeFolder } from './files';

export const COMMUNITY_BUCKET = 'community';

/** 자료 공유 표가 있는지 (schema.sql 을 다시 실행하기 전에는 없다) */
export async function requireCommunity(admin: SupabaseClient): Promise<void> {
  if (!(await getFeatures(admin)).community) {
    throw new UserFacingError('not_ready', '자료 공유는 아직 준비 중이에요. 운영자가 데이터베이스를 바꾸면 열려요.', 503);
  }
}

/** 글·댓글·갤러리를 쓸 수 있는지 (정지된 계정은 읽기만) */
export function assertCanWrite(acc: Account): void {
  if (acc.banned) throw new UserFacingError('banned', '이 계정은 자료 공유에 글을 쓸 수 없어요. 운영자에게 문의해 주세요.', 403);
}

/** 글·댓글에 적을 이름: 익명이면 '익명', 아니면 닉네임 (없으면 먼저 정하게 한다. 운영자처럼 보이는 닉네임은 바꾸게 한다) */
export function writerName(acc: Account, anonymous: boolean): string {
  if (anonymous) return '익명';
  const nick = (acc.nickname ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!nick) throw new UserFacingError('need_nickname', '자료 공유에 쓸 닉네임을 먼저 정해 주세요.', 400);
  const problem = acc.isAdmin ? null : nicknameProblem(nick);
  if (problem) throw new UserFacingError('bad_nickname', `${problem} 설정에서 닉네임을 바꿔 주세요.`, 400);
  return nick;
}

/** 짧은 시간에 너무 많이 쓰지 못하게 (kok_hit_rate). 관리자는 세지 않는다 */
export async function hitShare(admin: SupabaseClient, acc: Account, kind: string, max: number, windowSeconds: number, message: string): Promise<void> {
  if (acc.isAdmin) return;
  const { data, error } = await admin.rpc('kok_hit_rate', { p_user: acc.userId, p_max: max, p_window_seconds: windowSeconds, p_kind: kind });
  if (error) throw error;
  if (data === false) throw new UserFacingError('rate_limited', message, 429);
}

/** 내가 차단한 사람들 */
export async function blockedIds(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin.from('community_blocks').select('blocked_id').eq('user_id', userId).limit(1000);
  if (error) throw error;
  return (data ?? []).map((r) => String(r.blocked_id));
}

// ------------------------------------------------------------- 행
export type GalleryRow = {
  id: string;
  name: string;
  description: string;
  category: GalleryCategory;
  owner_id: string | null;
  post_count: number;
  last_post_at: string | null;
  created_at: string;
};

export type PostRow = {
  id: string;
  gallery_id: string;
  author_id: string;
  author_name: string;
  anonymous: boolean;
  title: string;
  body: string;
  has_files: boolean;
  has_note: boolean;
  like_count: number;
  comment_count: number;
  download_count: number;
  view_count: number;
  hidden: boolean;
  edited_at: string | null;
  created_at: string;
};

export type FileRow = {
  id: string;
  post_id: string;
  owner_id: string;
  kind: ShareKind;
  name: string;
  size: number;
  path: string;
  preview_path: string | null;
  pages: number | null;
  position: number;
};

export type CommentRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  anonymous: boolean;
  body: string;
  like_count: number;
  deleted: boolean;
  hidden: boolean;
  edited_at: string | null;
  created_at: string;
};

export const GALLERY_COLS = 'id, name, description, category, owner_id, post_count, last_post_at, created_at';
export const POST_COLS =
  'id, gallery_id, author_id, author_name, anonymous, title, body, has_files, has_note, like_count, comment_count, download_count, view_count, hidden, edited_at, created_at';
export const FILE_COLS = 'id, post_id, owner_id, kind, name, size, path, preview_path, pages, position';
export const COMMENT_COLS = 'id, post_id, parent_id, author_id, author_name, anonymous, body, like_count, deleted, hidden, edited_at, created_at';

export async function loadGallery(admin: SupabaseClient, id: string): Promise<GalleryRow> {
  const { data, error } = await admin.from('community_galleries').select(GALLERY_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError('not_found', '갤러리를 찾을 수 없어요. 지워졌을 수 있어요.', 404);
  return data as GalleryRow;
}

export async function loadPost(admin: SupabaseClient, id: string): Promise<PostRow> {
  const { data, error } = await admin.from('community_posts').select(POST_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError('not_found', '글을 찾을 수 없어요. 지워졌을 수 있어요.', 404);
  return data as PostRow;
}

/** 가린 글은 쓴 사람과 운영자만 */
export function assertVisible(post: PostRow, acc: Account): void {
  if (post.hidden && post.author_id !== acc.userId && !acc.isAdmin) {
    throw new UserFacingError('hidden', '신고가 쌓여 가려진 글이에요. 운영자가 확인하고 있어요.', 404);
  }
}

/**
 * 운영자가 가리거나 다시 보이게 하면 그것의 열린 신고를 닫는다: 가리면 해결, 다시 보이게 하면 기각
 * (기각해 두어야 다음 새 신고부터 다시 센다: /api/share/report)
 */
export async function settleShareReports(admin: SupabaseClient, kind: 'post' | 'comment', id: string, hidden: boolean): Promise<void> {
  const { error } = await admin
    .from('reports')
    .update({ status: hidden ? 'resolved' : 'dismissed', resolved_at: new Date().toISOString() })
    .eq('target_type', `share_${kind}`)
    .eq('target_id', id)
    .eq('status', 'open');
  if (error) throw error;
}

// ------------------------------------------------------------- 화면에 보낼 모양
export function galleryView(g: GalleryRow, acc: Account, favs: Set<string>): GalleryView {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    category: g.category,
    posts: g.post_count,
    lastPostAt: g.last_post_at,
    official: g.owner_id === null && isOfficialGallery(g.id),
    mine: !!g.owner_id && g.owner_id === acc.userId,
    fav: favs.has(g.id),
  };
}

const excerptOf = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 90);

/** 목록 한 줄. 익명 글은 이름만 '익명' (쓴 사람 번호는 보내지 않는다) */
export function postSummary(p: PostRow, galleryName: string, acc: Account, fileKinds: ShareKind[]): PostSummary {
  return {
    id: p.id,
    galleryId: p.gallery_id,
    galleryName,
    title: p.title,
    excerpt: excerptOf(p.body),
    authorName: p.anonymous ? '익명' : p.author_name,
    anonymous: p.anonymous,
    mine: p.author_id === acc.userId,
    hasFiles: p.has_files,
    hasNote: p.has_note,
    likes: p.like_count,
    comments: p.comment_count,
    downloads: p.download_count,
    views: p.view_count,
    fileKinds,
    createdAt: p.created_at,
    hidden: p.hidden,
  };
}

/** 글 목록에 붙일 갤러리 이름과 파일 종류 */
export async function summaries(admin: SupabaseClient, rows: PostRow[], acc: Account): Promise<PostSummary[]> {
  if (!rows.length) return [];
  const gids = [...new Set(rows.map((r) => r.gallery_id))];
  const ids = rows.filter((r) => r.has_files).map((r) => r.id);
  const [{ data: gs, error: gErr }, files] = await Promise.all([
    admin.from('community_galleries').select('id, name').in('id', gids),
    ids.length
      ? admin.from('community_files').select('post_id, kind, position').in('post_id', ids).order('position')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (gErr) throw gErr;
  if (files.error) throw files.error;
  const names = new Map((gs ?? []).map((g) => [String(g.id), String(g.name)]));
  const kinds = new Map<string, ShareKind[]>();
  for (const f of (files.data ?? []) as Array<{ post_id: string; kind: ShareKind }>) {
    const list = kinds.get(f.post_id) ?? [];
    list.push(f.kind);
    kinds.set(f.post_id, list);
  }
  return rows.map((r) => postSummary(r, names.get(r.gallery_id) ?? '', acc, kinds.get(r.id) ?? []));
}

/** 갤러리를 고치거나 그 갤러리의 글·댓글을 지울 수 있는지 (만든 사람·운영자) */
export function managesGallery(acc: Account, g: Pick<GalleryRow, 'owner_id'>): boolean {
  return acc.isAdmin || (!!g.owner_id && g.owner_id === acc.userId);
}

/**
 * 댓글 목록. 익명 이름은 서버가 정하고 쓴 사람 번호는 보내지 않는다.
 * - 차단은 닉네임으로 쓴 댓글에만 (익명 댓글까지 가리면 가려진 것으로 익명 글쓴이를 알아낼 수 있다). 답글이 있는 댓글은 자리만 남긴다
 * - '글쓴이' 표시는 글과 댓글이 같이 익명이거나 같이 닉네임일 때만 (익명 글의 글쓴이가 닉네임으로 단 댓글에 '글쓴이'를 붙이면 익명이 풀린다)
 * - 운영자에게만 익명 댓글의 실제 글쓴이(authors)
 */
export function commentViews(
  rows: CommentRow[],
  post: PostRow,
  acc: Account,
  opts: { blocked: Set<string>; liked: Set<string>; manager: boolean; authors?: Map<string, { nickname: string | null; email: string | null }> },
): CommentView[] {
  const anon = anonymousNames(
    rows.map((c) => ({ author: c.author_id, anonymous: c.anonymous })),
    post.author_id,
    post.anonymous,
  );
  const hasReplies = new Set(rows.filter((c) => c.parent_id).map((c) => c.parent_id as string));
  const out: CommentView[] = [];
  rows.forEach((c, i) => {
    const blocked = !c.anonymous && opts.blocked.has(c.author_id);
    if (blocked && !hasReplies.has(c.id)) return;
    const mine = c.author_id === acc.userId;
    const hiddenForMe = c.hidden && !mine && !acc.isAdmin;
    const gone = c.deleted || blocked;
    out.push({
      id: c.id,
      parentId: c.parent_id,
      authorName: gone ? '' : c.anonymous ? anon[i] : c.author_name,
      anonymous: c.anonymous,
      byPostAuthor: !gone && c.author_id === post.author_id && c.anonymous === post.anonymous,
      mine: mine && !c.deleted,
      body: c.deleted ? '' : blocked ? '' : hiddenForMe ? '' : c.body,
      likes: c.like_count,
      liked: opts.liked.has(c.id),
      deleted: c.deleted || blocked,
      blocked: blocked && !c.deleted,
      hidden: c.hidden,
      edited: !!c.edited_at,
      createdAt: c.created_at,
      canDelete: !c.deleted && (mine || opts.manager),
      ...(acc.isAdmin && c.anonymous && !gone ? { realAuthor: opts.authors?.get(c.author_id) ?? null } : {}),
    });
  });
  return out;
}

/** 운영자 화면에 보일 실제 글쓴이 (닉네임·이메일) */
export async function profilesOf(admin: SupabaseClient, ids: string[]): Promise<Map<string, { nickname: string | null; email: string | null }>> {
  const out = new Map<string, { nickname: string | null; email: string | null }>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await admin
      .from('profiles')
      .select('id, nickname, email')
      .in('id', uniq.slice(i, i + 100));
    for (const p of data ?? []) out.set(String(p.id), { nickname: (p.nickname as string | null) ?? null, email: (p.email as string | null) ?? null });
  }
  return out;
}

// ------------------------------------------------------------- 파일
/** 서명 주소 여러 개 (경로 → 주소). download 면 받기(이름)로 */
export async function signUrls(
  admin: SupabaseClient,
  bucket: string,
  paths: string[],
  opts: { seconds?: number; download?: string } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrls(paths, opts.seconds ?? 3000, opts.download ? { download: opts.download } : undefined);
  if (error) throw error;
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

/** 저장소 파일의 앞부분 n 바이트 (서명 주소로 받다가 n 바이트에서 멈춘다: 큰 파일을 통째로 받지 않게) */
export async function readHead(admin: SupabaseClient, bucket: string, path: string, n = 4096): Promise<Uint8Array> {
  const urls = await signUrls(admin, bucket, [path], { seconds: 120 });
  const url = urls.get(path);
  if (!url) return new Uint8Array();
  // no-store: Next 의 fetch 가 응답을 나눠(tee) 기억하지 않게 (나눈 응답은 한쪽만 그만 읽으면 그만두기가 끝나지 않는다)
  const res = await fetch(url, { headers: { Range: `bytes=0-${n - 1}` }, cache: 'no-store' });
  if (!res.ok || !res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  try {
    while (got < n) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      got += value.length;
    }
  } finally {
    // 남은 것은 받지 않는다 (기다리지 않는다: 그만두기가 늦게 끝나도 검사는 이어 간다)
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(got, n));
  let at = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - at);
    if (take <= 0) break;
    out.set(c.subarray(0, take), at);
    at += take;
  }
  return out;
}

/**
 * 글의 파일 폴더 ('community' 버킷 p/글id). 경로에 쓴 사람 번호를 넣지 않는다: 미리보기·받기 주소에 경로가 그대로 들어가서,
 * 넣으면 익명 글과 닉네임 글의 주소를 견줘 익명 글쓴이를 알아낼 수 있다. 누가 올렸는지는 올리기 자리(community_uploads)가 지킨다
 */
export function postFolder(postId: string): string {
  return `p/${postId}`;
}

/**
 * 글에 붙인 노트의 그림 폴더 ('sources' 버킷 쓴사람id/share/글id). 그림은 붙일 때마다 그 안의 새 폴더(8자)에 둔다:
 * 노트를 바꾸는 동안에도 받는 사람이 예전 모습의 그림을 복사할 수 있게 (새 모습을 넣은 뒤에 예전 그림을 지운다). 경로는 화면에 보내지 않는다
 */
export function noteFolder(authorId: string, postId: string): string {
  return `${authorId}/share/${postId}`;
}

/** 노트 그림 경로 안의 이름 (그림 폴더 바로 아래 fN.jpg 또는 붙일 때마다의 폴더/fN.jpg) */
const SHARED_FIGURE = /^(?:[0-9a-f]{8}\/)?(f\d{1,4}\.jpg)$/;

/** 글을 지울 때 파일·노트 그림도 지운다 (행은 cascade 로 지워진다). 처음 만든 때의 경로(쓴사람id/글id)에 올린 파일도 */
export async function removePostFiles(admin: SupabaseClient, posts: Array<Pick<PostRow, 'id' | 'author_id'>>): Promise<void> {
  for (const p of posts) {
    await removeFolder(admin, postFolder(p.id), COMMUNITY_BUCKET).catch(() => 0);
    await removeFolder(admin, `${p.author_id}/${p.id}`, COMMUNITY_BUCKET).catch(() => 0);
    await removeFolder(admin, noteFolder(p.author_id, p.id)).catch(() => 0);
  }
}

/** 탈퇴: 내 글의 파일 폴더와 글이 되지 않은 올리기 자리의 파일 (글 폴더에는 계정 번호가 없어서 내 글을 읽어 지운다. 글 행은 계정을 지우면 같이 지워진다) */
export async function removeUserShareFiles(admin: SupabaseClient, userId: string): Promise<void> {
  if (!(await getFeatures(admin)).community) return;
  const { data: posts } = await admin.from('community_posts').select('id, author_id').eq('author_id', userId).limit(10_000);
  await removePostFiles(admin, (posts ?? []) as Array<Pick<PostRow, 'id' | 'author_id'>>);
  const { data: pending } = await admin.from('community_uploads').select('path').eq('user_id', userId).limit(10_000);
  await removePaths(
    admin,
    COMMUNITY_BUCKET,
    (pending ?? []).map((r) => String(r.path)),
  );
}

/** 저장소 파일 여러 개 지우기 (100개씩, 실패는 넘어간다: 하루 청소가 다시 본다) */
export async function removePaths(admin: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
}

// ------------------------------------------------------------- 글쓰기
export const UploadedFile = z.object({
  path: z.string().min(1).max(200),
  previewPath: z.string().min(1).max(200).nullable().optional(),
  name: z.string().min(1).max(300),
  pages: z.number().int().min(0).max(100_000).nullable().optional(),
});
export type UploadedFile = z.infer<typeof UploadedFile>;

export const cleanTitle = (t: string) => t.replace(/\s+/g, ' ').trim();
export const cleanBody = (t: string) =>
  t
    .replace(/\r\n?/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

/**
 * 올린 파일 확인 → 파일 행: 내 올리기 자리인지, 실제 크기가 요금제 한도 안인지, 앞부분이 그 종류의 파일인지 (미리보기는 JPEG 인지).
 * 문제가 있으면 한국어로 던진다
 */
export async function checkUploads(
  admin: SupabaseClient,
  acc: { userId: string; lim: { shareFiles: number; shareFileMb: number } },
  postId: string,
  files: UploadedFile[],
  startAt = 0,
): Promise<
  Array<{
    post_id: string;
    owner_id: string;
    kind: ShareKind;
    name: string;
    size: number;
    path: string;
    preview_path: string | null;
    pages: number | null;
    position: number;
  }>
> {
  if (!files.length) return [];
  const folder = postFolder(postId);
  const paths = files.flatMap((f) => [f.path, ...(f.previewPath ? [f.previewPath] : [])]);
  if (paths.some((p) => !p.startsWith(`${folder}/`) || p.includes('..')))
    throw new UserFacingError('bad_path', '올린 파일이 이 글의 것이 아니에요. 다시 올려 주세요.', 400);
  const { data: tickets, error } = await admin.from('community_uploads').select('path').eq('user_id', acc.userId).eq('post_id', postId).in('path', paths);
  if (error) throw error;
  const have = new Set((tickets ?? []).map((t) => String(t.path)));
  if (paths.some((p) => !have.has(p))) throw new UserFacingError('upload_missing', '올린 파일을 찾을 수 없어요. 파일을 다시 올려 주세요.', 400);
  // 실제 크기 (올릴 때 말한 크기와 다르게 올렸을 수 있다)
  const { data: listed, error: lErr } = await admin.storage.from(COMMUNITY_BUCKET).list(folder, { limit: 200 });
  if (lErr) throw lErr;
  const sizes = new Map((listed ?? []).map((o) => [`${folder}/${o.name}`, Number((o.metadata as { size?: number } | null)?.size ?? 0)]));
  const out = [];
  for (const [i, f] of files.entries()) {
    const name = cleanFileName(f.name);
    const label = `'${name}'`;
    const kind = shareKindOf(name);
    if (!kind) throw new UserFacingError('bad_kind', `${josa(label, '은')} 올릴 수 없는 파일이에요.`, 400);
    const size = sizes.get(f.path) ?? 0;
    if (!size) throw new UserFacingError('upload_missing', `${josa(label, '이')} 다 올라가지 않았어요. 다시 올려 주세요.`, 400);
    if (size > acc.lim.shareFileMb * 1024 * 1024)
      throw new UserFacingError('too_big', `${josa(label, '이')} 너무 커요. 파일 한 개는 ${acc.lim.shareFileMb}MB까지예요.`, 400);
    if (!sniffShareFile(kind, await readHead(admin, COMMUNITY_BUCKET, f.path))) {
      throw new UserFacingError('bad_file', `${josa(label, '은')} 이름과 내용이 맞지 않는 파일이에요. 원래 파일을 올려 주세요.`, 400);
    }
    let preview: string | null = null;
    if (f.previewPath && sniffJpeg(await readHead(admin, COMMUNITY_BUCKET, f.previewPath, 16))) preview = f.previewPath;
    out.push({ post_id: postId, owner_id: acc.userId, kind, name, size, path: f.path, preview_path: preview, pages: f.pages ?? null, position: startAt + i });
  }
  return out;
}

/** 글에 붙인 파일의 올리기 자리를 지운다 (붙인 것만: 같은 글에 올리는 중인 다른 파일의 자리는 그대로 두고, 남은 자리는 하루 뒤 청소가 본다) */
export async function clearTickets(
  admin: SupabaseClient,
  userId: string,
  postId: string,
  files: Array<{ path: string; preview_path: string | null }>,
): Promise<void> {
  const paths = files.flatMap((f) => [f.path, ...(f.preview_path ? [f.preview_path] : [])]);
  for (let i = 0; i < paths.length; i += 100) {
    await admin
      .from('community_uploads')
      .delete()
      .eq('user_id', userId)
      .eq('post_id', postId)
      .in('path', paths.slice(i, i + 100));
  }
}

// ------------------------------------------------------------- 노트 공유
type Snapshot = {
  v: 1;
  subject: string;
  note: Record<string, unknown>;
  visuals: Array<{ type: string; spec: unknown }>;
  questions: Array<Record<string, unknown>>;
};

/** 노트 모습의 크기 (JSON 바이트). DB 는 jsonb 1.5MB 까지 받는다 (community_notes.snapshot) */
const SNAPSHOT_MAX_BYTES = 1_300_000;
const NOTE_TOO_BIG = '노트가 너무 커서 공유할 수 없어요. 노트를 나누거나 PDF 요약으로 올려 주세요.';

/** 노트 모습을 넣다가 DB 의 크기 검사(23514)에 걸리면 같은 안내로 */
export function noteSaveError(e: { code?: string } | null): unknown {
  if (e?.code === '23514') return new UserFacingError('note_too_big', NOTE_TOO_BIG, 400);
  return e;
}
const QUESTION_KEYS = [
  'key_point_id',
  'type',
  'prompt',
  'choices',
  'answer',
  'accepted',
  'explanation',
  'difficulty',
  'pages',
  'figure',
  'steps',
  'source_figure',
];

/** 노트 정리에서 남이 봐도 되는 것만 (내 별표·고친 표시·확인해 볼 것·관리자 기록은 뺀다) */
function shareBody(raw: Record<string, unknown>, figures: unknown[]): Record<string, unknown> {
  const n = zNote.parse(raw);
  const material = readNoteMaterial(raw);
  const labels = readPageLabels(raw);
  return {
    title: n.title,
    unit: '',
    summary: n.summary,
    key_points: n.key_points.map((k) => ({ id: k.id, title: k.title, explanation: k.explanation, why: k.why, importance: k.importance, pages: k.pages })),
    terms: n.terms.map((t) => ({ term: t.term, meaning: t.meaning })),
    formulas: n.formulas.map((f) => ({ latex: f.latex, label: f.label })),
    pitfalls: n.pitfalls.map((p) => ({ text: p.text, key_point_id: p.key_point_id })),
    examples: n.examples.map((e) => ({ text: e.text, key_point_id: e.key_point_id })),
    checks: [],
    changes: [],
    ...(n.manual ? { manual: true } : {}),
    ...(figures.length ? { figures } : {}),
    ...(labels.length ? { page_labels: labels } : {}),
    ...(material ? { material } : {}),
  };
}

/**
 * 내 노트를 공유 글에 붙일 모습으로 (정리·그림 설계도·문제, 지금 버전). 자료 그림 파일은 글의 그림 폴더로 복사하고 경로를 바꾼다.
 * 노트가 아직 정리 중이거나 비어 있으면 거절
 */
export async function buildNoteSnapshot(
  admin: SupabaseClient,
  acc: Account,
  sourceId: string,
  postId: string,
): Promise<{ title: string; subject: string; keyPoints: number; questions: number; snapshot: Snapshot; figurePaths: string[]; folder: string }> {
  const { data: src, error: sErr } = await admin.from('sources').select('id, user_id, subject_id, status, title, shared_from').eq('id', sourceId).maybeSingle();
  if (sErr) throw sErr;
  if (!src || src.user_id !== acc.userId) throw new UserFacingError('not_found', '붙일 노트를 찾을 수 없어요.', 404);
  if (src.status !== 'ready') throw new UserFacingError('not_ready', '정리가 끝난 노트만 공유할 수 있어요.', 409);
  // 공유받은 노트(가 합쳐 들어온 노트)는 다시 나누지 않는다 (다른 사람이 만든 것을 내 이름으로 퍼뜨리지 않게: 이용약관 6)
  if (src.shared_from) throw new UserFacingError('shared_note', '공유받은 노트는 다시 공유할 수 없어요. 내가 만든 노트를 붙여 주세요.', 400);
  const { data: kids, error: kErr } = await admin.from('sources').select('id').eq('parent_id', sourceId).not('shared_from', 'is', null).limit(1);
  if (kErr) throw kErr;
  if (kids?.length) throw new UserFacingError('shared_note', '공유받은 노트가 합쳐진 노트는 공유할 수 없어요. 내가 만든 노트를 붙여 주세요.', 400);
  const { data: noteRow, error: nErr } = await admin.from('notes').select('id, title, body').eq('source_id', sourceId).maybeSingle();
  if (nErr) throw nErr;
  if (!noteRow) throw new UserFacingError('not_found', '붙일 노트를 찾을 수 없어요.', 404);
  const raw = (noteRow.body ?? {}) as Record<string, unknown>;
  // 표시가 남은 예전 노트 (shared_from 칸이 생기기 전에 넣은 것)
  if (readSharedMark(raw)) throw new UserFacingError('shared_note', '공유받은 노트는 다시 공유할 수 없어요. 내가 만든 노트를 붙여 주세요.', 400);
  const n = zNote.parse(raw);
  if (!n.key_points.length && !n.summary.trim() && !n.terms.length && !n.formulas.length) {
    throw new UserFacingError('empty_note', '비어 있는 노트는 공유할 수 없어요. 노트를 먼저 채워 주세요.', 400);
  }
  const [{ data: subj }, { data: vis, error: vErr }, { data: qs, error: qErr }] = await Promise.all([
    admin.from('subjects').select('name').eq('id', src.subject_id).maybeSingle(),
    admin.from('visuals').select('type, spec').eq('note_id', noteRow.id),
    admin.from('questions').select('*').eq('note_id', noteRow.id).in('status', ['active', 'suspended']).order('created_at').limit(400),
  ]);
  if (vErr) throw vErr;
  if (qErr) throw qErr;

  // 자료 그림 파일: 노트와 문제가 가리키는 그림을 글의 폴더로 (서로 다른 자료의 같은 이름 그림도 있어 f1, f2 … 로 새로 이름 짓는다)
  const figures = readFigures(raw);
  const questions = (qs ?? []) as Array<Record<string, unknown>>;
  const crops = new Set<string>(figures.map((f) => f.crop));
  for (const q of questions) {
    const f = readQuestionFigure(q.source_figure);
    if (f) crops.add(f.crop);
  }
  const moved = new Map<string, string>();
  const bucket = admin.storage.from(SOURCES_BUCKET);
  const folder = `${noteFolder(acc.userId, postId)}/${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let k = 0;
  for (const from of crops) {
    if (!from.startsWith(`${acc.userId}/figs/`)) continue;
    const to = `${folder}/f${++k}.jpg`;
    const { error } = await bucket.copy(from, to);
    if (!error) moved.set(from, to);
  }
  const sharedFigures = figures.filter((f) => moved.has(f.crop)).map((f) => ({ ...f, crop: moved.get(f.crop)! }));
  const sharedQuestions = questions.map((q) => {
    const out: Record<string, unknown> = {};
    for (const key of QUESTION_KEYS) if (q[key] !== undefined && q[key] !== null) out[key] = q[key];
    const f = readQuestionFigure(q.source_figure);
    if (f) {
      if (moved.has(f.crop)) out.source_figure = { ...f, crop: moved.get(f.crop) };
      else delete out.source_figure;
    }
    return out;
  });
  // 그림이 없어진 그림 문제는 뺀다 (그림 없이는 풀 수 없다)
  const usable = sharedQuestions.filter((q, i) => !(readQuestionFigure(questions[i].source_figure) && !q.source_figure));
  const snapshot: Snapshot = {
    v: 1,
    subject: String(subj?.name ?? ''),
    note: shareBody(raw, sharedFigures),
    visuals: ((vis ?? []) as Array<{ type: string; spec: unknown }>).map((v) => ({ type: v.type, spec: v.spec })),
    questions: usable,
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > SNAPSHOT_MAX_BYTES) {
    await removeFolder(admin, folder).catch(() => 0);
    throw new UserFacingError('note_too_big', NOTE_TOO_BIG, 400);
  }
  return {
    title: String(noteRow.title || src.title || n.title || '노트').slice(0, 120),
    subject: snapshot.subject.slice(0, 40),
    keyPoints: n.key_points.length,
    questions: usable.length,
    snapshot,
    figurePaths: [...moved.values()],
    folder,
  };
}

/** 글에 붙인 노트의 미리보기 (받기 전에도 누구나 본다: 요약과 개념 이름 몇 개) */
export function notePreview(row: { title: string; subject_name: string; questions: number; key_points: number; snapshot: unknown }): NotePreview {
  const snap = (row.snapshot ?? {}) as Partial<Snapshot>;
  const n = zNote.parse(snap.note ?? {});
  const figures = Array.isArray((snap.note as { figures?: unknown } | undefined)?.figures) ? ((snap.note as { figures: unknown[] }).figures.length ?? 0) : 0;
  return {
    title: row.title,
    subject: row.subject_name,
    summary: n.summary.slice(0, 400),
    keyPoints: n.key_points.slice(0, 8).map((k) => k.title.slice(0, 60)),
    keyPointCount: n.key_points.length || row.key_points,
    questions: row.questions,
    terms: n.terms.length,
    formulas: n.formulas.length,
    figures,
    hasMindmap: Array.isArray(snap.visuals) && snap.visuals.some((v) => v && (v as { type?: unknown }).type === 'mindmap'),
  };
}

/** 이 글의 노트를 이미 넣었으면 열 노트 (합친 노트에 들어갔으면 그 노트) */
export async function importedFrom(admin: SupabaseClient, userId: string, postId: string): Promise<string | null> {
  const { data, error } = await admin.from('sources').select('id, parent_id').eq('user_id', userId).eq('shared_from', postId).limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? String(row.parent_id ?? row.id) : null;
}

/**
 * 공유받은 노트를 내 자료함에 (AI·에너지 없이): 새 자료 행 + 노트·그림·문제(복습 카드)를 한 번에 만든다.
 * 그림 파일은 내 그림 폴더로 복사하고 경로를 바꾼다. 실패하면 만든 것을 지운다. 이미 넣은 글이면 그 노트 (existing)
 */
export async function importSharedNote(
  admin: SupabaseClient,
  acc: Account,
  post: PostRow,
  subjectId: string,
): Promise<{ sourceId: string; noteId: string | null; existing?: boolean }> {
  const { data: shared, error } = await admin.from('community_notes').select('title, snapshot').eq('post_id', post.id).maybeSingle();
  if (error) throw error;
  if (!shared) throw new UserFacingError('not_found', '이 글에는 노트가 없어요.', 404);
  const snap = shared.snapshot as Snapshot;
  const sourceId = crypto.randomUUID();
  const bucket = admin.storage.from(SOURCES_BUCKET);

  // 그림 파일을 내 폴더로 (이름은 그대로 f1.jpg …)
  const moved = new Map<string, string>();
  const prefix = `${noteFolder(post.author_id, post.id)}/`;
  const paths = new Set<string>();
  const note = { ...(snap.note ?? {}) } as Record<string, unknown>;
  const figs = Array.isArray(note.figures) ? (note.figures as Array<Record<string, unknown>>) : [];
  for (const f of figs) if (typeof f.crop === 'string') paths.add(f.crop);
  for (const q of snap.questions ?? []) {
    const sf = q.source_figure as { crop?: unknown } | undefined;
    if (sf && typeof sf.crop === 'string') paths.add(sf.crop);
  }
  for (const from of paths) {
    if (!from.startsWith(prefix)) continue;
    const name = SHARED_FIGURE.exec(from.slice(prefix.length))?.[1];
    if (!name) continue;
    const to = `${acc.userId}/figs/${sourceId}/${name}`;
    const { error: cErr } = await bucket.copy(from, to);
    if (!cErr) moved.set(from, to);
  }
  note.figures = figs.filter((f) => typeof f.crop === 'string' && moved.has(f.crop)).map((f) => ({ ...f, crop: moved.get(f.crop as string) }));
  if (!(note.figures as unknown[]).length) delete note.figures;
  note.unit = '';
  note.shared = { post: post.id, title: post.title.slice(0, 80), by: post.anonymous ? '익명' : post.author_name, at: new Date().toISOString() };
  const questions = (snap.questions ?? [])
    .map((q) => {
      const sf = q.source_figure as { crop?: unknown } | undefined;
      if (!sf) return q;
      if (typeof sf.crop === 'string' && moved.has(sf.crop)) return { ...q, source_figure: { ...sf, crop: moved.get(sf.crop) } };
      return null;
    })
    .filter((q): q is Record<string, unknown> => !!q);
  const title = String(shared.title || zNote.parse(note).title || '공유받은 노트').slice(0, 120);

  const { error: sErr } = await admin.from('sources').insert({
    id: sourceId,
    user_id: acc.userId,
    subject_id: subjectId,
    kind: 'text',
    title,
    unit: '',
    text_content: null,
    status: 'ready',
    step: 'done',
    progress: 100,
    shared_from: post.id,
  });
  if (sErr) {
    await removeFolder(admin, `${acc.userId}/figs/${sourceId}`).catch(() => 0);
    // 같은 글을 거의 같은 때 두 번 넣으면 (sources_shared_from_uniq) 먼저 넣은 노트로
    if (sErr.code === '23505') {
      const prev = await importedFrom(admin, acc.userId, post.id);
      if (prev) return { sourceId: prev, noteId: null, existing: true };
    }
    throw sErr;
  }
  const { data: noteId, error: fErr } = await admin.rpc('kok_finalize_source', {
    p_source: sourceId,
    p_title: title,
    p_note: note,
    p_visuals: (snap.visuals ?? []).filter((v) => ['mindmap', 'table', 'timeline'].includes(v.type)),
    p_questions: questions,
    p_expire: null,
  });
  if (fErr || !noteId) {
    await admin.from('sources').delete().eq('id', sourceId);
    await removeFolder(admin, `${acc.userId}/figs/${sourceId}`).catch(() => 0);
    throw fErr ?? new Error('import failed');
  }
  // 단원은 학생이 고른 것만 (예전 함수가 노트의 단원으로 채웠어도 비운다)
  await admin.from('sources').update({ unit: '' }).eq('id', sourceId).neq('unit', '');
  return { sourceId, noteId: String(noteId) };
}
