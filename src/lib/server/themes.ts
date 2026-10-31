// 테마 (Pro) 서버 일: 쓸 수 있는지, 하루 한도, 그림 저장·검사, AI 그림(Cloudflare → AI 무늬 → 코드 무늬)
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Account, AppSettings } from './account';
import { assertPerk, getFeatures } from './account';
import { UserFacingError } from './errors';
import { cloudflareReady, generateImage, ImageGenError } from './cloudflare';
import { sniffImage } from '@/lib/themes/image-sniff';
import { CODE_PATTERNS, codePatternSvg } from '@/lib/themes/pattern';
import { mix } from '@/lib/themes/colors';
import { MAX_THEMES, readSpec, type ThemeImage, type ThemeSpec } from '@/lib/themes/spec';

export const THEME_IMAGES_BUCKET = 'theme-images';
/** 한 사람이 둘 수 있는 그림 수 (안 쓰는 그림은 매일 청소가 지운다) */
export const MAX_IMAGES = 60;
/** 올리는 그림 한 장의 최대 크기 (화면은 올리기 전에 줄여서 보낸다) */
export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 4096;
/** 하루 한도 (한 사람) */
export const AI_THEMES_PER_DAY = 10;
export const AI_IMAGES_PER_DAY = 10;
export const UPLOADS_PER_DAY = 20;
/** 하루 한도 (서비스 전체): Cloudflare 무료 몫(하루 10,000 뉴런 ≈ 그림 170장) 안에서 */
export const CF_IMAGES_PER_DAY = 150;
/** 덮기 정도 기본값: 사진·AI 그림은 진하게, 무늬는 옅게 (화면은 글자가 잘 보이게 더 올릴 수 있다: themes/backdrop.ts) */
export const DIM_IMAGE = 0.8;
export const DIM_PATTERN = 0.3;
/** 테마 만들기·고치기 횟수 (한 사람, 1시간) */
export const THEME_WRITES_PER_HOUR = 120;

const SCHEMA_OUTDATED = '테마를 만들려면 관리자가 Supabase 에서 schema.sql 을 다시 실행해야 해요.';

/** 테마를 만들고 고칠 수 있는지 (테마 혜택, 새 표가 있는지). ai: AI 로 테마·그림을 만드는 일이면 AI 테마 혜택도 */
export async function requireThemes(admin: SupabaseClient, acc: Account, opts: { ai?: boolean } = {}): Promise<void> {
  if (!(await getFeatures(admin)).themes) throw new UserFacingError('schema_outdated', SCHEMA_OUTDATED, 503);
  assertPerk(acc, 'theme');
  if (opts.ai) assertPerk(acc, 'aiTheme', 'AI로 테마 만들기');
}

/** 하루 한도 (24시간 안 횟수): 하나 쓰고, 다 썼으면 오류 */
export async function hitDaily(admin: SupabaseClient, userId: string, kind: string, max: number, message: string): Promise<void> {
  await hitRate(admin, userId, kind, max, 86400, message);
}

export async function hitRate(admin: SupabaseClient, userId: string, kind: string, max: number, windowSeconds: number, message: string): Promise<void> {
  const { data, error } = await admin.rpc('kok_hit_rate', { p_user: userId, p_max: max, p_window_seconds: windowSeconds, p_kind: kind });
  if (error) throw error;
  if (data === false) throw new UserFacingError('daily_limit', message, 429);
}

/** 하루 한도가 남았는지만 본다 (쓰지 않는다: AI 를 부르기 전에 미리 막을 때) */
export async function dailyLeft(admin: SupabaseClient, userId: string, kind: string, max: number): Promise<boolean> {
  const { count, error } = await admin
    .from('rate_hits')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('kind', kind)
    .gte('at', new Date(Date.now() - 86400_000).toISOString());
  if (error) throw error;
  return (count ?? 0) < max;
}

