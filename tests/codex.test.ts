import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codexAdapter } from '../src/adapters/codex';
import { htmlResponse, jsonResponse, makeCtx, NOW } from './helpers';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/codex/${name}`, import.meta.url), 'utf8'));

const SESSION_URL = 'https://chatgpt.com/api/auth/session';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

/** Responder with a live session; usage body selected per test. */
const withSession =
  (usageBody: () => Response) =>
  (url: string): Response => {
    if (url === SESSION_URL) return jsonResponse(fixture('auth-session.json'));
    if (url === USAGE_URL) return usageBody();
    return jsonResponse({}, 404);
  };

const headersOf = (init: RequestInit | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );

describe('codex adapter', () => {
  it('parses the live rate_limit shape with additional limits', async () => {
    const ctx = makeCtx(withSession(() => jsonResponse(fixture('wham-usage.rate-limit.json'))));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('wham_rate_limit');
    expect(snap.lanes.map((l) => [l.id, l.label, l.headroomPct])).toEqual([
      ['session', 'Session (5h)', 76],
      ['weekly', 'Weekly', 96],
      ['extra:gpt-reserve', 'gpt-reserve', 100],
    ]);
    // reset_at (epoch seconds) wins over reset_after_seconds
    expect(snap.lanes[0]?.resetsAt).toBe(new Date(1787962525 * 1000).toISOString());
  });

  it('mints the bearer from the session endpoint and never persists it', async () => {
    const ctx = makeCtx(withSession(() => jsonResponse(fixture('wham-usage.rate-limit.json'))));
    await codexAdapter.fetch(ctx);

    expect(ctx.requests.map((r) => r.url)).toEqual([SESSION_URL, USAGE_URL]);
    // session call: cookie-riding only, no Authorization
    const sessionHeaders = headersOf(ctx.requests[0]?.init);
    expect(ctx.requests[0]?.init?.credentials).toBe('include');
    expect(sessionHeaders).not.toHaveProperty('authorization');
    // usage call: the page's own auth style — bearer from the session response
    const usageHeaders = headersOf(ctx.requests[1]?.init);
    expect(usageHeaders['authorization']).toBe('Bearer test-access-token-XXX');
    // the token is never written to the adapter's persistent cache
    expect(ctx.cached()).toBeUndefined();
  });

  it('parses the legacy top-level primary_window variant', async () => {
    const ctx = makeCtx(withSession(() => jsonResponse(fixture('wham-usage.primary-window.json'))));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('wham_windows');
    expect(snap.lanes.map((l) => [l.id, l.headroomPct])).toEqual([
      ['session', 81],
      ['weekly', 96],
    ]);
    expect(snap.lanes[0]?.resetsAt).toBe(new Date(NOW.getTime() + 16_980_000).toISOString());
  });

  it('parses the legacy five_hour_limit variant (field-name drift)', async () => {
    const ctx = makeCtx(withSession(() => jsonResponse(fixture('wham-usage.five-hour-limit.json'))));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('wham_named');
    expect(snap.lanes.map((l) => [l.id, l.headroomPct])).toEqual([
      ['session', 12],
      ['weekly', 60],
    ]);
  });

  it('treats a logged-out session (200 with no accessToken) as unauthenticated', async () => {
    const ctx = makeCtx((url) =>
      url === SESSION_URL ? jsonResponse({}) : jsonResponse(fixture('wham-usage.rate-limit.json')),
    );
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('unauthenticated');
    // never calls the usage endpoint without a token
    expect(ctx.requests.map((r) => r.url)).toEqual([SESSION_URL]);
  });

  it('reports an unknown usage shape as schema_mismatch, never a zeroed lane', async () => {
    const ctx = makeCtx(withSession(() => jsonResponse(fixture('wham-usage.unknown-shape.json'))));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('schema_mismatch');
    expect(snap.lanes).toEqual([]);
  });

  it('maps session-endpoint statuses: 401/403 unauthenticated, 429 rate_limited', async () => {
    for (const [status, expected] of [
      [401, 'unauthenticated'],
      [403, 'unauthenticated'],
      [429, 'rate_limited'],
      [500, 'error'],
    ] as const) {
      const ctx = makeCtx(() => jsonResponse({}, status));
      const snap = await codexAdapter.fetch(ctx);
      expect(snap.status).toBe(expected);
    }
  });

  it('maps usage-endpoint statuses after a good session', async () => {
    for (const [status, expected] of [
      [401, 'unauthenticated'],
      [429, 'rate_limited'],
      [500, 'error'],
    ] as const) {
      const ctx = makeCtx(withSession(() => jsonResponse({}, status)));
      const snap = await codexAdapter.fetch(ctx);
      expect(snap.status).toBe(expected);
    }
  });

  it('treats a non-JSON session body as unauthenticated and usage body as error', async () => {
    const loggedOut = makeCtx(() => htmlResponse(200));
    expect((await codexAdapter.fetch(loggedOut)).status).toBe('unauthenticated');

    const ctx = makeCtx(withSession(() => htmlResponse(200)));
    const snap = await codexAdapter.fetch(ctx);
    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('not_json');
  });

  it('never throws on network failure', async () => {
    const ctx = makeCtx(() => {
      throw new Error('offline');
    });
    const snap = await codexAdapter.fetch(ctx);
    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('network');
  });
});
