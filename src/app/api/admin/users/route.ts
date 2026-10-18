// 관리자: 사용자 목록 (이메일·닉네임으로 찾기)
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';

export async function GET(req: NextRequest) {
  try {
    const { admin } = await requireAccount({ admin: true });
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60);
    const page = Math.max(0, Number(req.nextUrl.searchParams.get('page') ?? 0) || 0);
    let query = admin
      .from('profiles')
      .select('id, email, nickname, role, plan, pro_until, banned, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * 50, page * 50 + 49);
    if (q) {
      const safe = q.replace(/[%_,()*\\]/g, ' ');
      query = query.or(`email.ilike.%${safe}%,nickname.ilike.%${safe}%`);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    const now = Date.now();
    const users = (data ?? []).map((u) => ({ ...u, pro_active: u.plan === 'pro' && !!u.pro_until && Date.parse(u.pro_until) > now }));
    return Response.json({ ok: true, users, total: count ?? 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
