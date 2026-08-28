import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codexAdapter } from '../src/adapters/codex';
import { htmlResponse, jsonResponse, makeCtx, NOW } from './helpers';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/codex/${name}`, import.meta.url), 'utf8'));

describe('codex adapter', () => {
  it('parses the primary_window/secondary_window variant', async () => {
    const ctx = makeCtx(() => jsonResponse(fixture('wham-usage.primary-window.json')));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('wham_windows');
    expect(snap.lanes.map((l) => [l.id, l.headroomPct])).toEqual([
      ['session', 81],
      ['weekly', 96],
    ]);
    // resets_in_seconds is relative to the injected clock
    expect(snap.lanes[0]?.resetsAt).toBe(new Date(NOW.getTime() + 16_980_000).toISOString());
    // resets_at is epoch seconds
    expect(snap.lanes[1]?.resetsAt).toBe(new Date(1756897800 * 1000).toISOString());
  });

  it('parses the five_hour_limit/weekly_limit variant (field-name drift)', async () => {
    const ctx = makeCtx(() => jsonResponse(fixture('wham-usage.five-hour-limit.json')));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.schemaVariant).toBe('wham_named');
    expect(snap.lanes.map((l) => [l.id, l.headroomPct])).toEqual([
      ['session', 12],
      ['weekly', 60],
    ]);
  });

  it('maps additional_rate_limits to extra lanes', async () => {
    const ctx = makeCtx(() => jsonResponse(fixture('wham-usage.additional-limits.json')));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('ok');
    expect(snap.lanes.map((l) => l.id)).toEqual(['session', 'extra:gpt-5-pro', 'extra:1']);
    expect(snap.lanes[1]?.label).toBe('gpt-5-pro');
    expect(snap.lanes[1]?.headroomPct).toBe(25);
  });

  it('reports an unknown shape as schema_mismatch, never a zeroed lane', async () => {
    const ctx = makeCtx(() => jsonResponse(fixture('wham-usage.unknown-shape.json')));
    const snap = await codexAdapter.fetch(ctx);

    expect(snap.status).toBe('error');
    expect(snap.error?.code).toBe('schema_mismatch');
    expect(snap.lanes).toEqual([]);
  });

  it('maps 401/403 to unauthenticated and 429 to rate_limited', async () => {
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

  it('treats a non-JSON body as an error state', async () => {
    const ctx = makeCtx(() => htmlResponse(200));
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

  it('rides the browser session: credentials include, no Authorization header', async () => {
    const ctx = makeCtx(() => jsonResponse(fixture('wham-usage.primary-window.json')));
    await codexAdapter.fetch(ctx);

    expect(ctx.requests).toHaveLength(1);
    const init = ctx.requests[0]?.init;
    expect(init?.credentials).toBe('include');
    const headers = Object.keys((init?.headers as Record<string, string>) ?? {});
    expect(headers.map((h) => h.toLowerCase())).not.toContain('authorization');
  });
});
