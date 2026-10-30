// 관리자: 신고함
import type { NextRequest } from 'next/server';
import { UUID_RE, requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { THEME_IMAGES_BUCKET } from '@/lib/server/themes';

const COLS = 'id, reporter_id, target_type, target_id, reason, status, created_at, resolved_at';

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
    const userIds = [...new Set(data.map((r) => r.reporter_id))];
    const users: Record<string, unknown> = {};
    if (userIds.length) {
      const { data: us } = await admin.from('profiles').select('id, email, nickname').in('id', userIds);
      for (const u of us ?? []) users[u.id] = u;
    }
    return Response.json({ ok: true, reports: data, questions, pictures, users });
  } catch (e) {
    return errorResponse(e);
  }
}
