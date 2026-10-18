// 서버가 자기 자신을 부를 때 쓰는 서명 (자료 처리 이어 달리기)
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

function key(): Buffer {
  const s = process.env.SUPABASE_SECRET_KEY;
  if (!s) throw new Error('SUPABASE_SECRET_KEY 가 없어요.');
  return createHmac('sha256', s).update('kok-internal-v1').digest();
}

export function signInternal(id: string, ts: number = Date.now()): string {
  const mac = createHmac('sha256', key()).update(`${id}.${ts}`).digest('base64url');
  return `${ts}.${mac}`;
}

export function verifyInternal(id: string, token: string | null, maxAgeMs = 10 * 60_000): boolean {
  if (!token) return false;
  const [tsRaw, mac] = token.split('.');
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || !mac) return false;
  if (Math.abs(Date.now() - ts) > maxAgeMs) return false;
  const expected = createHmac('sha256', key()).update(`${id}.${ts}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
