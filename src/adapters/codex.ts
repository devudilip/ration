/**
 * Codex / ChatGPT adapter (Tier A).
 *
 * Auth: the ChatGPT web app authenticates its backend calls with a
 * short-lived bearer token minted from the browser session. This adapter
 * does the same thing the page itself does: it asks the provider's own
 * session endpoint (`/api/auth/session`, cookie-authed) for that token,
 * uses it in-memory for the single usage request, and never stores it —
 * nothing is written to storage or logs.
 *
 * The endpoint is undocumented and has been observed with several shapes.
 * Field names are matched literally per named variant — never inferred from
 * display labels — because mislabeling which window is which produces a
 * confidently wrong display, worse than no display. An unknown shape is an
 * error state, never a zeroed lane. The primary variant (`wham_rate_limit`,
 * windows nested under `rate_limit`) is verified against a live capture
 * (2026-08); the flat shapes remain as fallbacks.
 */
import type { FetchContext, ProviderAdapter, ProviderSnapshot, QuotaLane } from '../types';
import { clampPct } from '../lib/headroom';
import { arr, matchVariant, nullable, num, obj, optional, str, type Schema } from '../lib/validate';

export const CODEX_ADAPTER_VERSION = 2;
const SESSION_URL = 'https://chatgpt.com/api/auth/session';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

interface UsageWindow {
  used_percent: number;
  limit_window_seconds?: number | null;
  reset_at?: number | null;
  reset_after_seconds?: number | null;
  resets_at?: number | null;
  resets_in_seconds?: number | null;
}

const windowSchema: Schema<UsageWindow> = obj({
  used_percent: num,
  limit_window_seconds: optional(nullable(num)),
  reset_at: optional(nullable(num)),
  reset_after_seconds: optional(nullable(num)),
  resets_at: optional(nullable(num)),
  resets_in_seconds: optional(nullable(num)),
});

interface RateLimitBlock {
  primary_window?: UsageWindow | null;
  secondary_window?: UsageWindow | null;
}

const rateLimitBlockSchema: Schema<RateLimitBlock> = obj({
  primary_window: optional(nullable(windowSchema)),
  secondary_window: optional(nullable(windowSchema)),
});

interface AdditionalRateLimit {
  limit_name?: string | null;
  rate_limit?: RateLimitBlock | null;
}

/** Live shape: windows nested under rate_limit. */
interface RateLimitShape {
  rate_limit: RateLimitBlock;
  additional_rate_limits?: AdditionalRateLimit[] | null;
}

/** Legacy/fallback shapes: windows at the top level. */
interface WindowsShape {
  primary_window: UsageWindow;
  secondary_window?: UsageWindow | null;
}

interface NamedShape {
  five_hour_limit: UsageWindow;
  weekly_limit?: UsageWindow | null;
}

type UsageShape = RateLimitShape | WindowsShape | NamedShape;

const additionalSchema: Schema<AdditionalRateLimit> = obj({
  limit_name: optional(nullable(str)),
  rate_limit: optional(nullable(rateLimitBlockSchema)),
});

const variants = {
  wham_rate_limit: obj<RateLimitShape>({
    rate_limit: rateLimitBlockSchema,
    additional_rate_limits: optional(nullable(arr(additionalSchema))),
  }) as Schema<UsageShape>,
  wham_windows: obj<WindowsShape>({
    primary_window: windowSchema,
    secondary_window: optional(nullable(windowSchema)),
  }) as Schema<UsageShape>,
  wham_named: obj<NamedShape>({
    five_hour_limit: windowSchema,
    weekly_limit: optional(nullable(windowSchema)),
  }) as Schema<UsageShape>,
};

const sessionSchema = obj<{ accessToken?: string }>({
  accessToken: optional(str),
});

