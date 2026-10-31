// 자료 공유 신고: 글·댓글·갤러리 (Google Play UGC 정책: 앱 안에서 신고, 운영자가 처리). 신고할 때의 내용을 운영자용으로 남긴다.
// snapshot 은 신고한 사람도 읽을 수 있어서 (reports 표 select) 계정 번호를 남기지 않는다: 실제 글쓴이는 운영자 신고함이 그때 읽는다.
// 서로 다른 사람의 신고가 SHARE_HIDE_AT 개 쌓이면 운영자가 볼 때까지 가린다. 내 것은 신고할 수 없고, 같은 것을 두 번 신고해도 한 번만 남는다
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { assertVisible, loadGallery, loadPost, requireCommunity } from '@/lib/server/share';
import { clipSnapshot, REPORT_REASON_MAX } from '@/lib/report';
import { SHARE_HIDE_AT, SHARE_REPORT_KINDS } from '@/lib/share';

const Body = z.object({ kind: z.enum(SHARE_REPORT_KINDS), id: z.string().uuid(), reason: z.string().trim().min(1).max(REPORT_REASON_MAX) });
const REPORTS_PER_DAY = 100;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    await requireCommunity(admin);
    const parsed = Body.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '신고하는 까닭을 골라 주세요.', 400);
    const { kind, id, reason } = parsed.data;
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await admin.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', acc.userId).gte('created_at', since);
    if ((count ?? 0) >= REPORTS_PER_DAY) throw new UserFacingError('too_many_reports', '오늘은 신고를 더 보낼 수 없어요. 내일 다시 보내 주세요.', 429);

    // 신고할 것과 운영자가 볼 내용 (이름은 화면에 보이던 그대로: 익명 글은 '익명')
    let owner: string | null = null;
    let lines: string[];
    if (kind === 'post') {
      const p = await loadPost(admin, id);
      assertVisible(p, acc);
      owner = p.author_id;
      lines = [`글: ${p.title}`, `글쓴이: ${p.anonymous ? '익명' : p.author_name}`, p.body.slice(0, 2500)];
    } else if (kind === 'comment') {
      const { data: c, error } = await admin
        .from('community_comments')
        .select('id, post_id, author_id, author_name, anonymous, body, deleted, hidden')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!c || c.deleted) throw new UserFacingError('not_found', '댓글을 찾을 수 없어요.', 404);
      const p = await loadPost(admin, String(c.post_id));
      assertVisible(p, acc);
      owner = String(c.author_id);
      if (c.hidden && owner !== acc.userId) throw new UserFacingError('hidden', '신고가 쌓여 가려진 댓글이에요. 운영자가 확인하고 있어요.', 404);
      lines = [`글: ${p.title}`, `글 번호: ${c.post_id}`, `댓글쓴이: ${c.anonymous ? '익명' : c.author_name}`, String(c.body)];
    } else {
      const g = await loadGallery(admin, id);
      owner = g.owner_id;
      lines = [`갤러리: ${g.name}`, `만든 사람: ${g.owner_id ? '이용자' : '운영자'}`, g.description];
    }
    if (owner && owner === acc.userId) throw new UserFacingError('own', '내가 쓴 것은 신고할 수 없어요. 고치거나 지울 수 있어요.', 400);
    const type = `share_${kind}`;
    const { data: dup } = await admin
      .from('reports')
      .select('id')
      .eq('reporter_id', acc.userId)
      .eq('target_type', type)
      .eq('target_id', id)
      .eq('status', 'open')
      .limit(1);
    if (dup?.length) return Response.json({ ok: true });
    const { error: iErr } = await admin
      .from('reports')
      .insert({ reporter_id: acc.userId, target_type: type, target_id: id, reason, snapshot: clipSnapshot(lines.filter(Boolean).join('\n')) });
    if (iErr) {
      if (iErr.code === '23514') throw new UserFacingError('schema_outdated', '신고를 받을 준비가 아직 안 됐어요. 잠시 뒤에 다시 해 주세요.', 503);
      throw iErr;
    }
    // 서로 다른 사람의 신고가 쌓이면 운영자가 볼 때까지 가린다 (새 신고가 들어왔을 때만: 운영자가 다시 보이게 하면 그때까지의 신고는 기각된다)
    if (kind !== 'gallery') {
      const { data: open } = await admin.from('reports').select('reporter_id').eq('target_type', type).eq('target_id', id).eq('status', 'open').limit(200);
      if (new Set((open ?? []).map((r) => String(r.reporter_id))).size >= SHARE_HIDE_AT) {
        await admin
          .from(kind === 'post' ? 'community_posts' : 'community_comments')
          .update({ hidden: true })
          .eq('id', id);
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
