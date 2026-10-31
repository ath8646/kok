// 내 데이터 내려받기 (JSON 한 파일)
import { requireAccount } from '@/lib/server/auth';
import { getFeatures } from '@/lib/server/account';
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
    const features = await getFeatures(admin);
    const [profile, subjects, sources, notes, visuals, questions, cards, reviewLogs, energy, reports] = await Promise.all([
      all(admin, 'profiles', 'id', u, `id, email, nickname, plan, pro_until${features.maxPlan ? ', max_until' : ''}, consented_at, settings, created_at`),
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
    // 자료 공유: 내가 쓴 글·댓글·파일 정보, 만든 갤러리, 좋아요·즐겨찾기·받은 글, 차단 목록 (차단한 사람의 계정 번호는 넣지 않는다: 익명 글쓴이를 알아내지 못하게)
    const community = features.community
      ? await Promise.all([
          all(
            admin,
            'community_posts',
            'author_id',
            u,
            'id, gallery_id, author_name, anonymous, title, body, has_files, has_note, hidden, edited_at, created_at',
          ),
          all(admin, 'community_comments', 'author_id', u, 'id, post_id, parent_id, author_name, anonymous, body, deleted, hidden, edited_at, created_at'),
          all(admin, 'community_files', 'owner_id', u, 'id, post_id, kind, name, size, pages, created_at'),
          all(admin, 'community_galleries', 'owner_id', u, 'id, name, description, category, created_at'),
          all(admin, 'community_likes', 'user_id', u, 'target_type, target_id, created_at', 'created_at'),
          all(admin, 'community_favs', 'user_id', u, 'gallery_id, created_at', 'created_at'),
          all(admin, 'community_downloads', 'user_id', u, 'post_id, created_at', 'created_at'),
          all(admin, 'community_blocks', 'user_id', u, 'label, created_at', 'created_at'),
        ]).then(([posts, comments, files, galleries, likes, favorites, downloads, blocks]) => ({
          posts,
          comments,
          files,
          galleries,
          likes,
          favorites,
          downloads,
          blocks,
        }))
      : null;
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
        ...(community ? { community } : {}),
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
