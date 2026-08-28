/**
 * The adapter contract. Every provider normalizes to these shapes; this is
 * what makes adding a provider a single-file contribution (see CONTRIBUTING.md).
 */

export type QuotaKind = 'percent' | 'currency' | 'count';

export interface QuotaLane {
  /** Stable id, e.g. 'five_hour', 'included_usage'. */
  id: string;
  /** Human label, e.g. 'Session (5h)', 'Weekly'. */
  label: string;
  kind: QuotaKind;
  used: number;
  /** null = provider reports a percentage only, no absolute limit. */
  limit: number | null;
  /** ISO 8601; null = unknown. */
  resetsAt: string | null;
  /** 0–100 remaining. THE normalized field every provider must compute. */
  headroomPct: number;
}

export type ProviderStatus = 'ok' | 'unauthenticated' | 'rate_limited' | 'error';

export interface ProviderSnapshot {
  providerId: string;
  displayName: string;
  status: ProviderStatus;
  lanes: QuotaLane[];
  /** ISO 8601 time this snapshot was fetched. Staleness is derived from it. */
  fetchedAt: string;
  /** Which response-schema variant matched, for endpoint-drift forensics. */
  schemaVariant?: string;
  /** Bumped whenever an adapter's parsing logic changes. */
  adapterVersion: number;
  error?: { code: string; message: string };
}

export interface FetchContext {
  /** Injected so fixture tests never touch the network. */
  fetch: typeof globalThis.fetch;
  /** Injected so fetchedAt / reset math is deterministic in tests. */
  now: () => Date;
}

export interface ProviderAdapter {
  id: string;
  displayName: string;
  /** Where the credential lives. Tier A = existing browser session cookie. */
  tier: 'A' | 'B' | 'C';
  /** Origins requested via chrome.permissions.request when the user enables it. */
  hostPermissions: string[];
  /** Link to the provider's own usage dashboard. */
  dashboardUrl: string;
  /** Per-provider rate-limit floor: never refetch more often than this. */
  minRefreshMs: number;
  /**
   * MUST never throw and MUST never coerce an unparseable response to zero —
   * every failure path returns a snapshot with an honest error status.
   */
  fetch(ctx: FetchContext): Promise<ProviderSnapshot>;
}

/** Popup → service-worker message protocol. */
export type Msg =
  | { type: 'refresh'; providerId?: string }
  | { type: 'setEnabled'; providerId: string; enabled: boolean }
  | { type: 'wipeAll' };

export interface Settings {
  providers: Record<string, { enabled: boolean }>;
}

export interface BackoffRecord {
  failCount: number;
  /** Epoch ms before which the provider must not be fetched again. */
  nextAllowedAt: number;
  /** Epoch ms of the last attempt; enforces the hard 60s/provider floor. */
  lastAttemptAt: number;
}
