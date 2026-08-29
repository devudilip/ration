import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cursorAdapter } from '../src/adapters/cursor';
import { htmlResponse, jsonResponse, makeCtx } from './helpers';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/cursor/${name}`, import.meta.url), 'utf8'));

const PERIOD_URL = 'https://cursor.com/api/dashboard/get-current-period-usage';
const SAND_URL = 'https://cursor.com/api/dashboard/get-sand-usage-status';
const TEAMS_URL = 'https://cursor.com/api/dashboard/teams';

/** Individual account: {} works directly on the period endpoint. */
const individualResponder = (url: string): Response => {
  if (url === PERIOD_URL) return jsonResponse(fixture('period-usage.json'));
  if (url === SAND_URL) return jsonResponse(fixture('sand-usage.json'));
  return jsonResponse({}, 404);
};

const bodyOf = (init: RequestInit | undefined): Record<string, unknown> =>
  JSON.parse((init?.body as string) ?? '{}');

describe('cursor adapter', () => {
  it('parses the dashboard usage pools and the Grok weekly window', async () => {
    const ctx = makeCtx(individualResponder);
    const snap = await cursorAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('dashboard_period_usage');
    expect(snap.lanes.map((l) => [l.id, l.label, Math.round(l.headroomPct)])).toEqual([
      ['cursor_models', 'Cursor Models', 100],
      ['other_models', 'Other Models', 90],
      ['grok_weekly', 'Weekly (Grok)', 97],
    ]);
    // billingCycleEnd is an epoch-milliseconds string
    expect(snap.lanes[0]?.resetsAt).toBe(new Date(1789911772000).toISOString());
    expect(snap.lanes[2]?.resetsAt).toBe('2026-08-31T17:23:51.777Z');
  });

  it('caches the individual (no team) strategy', async () => {
    const ctx = makeCtx(individualResponder);
    await cursorAdapter.fetch(ctx);
    expect(ctx.cached()).toEqual({ teamId: null });
  });

  it('discovers the team id when the bare request is refused', async () => {
    // Team accounts: the period endpoint answers only with the right teamId.
    const ctx = makeCtx(() => jsonResponse({}, 404));
    ctx.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      ctx.requests.push({ url, init });
      if (url === PERIOD_URL) {
        return bodyOf(init).teamId === 11000001
          ? jsonResponse(fixture('period-usage.json'))
          : jsonResponse({ error: 'teamId required' }, 400);
      }
      if (url === TEAMS_URL) return jsonResponse(fixture('teams.json'));
      if (url === SAND_URL) return jsonResponse(fixture('sand-usage.json'));
      return jsonResponse({}, 404);
    }) as typeof globalThis.fetch;

    const snap = await cursorAdapter.fetch(ctx);
    expect(snap.status).toBe('ok');
    expect(ctx.cached()).toEqual({ teamId: 11000001 });
    // subsequent fetches lead with the cached team id
    await cursorAdapter.fetch(ctx);
    const periodCalls = ctx.requests.filter((r) => r.url === PERIOD_URL);
    expect(bodyOf(periodCalls[periodCalls.length - 1]?.init).teamId).toBe(11000001);
  });

  it('omits the Grok lane when the sand endpoint is absent (404)', async () => {
    const ctx = makeCtx((url) =>
      url === PERIOD_URL ? jsonResponse(fixture('period-usage.json')) : jsonResponse({}, 404),
    );
    const snap = await cursorAdapter.fetch(ctx);
    expect(snap.status).toBe('ok');
    expect(snap.lanes.map((l) => l.id)).toEqual(['cursor_models', 'other_models']);
  });

  it('reports endpoint_not_verified when no strategy matches', async () => {
    const ctx = makeCtx(() => jsonResponse({ unexpected: true }, 200));
    const snap = await cursorAdapter.fetch(ctx);
    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('endpoint_not_verified');
    expect(snap.lanes).toEqual([]);
  });

  it('maps 401/403 to unauthenticated and 429 to rate_limited', async () => {
    for (const [status, expected] of [
      [401, 'unauthenticated'],
      [403, 'unauthenticated'],
      [429, 'rate_limited'],
    ] as const) {
      const ctx = makeCtx(() => jsonResponse({}, status));
      const snap = await cursorAdapter.fetch(ctx);
      expect(snap.status).toBe(expected);
    }
  });

  it('treats an HTML body as a failed strategy, never a number', async () => {
    const ctx = makeCtx(() => htmlResponse(200));
    const snap = await cursorAdapter.fetch(ctx);
    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('endpoint_not_verified');
  });

  it('never throws on network failure', async () => {
    const ctx = makeCtx(() => {
      throw new Error('offline');
    });
    const snap = await cursorAdapter.fetch(ctx);
    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('network');
  });

  it('rides the browser session: credentials include, no Authorization header', async () => {
    const ctx = makeCtx(individualResponder);
    await cursorAdapter.fetch(ctx);

    expect(ctx.requests.length).toBeGreaterThan(0);
    for (const req of ctx.requests) {
      expect(req.init?.credentials).toBe('include');
      expect(req.init?.method).toBe('POST');
      const headers = Object.keys((req.init?.headers as Record<string, string>) ?? {});
      expect(headers.map((h) => h.toLowerCase())).not.toContain('authorization');
    }
  });
});
