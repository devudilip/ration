/**
 * Cursor adapter (Tier A).
 *
 * Rides the user's existing cursor.com browser session via
 * `credentials: 'include'` — no cookie values are read, no tokens handled.
 *
 * Verified against a live capture (2026-08). The dashboard uses two
 * cookie-authed POST endpoints:
 *
 *  - /api/dashboard/get-current-period-usage — the "Included usage" pools.
 *    Team accounts must send {"teamId": N}; we first try {} (individual
 *    accounts), and on failure discover the team id via
 *    /api/dashboard/teams, caching whichever strategy worked.
 *  - /api/dashboard/get-sand-usage-status — the Grok Bot weekly window.
 *    Not present on all plans; a 404/400 simply omits that lane.
 *
 * Lanes: Cursor Models (auto bucket), Other Models (named/API models),
 * and Grok Bot weekly — matching the rows on cursor.com/dashboard.
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

export const CURSOR_ADAPTER_VERSION = 1;
const ORIGIN = 'https://cursor.com';
const PERIOD_USAGE_URL = `${ORIGIN}/api/dashboard/get-current-period-usage`;
const SAND_USAGE_URL = `${ORIGIN}/api/dashboard/get-sand-usage-status`;
const TEAMS_URL = `${ORIGIN}/api/dashboard/teams`;

interface CursorCache {
  /** null = individual account ({} body works); a number = team id to send. */
  teamId?: number | null;
}

const numOrStr: Schema<number | string> = (v, path) =>
  typeof v === 'number' || typeof v === 'string'
    ? ({ ok: true, value: v } as Result<number | string>)
    : { ok: false, path, expected: 'number|string' };

interface PlanUsage {
  autoPercentUsed: number;
  apiPercentUsed: number;
}

interface PeriodUsageShape {
  billingCycleEnd?: number | string | null;
  planUsage: PlanUsage;
}

const periodVariants = {
  dashboard_period_usage: obj<PeriodUsageShape>({
    billingCycleEnd: optional(nullable(numOrStr)),
    planUsage: obj<PlanUsage>({
      autoPercentUsed: num,
      apiPercentUsed: num,
    }),
  }),
};

interface SandUsageShape {
  usagePercent: number;
  nextResetTimestampUtc?: string | null;
  grokPlanLabel?: string | null;
}

const sandSchema = obj<SandUsageShape>({
  usagePercent: num,
  nextResetTimestampUtc: optional(nullable(str)),
  grokPlanLabel: optional(nullable(str)),
});

const teamsSchema = obj<{ teams: { id: number }[] }>({
  teams: arr(obj({ id: num })),
});

