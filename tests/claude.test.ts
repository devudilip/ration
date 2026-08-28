import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude';
import { htmlResponse, jsonResponse, makeCtx } from './helpers';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/claude/${name}`, import.meta.url), 'utf8'));

const CHAT_ORG = '00000000-0000-4000-8000-0000000000ca';
const orgs = () => fixture('organizations.json');
const usage = () => fixture('usage.limits.json');

/** Happy-path responder: org discovery, then usage on the first candidate. */
const happyResponder = (url: string): Response => {
  if (url === 'https://claude.ai/api/organizations') return jsonResponse(orgs());
  if (url === `https://claude.ai/api/organizations/${CHAT_ORG}/usage`) {
    return jsonResponse(usage());
  }
  return jsonResponse({ error: 'not found' }, 404);
};

describe('claude adapter', () => {
  it('discovers the chat-capable org and parses the limits array (live shape)', async () => {
    const ctx = makeCtx(happyResponder);
    const snap = await claudeAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('org_usage_limits');
    expect(snap.lanes.map((l) => [l.id, l.label, l.headroomPct])).toEqual([
      ['session', 'Session (5h)', 87],
      ['weekly_all', 'Weekly (all models)', 95],
      ['weekly_scoped:Fable', 'Weekly (Fable)', 93],
    ]);
    // Microsecond-precision ISO timestamps normalize cleanly
    expect(snap.lanes[0]?.resetsAt).toBe('2026-08-28T20:39:59.559Z');
  });

  it('falls back to the top-level windows shape, tolerating null windows', async () => {
    const ctx = makeCtx((url) =>
      url === 'https://claude.ai/api/organizations'
        ? jsonResponse(orgs())
        : jsonResponse(fixture('usage.expected.json')),
    );
    const snap = await claudeAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('org_usage_windows');
    // seven_day_sonnet is null in the fixture and must be skipped, not fatal
    expect(snap.lanes.map((l) => [l.id, l.headroomPct])).toEqual([
      ['five_hour', 96],
      ['seven_day', 97],
      ['seven_day_opus', 96],
    ]);
    // ISO string and epoch-seconds reset formats both normalize
    expect(snap.lanes[0]?.resetsAt).toBe('2026-08-28T13:08:00.000Z');
    expect(snap.lanes[2]?.resetsAt).toBe(new Date(1756825200 * 1000).toISOString());
  });

  it('caches org id and verified usage URL — second fetch is one request', async () => {
    const ctx = makeCtx(happyResponder);
    await claudeAdapter.fetch(ctx);
    const requestsAfterFirst = ctx.requests.length;
    expect(ctx.cached()).toEqual({
      orgId: CHAT_ORG,
      usageUrl: `https://claude.ai/api/organizations/${CHAT_ORG}/usage`,
    });

    const snap = await claudeAdapter.fetch(ctx);
    expect(snap.status).toBe('ok');
    expect(ctx.requests.length).toBe(requestsAfterFirst + 1);
  });

  it('falls through candidates until one validates', async () => {
    const ctx = makeCtx((url) => {
      if (url === 'https://claude.ai/api/organizations') return jsonResponse(orgs());
      if (url.endsWith('/usage')) return jsonResponse({}, 404);
      if (url.endsWith('/usage_limits')) return jsonResponse(usage());
      return jsonResponse({}, 404);
    });
    const snap = await claudeAdapter.fetch(ctx);
    expect(snap.status).toBe('ok');
    expect(ctx.cached()).toMatchObject({
      usageUrl: `https://claude.ai/api/organizations/${CHAT_ORG}/usage_limits`,
    });
  });

  it('reports endpoint_not_verified when no candidate matches', async () => {
    const ctx = makeCtx((url) =>
      url === 'https://claude.ai/api/organizations'
        ? jsonResponse(orgs())
        : jsonResponse(fixture('usage.unknown-shape.json')),
    );
    const snap = await claudeAdapter.fetch(ctx);
    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('endpoint_not_verified');
    expect(snap.lanes).toEqual([]);
  });

  it('treats a logged-out HTML shell as unauthenticated', async () => {
    const ctx = makeCtx(() => htmlResponse(200));
    const snap = await claudeAdapter.fetch(ctx);
    expect(snap.status).toBe('unauthenticated');
  });

  it('maps 401 to unauthenticated and clears the cache on session expiry', async () => {
    const ctx = makeCtx(happyResponder);
    await claudeAdapter.fetch(ctx); // populate cache

    let loggedOut = false;
    const ctx2 = makeCtx((url) => {
      if (loggedOut) return jsonResponse({}, 401);
      return happyResponder(url);
    });
    await claudeAdapter.fetch(ctx2);
    loggedOut = true;
    const snap = await claudeAdapter.fetch(ctx2);
    expect(snap.status).toBe('unauthenticated');
    expect(ctx2.cached()).toEqual({});
  });

  it('maps 429 to rate_limited', async () => {
    const ctx = makeCtx(() => jsonResponse({}, 429));
    const snap = await claudeAdapter.fetch(ctx);
    expect(snap.status).toBe('rate_limited');
  });

  it('never throws on network failure', async () => {
    const ctx = makeCtx(() => {
      throw new Error('offline');
    });
    const snap = await claudeAdapter.fetch(ctx);
    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('network');
  });

  it('LEGAL: never constructs an Authorization header on any request', async () => {
    const ctx = makeCtx(happyResponder);
    await claudeAdapter.fetch(ctx);

    expect(ctx.requests.length).toBeGreaterThan(1);
    for (const req of ctx.requests) {
      expect(req.init?.credentials).toBe('include');
      const headers = Object.keys((req.init?.headers as Record<string, string>) ?? {});
      expect(headers.map((h) => h.toLowerCase())).not.toContain('authorization');
    }
  });
});
