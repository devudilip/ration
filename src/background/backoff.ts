/**
 * Exponential backoff for polite polling of undocumented endpoints.
 * Pure math here; the persisted BackoffRecord lives in storage so backoff
 * state survives service-worker restarts.
 */
import type { BackoffRecord } from '../types';

export const BASE_DELAY_MS = 5 * 60 * 1000;
export const MAX_DELAY_MS = 60 * 60 * 1000;
/** Never more than one request per provider per minute, regardless of trigger. */
export const HARD_FLOOR_MS = 60 * 1000;

/**
 * 5 min * 2^failCount, capped at 60 min, with ±25% jitter.
 * `random` is injected (0..1) so tests are deterministic.
 */
export function nextDelayMs(failCount: number, random: () => number = Math.random): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** failCount, MAX_DELAY_MS);
  const jitter = 0.75 + random() * 0.5;
  return Math.round(exp * jitter);
}

export function bumpBackoff(
  record: BackoffRecord,
  nowMs: number,
  random: () => number = Math.random,
): BackoffRecord {
  return {
    failCount: record.failCount + 1,
    nextAllowedAt: nowMs + nextDelayMs(record.failCount, random),
    lastAttemptAt: record.lastAttemptAt,
  };
}

export function resetBackoff(record: BackoffRecord): BackoffRecord {
  return { failCount: 0, nextAllowedAt: 0, lastAttemptAt: record.lastAttemptAt };
}
