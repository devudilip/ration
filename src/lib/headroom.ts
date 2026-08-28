import type { ProviderSnapshot } from '../types';

export function clampPct(pct: number): number {
  return Math.min(100, Math.max(0, pct));
}

/**
 * A provider's overall headroom is the MINIMUM across its lanes: you are
 * blocked by whichever ceiling you hit first, so 12% five-hour + 80% weekly
 * is 12% headroom, not an average.
 */
export function providerHeadroom(snapshot: ProviderSnapshot): number | null {
  if (snapshot.status !== 'ok' || snapshot.lanes.length === 0) return null;
  return Math.min(...snapshot.lanes.map((lane) => clampPct(lane.headroomPct)));
}

/** Snapshots older than this are treated as stale (grey "!"). */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export function isStale(snapshot: ProviderSnapshot, now: Date): boolean {
  const fetched = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetched)) return true;
  return now.getTime() - fetched > STALE_AFTER_MS;
}
