// 관리자: 신고함
import type { NextRequest } from 'next/server';
import { UUID_RE, requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { THEME_IMAGES_BUCKET } from '@/lib/server/themes';

const COLS = 'id, reporter_id, target_type, target_id, reason, status, created_at, resolved_at';

type ShareTarget = {
  /** 실제로 쓴 사람 (닉네임·이메일, 탈퇴했으면 null). 갤러리는 만든 사람, 운영자 갤러리면 '운영자' */
  author: string | null;
  anonymous: boolean;
  /** 댓글이 있는 글 */
  postId: string | null;
  hidden: boolean;
  /** 지워져서 없음 */
  gone: boolean;
};

/**
 * 자료 공유 신고의 실제 글쓴이 (익명 글도 운영자는 안다). 신고한 사람도 읽는 snapshot 에는 계정 번호를 남기지 않아서 여기서 읽는다.
 * 자료 공유 표가 없는 예전 DB 면 빈 것
 */
async function shareTargets(
  admin: Awaited<ReturnType<typeof requireAccount>>['admin'],
  reports: Array<{ target_type: string; target_id: string | null }>,
): Promise<Record<string, ShareTarget>> {
  const ids = (type: string) => [
    ...new Set(reports.filter((r) => r.target_type === type && typeof r.target_id === 'string' && UUID_RE.test(r.target_id)).map((r) => r.target_id as string)),
  ];
  const postIds = ids('share_post');
  const commentIds = ids('share_comment');
  const galleryIds = ids('share_gallery');
  if (!postIds.length && !commentIds.length && !galleryIds.length) return {};
  const empty = { data: [] as Array<Record<string, unknown>>, error: null };
  const [posts, comments, galleries] = await Promise.all([
    postIds.length ? admin.from('community_posts').select('id, author_id, anonymous, hidden').in('id', postIds) : empty,
    commentIds.length ? admin.from('community_comments').select('id, post_id, author_id, anonymous, hidden, deleted').in('id', commentIds) : empty,
    galleryIds.length ? admin.from('community_galleries').select('id, owner_id').in('id', galleryIds) : empty,
  ]);
  const rows = {
    posts: (posts.error ? [] : (posts.data ?? [])) as Array<{ id: string; author_id: string; anonymous: boolean; hidden: boolean }>,
    comments: (comments.error ? [] : (comments.data ?? [])) as Array<{
      id: string;
      post_id: string;
      author_id: string;
      anonymous: boolean;
      hidden: boolean;
      deleted: boolean;
    }>,
    galleries: (galleries.error ? [] : (galleries.data ?? [])) as Array<{ id: string; owner_id: string | null }>,
  };
  const people = [
    ...new Set([
      ...rows.posts.map((p) => p.author_id),
      ...rows.comments.map((c) => c.author_id),
      ...rows.galleries.flatMap((g) => (g.owner_id ? [g.owner_id] : [])),
    ]),
  ];
  const names = new Map<string, string>();
  for (let i = 0; i < people.length; i += 100) {
    const { data: ps } = await admin
      .from('profiles')
      .select('id, nickname, email')
      .in('id', people.slice(i, i + 100));
    for (const p of ps ?? []) {
      const nick = (p.nickname as string | null) ?? '';
      const email = (p.email as string | null) ?? '';
      names.set(String(p.id), nick && email ? `${nick} (${email})` : nick || email || '이름 없음');
    }
  }
  const out: Record<string, ShareTarget> = {};
  for (const id of postIds) {
    const p = rows.posts.find((r) => r.id === id);
    out[id] = { author: p ? (names.get(p.author_id) ?? null) : null, anonymous: !!p?.anonymous, postId: id, hidden: !!p?.hidden, gone: !p };
  }
  for (const id of commentIds) {
    const c = rows.comments.find((r) => r.id === id);
    out[id] = {
      author: c ? (names.get(c.author_id) ?? null) : null,
      anonymous: !!c?.anonymous,
      postId: c?.post_id ?? null,
      hidden: !!c?.hidden,
      gone: !c || c.deleted,
    };
  }
  for (const id of galleryIds) {
    const g = rows.galleries.find((r) => r.id === id);
    out[id] = { author: g ? (g.owner_id ? (names.get(g.owner_id) ?? null) : '운영자') : null, anonymous: false, postId: null, hidden: false, gone: !g };
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { admin } = await requireAccount({ admin: true });
    const status = req.nextUrl.searchParams.get('status') ?? 'open';
    const want = ['open', 'resolved', 'dismissed'].includes(status) ? status : 'open';
    // snapshot(신고할 때 본 AI 결과)은 schema.sql 을 다시 실행하기 전에는 없다: 없으면 예전 칸만
    const read = (cols: string) => admin.from('reports').select(cols).eq('status', want).order('created_at', { ascending: false }).limit(100);
    let res = await read(`${COLS}, snapshot`);
    if (res.error) res = await read(COLS);
    if (res.error) throw res.error;
    const data = (res.data ?? []) as unknown as Array<{ reporter_id: string; target_type: string; target_id: string | null }>;
    // 신고한 사람의 문제만 미리 보기로 붙인다 (번호가 이상하거나 남의 문제 번호면 건너뛴다)
    const qReports = data.filter((r) => r.target_type === 'question' && typeof r.target_id === 'string' && UUID_RE.test(r.target_id));
    const qIds = [...new Set(qReports.map((r) => r.target_id as string))];
    const questions: Record<string, unknown> = {};
    if (qIds.length) {
      const { data: qs } = await admin.from('questions').select('id, user_id, type, prompt, choices, answer, explanation, status, created_by').in('id', qIds);
      for (const q of qs ?? []) {
        if (!qReports.some((r) => r.target_id === q.id && r.reporter_id === q.user_id)) continue;
        questions[q.id] = {
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          choices: q.choices,
          answer: q.answer,
          explanation: q.explanation,
          status: q.status,
          created_by: q.created_by,
        };
      }
    }
    // 테마 그림 신고: 신고한 사람의 그림이 아직 있으면 잠깐 볼 수 있는 주소 (안 쓰는 그림은 매일 지워진다)
    const tReports = data.filter((r) => r.target_type === 'theme' && typeof r.target_id === 'string' && UUID_RE.test(r.target_id));
    const pictures: Record<string, string> = {};
    if (tReports.length) {
      const { data: imgs } = await admin
        .from('theme_images')
        .select('id, user_id, path')
        .in('id', [...new Set(tReports.map((r) => r.target_id as string))]);
      const mine = (imgs ?? []).filter((im) => tReports.some((r) => r.target_id === im.id && r.reporter_id === im.user_id));
      if (mine.length) {
        const { data: signed } = await admin.storage.from(THEME_IMAGES_BUCKET).createSignedUrls(
          mine.map((im) => im.path as string),
          3600,
        );
        mine.forEach((im, i) => {
          const url = signed?.[i]?.signedUrl;
          if (url) pictures[im.id] = url;
        });
      }
    }
    const share = await shareTargets(admin, data);
    const userIds = [...new Set(data.map((r) => r.reporter_id))];
    const users: Record<string, unknown> = {};
    if (userIds.length) {
      const { data: us } = await admin.from('profiles').select('id, email, nickname').in('id', userIds);
      for (const u of us ?? []) users[u.id] = u;
    }
    return Response.json({ ok: true, reports: data, questions, pictures, users, share });
  } catch (e) {
    return errorResponse(e);
  }
}