/** 다 끝난 뒤에 하루 한도를 하나 쓴다 (AI 가 거절하거나 실패하면 쓰지 않게) */
export async function recordHit(admin: SupabaseClient, userId: string, kind: string): Promise<void> {
  const { error } = await admin.from('rate_hits').insert({ user_id: userId, kind });
  if (error) console.warn('[kok] rate hit not recorded', error.message);
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/** 서비스 전체 오늘 AI 그림 몫이 남았는지 (쓰지 않는다) */
async function serviceRoomLeft(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.from('app_counters').select('n').eq('day', utcDay()).eq('kind', 'cf_image').maybeSingle();
  if (error) throw error;
  return Number(data?.n ?? 0) < CF_IMAGES_PER_DAY;
}

/** Cloudflare 가 오늘 몫을 다 썼다고 하면 오늘은 더 부르지 않게 채워 둔다 */
async function fillServiceRoom(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.from('app_counters').upsert({ day: utcDay(), kind: 'cf_image', n: CF_IMAGES_PER_DAY }, { onConflict: 'day,kind' });
  if (error) console.warn('[kok] cf counter not filled', error.message);
}

export type PictureRoom = 'ok' | 'not_configured' | 'mine' | 'quota';

/** 지금 AI 그림을 그릴 수 있는지 (몫을 쓰지 않고 본다) */
export async function pictureRoom(admin: SupabaseClient, userId: string): Promise<PictureRoom> {
  if (!cloudflareReady()) return 'not_configured';
  if (!(await dailyLeft(admin, userId, 'theme_image', AI_IMAGES_PER_DAY))) return 'mine';
  if (!(await serviceRoomLeft(admin))) return 'quota';
  return 'ok';
}

/** AI 그림(Cloudflare, 에너지 없음)도 관리자가 AI 를 쉬게 했거나 막힌 계정이면 그리지 않는다 */
export function assertPicturesAllowed(acc: Account, app: AppSettings): void {
  if (acc.banned) throw new UserFacingError('banned', '이 계정은 AI 기능을 쓸 수 없어요. 관리자에게 문의해 주세요.', 403);
  if (!app.aiEnabled && !acc.isAdmin) throw new UserFacingError('ai_paused', '지금은 AI 기능을 잠깐 쉬고 있어요.', 503);
}

/** 테마 행을 넣다가 DB 가 한도(20개)를 넘는다고 하면 알아듣는 말로 */
export function themeInsertError(error: { message?: string }): Error {
  if (/kok_theme_limit/.test(error.message ?? '')) {
    return new UserFacingError('too_many_themes', `테마는 ${MAX_THEMES}개까지 만들 수 있어요. 안 쓰는 테마를 지워 주세요.`, 400);
  }
  return error as Error;
}

/** 테마 만들기·고치기 횟수 제한 */
export async function hitThemeWrites(admin: SupabaseClient, userId: string): Promise<void> {
  await hitRate(admin, userId, 'theme_write', THEME_WRITES_PER_HOUR, 3600, '테마를 너무 자주 바꿨어요. 잠시 뒤에 다시 해 주세요.');
}

export async function assertThemeRoom(admin: SupabaseClient, userId: string): Promise<void> {
  const { count, error } = await admin.from('user_themes').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw error;
  if ((count ?? 0) >= MAX_THEMES) throw new UserFacingError('too_many_themes', `테마는 ${MAX_THEMES}개까지 만들 수 있어요. 안 쓰는 테마를 지워 주세요.`, 400);
}

/** 테마가 쓰는 그림이 내 것인지 */
export async function assertOwnImage(admin: SupabaseClient, userId: string, image: ThemeImage | null): Promise<void> {
  if (!image || image.kind !== 'file') return;
  const { data, error } = await admin.from('theme_images').select('id').eq('id', image.id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError('image_not_found', '그림을 찾을 수 없어요. 다시 넣어 주세요.', 404);
}

/** 내 테마 하나 (없거나 남의 것이면 404) */
export async function loadOwnTheme(
  admin: SupabaseClient,
  userId: string,
  id: string,
): Promise<{ id: string; name: string; spec: ThemeSpec; updatedAt: string }> {
  const { data, error } = await admin.from('user_themes').select('id, user_id, name, spec, updated_at').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== userId) throw new UserFacingError('not_found', '테마를 찾을 수 없어요.', 404);
  const spec = readSpec(data.spec);
  if (!spec) throw new UserFacingError('bad_theme', '테마 모양이 이상해요. 지우고 다시 만들어 주세요.', 400);
  return { id: data.id as string, name: data.name as string, spec, updatedAt: data.updated_at as string };
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** 안 쓰는 오래된 그림부터 지워 자리를 만든다 (못 만들면 오류) */
async function makeImageRoom(admin: SupabaseClient, userId: string): Promise<void> {
  const { count, error } = await admin.from('theme_images').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw error;
  if ((count ?? 0) < MAX_IMAGES) return;
  const removed = await sweepUnusedImages(admin, { userId, olderThanMs: 0, limit: 10 });
  if (!removed) throw new UserFacingError('too_many_images', '그림이 너무 많아요. 안 쓰는 테마를 지워 주세요.', 400);
}

/** 그림 바이트를 검사하고 저장한다 → 그림 번호 */
export async function storeThemeImage(
  admin: SupabaseClient,
  userId: string,
  bytes: Uint8Array,
  opts: { kind: 'upload' | 'ai'; prompt?: string | null },
): Promise<string> {
  const info = sniffImage(bytes);
  if (!info) throw new UserFacingError('bad_image', 'JPG·PNG·WebP 그림만 넣을 수 있어요.', 400);
  if (bytes.length > UPLOAD_MAX_BYTES) throw new UserFacingError('image_too_big', '그림이 너무 커요. 3MB보다 작은 그림을 넣어 주세요.', 413);
  if (info.width > IMAGE_MAX_SIDE || info.height > IMAGE_MAX_SIDE || info.width < 16 || info.height < 16) {
    throw new UserFacingError('bad_image_size', '그림 크기가 맞지 않아요. 다른 그림을 넣어 주세요.', 400);
  }
  await makeImageRoom(admin, userId);
  const id = randomUUID();
  const path = `${userId}/${id}.${EXT[info.mime]}`;
  const up = await admin.storage.from(THEME_IMAGES_BUCKET).upload(path, bytes, { contentType: info.mime, upsert: false });
  if (up.error) throw up.error;
  const { error } = await admin.from('theme_images').insert({
    id,
    user_id: userId,
    kind: opts.kind,
    path,
    mime: info.mime,
    bytes: bytes.length,
    width: info.width,
    height: info.height,
    prompt: opts.prompt ? opts.prompt.slice(0, 600) : null,
  });
  if (error) {
    await admin.storage.from(THEME_IMAGES_BUCKET).remove([path]);
    throw error;
  }
  return id;
}

/** 코드로 만든 무늬 (AI 그림을 못 쓸 때). 설명 글로 무늬 모양을 골라 같은 설명이면 같은 무늬 */
export function fallbackPattern(spec: Pick<ThemeSpec, 'light'>, seedText: string): ThemeImage {
  let h = 0;
  for (const ch of seedText) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  const kind = CODE_PATTERNS[h % CODE_PATTERNS.length];
  return { kind: 'pattern', svg: codePatternSvg(kind, spec.light.accent, mix(spec.light.accent, '#ffffff', 0.45), h || 1) };
}

/**
 * AI 배경 그림: Cloudflare(무료 몫 안에서) → 실패하면 null (부르는 쪽이 무늬로 바꾼다).
 * 한 사람 하루 한도는 그림을 실제로 그릴 때만 센다.
 */
export type ImageFail = 'not_configured' | 'quota' | 'mine' | 'refused' | 'full' | 'failed';

export async function makeAiImage(
  admin: SupabaseClient,
  acc: Account,
  prompt: string,
  opts: { strictDaily?: boolean } = {},
): Promise<{ id: string } | { fail: ImageFail }> {
  if (!cloudflareReady()) return { fail: 'not_configured' };
  const clean = prompt.replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!clean) return { fail: 'failed' };
  // 한 사람 하루 한도: 그림만 그려 달라고 했으면 알리고, 테마를 만드는 중이면 무늬로 바꾼다
  try {
    await hitDaily(admin, acc.userId, 'theme_image', AI_IMAGES_PER_DAY, `AI 그림은 하루 ${AI_IMAGES_PER_DAY}번까지 그릴 수 있어요. 내일 다시 해 주세요.`);
  } catch (e) {
    if (!opts.strictDaily && e instanceof UserFacingError && e.code === 'daily_limit') return { fail: 'mine' };
    throw e;
  }
  const { data: room, error } = await admin.rpc('kok_bump_counter', { p_kind: 'cf_image', p_max: CF_IMAGES_PER_DAY });
  if (error) throw error;
  if (room === false) return { fail: 'quota' };
  try {
    const bytes = await generateImage(clean, { timeoutMs: 35_000 });
    const id = await storeThemeImage(admin, acc.userId, bytes, { kind: 'ai', prompt: clean });
    return { id };
  } catch (e) {
    if (e instanceof ImageGenError) {
      // Cloudflare 가 오늘 몫을 다 썼다고 하면, 오늘은 다른 사람도 부르지 않게 (몫은 UTC 0시에 다시 찬다)
      if (e.kind === 'quota') await fillServiceRoom(admin);
      return { fail: e.kind };
    }
    // 그림은 그렸는데 저장하지 못함 (그림이 너무 많음 등): 테마는 무늬로 마저 만든다
    if (e instanceof UserFacingError) return { fail: e.code === 'too_many_images' ? 'full' : 'failed' };
    console.warn('[kok] ai image store failed', (e as Error).message);
    return { fail: 'failed' };
  }
}

/** AI 그림을 못 그렸을 때 알릴 말 */
export function imageFailNote(fail: ImageFail): string {
  switch (fail) {
    case 'quota':
      return '오늘 AI 그림 몫을 다 써서 무늬를 대신 넣었어요. 내일 다시 그릴 수 있어요.';
    case 'mine':
      return `AI 그림은 하루 ${AI_IMAGES_PER_DAY}번까지라 무늬를 대신 넣었어요. 내일 다시 그릴 수 있어요.`;
    case 'full':
      return '그림이 너무 많아서 무늬를 대신 넣었어요. 안 쓰는 테마를 지우면 다시 그릴 수 있어요.';
    case 'refused':
      return '이 설명으로는 그림을 그릴 수 없어서 무늬를 대신 넣었어요.';
    case 'not_configured':
      return 'AI 그림을 아직 쓸 수 없어서 무늬를 넣었어요.';
    default:
      return 'AI 그림을 그리지 못해서 무늬를 대신 넣었어요.';
  }
}

/**
 * 안 쓰는 그림 지우기: 어느 테마도 쓰지 않는 그림 (olderThanMs 보다 오래된 것만, 새로 올리고 아직 저장하지 않은 그림은 두게).
 * userId 를 주면 그 사람 것만. 행은 DB 가 한 번에 골라 지우고(kok_take_unused_theme_images), 파일은 여기서 지운다. 지운 수
 */
export async function sweepUnusedImages(admin: SupabaseClient, opts: { userId?: string; olderThanMs: number; limit: number }): Promise<number> {
  const { data, error } = await admin.rpc('kok_take_unused_theme_images', {
    p_before: new Date(Date.now() - opts.olderThanMs).toISOString(),
    p_user: opts.userId ?? null,
    p_limit: opts.limit,
  });
  if (error) throw error;
  const paths = ((data ?? []) as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (!paths.length) return 0;
  const { error: rmErr } = await admin.storage.from(THEME_IMAGES_BUCKET).remove(paths);
  // 파일을 못 지워도 학생에게는 보이지 않는다 (탈퇴할 때 폴더째 지운다)
  if (rmErr) console.warn('[kok] unused theme image files not removed', rmErr.message);
  return paths.length;
}
