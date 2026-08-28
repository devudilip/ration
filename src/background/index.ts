/**
 * MV3 service-worker entry: event wiring only. The worker is ephemeral, so
 * every handler reloads its state from chrome.storage.local — no module-level
 * mutable state.
 */
import type { Msg } from '../types';
import { getSettings, putSettings, removeProviderData, wipeAll } from '../lib/storage';
import { ALARM_NAME, ALARM_PERIOD_MIN, refreshDueProviders, updateBadge } from './refresh';

function ensureAlarm(): void {
  // Idempotent: re-creating an alarm with the same name just reschedules it.
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshDueProviders('alarm');
});

async function handleMessage(msg: Msg): Promise<void> {
  switch (msg.type) {
    case 'refresh':
      await refreshDueProviders('popup', msg.providerId);
      return;
    case 'setEnabled': {
      const settings = await getSettings();
      settings.providers[msg.providerId] = { enabled: msg.enabled };
      await putSettings(settings);
      if (msg.enabled) {
        await refreshDueProviders('enable', msg.providerId);
      } else {
        await removeProviderData(msg.providerId);
        await updateBadge();
      }
      return;
    }
    case 'wipeAll':
      await wipeAll();
      await updateBadge();
      return;
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(() => sendResponse({ ok: true }))
    .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the message channel open for the async response
});
