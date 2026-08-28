/**
 * Claude.ai adapter (Tier A).
 *
 * LEGAL GUARDRAIL — do not weaken this in a PR:
 * Anthropic's terms restrict Claude Code / claude.ai OAuth tokens to those
 * products. This adapter therefore NEVER constructs an Authorization header,
 * never reads, stores, or handles any token or cookie value, and the
 * extension never requests the `cookies` permission. It only rides the
 * user's existing claude.ai browser session via `credentials: 'include'`,
 * exactly like the Settings → Usage page the user could open themselves.
 * See README "Legal & privacy".
 *
 * The usage endpoint behind Settings → Usage is undocumented and has not
 * been pinned by the maintainers yet, so this adapter probes a short list of
 * candidate paths; the first response that is 200 AND validates against a
 * known schema wins and is cached. If none verifies, the honest result is an
 * `endpoint_not_verified` error (grey "!") with instructions in the README /
 * issue templates for capturing the real endpoint from DevTools.
 */
import type { FetchContext, ProviderAdapter, ProviderSnapshot, QuotaLane } from '../types';
import { clampPct } from '../lib/headroom';
import {
  arr,
  matchVariant,
  nullable,
  num,
  obj,
  optional,
  str,
  type Result,
  type Schema,
} from '../lib/validate';

export const CLAUDE_ADAPTER_VERSION = 1;
const ORIGIN = 'https://claude.ai';
const ORGANIZATIONS_URL = `${ORIGIN}/api/organizations`;

/**
 * Candidate usage endpoints, tried in order. Community-verified fixes to this
 * list are the expected way Claude support solidifies — see the
 * "adapter broken" issue template.
 */
export const USAGE_PATH_CANDIDATES = [
  (orgId: string) => `${ORIGIN}/api/organizations/${orgId}/usage`,
  (orgId: string) => `${ORIGIN}/api/organizations/${orgId}/usage_limits`,
];

interface ClaudeCache {
  orgId?: string;
  usageUrl?: string;
}

const orgSchema = obj({
  uuid: str,
  capabilities: optional(arr(str)),
});
const orgsSchema = arr(orgSchema);

/** Accept either an ISO string or epoch seconds for reset timestamps. */
const numOrStr: Schema<number | string> = (v, path) =>
  typeof v === 'number' || typeof v === 'string'
    ? ({ ok: true, value: v } as Result<number | string>)
    : { ok: false, path, expected: 'number|string' };

interface UsageWindow {
  utilization: number;
  resets_at?: number | string | null;
}

const windowSchema: Schema<UsageWindow> = obj({
  utilization: num,
  resets_at: optional(nullable(numOrStr)),
});

interface UsageShape {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_sonnet?: UsageWindow;
  seven_day_opus?: UsageWindow;
}

const usageVariants = {
  org_usage_windows: obj<UsageShape>({
    five_hour: optional(windowSchema),
    seven_day: optional(windowSchema),
    seven_day_sonnet: optional(windowSchema),
    seven_day_opus: optional(windowSchema),
  }),
};

const LANE_LABELS: Record<keyof UsageShape, string> = {
  five_hour: 'Session (5h)',
  seven_day: 'Weekly (all models)',
  seven_day_sonnet: 'Weekly (Sonnet)',
  seven_day_opus: 'Weekly (Opus)',
};

