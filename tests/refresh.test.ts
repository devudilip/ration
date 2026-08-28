import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshDueProviders } from '../src/background/refresh';
import { HARD_FLOOR_MS } from '../src/background/backoff';
import { keyBackoff, KEY_SETTINGS, keySnapshot } from '../src/lib/storage';
import type { BackoffRecord, ProviderAdapter, ProviderSnapshot } from '../src/types';
import { installChromeFake, type ChromeFake } from './chrome-fake';

function makeAdapter(
  id: string,
  result: () => ProviderSnapshot,
): ProviderAdapter & { calls: number[] } {
  const calls: number[] = [];
  return {
    id,
    displayName: id,
    tier: 'A',
    hostPermissions: [],
    dashboardUrl: 'https://example.com',
    minRefreshMs: 60_000,
    calls,
    async fetch() {
      calls.push(Date.now());
      return result();
    },
  };
}

const okSnapshot = (id: string): ProviderSnapshot => ({
  providerId: id,
  displayName: id,
  status: 'ok',
  lanes: [
    { id: 'l', label: 'L', kind: 'percent', used: 10, limit: 100, resetsAt: null, headroomPct: 90 },
  ],
  fetchedAt: new Date().toISOString(),
  adapterVersion: 1,
});

const errorSnapshot = (id: string): ProviderSnapshot => ({
  ...okSnapshot(id),
  status: 'error',
  lanes: [],
  error: { code: 'network', message: 'boom' },
});

describe('refreshDueProviders', () => {
  let fake: ChromeFake;

  beforeEach(() => {
    fake = installChromeFake();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    fake.uninstall();
  });

  const enable = (...ids: string[]) =>
    fake.store.set(KEY_SETTINGS, {
      providers: Object.fromEntries(ids.map((id) => [id, { enabled: true }])),
    });

  it('skips disabled providers entirely', async () => {
    const adapter = makeAdapter('a', () => okSnapshot('a'));
    await refreshDueProviders('alarm', undefined, [adapter]);
    expect(adapter.calls).toHaveLength(0);
  });

  it('fetches enabled providers and stores the snapshot', async () => {
    enable('a');
    const adapter = makeAdapter('a', () => okSnapshot('a'));
    await refreshDueProviders('alarm', undefined, [adapter]);
    expect(adapter.calls).toHaveLength(1);
    expect(fake.store.get(keySnapshot('a'))).toMatchObject({ providerId: 'a', status: 'ok' });
  });

  it('enforces the 60s hard floor across triggers', async () => {
    enable('a');
    const adapter = makeAdapter('a', () => okSnapshot('a'));
    await refreshDueProviders('enable', 'a', [adapter]);
    vi.advanceTimersByTime(HARD_FLOOR_MS - 1000);
    await refreshDueProviders('popup', undefined, [adapter]);
    await refreshDueProviders('enable', 'a', [adapter]);
    expect(adapter.calls).toHaveLength(1);
  });

  it('popup opens reuse a fresh snapshot instead of refetching', async () => {
    enable('a');
    const adapter = makeAdapter('a', () => okSnapshot('a'));
    await refreshDueProviders('popup', undefined, [adapter]);
    vi.advanceTimersByTime(2 * 60_000); // past the hard floor
    // a snapshot fresher than adapter.minRefreshMs must be reused, not refetched
    fake.store.set(keySnapshot('a'), { ...okSnapshot('a'), fetchedAt: new Date().toISOString() });
    await refreshDueProviders('popup', undefined, [adapter]);
    expect(adapter.calls).toHaveLength(1);
  });

  it('bumps persisted backoff on failure and respects the gate', async () => {
    enable('a');
    const adapter = makeAdapter('a', () => errorSnapshot('a'));
    await refreshDueProviders('alarm', undefined, [adapter]);
    expect(adapter.calls).toHaveLength(1);

    const backoff = fake.store.get(keyBackoff('a')) as BackoffRecord;
    expect(backoff.failCount).toBe(1);
    expect(backoff.nextAllowedAt).toBeGreaterThan(Date.now());

    // Next alarm tick is inside the backoff window: no fetch.
    vi.advanceTimersByTime(4 * 60_000);
    await refreshDueProviders('alarm', undefined, [adapter]);
    expect(adapter.calls).toHaveLength(1);
  });

  it('resets backoff after a success', async () => {
    enable('a');
    let fail = true;
    const adapter = makeAdapter('a', () => (fail ? errorSnapshot('a') : okSnapshot('a')));
    await refreshDueProviders('alarm', undefined, [adapter]);
    fail = false;
    vi.advanceTimersByTime(61 * 60_000); // beyond max backoff
    await refreshDueProviders('alarm', undefined, [adapter]);
    expect(adapter.calls).toHaveLength(2);
    const backoff = fake.store.get(keyBackoff('a')) as BackoffRecord;
    expect(backoff.failCount).toBe(0);
    expect(backoff.nextAllowedAt).toBe(0);
  });

  it('one broken adapter does not stop the others', async () => {
    enable('a', 'b');
    const bad = makeAdapter('a', () => errorSnapshot('a'));
    const good = makeAdapter('b', () => okSnapshot('b'));
    await refreshDueProviders('alarm', undefined, [bad, good]);
    expect(good.calls).toHaveLength(1);
    expect(fake.store.get(keySnapshot('b'))).toMatchObject({ status: 'ok' });
    // and the badge reflects the error state
    expect(fake.badge.text).toBe('!');
  });

  it('updates the badge from stored snapshots', async () => {
    enable('a');
    const low = { ...okSnapshot('a') };
    low.lanes = [{ ...low.lanes[0]!, headroomPct: 12 }];
    const adapter = makeAdapter('a', () => low);
    await refreshDueProviders('alarm', undefined, [adapter]);
    expect(fake.badge).toEqual({ text: '12', color: '#d93025' });
  });
});
