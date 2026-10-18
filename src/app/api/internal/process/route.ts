// 서버가 스스로 부르는 이어 달리기 (서명이 맞을 때만)
import { after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyInternal } from '@/lib/server/internal';
import { driveSource } from '@/lib/server/drive';

export const maxDuration = 300;

const Body = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'bad_body' }, { status: 400 });
  const { id } = parsed.data;
  if (!verifyInternal(id, req.headers.get('x-kok-internal'))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const origin = req.nextUrl.origin;
  after(() => driveSource(id, origin));
  return Response.json({ ok: true }, { status: 202 });
}
