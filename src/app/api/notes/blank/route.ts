// 빈 노트 만들기: AI 없이 내가 직접 채우는 노트 (에너지를 쓰지 않는다)
// 자료 행(글, 정리 끝)과 빈 노트를 만든다. 자료·노트는 서버만 만들 수 있다 (학생은 고치기만)
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, readJson, requireAccount } from '@/lib/server/auth';
import { getFeatures } from '@/lib/server/account';
import { UserFacingError, errorResponse } from '@/lib/server/errors';

const Body = z.object({
  subjectId: z.string().uuid(),
  title: z.string().max(200).catch(''),
  /** 단원 (AI 채팅에서 푼 문제를 새 노트에 넣을 때 고른 단원) */
  unit: z.string().max(80).catch(''),
  /** 이 노트의 문제를 복습에 넣을지 (없으면 넣는다) */
  review: z.boolean().optional(),
});

/** 한 시간에 만들 수 있는 빈 노트 수 (실수로 여러 번 눌러도 자료함이 넘치지 않게) */
const BLANK_PER_HOUR = 30;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { admin, acc } = await requireAccount();
    const parsed = Body.safeParse(await readJson(req, 4_000));
    if (!parsed.success) throw new UserFacingError('bad_body', '보낸 내용이 올바르지 않아요.', 400);
    const title = parsed.data.title.replace(/\s+/g, ' ').trim().slice(0, 120) || '새 노트';
    const unit = parsed.data.unit.replace(/\s+/g, ' ').trim().slice(0, 40);

    const { data: subject } = await admin.from('subjects').select('id').eq('id', parsed.data.subjectId).eq('user_id', acc.userId).maybeSingle();
    if (!subject) throw new UserFacingError('no_subject', '과목을 찾을 수 없어요.', 404);

    const { data: allowed, error: rErr } = await admin.rpc('kok_hit_rate', {
      p_user: acc.userId,
      p_max: BLANK_PER_HOUR,
      p_window_seconds: 3600,
      p_kind: 'blank_note',
    });
    if (rErr) throw rErr;
    if (!allowed) throw new UserFacingError('rate_limited', '빈 노트를 너무 많이 만들었어요. 조금 뒤에 다시 해 주세요.', 429);

    const id = crypto.randomUUID();
    // 복습에 넣지 않을 노트 (칸이 없는 예전 DB 면 넣지 않고 지금처럼 만든다)
    const keepOut = parsed.data.review === false && (await getFeatures(admin)).organize;
    const { error: sErr } = await admin.from('sources').insert({
      ...(keepOut ? { in_review: false } : {}),
      id,
      user_id: acc.userId,
      subject_id: subject.id,
      kind: 'text',
      title,
      unit,
      text_content: null,
      status: 'ready',
      step: 'done',
      progress: 100,
    });
    if (sErr) throw sErr;
    const body = {
      title,
      unit,
      summary: '',
      key_points: [],
      terms: [],
      formulas: [],
      pitfalls: [],
      examples: [],
      checks: [],
      changes: [],
      manual: true,
    };
    const { data: made, error: nErr } = await admin
      .from('notes')
      .insert({ user_id: acc.userId, source_id: id, subject_id: subject.id, title, body })
      .select('id')
      .single();
    if (nErr || !made) {
      // 노트를 못 만들었으면 빈 자료도 남기지 않는다
      await admin.from('sources').delete().eq('id', id);
      throw nErr ?? new Error('note insert failed');
    }
    return Response.json({ ok: true, id, noteId: made.id });
  } catch (e) {
    return errorResponse(e);
  }
}
