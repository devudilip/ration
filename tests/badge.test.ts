import { describe, expect, it } from 'vitest';
import { COLOR_AMBER, COLOR_GREY, COLOR_RED, computeBadge } from '../src/background/badge';
import { STALE_AFTER_MS } from '../src/lib/headroom';
import type { ProviderSnapshot, Settings } from '../src/types';

const now = new Date('2026-08-28T12:00:00Z');

const snap = (id: string, headroomPct: number, over: Partial<ProviderSnapshot> = {}): ProviderSnapshot => ({
  providerId: id,
  displayName: id,
  status: 'ok',
  lanes: [
    { id: 'l', label: 'L', kind: 'percent', used: 100 - headroomPct, limit: 100, resetsAt: null, headroomPct },
  ],
  fetchedAt: now.toISOString(),
  adapterVersion: 1,
  ...over,
});

const settings = (...ids: string[]): Settings => ({
  providers: Object.fromEntries(ids.map((id) => [id, { enabled: true }])),
});

describe('computeBadge', () => {
  it('clears when no provider is enabled, or none has data yet', () => {
    expect(computeBadge({}, { providers: {} }, now)).toEqual({ clear: true });
    expect(computeBadge({}, settings('a'), now)).toEqual({ clear: true });
  });

  it('is quiet above 40% headroom', () => {
    expect(computeBadge({ a: snap('a', 41) }, settings('a'), now)).toEqual({ clear: true });
  });

  it('shows amber at 15–40% and red below 15%', () => {
    expect(computeBadge({ a: snap('a', 40) }, settings('a'), now)).toEqual({
      text: '40',
      color: COLOR_AMBER,
    });
    expect(computeBadge({ a: snap('a', 15) }, settings('a'), now)).toEqual({
      text: '15',
      color: COLOR_AMBER,
    });
    expect(computeBadge({ a: snap('a', 14.9) }, settings('a'), now)).toEqual({
      text: '15',
      color: COLOR_RED,
    });
  });

  it('uses the minimum across providers — the wall you hit first', () => {
    const snaps = { a: snap('a', 90), b: snap('b', 22) };
    expect(computeBadge(snaps, settings('a', 'b'), now)).toEqual({
      text: '22',
      color: COLOR_AMBER,
    });
  });

  it('any errored provider wins with grey !', () => {
    const snaps = { a: snap('a', 90), b: snap('b', 90, { status: 'error', lanes: [] }) };
    expect(computeBadge(snaps, settings('a', 'b'), now)).toEqual({ text: '!', color: COLOR_GREY });
  });

  it('a stale snapshot is grey ! even if its numbers look fine', () => {
    const old = new Date(now.getTime() - STALE_AFTER_MS - 1000).toISOString();
    const snaps = { a: snap('a', 90, { fetchedAt: old }) };
    expect(computeBadge(snaps, settings('a'), now)).toEqual({ text: '!', color: COLOR_GREY });
  });

  it('ignores snapshots of disabled providers', () => {
    const snaps = { a: snap('a', 90), b: snap('b', 5, { status: 'error' }) };
    expect(computeBadge(snaps, settings('a'), now)).toEqual({ clear: true });
  });
});
