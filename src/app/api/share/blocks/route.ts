// 차단: 닉네임으로 쓴 글이나 댓글의 글쓴이를 막으면 그 사람이 닉네임으로 쓴 글·댓글이 내 화면에서 빠진다.
// 익명으로 쓴 것은 차단할 수 없고 차단해도 빠지지 않는다: 차단으로 빠지는 익명 글을 보면 익명 글쓴이를 알아낼 수 있어서 (문제가 있으면 신고).
// 계정 번호는 화면에 보내지 않는다: 차단 목록은 차단할 때 보인 이름과 풀기 번호만
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { loadPost, requireCommunity } from '@/lib/server/share';

const BLOCKS_MAX = 500;

export async function GET() {
  try {
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const { data, error } = await admin
      .from('community_blocks')
      .select('id, label, created_at')
      .eq('user_id', acc.userId)
      .order('created_at', { ascending: false })
      .limit(BLOCKS_MAX);
    if (error) throw error;
    return Response.json(
      { ok: true, blocks: (data ?? []).map((b) => ({ id: b.id, label: b.label || '이름 없음', at: b.created_at })) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.union([z.object({ post: z.string().uuid() }), z.object({ comment: z.string().uuid() })]);

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const parsed = Body.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    let who: string;
    let label: string;
    let anonymous: boolean;
    if ('post' in parsed.data) {
      const p = await loadPost(admin, parsed.data.post);
      who = p.author_id;
      label = p.author_name;
      anonymous = p.anonymous;
    } else {
      const { data: c, error } = await admin
        .from('community_comments')
        .select('author_id, author_name, anonymous, deleted')
        .eq('id', parsed.data.comment)
        .maybeSingle();
      if (error) throw error;
      if (!c || c.deleted) throw new UserFacingError('not_found', '댓글을 찾을 수 없어요.', 404);
      who = String(c.author_id);
      label = String(c.author_name);
      anonymous = !!c.anonymous;
    }
    if (anonymous) throw new UserFacingError('anonymous', '익명으로 쓴 글과 댓글은 차단할 수 없어요. 문제가 있으면 신고해 주세요.', 400);
    if (who === acc.userId) throw new UserFacingError('self', '나를 차단할 수는 없어요.', 400);
    const { count } = await admin.from('community_blocks').select('id', { count: 'exact', head: true }).eq('user_id', acc.userId);
    if ((count ?? 0) >= BLOCKS_MAX) throw new UserFacingError('block_limit', `차단은 ${BLOCKS_MAX}명까지예요.`, 400);
    const { error } = await admin
      .from('community_blocks')
      .upsert({ user_id: acc.userId, blocked_id: who, label: label.slice(0, 40) }, { onConflict: 'user_id,blocked_id', ignoreDuplicates: true });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

const Del = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const parsed = Del.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const { error } = await admin.from('community_blocks').delete().eq('user_id', acc.userId).eq('id', parsed.data.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
