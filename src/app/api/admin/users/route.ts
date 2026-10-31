// 관리자: 사용자 목록 (이메일·닉네임으로 찾기)
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';

export async function GET(req: NextRequest) {
  try {
    const { admin } = await requireAccount({ admin: true });
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60);
    const page = Math.max(0, Number(req.nextUrl.searchParams.get('page') ?? 0) || 0);
    // '*' 로 읽는다: schema.sql 을 다시 실행하기 전(테스트 플랜 칸이 없을 때)에도 목록이 보이게
    let query = admin
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * 50, page * 50 + 49);
    if (q) {
      const safe = q.replace(/[%_,()*\\]/g, ' ');
      query = query.or(`email.ilike.%${safe}%,nickname.ilike.%${safe}%`);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    const now = Date.now();
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const customActive = (u: Record<string, unknown>) => !!u.custom_plan_id && typeof u.custom_plan_until === 'string' && Date.parse(u.custom_plan_until) > now;
    // 켜져 있는 테스트 플랜 이름
    const planIds = [...new Set(rows.filter(customActive).map((u) => String(u.custom_plan_id)))];
    const names = new Map<string, string>();
    if (planIds.length) {
      const { data: plans } = await admin.from('custom_plans').select('id, name').in('id', planIds);
      for (const p of plans ?? []) names.set(String(p.id), String(p.name));
    }
    const users = rows.map((u) => {
      const active = customActive(u) && names.has(String(u.custom_plan_id));
      return {
        id: u.id,
        email: u.email ?? null,
        provider: u.provider ?? null,
        nickname: u.nickname ?? null,
        role: u.role ?? 'student',
        plan: u.plan ?? 'free',
        pro_until: u.pro_until ?? null,
        max_until: u.max_until ?? null,
        banned: !!u.banned,
        created_at: u.created_at ?? null,
        pro_active: u.plan === 'pro' && typeof u.pro_until === 'string' && Date.parse(u.pro_until) > now,
        max_active: typeof u.max_until === 'string' && Date.parse(u.max_until) > now,
        custom_plan: active ? { id: String(u.custom_plan_id), name: names.get(String(u.custom_plan_id))!, until: String(u.custom_plan_until) } : null,
      };
    });
    return Response.json({ ok: true, users, total: count ?? 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
