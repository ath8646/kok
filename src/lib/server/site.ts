// 공개 안내 문서에 보일 운영자 정보 (관리자 화면에서 정한다)
import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { DEFAULT_PLANS, type PlansConfig } from '@/lib/plans';
import { getAppSettings } from './account';

export async function getSiteInfo(): Promise<{ operatorName: string; contactEmail: string }> {
  try {
    const { data } = await adminClient().from('app_settings').select('value').eq('key', 'site').maybeSingle();
    const v = (data?.value ?? {}) as Record<string, unknown>;
    return {
      operatorName: typeof v.operatorName === 'string' && v.operatorName ? v.operatorName : 'KOK 운영자',
      contactEmail: typeof v.contactEmail === 'string' ? v.contactEmail : '',
    };
  } catch {
    return { operatorName: 'KOK 운영자', contactEmail: '' };
  }
}

/** 공개 안내 문서에 보일 요금제 숫자 (관리자가 고친 값, 읽지 못하면 처음 값) */
export async function getPublicPlans(): Promise<PlansConfig> {
  try {
    return (await getAppSettings(adminClient())).plans;
  } catch {
    return DEFAULT_PLANS;
  }
}
