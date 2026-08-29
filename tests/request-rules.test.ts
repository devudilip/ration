import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adapters } from '../src/adapters';
import { syncOriginRules } from '../src/background/request-rules';
import type { Settings } from '../src/types';
import { installChromeFake, type ChromeFake } from './chrome-fake';

const settings = (enabled: string[]): Settings => ({
  providers: Object.fromEntries(enabled.map((id) => [id, { enabled: true }])),
});

describe('syncOriginRules', () => {
  let fake: ChromeFake;

  beforeEach(() => {
    fake = installChromeFake();
  });

  afterEach(() => {
    fake.uninstall();
  });

  it('adds an origin rule for enabled providers that declare originOverride', async () => {
    await syncOriginRules(settings(['cursor']));

    expect(fake.sessionRules.size).toBe(1);
    const rule = [...fake.sessionRules.values()][0] as {
      action: { type: string; requestHeaders: { header: string; value: string }[] };
      condition: { urlFilter: string; initiatorDomains: string[]; resourceTypes: string[] };
    };
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.action.requestHeaders).toEqual([
      { header: 'origin', operation: 'set', value: 'https://cursor.com' },
    ]);
    expect(rule.condition.urlFilter).toBe('|https://cursor.com/api/');
    // Scoped to the extension's own requests only — never other pages'.
    expect(rule.condition.initiatorDomains).toEqual(['test-extension-id']);
  });

  it('adds no rules for providers without originOverride', async () => {
    await syncOriginRules(settings(['claude', 'codex']));
    expect(fake.sessionRules.size).toBe(0);
  });

  it('removes the rule when the provider is disabled', async () => {
    await syncOriginRules(settings(['cursor']));
    expect(fake.sessionRules.size).toBe(1);
    await syncOriginRules(settings([]));
    expect(fake.sessionRules.size).toBe(0);
  });

  it('is a no-op when declarativeNetRequest is unavailable', async () => {
    delete (globalThis.chrome as { declarativeNetRequest?: unknown }).declarativeNetRequest;
    await expect(syncOriginRules(settings(['cursor']))).resolves.toBeUndefined();
  });

  it('only cursor currently declares an originOverride', () => {
    expect(adapters.filter((a) => a.originOverride).map((a) => a.id)).toEqual(['cursor']);
  });
});
