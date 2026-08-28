import { describe, expect, it } from 'vitest';
import {
  BASE_DELAY_MS,
  bumpBackoff,
  MAX_DELAY_MS,
  nextDelayMs,
  resetBackoff,
} from '../src/background/backoff';
import type { BackoffRecord } from '../src/types';

const mid = () => 0.5; // jitter factor exactly 1.0

describe('nextDelayMs', () => {
  it('starts at 5 minutes and doubles per failure', () => {
    expect(nextDelayMs(0, mid)).toBe(BASE_DELAY_MS);
    expect(nextDelayMs(1, mid)).toBe(BASE_DELAY_MS * 2);
    expect(nextDelayMs(2, mid)).toBe(BASE_DELAY_MS * 4);
  });

  it('caps at 60 minutes', () => {
    expect(nextDelayMs(4, mid)).toBe(MAX_DELAY_MS);
    expect(nextDelayMs(50, mid)).toBe(MAX_DELAY_MS);
  });

  it('applies ±25% jitter', () => {
    expect(nextDelayMs(0, () => 0)).toBe(BASE_DELAY_MS * 0.75);
    expect(nextDelayMs(0, () => 1)).toBe(BASE_DELAY_MS * 1.25);
  });
});

describe('bumpBackoff / resetBackoff', () => {
  const now = 1_000_000;
  const rec: BackoffRecord = { failCount: 1, nextAllowedAt: 0, lastAttemptAt: now - 100 };

  it('bump increments failCount and schedules from the previous count', () => {
    const b = bumpBackoff(rec, now, mid);
    expect(b.failCount).toBe(2);
    expect(b.nextAllowedAt).toBe(now + BASE_DELAY_MS * 2);
    expect(b.lastAttemptAt).toBe(rec.lastAttemptAt);
  });

  it('reset clears the gate but preserves lastAttemptAt (hard floor)', () => {
    const r = resetBackoff(rec);
    expect(r).toEqual({ failCount: 0, nextAllowedAt: 0, lastAttemptAt: rec.lastAttemptAt });
  });
});
