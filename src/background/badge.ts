/**
 * Badge policy: the icon shows the LOWEST headroom across enabled providers —
 * the number that will block you first — and stays visually silent when
 * everything is fine.
 */
import { isStale, providerHeadroom } from '../lib/headroom';
import type { ProviderSnapshot, Settings } from '../types';

export const COLOR_AMBER = '#f9ab00';
export const COLOR_RED = '#d93025';
export const COLOR_GREY = '#9aa0a6';

export type BadgeState = { text: string; color: string } | { clear: true };

export function computeBadge(
  snapshots: Record<string, ProviderSnapshot>,
  settings: Settings,
  now: Date,
): BadgeState {
  const enabledIds = Object.entries(settings.providers)
    .filter(([, v]) => v.enabled)
    .map(([id]) => id);
  if (enabledIds.length === 0) return { clear: true };

  const headrooms: number[] = [];
  for (const id of enabledIds) {
    const snap = snapshots[id];
    // No snapshot yet = first fetch in flight; not an error condition.
    if (!snap) continue;
    const headroom = providerHeadroom(snap);
    if (snap.status !== 'ok' || headroom === null || isStale(snap, now)) {
      return { text: '!', color: COLOR_GREY };
    }
    headrooms.push(headroom);
  }
  if (headrooms.length === 0) return { clear: true };

  const min = Math.min(...headrooms);
  if (min > 40) return { clear: true };
  const text = `${Math.round(min)}`;
  return { text, color: min < 15 ? COLOR_RED : COLOR_AMBER };
}

export function applyBadge(state: BadgeState): void {
  if ('clear' in state) {
    void chrome.action.setBadgeText({ text: '' });
    return;
  }
  void chrome.action.setBadgeText({ text: state.text });
  void chrome.action.setBadgeBackgroundColor({ color: state.color });
}
