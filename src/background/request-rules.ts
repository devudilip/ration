/**
 * Origin-header rules for providers whose API rejects extension-origin
 * requests as CSRF (adapter.originOverride). A declarativeNetRequest session
 * rule sets the Origin header to the provider's own origin — but ONLY on
 * requests initiated by this extension (initiatorDomains scoping), so other
 * pages' requests are untouched and the provider's CSRF protection is not
 * weakened for anyone else. The user-agent and everything else stay honest;
 * this only makes our read-only usage requests pass the same origin check
 * the provider's own dashboard passes.
 *
 * Session rules don't survive a browser restart, so the service worker
 * re-syncs them on startup/install and whenever a provider is toggled.
 */
import { adapters } from '../adapters';
import type { Settings } from '../types';

const RULE_ID_BASE = 100;

export async function syncOriginRules(settings: Settings): Promise<void> {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;

  const removeRuleIds: number[] = [];
  const addRules: chrome.declarativeNetRequest.Rule[] = [];

  adapters.forEach((adapter, index) => {
    const ruleId = RULE_ID_BASE + index;
    removeRuleIds.push(ruleId);
    const override = adapter.originOverride;
    if (!override || !settings.providers[adapter.id]?.enabled) return;
    addRules.push({
      id: ruleId,
      priority: 1,
      action: {
        type: dnr.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          { header: 'origin', operation: dnr.HeaderOperation.SET, value: override.origin },
        ],
      },
      condition: {
        urlFilter: `|${override.urlPrefix}`,
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: [dnr.ResourceType.XMLHTTPREQUEST],
      },
    });
  });

  await dnr.updateSessionRules({ removeRuleIds, addRules });
}
