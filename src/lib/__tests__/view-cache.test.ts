import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropView, noteWrite, readView, trackedFetch, viewStamp, writeView, writesData, writesSettled } from '@/lib/view-cache';

describe('방금 본 목록 기억 (화면을 오갈 때 바로 보여 주기)', () => {
  afterEach(() => {
    dropView();
    vi.unstubAllGlobals();
  });

  it('같은 계정에만 보여 준다 (다른 계정으로 바꾸면 남의 목록이 보이지 않게)', () => {
    writeView('library', 'user-a', { n: 1 });
    expect(readView('library', 'user-a')).toEqual({ n: 1 });
    expect(readView('library', 'user-b')).toBeUndefined();
    expect(readView('library', null)).toBeUndefined();
  });

  it('5분이 지나면 쓰지 않는다', () => {
    writeView('library', 'user-a', { n: 1 }, { now: 1_000 });
    expect(readView('library', 'user-a', 1_000 + 4 * 60_000)).toEqual({ n: 1 });
    expect(readView('library', 'user-a', 1_000 + 6 * 60_000)).toBeUndefined();
  });

  it('지우면 사라진다 (하나만, 또는 모두)', () => {
    writeView('library', 'user-a', { n: 1 });
    writeView('other', 'user-a', { n: 2 });
    dropView('library');
    expect(readView('library', 'user-a')).toBeUndefined();
    expect(readView('other', 'user-a')).toEqual({ n: 2 });
    dropView();
    expect(readView('other', 'user-a')).toBeUndefined();
  });

  it('계정이 없으면 적지 않는다', () => {
    writeView('library', undefined, { n: 1 });
    expect(readView('library', undefined)).toBeUndefined();
  });

  it('기억한 뒤에 데이터를 바꾸는 요청이 있었으면 쓰지 않는다 (바뀌기 전 화면이 보였다가 바뀌지 않게)', () => {
    writeView('home', 'user-a', { n: 1 });
    noteWrite();
    expect(readView('home', 'user-a')).toBeUndefined();
    // 저장이 끝난 뒤 다시 읽은 것은 쓴다
    writeView('home', 'user-a', { n: 2 });
    expect(readView('home', 'user-a')).toEqual({ n: 2 });
  });

  it('읽는 사이에 쓰기가 있었으면 읽은 것을 기억하지 않는다 (읽기를 시작할 때의 번호로 적는다)', () => {
    writeView('home', 'user-a', { n: 1 });
    const stamp = viewStamp();
    noteWrite();
    writeView('home', 'user-a', { n: 2 }, { stamp });
    expect(readView('home', 'user-a')).toBeUndefined();
    const fresh = viewStamp();
    writeView('home', 'user-a', { n: 3 }, { stamp: fresh });
    expect(readView('home', 'user-a')).toEqual({ n: 3 });
  });
});

describe('데이터를 바꾸는 요청 세기', () => {
  const SB = 'https://abc.supabase.co';

  it('Supabase 표: 읽기(GET·HEAD)는 세지 않고 쓰기는 센다', () => {
    expect(writesData('GET', `${SB}/rest/v1/cards?select=*`)).toBe(false);
    expect(writesData(undefined, `${SB}/rest/v1/cards?select=*`)).toBe(false);
    expect(writesData('HEAD', `${SB}/rest/v1/review_logs?select=id`)).toBe(false);
    expect(writesData('PATCH', `${SB}/rest/v1/sources?id=in.(a,b)`)).toBe(true);
    expect(writesData('post', `${SB}/rest/v1/review_logs`)).toBe(true);
    expect(writesData('DELETE', `${SB}/rest/v1/review_sessions?key=eq.home`)).toBe(true);
  });

  it('Supabase 함수: 읽기만 하는 함수는 세지 않는다', () => {
    expect(writesData('POST', `${SB}/rest/v1/rpc/kok_my_study_days`)).toBe(false);
    expect(writesData('POST', `${SB}/rest/v1/rpc/kok_session_answer`)).toBe(true);
    expect(writesData('POST', `${SB}/rest/v1/rpc/kok_reorder_sources`)).toBe(true);
  });

  it('로그인·파일 서명 주소는 세지 않는다', () => {
    expect(writesData('POST', `${SB}/auth/v1/token?grant_type=refresh_token`)).toBe(false);
    expect(writesData('POST', `${SB}/storage/v1/object/sign/sources/u/s/a.pdf`)).toBe(false);
  });

  it('앱 API: GET 이 아니면 센다 (멈춘 정리 이어 달리기·홈 채팅·올리기 주소는 빼고)', () => {
    expect(writesData('GET', '/api/me')).toBe(false);
    expect(writesData('POST', '/api/sources')).toBe(true);
    expect(writesData('POST', '/api/sources/delete')).toBe(true);
    expect(writesData('DELETE', '/api/subjects/x')).toBe(true);
    expect(writesData('POST', '/api/notes/n1/chat')).toBe(true);
    expect(writesData('POST', '/api/sources/s1/process')).toBe(false);
    expect(writesData('POST', '/api/chat')).toBe(false);
    expect(writesData('POST', '/api/uploads')).toBe(false);
    expect(writesData('POST', 'http://localhost:3000/api/sources/move')).toBe(true);
  });

  it('trackedFetch: 쓰기 요청은 시작할 때와 끝날 때 센다 (실패해도), 읽기는 그대로', async () => {
    let finish: (r: Response) => void = () => {};
    const fake = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal('fetch', fake);
    writeView('home', 'user-a', { n: 1 });
    const before = viewStamp();
    const read = trackedFetch(`${SB}/rest/v1/cards`);
    expect(viewStamp()).toBe(before);
    finish(new Response('[]'));
    await read;
    expect(readView('home', 'user-a')).toEqual({ n: 1 });

    const write = trackedFetch(`${SB}/rest/v1/cards?question_id=eq.q1`, { method: 'PATCH', body: '{}' });
    expect(viewStamp()).toBe(before + 1);
    expect(readView('home', 'user-a')).toBeUndefined();
    finish(new Response(null, { status: 204 }));
    await write;
    await Promise.resolve();
    expect(viewStamp()).toBe(before + 2);

    const fail = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fail);
    await expect(trackedFetch('/api/sources', { method: 'POST' })).rejects.toThrow('offline');
    await Promise.resolve();
    expect(viewStamp()).toBe(before + 4);
    expect(fake).toHaveBeenCalledTimes(2);
  });

  it('writesSettled: 진행 중인 쓰기가 모두 끝나면 (없으면 바로)', async () => {
    await writesSettled();
    const ends: Array<(r: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => ends.push(r))),
    );
    const a = trackedFetch(`${SB}/rest/v1/review_logs`, { method: 'POST' });
    const b = trackedFetch(`${SB}/rest/v1/cards?question_id=eq.q1`, { method: 'PATCH' });
    let settled = false;
    const wait = writesSettled().then(() => (settled = true));
    ends[0](new Response(null, { status: 201 }));
    await a;
    await Promise.resolve();
    expect(settled).toBe(false);
    ends[1](new Response(null, { status: 204 }));
    await b;
    await wait;
    expect(settled).toBe(true);
  });
});
