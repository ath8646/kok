// 공개 안내 문서에 보일 운영자 정보 (관리자 화면에서 정한다)
import 'server-only';
import { adminClient } from '@/lib/supabase/admin';

export async function getSiteInfo(): Promise<{ operatorName: string; contactEmail: string }> {
  try {
    const { data } = await adminClient().from('app_settings').select('value').eq('key', 'site').maybeSingle();
    const v = (data?.value ?? {}) as Record<string, unknown>;
    return {
      operatorName: typeof v.operatorName === 'string' && v.operatorName ? v.operatorName : '콕 운영자',
      contactEmail: typeof v.contactEmail === 'string' ? v.contactEmail : '',
    };
  } catch {
    return { operatorName: '콕 운영자', contactEmail: '' };
  }
}
