// '이상해요' 신고: AI 가 만든 노트·채팅 답·표지 그림·테마 그림·레슨 (문제 신고는 고친 문제를 같이 받는 /api/questions/[id]/report).
// Google Play 의 AI 생성 콘텐츠 정책(앱 안에서 신고)과 인공지능기본법(이용자 보호)에 맞춰 AI 결과가 보이는 곳마다 둔다.
// - 신고할 때 본 결과(snapshot)는 서버가 DB 에서 읽어 함께 남긴다: 나중에 바뀌거나 지워져도 운영자가 볼 수 있게.
//   저장하지 않는 것(홈 채팅 답·복습 칸의 문제)만 화면이 보낸 글을 쓴다. 남의 것을 가리키면 거절한다
// - 서버가 넣으면 DB 의 하루 100개 검사(reports_guard)를 건너뛰어서 여기서 센다
// - 예전 DB(새 종류·snapshot 칸이 없다: schema.sql 을 다시 실행하기 전)면 'other' 로 넣고 결과는 이유 글 끝에 붙인다
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { UUID_RE, assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { UserFacingError, errorResponse } from '@/lib/server/errors';
import { readCoursePlan } from '@/lib/course';
import { readCover } from '@/lib/cover';
import {
  REPORT_KINDS,
  REPORT_REASON_MAX,
  chatSnapshot,
  clipSnapshot,
  coverSnapshot,
  legacyReportReason,
  lessonSnapshot,
  storedChatSolution,
  type ReportKind,
} from '@/lib/report';

const Body = z.object({
  kind: z.enum(REPORT_KINDS),
  target: z.string().trim().max(100).optional(),
  reason: z.string().trim().min(1).max(REPORT_REASON_MAX),
  snapshot: z.string().max(8000).optional(),
});

/** 하루에 보낼 수 있는 신고 (DB 의 reports_guard 와 같게) */
const REPORTS_PER_DAY = 100;

const notFound = () => new UserFacingError('not_found', '신고할 것을 찾지 못했어요. 화면을 새로 열고 다시 해 주세요.', 404);

/** 가리킨 것이 내 것인지 보고, 운영자가 읽을 결과를 만든다. targetId 는 DB 에 남길 번호 */
async function resolve(
  admin: SupabaseClient,
  uid: string,
  kind: ReportKind,
  target: string | undefined,
  given: string | undefined,
): Promise<{ targetId: string | null; snapshot: string | null }> {
  const fromClient = given?.trim() ? clipSnapshot(given) : null;
  if (kind === 'note') {
    if (!target || !UUID_RE.test(target)) throw notFound();
    const { data } = await admin.from('notes').select('id, title').eq('id', target).eq('user_id', uid).maybeSingle();
    if (!data) throw notFound();
    return { targetId: data.id, snapshot: clipSnapshot(`노트: ${data.title ?? ''}`) };
  }
  if (kind === 'chat') {
    // 홈 채팅은 대화를 저장하지 않는다: 화면이 보낸 답을 그대로 남긴다
    if (!target) return { targetId: 'home', snapshot: fromClient };
    if (!UUID_RE.test(target)) throw notFound();
    const { data: m } = await admin.from('chat_messages').select('id, note_id, role, content, created_at').eq('id', target).eq('user_id', uid).maybeSingle();
    if (!m || m.role !== 'assistant') throw notFound();
    // 풀이 칸은 schema.sql 을 다시 실행하기 전에는 없다
    const { data: withSolution } = await admin.from('chat_messages').select('solution').eq('id', m.id).maybeSingle();
    const { data: asked } = await admin
      .from('chat_messages')
      .select('content')
      .eq('note_id', m.note_id)
      .eq('user_id', uid)
      .eq('role', 'user')
      .lte('created_at', m.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const solution = withSolution ? storedChatSolution((withSolution as { solution?: unknown }).solution) : null;
    return { targetId: m.id, snapshot: chatSnapshot({ question: asked?.content ?? null, reply: m.content, solution }) };
  }
  if (kind === 'cover') {
    if (!target || !UUID_RE.test(target)) throw notFound();
    const { data } = await admin.from('sources').select('id, title, cover').eq('id', target).eq('user_id', uid).maybeSingle();
    if (!data) throw notFound();
    return { targetId: data.id, snapshot: coverSnapshot(data.title ?? '', readCover(data.cover)) };
  }
  if (kind === 'theme') {
    // AI 가 그린 테마 그림 (theme_images 번호)
    if (!target || !UUID_RE.test(target)) throw notFound();
    const { data } = await admin.from('theme_images').select('id, kind, path, prompt').eq('id', target).eq('user_id', uid).maybeSingle();
    if (!data) throw notFound();
    const lines = [
      `테마 그림 (${data.kind === 'ai' ? 'AI가 그림' : '올린 사진'})`,
      data.prompt ? `그림 설명(AI에게 보낸 것): ${data.prompt}` : '',
      `파일: ${data.path}`,
    ];
    return { targetId: data.id, snapshot: clipSnapshot(lines.filter(Boolean).join('\n')) };
  }
  // course: '노트번호:l-단계-레슨' (레슨) 또는 '노트번호:r-단계'·'노트번호:final' (복습: 레슨의 문제를 뽑아 낸 것)
  const m = /^([0-9a-f-]{36}):(l-(\d{1,3})-(\d{1,3})|r-\d{1,3}|final)$/i.exec(target ?? '');
  if (!m || !UUID_RE.test(m[1])) throw notFound();
  const { data: course } = await admin.from('note_courses').select('note_id, level, plan').eq('note_id', m[1]).eq('user_id', uid).maybeSingle();
  if (!course) throw notFound();
  const lesson = m[3] !== undefined ? readCoursePlan(course.plan)?.units[Number(m[3])]?.lessons[Number(m[4])] : undefined;
  const parts = [`수준: ${course.level}`, lesson ? lessonSnapshot(lesson) : '', fromClient ?? ''].filter(Boolean);
  return { targetId: `${m[1]}:${m[2]}`, snapshot: clipSnapshot(parts.join('\n')) };
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 40_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '무엇이 이상한지 골라 주세요.', 400);
    const { kind, target, reason, snapshot: given } = parsed.data;

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await admin.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', acc.userId).gte('created_at', since);
    if ((count ?? 0) >= REPORTS_PER_DAY) throw new UserFacingError('too_many_reports', '오늘은 신고를 더 보낼 수 없어요. 내일 다시 보내 주세요.', 429);

    const { targetId, snapshot } = await resolve(admin, acc.userId, kind, target, given);
    const { error } = await admin.from('reports').insert({ reporter_id: acc.userId, target_type: kind, target_id: targetId, reason, snapshot });
    if (error) {
      // 23514 = 예전 종류 검사, 42703·PGRST204 = snapshot 칸이 없다 (schema.sql 을 다시 실행하기 전)
      if (error.code !== '23514' && error.code !== '42703' && error.code !== 'PGRST204') throw error;
      const { error: e2 } = await admin.from('reports').insert({
        reporter_id: acc.userId,
        target_type: 'other',
        target_id: `${kind}:${targetId ?? ''}`.slice(0, 100),
        reason: legacyReportReason(kind, reason, snapshot),
      });
      if (e2) throw e2;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
