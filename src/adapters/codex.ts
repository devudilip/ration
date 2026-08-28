/**
 * Codex / ChatGPT adapter (Tier A).
 *
 * Rides the user's existing chatgpt.com browser session via
 * `credentials: 'include'` — no tokens are read, stored, or constructed.
 *
 * The endpoint is undocumented and has been observed with more than one
 * field-name convention (`primary_window`/`secondary_window` vs.
 * `five_hour_limit`/`weekly_limit`). Field names are matched literally per
 * variant — never inferred from display labels — because mislabeling which
 * window is which produces a confidently wrong display, which is worse than
 * no display. An unknown shape is an error state, never a zeroed lane.
 */
import type { FetchContext, ProviderAdapter, ProviderSnapshot, QuotaLane } from '../types';
import { clampPct } from '../lib/headroom';
import { arr, matchVariant, nullable, num, obj, optional, str, type Schema } from '../lib/validate';

export const CODEX_ADAPTER_VERSION = 1;
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

interface UsageWindow {
  used_percent: number;
  resets_at?: number | null;
  resets_in_seconds?: number | null;
}

const windowSchema: Schema<UsageWindow> = obj({
  used_percent: num,
  resets_at: optional(nullable(num)),
  resets_in_seconds: optional(nullable(num)),
});

interface AdditionalLimit extends UsageWindow {
  name?: string;
}

const additionalLimitSchema: Schema<AdditionalLimit> = obj({
  name: optional(str),
  used_percent: num,
  resets_at: optional(nullable(num)),
  resets_in_seconds: optional(nullable(num)),
});

interface WindowsShape {
  primary_window: UsageWindow;
  secondary_window?: UsageWindow;
  additional_rate_limits?: AdditionalLimit[];
}

interface NamedShape {
  five_hour_limit: UsageWindow;
  weekly_limit?: UsageWindow;
  additional_rate_limits?: AdditionalLimit[];
}

const variants = {
  wham_windows: obj<WindowsShape>({
    primary_window: windowSchema,
    secondary_window: optional(windowSchema),
    additional_rate_limits: optional(arr(additionalLimitSchema)),
  }) as Schema<WindowsShape | NamedShape>,
  wham_named: obj<NamedShape>({
    five_hour_limit: windowSchema,
    weekly_limit: optional(windowSchema),
    additional_rate_limits: optional(arr(additionalLimitSchema)),
  }) as Schema<WindowsShape | NamedShape>,
};

function windowToLane(id: string, label: string, w: UsageWindow, now: Date): QuotaLane {
  let resetsAt: string | null = null;
  if (typeof w.resets_at === 'number') {
    resetsAt = new Date(w.resets_at * 1000).toISOString();
  } else if (typeof w.resets_in_seconds === 'number') {
    resetsAt = new Date(now.getTime() + w.resets_in_seconds * 1000).toISOString();
  }
  return {
    id,
    label,
    kind: 'percent',
    used: clampPct(w.used_percent),
    limit: 100,
    resetsAt,
    headroomPct: clampPct(100 - w.used_percent),
  };
}

function toLanes(value: WindowsShape | NamedShape, now: Date): QuotaLane[] {
  const lanes: QuotaLane[] = [];
  if ('primary_window' in value) {
    lanes.push(windowToLane('session', 'Session', value.primary_window, now));
    if (value.secondary_window) {
      lanes.push(windowToLane('weekly', 'Weekly', value.secondary_window, now));
    }
  } else {
    lanes.push(windowToLane('session', 'Session (5h)', value.five_hour_limit, now));
    if (value.weekly_limit) {
      lanes.push(windowToLane('weekly', 'Weekly', value.weekly_limit, now));
    }
  }
  (value.additional_rate_limits ?? []).forEach((extra, i) => {
    const name = extra.name ?? `limit ${i + 1}`;
    lanes.push(windowToLane(`extra:${extra.name ?? i}`, name, extra, now));
  });
  return lanes;
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: 'Codex',
  tier: 'A',
  hostPermissions: ['https://chatgpt.com/*'],
  dashboardUrl: 'https://chatgpt.com/#settings/Usage',
  minRefreshMs: 60_000,

  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    const base = {
      providerId: this.id,
      displayName: this.displayName,
      adapterVersion: CODEX_ADAPTER_VERSION,
      fetchedAt: ctx.now().toISOString(),
    };
    const failed = (
      status: 'unauthenticated' | 'rate_limited' | 'error',
      code: string,
      message: string,
    ): ProviderSnapshot => ({ ...base, status, lanes: [], error: { code, message } });

    let response: Response;
    try {
      response = await ctx.fetch(USAGE_URL, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      return failed('error', 'network', err instanceof Error ? err.message : String(err));
    }

    if (response.status === 401 || response.status === 403) {
      return failed('unauthenticated', 'not_logged_in', 'Log in at chatgpt.com');
    }
    if (response.status === 429) {
      return failed('rate_limited', 'rate_limited', 'chatgpt.com rate-limited us; backing off');
    }
    if (!response.ok) {
      return failed('error', `http_${response.status}`, `chatgpt.com returned ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failed('error', 'not_json', 'Response was not JSON (interstitial page?)');
    }

    const match = matchVariant(variants, body);
    if (!match.ok) {
      const first = match.errors[0];
      return failed(
        'error',
        'schema_mismatch',
        `Unrecognized response shape (variant '${first?.variant}' diverged at '${first?.path}')`,
      );
    }

    return {
      ...base,
      status: 'ok',
      schemaVariant: match.variant,
      lanes: toLanes(match.value, ctx.now()),
    };
  },
};
