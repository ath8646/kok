'use client';
// 지도 밑그림 파일 불러오기 (/maps/*.json): 처음 쓸 때 한 번 받아 기억해 둔다.
// 받는 동안은 undefined (지도는 바다만 그리고 기다린다), 못 받으면 null (밑그림 없이 그린다)
import { useEffect, useState } from 'react';
import { readMapFile, type MapFile } from '@/lib/art/basemap';

const cache = new Map<string, MapFile | 'error'>();
const pending = new Map<string, Promise<MapFile | null>>();

/** 미리 넣어 두기 (그림 미리보기·시험에서 받지 않고 바로 그리게) */
export function primeMapFile(name: string, data: unknown) {
  const f = readMapFile(data);
  if (f) cache.set(name, f);
}

function load(name: string): Promise<MapFile | null> {
  const hit = cache.get(name);
  if (hit) return Promise.resolve(hit === 'error' ? null : hit);
  let p = pending.get(name);
  if (!p) {
    p = fetch(`/maps/${name}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const f = readMapFile(j);
        cache.set(name, f ?? 'error');
        return f;
      })
      .catch(() => {
        // 잠깐 끊긴 것일 수 있어서 기억하지 않고 다음에 다시 받아 본다
        return null;
      })
      .finally(() => pending.delete(name));
    pending.set(name, p);
  }
  return p;
}

/** 기억해 둔 것: 파일, 못 받은 것은 null, 아직 안 받은 것은 undefined */
function peek(name: string | null): MapFile | null | undefined {
  if (!name) return null;
  const hit = cache.get(name);
  return hit === 'error' ? null : hit;
}

/** name 의 밑그림 (name 이 null 이면 받지 않고 null). 받는 동안 undefined */
export function useMapFile(name: string | null): MapFile | null | undefined {
  const [state, setState] = useState<{ name: string | null; file: MapFile | null | undefined }>(() => ({ name, file: peek(name) }));
  // 이름이 바뀌면 기억해 둔 것으로 바로 바꾼다 (그리는 동안 상태를 맞춘다)
  if (state.name !== name) setState({ name, file: peek(name) });
  useEffect(() => {
    if (!name) return;
    let alive = true;
    // 이미 기억해 둔 것이어도 거친다: 처음 그린 뒤에 다른 지도가 받아 둔 것일 수 있다 (같으면 다시 그리지 않는다)
    load(name).then((f) => {
      if (alive) setState((s) => (s.name === name && s.file === f ? s : { name, file: f }));
    });
    return () => {
      alive = false;
    };
  }, [name]);
  return state.name === name ? state.file : peek(name);
}
