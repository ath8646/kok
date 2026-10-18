// 관리자: 신고함
import type { NextRequest } from 'next/server';
import { UUID_RE, requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';

export async function GET(req: NextRequest) {
  try {
    const { admin } = await requireAccount({ admin: true });
    const status = req.nextUrl.searchParams.get('status') ?? 'open';
    const { data, error } = await admin
      .from('reports')
      .select('id, reporter_id, target_type, target_id, reason, status, created_at, resolved_at')
      .eq('status', ['open', 'resolved', 'dismissed'].includes(status) ? status : 'open')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    // 신고한 사람의 문제만 미리 보기로 붙인다 (번호가 이상하거나 남의 문제 번호면 건너뛴다)
    const qReports = (data ?? []).filter((r) => r.target_type === 'question' && typeof r.target_id === 'string' && UUID_RE.test(r.target_id));
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
    const userIds = [...new Set((data ?? []).map((r) => r.reporter_id))];
    const users: Record<string, unknown> = {};
    if (userIds.length) {
      const { data: us } = await admin.from('profiles').select('id, email, nickname').in('id', userIds);
      for (const u of us ?? []) users[u.id] = u;
    }
    return Response.json({ ok: true, reports: data ?? [], questions, users });
  } catch (e) {
    return errorResponse(e);
  }
}
