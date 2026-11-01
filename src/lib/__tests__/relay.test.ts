import { describe, expect, it } from 'vitest';
import { FUNCTION_MS, LOCK_PAD_MS, LOCK_WAIT_MS, RUN_MS, WATCHDOG_BEFORE_MS, aiParallel, lockSeconds, lockWait } from '@/lib/relay';

describe('이어 달리기 시간', () => {
  it('잠금은 그 서버 함수가 끝나는 때 + 여유까지만 (늦게 잡은 단계일수록 짧게)', () => {
    const start = 1_000_000;
    const deadline = start + RUN_MS;
    const end = start + FUNCTION_MS + LOCK_PAD_MS;
    expect(lockSeconds(deadline, start)).toBe(Math.ceil((end - start) / 1000));
    expect(lockSeconds(deadline, start + 200_000)).toBe(Math.ceil((end - start - 200_000) / 1000));
    // 함수가 끝나 가도 30초보다 짧게는 잡지 않고, 처음 잡을 때도 함수 한 번 + 여유보다 길게는 잡지 않는다
    expect(lockSeconds(deadline, start + 299_000)).toBe(30);
    expect(lockSeconds(deadline + 500_000, start)).toBe((FUNCTION_MS + LOCK_PAD_MS) / 1000);
  });

  it('함수가 멈추기 전에 미리 부르고, 다음 요청이 그 잠금이 풀리는 것을 기다릴 수 있다', () => {
    // 미리 부른 요청이 시작될 때 앞 함수의 잠금이 남은 시간 (끝 + 여유 − 미리 부른 때) 은 기다리는 한도 안
    const left = FUNCTION_MS + LOCK_PAD_MS - (FUNCTION_MS - WATCHDOG_BEFORE_MS);
    expect(left).toBeLessThan(LOCK_WAIT_MS);
    // 단계는 함수가 끝나기 전에 끝내고 다음 요청을 부를 여유가 있다
    expect(FUNCTION_MS - RUN_MS).toBeGreaterThanOrEqual(20_000);
  });

  it('잠금 기다리기: 곧 풀리면 그때까지, 오래 잡혀 있으면 기다리지 않는다', () => {
    const now = Date.parse('2026-11-01T00:00:00Z');
    expect(lockWait(null, now, 45_000)).toBe(0);
    expect(lockWait('2026-10-31T23:59:00Z', now, 45_000)).toBe(0);
    expect(lockWait('2026-11-01T00:00:20Z', now, 45_000)).toBe(21_500);
    expect(lockWait('2026-11-01T00:04:00Z', now, 45_000)).toBeNull();
    expect(lockWait('2026-11-01T00:04:00Z', now, 300_000)).toBe(241_500);
    expect(lockWait('이상한 값', now, 45_000)).toBeNull();
  });

  it('같이 부르는 AI 수: 기본 3, 1~5', () => {
    expect(aiParallel(undefined)).toBe(3);
    expect(aiParallel('')).toBe(3);
    expect(aiParallel('1')).toBe(1);
    expect(aiParallel('4')).toBe(4);
    expect(aiParallel('9')).toBe(5);
    expect(aiParallel('0')).toBe(3);
    expect(aiParallel('abc')).toBe(3);
  });
});
