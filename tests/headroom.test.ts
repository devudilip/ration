import { describe, expect, it } from 'vitest';
import { isStale, providerHeadroom, STALE_AFTER_MS } from '../src/lib/headroom';
import type { ProviderSnapshot, QuotaLane } from '../src/types';

const lane = (headroomPct: number): QuotaLane => ({
  id: 'l',
  label: 'L',
  kind: 'percent',
  used: 100 - headroomPct,
  limit: 100,
  resetsAt: null,
  headroomPct,
});

const snap = (over: Partial<ProviderSnapshot>): ProviderSnapshot => ({
  providerId: 'p',
  displayName: 'P',
  status: 'ok',
  lanes: [],
  fetchedAt: new Date(0).toISOString(),
  adapterVersion: 1,
  ...over,
});

describe('providerHeadroom', () => {
  it('is the minimum across lanes, not an average', () => {
    expect(providerHeadroom(snap({ lanes: [lane(12), lane(80)] }))).toBe(12);
  });

  it('clamps out-of-range lane values into 0–100', () => {
    expect(providerHeadroom(snap({ lanes: [lane(-5), lane(120)] }))).toBe(0);
    expect(providerHeadroom(snap({ lanes: [lane(120)] }))).toBe(100);
  });

  it('is null for non-ok status or no lanes', () => {
    expect(providerHeadroom(snap({ status: 'error', lanes: [lane(50)] }))).toBeNull();
    expect(providerHeadroom(snap({ lanes: [] }))).toBeNull();
  });
});

describe('isStale', () => {
  const t0 = new Date('2026-08-28T12:00:00Z');

  it('is fresh within the window and stale beyond it', () => {
    const fresh = snap({ fetchedAt: new Date(t0.getTime() - STALE_AFTER_MS + 1000).toISOString() });
    const stale = snap({ fetchedAt: new Date(t0.getTime() - STALE_AFTER_MS - 1000).toISOString() });
    expect(isStale(fresh, t0)).toBe(false);
    expect(isStale(stale, t0)).toBe(true);
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(isStale(snap({ fetchedAt: 'garbage' }), t0)).toBe(true);
  });
});
