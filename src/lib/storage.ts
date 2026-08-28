/**
 * Typed access to chrome.storage.local — the only state store. MV3 service
 * workers are killed aggressively, so nothing may live in memory between
 * events; everything round-trips through these keys.
 *
 * Keys are namespaced `v1:` so a future schema migration is a key-prefix
 * switch. `v1:history:<id>` is reserved for the 7-day history feature but is
 * not written in v0.1.
 */
import type { BackoffRecord, ProviderSnapshot, Settings } from '../types';

export const KEY_SETTINGS = 'v1:settings';
export const keySnapshot = (providerId: string) => `v1:snapshot:${providerId}`;
export const keyBackoff = (providerId: string) => `v1:backoff:${providerId}`;
/** Adapter-private cache, e.g. Claude's discovered org id. */
export const keyAdapterCache = (providerId: string) => `v1:cache:${providerId}`;

const SNAPSHOT_PREFIX = 'v1:snapshot:';

export async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY_SETTINGS);
  return (got[KEY_SETTINGS] as Settings | undefined) ?? { providers: {} };
}

export async function putSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY_SETTINGS]: settings });
}

export async function getSnapshot(providerId: string): Promise<ProviderSnapshot | undefined> {
  const key = keySnapshot(providerId);
  const got = await chrome.storage.local.get(key);
  return got[key] as ProviderSnapshot | undefined;
}

export async function getAllSnapshots(): Promise<Record<string, ProviderSnapshot>> {
  const all = await chrome.storage.local.get(null);
  const out: Record<string, ProviderSnapshot> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(SNAPSHOT_PREFIX)) {
      out[key.slice(SNAPSHOT_PREFIX.length)] = value as ProviderSnapshot;
    }
  }
  return out;
}

export async function putSnapshot(snapshot: ProviderSnapshot): Promise<void> {
  await chrome.storage.local.set({ [keySnapshot(snapshot.providerId)]: snapshot });
}

export async function removeProviderData(providerId: string): Promise<void> {
  await chrome.storage.local.remove([
    keySnapshot(providerId),
    keyBackoff(providerId),
    keyAdapterCache(providerId),
  ]);
}

export const EMPTY_BACKOFF: BackoffRecord = { failCount: 0, nextAllowedAt: 0, lastAttemptAt: 0 };

export async function getBackoff(providerId: string): Promise<BackoffRecord> {
  const key = keyBackoff(providerId);
  const got = await chrome.storage.local.get(key);
  return (got[key] as BackoffRecord | undefined) ?? EMPTY_BACKOFF;
}

export async function putBackoff(providerId: string, record: BackoffRecord): Promise<void> {
  await chrome.storage.local.set({ [keyBackoff(providerId)]: record });
}

export async function getAdapterCache<T>(providerId: string): Promise<T | undefined> {
  const key = keyAdapterCache(providerId);
  const got = await chrome.storage.local.get(key);
  return got[key] as T | undefined;
}

export async function putAdapterCache<T>(providerId: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [keyAdapterCache(providerId)]: value });
}

/** One-click privacy wipe: everything Ration has ever stored. */
export async function wipeAll(): Promise<void> {
  await chrome.storage.local.clear();
}
