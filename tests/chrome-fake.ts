/** Minimal in-memory chrome.* fake covering what the background code uses. */

export interface ChromeFake {
  store: Map<string, unknown>;
  badge: { text: string; color: string };
  sessionRules: Map<number, unknown>;
  uninstall: () => void;
}

export function installChromeFake(): ChromeFake {
  const store = new Map<string, unknown>();
  const badge = { text: '', color: '' };
  const sessionRules = new Map<number, unknown>();

  const local = {
    async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
      const out: Record<string, unknown> = {};
      const wanted =
        keys === null ? [...store.keys()] : typeof keys === 'string' ? [keys] : keys;
      for (const key of wanted) {
        if (store.has(key)) out[key] = store.get(key);
      }
      return out;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const key of typeof keys === 'string' ? [keys] : keys) store.delete(key);
    },
    async clear(): Promise<void> {
      store.clear();
    },
  };

  const fake = {
    storage: { local },
    action: {
      async setBadgeText({ text }: { text: string }): Promise<void> {
        badge.text = text;
      },
      async setBadgeBackgroundColor({ color }: { color: string }): Promise<void> {
        badge.color = color;
      },
    },
    alarms: {
      create(): void {},
    },
    runtime: {
      id: 'test-extension-id',
    },
    declarativeNetRequest: {
      RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { SET: 'set' },
      ResourceType: { XMLHTTPREQUEST: 'xmlhttprequest' },
      async updateSessionRules(options: {
        removeRuleIds?: number[];
        addRules?: { id: number }[];
      }): Promise<void> {
        for (const id of options.removeRuleIds ?? []) sessionRules.delete(id);
        for (const rule of options.addRules ?? []) sessionRules.set(rule.id, rule);
      },
    },
  };

  (globalThis as { chrome?: unknown }).chrome = fake;
  return {
    store,
    badge,
    sessionRules,
    uninstall: () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    },
  };
}