/** Accepts ISO strings and epoch values (seconds or milliseconds). */
function parseResetsAt(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const asNumber = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isFinite(asNumber)) {
    const ms = asNumber > 1e12 ? asNumber : asNumber * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function percentLane(id: string, label: string, usedPct: number, resetsAt: string | null): QuotaLane {
  return {
    id,
    label,
    kind: 'percent',
    used: clampPct(usedPct),
    limit: 100,
    resetsAt,
    headroomPct: clampPct(100 - usedPct),
  };
}

async function readJson(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  tier: 'A',
  hostPermissions: ['https://cursor.com/*'],
  dashboardUrl: 'https://cursor.com/dashboard',
  minRefreshMs: 60_000,
  // cursor.com rejects POSTs whose Origin isn't its own ("Invalid origin
  // for state-changing request"), and extension requests carry a
  // chrome-extension:// Origin. See background/request-rules.ts.
  originOverride: { origin: 'https://cursor.com', urlPrefix: 'https://cursor.com/api/' },

  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    const base = {
      providerId: this.id,
      displayName: this.displayName,
      adapterVersion: CURSOR_ADAPTER_VERSION,
      fetchedAt: ctx.now().toISOString(),
    };
    const failed = (
      status: 'unauthenticated' | 'rate_limited' | 'error',
      code: string,
      message: string,
    ): ProviderSnapshot => ({ ...base, status, lanes: [], error: { code, message } });

    const post = (url: string, body: Record<string, unknown>) =>
      ctx.fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    // Common status handling; returns a snapshot to surface, or null to go on.
    const gate = (response: Response): ProviderSnapshot | null => {
      if (response.status === 401 || response.status === 403) {
        return failed('unauthenticated', 'not_logged_in', 'Log in at cursor.com');
      }
      if (response.status === 429) {
        return failed('rate_limited', 'rate_limited', 'cursor.com rate-limited us; backing off');
      }
      return null;
    };

    const cache = (await ctx.cache.get<CursorCache>()) ?? {};

    // Step 1: included-usage pools, discovering the team id if needed.
    // Order: cached strategy first, then {} (individual), then team discovery.
    const bodies: Record<string, unknown>[] = [];
    if (cache.teamId != null) bodies.push({ teamId: cache.teamId });
    if (cache.teamId !== null || bodies.length === 0) bodies.push({});

    let period: PeriodUsageShape | undefined;
    let usedTeamId: number | null | undefined;
    let lastFailure = 'unknown';

    for (let attempt = 0; attempt < 2 && !period; attempt++) {
      for (const body of bodies.splice(0)) {
        if (period) break;
        let response: Response;
        try {
          response = await post(PERIOD_USAGE_URL, body);
        } catch (err) {
          return failed('error', 'network', err instanceof Error ? err.message : String(err));
        }
        const gated = gate(response);
        if (gated) return gated;
        if (!response.ok) {
          lastFailure = `http_${response.status}`;
          continue;
        }
        const json = await readJson(response);
        if (json === undefined) {
          lastFailure = 'not_json';
          continue;
        }
        const match = matchVariant(periodVariants, json);
        if (!match.ok) {
          const first = match.errors[0];
          lastFailure = `schema_mismatch at '${first?.path}'`;
          continue;
        }
        period = match.value;
        usedTeamId = 'teamId' in body ? (body.teamId as number) : null;
      }

      // Nothing worked yet: discover a team id once, then retry with it.
      if (!period && attempt === 0) {
        let response: Response;
        try {
          response = await post(TEAMS_URL, {});
        } catch (err) {
          return failed('error', 'network', err instanceof Error ? err.message : String(err));
        }
        const gated = gate(response);
        if (gated) return gated;
        if (response.ok) {
          const json = await readJson(response);
          const teams = json === undefined ? undefined : teamsSchema(json, 'teams');
          const teamId = teams?.ok ? teams.value.teams[0]?.id : undefined;
          if (teamId !== undefined) bodies.push({ teamId });
        }
      }
    }

    if (!period) {
      return failed(
        'error',
        'endpoint_not_verified',
        `cursor.com usage endpoint did not match (${lastFailure}) — help pin it via the "adapter broken" issue template`,
      );
    }

    if (cache.teamId !== usedTeamId) {
      await ctx.cache.set<CursorCache>({ teamId: usedTeamId });
    }

    const cycleResetsAt = parseResetsAt(period.billingCycleEnd);
    const lanes: QuotaLane[] = [
      percentLane('cursor_models', 'Cursor Models', period.planUsage.autoPercentUsed, cycleResetsAt),
      percentLane('other_models', 'Other Models', period.planUsage.apiPercentUsed, cycleResetsAt),
    ];

    // Step 2: Grok Bot weekly window — absent on some plans (4xx = no lane).
    let sandResponse: Response;
    try {
      sandResponse = await post(SAND_USAGE_URL, {});
    } catch (err) {
      return failed('error', 'network', err instanceof Error ? err.message : String(err));
    }
    const sandGated = gate(sandResponse);
    if (sandGated) return sandGated;
    if (sandResponse.ok) {
      const json = await readJson(sandResponse);
      if (json === undefined) {
        return failed('error', 'not_json', 'get-sand-usage-status response was not JSON');
      }
      const sand = sandSchema(json, '');
      if (!sand.ok) {
        return failed(
          'error',
          'schema_mismatch',
          `Unrecognized get-sand-usage-status shape at '${sand.path}'`,
        );
      }
      const label = sand.value.grokPlanLabel ? 'Weekly (Grok)' : 'Weekly bot usage';
      lanes.push(
        percentLane(
          'grok_weekly',
          label,
          sand.value.usagePercent,
          parseResetsAt(sand.value.nextResetTimestampUtc),
        ),
      );
    } else if (sandResponse.status >= 500) {
      return failed('error', `http_${sandResponse.status}`, 'cursor.com returned a server error');
    }
    // 404/400 etc.: plan without the Grok Bot feature — no lane, not an error.

    return { ...base, status: 'ok', schemaVariant: 'dashboard_period_usage', lanes };
  },
};
