'use client';
// 원본에서 잘라 둔 자료 그림의 주소 (비공개 저장소라 잠깐 쓰는 서명 주소). 같은 그림은 한 번만 받아 50분 동안 다시 쓴다.
// 한 화면에 그림이 여럿이면 같은 순간에 부른 것을 한 번에 받는다 (createSignedUrls)
import { useEffect, useState } from 'react';
import { sb } from '@/lib/data';

const cache = new Map<string, { url: string; until: number }>();
const pending = new Map<string, Promise<string | null>>();
let queue: Array<{ path: string; done: (url: string | null) => void }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function fresh(path: string): string | null {
  const hit = cache.get(path);
  return hit && hit.until > Date.now() ? hit.url : null;
}

async function flush() {
  const batch = queue;
  queue = [];
  timer = null;
  const urls = new Map<string, string>();
  try {
    const { data, error } = await sb()
      .storage.from('sources')
      .createSignedUrls(
        batch.map((b) => b.path),
        3600,
      );
    if (!error) {
      for (const d of data ?? []) {
        if (d.path && !d.error && d.signedUrl) urls.set(d.path, d.signedUrl);
      }
    }
  } catch {
    // 인터넷이 끊김: 모두 받지 못함
  }
  for (const { path, done } of batch) {
    const url = urls.get(path) ?? null;
    if (url) cache.set(path, { url, until: Date.now() + 50 * 60_000 });
    pending.delete(path);
    done(url);
  }
}

function sign(path: string): Promise<string | null> {
  const ready = fresh(path);
  if (ready) return Promise.resolve(ready);
  const going = pending.get(path);
  if (going) return going;
  const p = new Promise<string | null>((done) => {
    queue.push({ path, done });
    if (!timer) timer = setTimeout(flush, 0);
  });
  pending.set(path, p);
  return p;
}

/** url: 받은 주소 (받는 중이면 null), failed: 받지 못함 (지워졌거나 인터넷이 끊김) */
export function useCropUrl(path: string | null): { url: string | null; failed: boolean } {
  const cached = path ? fresh(path) : null;
  const [got, setGot] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path || cached) return;
    let alive = true;
    sign(path).then((url) => {
      if (alive) setGot({ path, url });
    });
    return () => {
      alive = false;
    };
  }, [path, cached]);
  if (!path) return { url: null, failed: true };
  if (cached) return { url: cached, failed: false };
  if (got && got.path === path) return { url: got.url, failed: !got.url };
  return { url: null, failed: false };
}
