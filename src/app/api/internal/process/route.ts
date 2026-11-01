// 서버가 스스로 부르는 이어 달리기 (서명이 맞을 때만)
import { after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyInternal } from '@/lib/server/internal';
import { driveSource } from '@/lib/server/drive';

export const maxDuration = 300;

/** tries: 서버 오류로 다시 부른 수, wait: 앞 요청이 멈춘 것을 알고 부름 (잠금이 풀릴 때까지 기다렸다가 잇는다) */
const Body = z.object({ id: z.string().uuid(), tries: z.number().int().min(0).max(20).optional(), wait: z.boolean().optional() });

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'bad_body' }, { status: 400 });
  const { id, tries, wait } = parsed.data;
  if (!verifyInternal(id, req.headers.get('x-kok-internal'))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const origin = req.nextUrl.origin;
  after(() => driveSource(id, origin, startedAt, { tries, wait }));
  return Response.json({ ok: true }, { status: 202 });
}
