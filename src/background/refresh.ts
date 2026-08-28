/**
 * Refresh orchestration — the politeness policy in code. These gates are
 * non-negotiable: we poll undocumented endpoints as guests.
 *
 *  - hard floor: never more than 1 request per provider per 60s, any trigger
 *  - persisted exponential backoff gate on prior failures
 *  - freshness gate: popup opens reuse a recent snapshot instead of fetching
 */
import { adapters as registry, getAdapter } from '../adapters';
import type { FetchContext, ProviderAdapter } from '../types';
import {
  getAdapterCache,
  getAllSnapshots,
  getBackoff,
  getSettings,
  getSnapshot,
  putAdapterCache,
  putBackoff,
  putSnapshot,
} from '../lib/storage';
import { bumpBackoff, HARD_FLOOR_MS, resetBackoff } from './backoff';
import { applyBadge, computeBadge } from './badge';

export const ALARM_NAME = 'ration:tick';
export const ALARM_PERIOD_MIN = 5;
/** Slightly under the alarm period so timing jitter can't skip every other tick. */
const ALARM_FRESH_MS = ALARM_PERIOD_MIN * 60_000 - 30_000;

export type RefreshTrigger = 'alarm' | 'popup' | 'enable';

function makeContext(adapter: ProviderAdapter): FetchContext {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    cache: {
      get: <T,>() => getAdapterCache<T>(adapter.id),
      set: <T,>(value: T) => putAdapterCache<T>(adapter.id, value),
    },
  };
}

export async function refreshDueProviders(
  trigger: RefreshTrigger,
  onlyId?: string,
  adapters: readonly ProviderAdapter[] = registry,
): Promise<void> {
  const settings = await getSettings();
  const targets = onlyId
    ? adapters.filter((a) => a.id === onlyId)
    : adapters;

  // Sequential on purpose: it naturally staggers requests across providers.
  for (const adapter of targets) {
    if (!settings.providers[adapter.id]?.enabled) continue;

    const backoff = await getBackoff(adapter.id);
    const nowMs = Date.now();
    if (nowMs - backoff.lastAttemptAt < HARD_FLOOR_MS) continue;
    if (nowMs < backoff.nextAllowedAt) continue;

    if (trigger !== 'enable') {
      const existing = await getSnapshot(adapter.id);
      const freshMs = trigger === 'popup' ? adapter.minRefreshMs : ALARM_FRESH_MS;
      if (existing && nowMs - Date.parse(existing.fetchedAt) < freshMs) continue;
    }

    // Persist the attempt BEFORE fetching so the hard floor holds even if
    // the service worker is killed mid-flight.
    await putBackoff(adapter.id, { ...backoff, lastAttemptAt: nowMs });

    const snapshot = await adapter.fetch(makeContext(adapter));

    const latest = await getBackoff(adapter.id);
    if (snapshot.status === 'rate_limited' || snapshot.status === 'error') {
      await putBackoff(adapter.id, bumpBackoff(latest, nowMs));
    } else {
      await putBackoff(adapter.id, resetBackoff(latest));
    }
    await putSnapshot(snapshot);
  }

  await updateBadge();
}

export async function updateBadge(): Promise<void> {
  const [settings, snapshots] = await Promise.all([getSettings(), getAllSnapshots()]);
  applyBadge(computeBadge(snapshots, settings, new Date()));
}

export { getAdapter };
