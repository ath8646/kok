// 자료함 정리 2 (자료 옮기기·과목 합치기·노트 합치기·AI로 다시 정리)의 서버 공통 처리
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatures, missingFunction } from './account';
import { UserFacingError } from './errors';

export const MERGE_SCHEMA_OUTDATED = '이 기능을 쓰려면 관리자가 Supabase 에서 schema.sql 을 다시 실행해야 해요.';

/** DB 에 새 함수가 있을 때만 (schema.sql 을 다시 실행하기 전에는 알려 주고 멈춘다) */
export async function assertMergeReady(admin: SupabaseClient): Promise<void> {
  if (!(await getFeatures(admin)).merge) throw new UserFacingError('schema_outdated', MERGE_SCHEMA_OUTDATED, 503);
}

/** DB 함수가 낸 오류 이름(raise exception '…')을 한국어 오류로. 모르는 오류는 그대로 돌려준다 (서버 오류로 남는다) */
export function dbError(error: { code?: string; message?: string }, messages: Record<string, readonly [string, number]>): unknown {
  if (missingFunction(error)) return new UserFacingError('schema_outdated', MERGE_SCHEMA_OUTDATED, 503);
  const key = Object.keys(messages).find((k) => (error.message ?? '').includes(k));
  if (key) return new UserFacingError(key, messages[key][0], messages[key][1]);
  return error;
}