function windowToLane(id: keyof UsageShape, w: UsageWindow): QuotaLane {
  let resetsAt: string | null = null;
  if (typeof w.resets_at === 'number') {
    resetsAt = new Date(w.resets_at * 1000).toISOString();
  } else if (typeof w.resets_at === 'string') {
    const parsed = Date.parse(w.resets_at);
    resetsAt = Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return {
    id,
    label: LANE_LABELS[id],
    kind: 'percent',
    used: clampPct(w.utilization),
    limit: 100,
    resetsAt,
    headroomPct: clampPct(100 - w.utilization),
  };
}

function toLanes(shape: UsageShape): QuotaLane[] {
  const lanes: QuotaLane[] = [];
  for (const id of Object.keys(LANE_LABELS) as (keyof UsageShape)[]) {
    const w = shape[id];
    if (w) lanes.push(windowToLane(id, w));
  }
  return lanes;
}

async function readJson(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  displayName: 'Claude',
  tier: 'A',
  hostPermissions: ['https://claude.ai/*'],
  dashboardUrl: 'https://claude.ai/settings/usage',
  minRefreshMs: 60_000,

  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    const base = {
      providerId: this.id,
      displayName: this.displayName,
      adapterVersion: CLAUDE_ADAPTER_VERSION,
      fetchedAt: ctx.now().toISOString(),
    };
    const failed = (
      status: 'unauthenticated' | 'rate_limited' | 'error',
      code: string,
      message: string,
    ): ProviderSnapshot => ({ ...base, status, lanes: [], error: { code, message } });

    const cache = (await ctx.cache.get<ClaudeCache>()) ?? {};

    // Step 1: discover the organization id (cached after first success).
    let orgId = cache.orgId;
    if (!orgId) {
      let response: Response;
      try {
        response = await ctx.fetch(ORGANIZATIONS_URL, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch (err) {
        return failed('error', 'network', err instanceof Error ? err.message : String(err));
      }
      if (response.status === 401 || response.status === 403) {
        return failed('unauthenticated', 'not_logged_in', 'Log in at claude.ai');
      }
      if (response.status === 429) {
        return failed('rate_limited', 'rate_limited', 'claude.ai rate-limited us; backing off');
      }
      if (!response.ok) {
        return failed('error', `http_${response.status}`, `claude.ai returned ${response.status}`);
      }
      const body = await readJson(response);
      if (body === undefined) {
        // Logged-out claude.ai serves the app shell HTML instead of JSON.
        return failed('unauthenticated', 'not_logged_in', 'Log in at claude.ai');
      }
      const orgs = orgsSchema(body, 'organizations');
      if (!orgs.ok) {
        return failed(
          'error',
          'schema_mismatch',
          `Unexpected /api/organizations shape at '${orgs.path}'`,
        );
      }
      if (orgs.value.length === 0) {
        return failed('error', 'no_organization', 'No claude.ai organization found');
      }
      const chatOrg = orgs.value.find((o) => o.capabilities?.includes('chat'));
      orgId = (chatOrg ?? orgs.value[0]!).uuid;
      await ctx.cache.set<ClaudeCache>({ ...cache, orgId });
    }

    // Step 2: fetch usage — verified path first, then remaining candidates.
    const candidates = USAGE_PATH_CANDIDATES.map((make) => make(orgId));
    const urls = cache.usageUrl
      ? [cache.usageUrl, ...candidates.filter((u) => u !== cache.usageUrl)]
      : candidates;

    let sawServerError: string | undefined;
    for (const url of urls) {
      let response: Response;
      try {
        response = await ctx.fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch (err) {
        return failed('error', 'network', err instanceof Error ? err.message : String(err));
      }
      if (response.status === 401 || response.status === 403) {
        // Session may have expired since the org id was cached.
        await ctx.cache.set<ClaudeCache>({});
        return failed('unauthenticated', 'not_logged_in', 'Log in at claude.ai');
      }
      if (response.status === 429) {
        return failed('rate_limited', 'rate_limited', 'claude.ai rate-limited us; backing off');
      }
      if (!response.ok) {
        if (response.status >= 500) sawServerError = `http_${response.status}`;
        continue; // 404 etc. — try the next candidate
      }
      const body = await readJson(response);
      if (body === undefined) continue;
      const match = matchVariant(usageVariants, body);
      if (!match.ok) continue;
      const lanes = toLanes(match.value);
      if (lanes.length === 0) continue; // validated but empty — not the usage endpoint

      if (cache.usageUrl !== url) {
        await ctx.cache.set<ClaudeCache>({ orgId, usageUrl: url });
      }
      return { ...base, status: 'ok', schemaVariant: match.variant, lanes };
    }

    if (sawServerError) {
      return failed('error', sawServerError, 'claude.ai returned a server error');
    }
    return failed(
      'error',
      'endpoint_not_verified',
      'No known claude.ai usage endpoint matched — help pin it via the "adapter broken" issue template',
    );
  },
};