function windowLabel(w: UsageWindow, slot: 'session' | 'weekly'): string {
  const secs = w.limit_window_seconds;
  if (typeof secs === 'number' && secs > 0) {
    if (secs === 18_000) return 'Session (5h)';
    if (secs === 604_800) return 'Weekly';
    const hours = Math.round(secs / 3600);
    return hours >= 48 ? `${Math.round(hours / 24)}-day window` : `${hours}h window`;
  }
  return slot === 'session' ? 'Session' : 'Weekly';
}

function windowToLane(id: string, label: string, w: UsageWindow, now: Date): QuotaLane {
  let resetsAt: string | null = null;
  const epoch = w.reset_at ?? w.resets_at;
  const relative = w.reset_after_seconds ?? w.resets_in_seconds;
  if (typeof epoch === 'number') {
    resetsAt = new Date(epoch * 1000).toISOString();
  } else if (typeof relative === 'number') {
    resetsAt = new Date(now.getTime() + relative * 1000).toISOString();
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

function blockToLanes(block: RateLimitBlock, now: Date): QuotaLane[] {
  const lanes: QuotaLane[] = [];
  if (block.primary_window) {
    lanes.push(
      windowToLane('session', windowLabel(block.primary_window, 'session'), block.primary_window, now),
    );
  }
  if (block.secondary_window) {
    lanes.push(
      windowToLane('weekly', windowLabel(block.secondary_window, 'weekly'), block.secondary_window, now),
    );
  }
  return lanes;
}

function toLanes(value: UsageShape, now: Date): QuotaLane[] {
  if ('rate_limit' in value) {
    const lanes = blockToLanes(value.rate_limit, now);
    (value.additional_rate_limits ?? []).forEach((extra, i) => {
      const w = extra.rate_limit?.primary_window;
      if (!w) return;
      const name = extra.limit_name ?? `limit ${i + 1}`;
      lanes.push(windowToLane(`extra:${extra.limit_name ?? i}`, name, w, now));
    });
    return lanes;
  }
  if ('primary_window' in value) {
    const lanes = [windowToLane('session', 'Session', value.primary_window, now)];
    if (value.secondary_window) {
      lanes.push(windowToLane('weekly', 'Weekly', value.secondary_window, now));
    }
    return lanes;
  }
  const lanes = [windowToLane('session', 'Session (5h)', value.five_hour_limit, now)];
  if (value.weekly_limit) {
    lanes.push(windowToLane('weekly', 'Weekly', value.weekly_limit, now));
  }
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

    // Step 1: mint the short-lived bearer the same way the ChatGPT page does.
    // The token lives only in this function scope; it is never persisted.
    let sessionResponse: Response;
    try {
      sessionResponse = await ctx.fetch(SESSION_URL, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      return failed('error', 'network', err instanceof Error ? err.message : String(err));
    }
    if (sessionResponse.status === 401 || sessionResponse.status === 403) {
      return failed('unauthenticated', 'not_logged_in', 'Log in at chatgpt.com');
    }
    if (sessionResponse.status === 429) {
      return failed('rate_limited', 'rate_limited', 'chatgpt.com rate-limited us; backing off');
    }
    if (!sessionResponse.ok) {
      return failed(
        'error',
        `http_${sessionResponse.status}`,
        `chatgpt.com session endpoint returned ${sessionResponse.status}`,
      );
    }
    let sessionBody: unknown;
    try {
      sessionBody = await sessionResponse.json();
    } catch {
      return failed('unauthenticated', 'not_logged_in', 'Log in at chatgpt.com');
    }
    const session = sessionSchema(sessionBody, 'session');
    // A logged-out session returns 200 with an empty object.
    if (!session.ok || !session.value.accessToken) {
      return failed('unauthenticated', 'not_logged_in', 'Log in at chatgpt.com');
    }

    // Step 2: the usage call, authenticated exactly like the page's own.
    let response: Response;
    try {
      response = await ctx.fetch(USAGE_URL, {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.value.accessToken}`,
        },
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
