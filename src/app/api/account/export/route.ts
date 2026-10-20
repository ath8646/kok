// 내 데이터 내려받기 (JSON 한 파일)
import { requireAccount } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/errors';
import { kstDateString } from '@/lib/time';

export const maxDuration = 60;

async function all(admin: import('@supabase/supabase-js').SupabaseClient, table: string, column: string, userId: string, select = '*', order = 'id') {
  const out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .eq(column, userId)
      .order(order)
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function GET() {
  try {
    const { admin, acc } = await requireAccount({ consent: false });
    const u = acc.userId;
    const [profile, subjects, sources, notes, visuals, questions, cards, reviewLogs, energy, reports] = await Promise.all([
      all(admin, 'profiles', 'id', u, 'id, email, nickname, plan, pro_until, consented_at, settings, created_at'),
      all(admin, 'subjects', 'user_id', u),
      all(admin, 'sources', 'user_id', u, 'id, subject_id, kind, title, text_content, page_count, status, created_at'),
      all(admin, 'notes', 'user_id', u),
      all(admin, 'visuals', 'user_id', u),
      all(admin, 'questions', 'user_id', u),
      all(admin, 'cards', 'user_id', u, '*', 'question_id'),
      all(admin, 'review_logs', 'user_id', u),
      all(admin, 'energy_ledger', 'user_id', u, 'task, model, input_tokens, output_tokens, energy, created_at'),
      all(admin, 'reports', 'reporter_id', u),
    ]);
    const body = JSON.stringify(
      {
        app: 'KOK',
        exported_at: new Date().toISOString(),
        profile: profile[0] ?? null,
        subjects,
        sources,
        notes,
        visuals,
        questions,
        cards,
        review_logs: reviewLogs,
        energy,
        reports,
      },
      null,
      2,
    );
    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="kok-data-${kstDateString()}.json"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
