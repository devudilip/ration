import { describe, expect, it } from 'vitest';
import { formatAge, formatCountdown } from '../src/lib/time';

const now = new Date('2026-08-28T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe('formatAge', () => {
  it('formats seconds, minutes, hours and days', () => {
    expect(formatAge(ago(3_000), now)).toBe('just now');
    expect(formatAge(ago(40_000), now)).toBe('40s ago');
    expect(formatAge(ago(3 * 60_000), now)).toBe('3m ago');
    expect(formatAge(ago(2 * 3_600_000), now)).toBe('2h ago');
    expect(formatAge(ago(72 * 3_600_000), now)).toBe('3d ago');
  });

  it('handles garbage and future timestamps', () => {
    expect(formatAge('nope', now)).toBe('unknown');
    expect(formatAge(ahead(60_000), now)).toBe('unknown');
  });
});

describe('formatCountdown', () => {
  it('formats minutes, hours and days', () => {
    expect(formatCountdown(ahead(38 * 60_000), now)).toBe('38m');
    expect(formatCountdown(ahead((2 * 60 + 14) * 60_000), now)).toBe('2h 14m');
    expect(formatCountdown(ahead(4 * 24 * 3_600_000), now)).toBe('4d');
  });

  it('is null for unknown or past resets', () => {
    expect(formatCountdown(null, now)).toBeNull();
    expect(formatCountdown(ago(1000), now)).toBeNull();
    expect(formatCountdown('garbage', now)).toBeNull();
  });
});
