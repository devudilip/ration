/**
 * Popup renderer. Reads only from chrome.storage.local — it never fetches.
 * It renders the last stored snapshots instantly, asks the service worker
 * for a refresh, and re-renders as results stream into storage.
 *
 * DOM is built with createElement/textContent only: lane labels come from
 * provider responses, so nothing remote-derived ever meets innerHTML.
 */
import { adapters } from '../adapters';
import { providerHeadroom } from '../lib/headroom';
import { getAllSnapshots, getSettings } from '../lib/storage';
import { formatAge, formatCountdown } from '../lib/time';
import type { Msg, ProviderAdapter, ProviderSnapshot, Settings } from '../types';

const cardsEl = document.getElementById('cards') as HTMLElement;
const ageEl = document.getElementById('age') as HTMLElement;
const wipeEl = document.getElementById('wipe') as HTMLButtonElement;

const send = (msg: Msg): Promise<unknown> => chrome.runtime.sendMessage(msg);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statusClass(headroom: number | null): string {
  if (headroom === null) return 'status-bad';
  if (headroom < 15) return 'status-bad';
  if (headroom <= 40) return 'status-warn';
  return 'status-ok';
}

function barClass(headroom: number): string {
  if (headroom < 15) return 'bar bar-bad';
  if (headroom <= 40) return 'bar bar-warn';
  return 'bar';
}

function providerLink(adapter: ProviderAdapter): HTMLAnchorElement {
  const link = el('a', 'provider-name', adapter.displayName);
  link.href = adapter.dashboardUrl;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.title = `Open the ${adapter.displayName} usage dashboard`;
  return link;
}

function renderOkCard(adapter: ProviderAdapter, snap: ProviderSnapshot, now: Date): HTMLElement {
  const headroom = providerHeadroom(snap);
  const card = el('div', `card ${statusClass(headroom)}`);
  const head = el('div', 'card-head');
  head.append(el('span', 'status-glyph', headroom !== null && headroom > 40 ? '✓' : '⚠'));
  head.append(providerLink(adapter));
  head.append(el('span', 'headroom', headroom === null ? '—' : `${Math.round(headroom)}%`));
  card.append(head);

  for (const lane of snap.lanes) {
    const row = el('div', 'lane');
    row.append(el('span', 'lane-label', lane.label));
    const bar = el('div', barClass(lane.headroomPct));
    const fill = el('div', 'bar-fill');
    fill.style.width = `${Math.min(100, Math.max(0, lane.headroomPct))}%`;
    bar.title = `${Math.round(lane.headroomPct)}% left`;
    bar.append(fill);
    row.append(bar);
    const countdown = formatCountdown(lane.resetsAt, now);
    row.append(el('span', 'lane-reset', countdown ? `resets ${countdown}` : ''));
    card.append(row);
  }
  return card;
}

function renderProblemCard(adapter: ProviderAdapter, snap: ProviderSnapshot): HTMLElement {
  const card = el('div', 'card status-bad');
  const head = el('div', 'card-head');
  head.append(el('span', 'status-glyph', '✕'));
  head.append(providerLink(adapter));
  card.append(head);

  const note = el('div', 'card-note');
  if (snap.status === 'unauthenticated') {
    note.append('Not logged in — ');
    const login = el('a', undefined, `open ${adapter.displayName} ›`);
    login.href = new URL(adapter.dashboardUrl).origin;
    login.target = '_blank';
    login.rel = 'noreferrer noopener';
    note.append(login);
  } else if (snap.status === 'rate_limited') {
    note.textContent = 'Rate-limited by the provider — backing off, will retry.';
  } else {
    note.textContent = snap.error
      ? `Error: ${snap.error.message}`
      : 'Something went wrong reading this provider.';
  }
  card.append(note);
  return card;
}

function renderPendingCard(adapter: ProviderAdapter): HTMLElement {
  const card = el('div', 'card');
  const head = el('div', 'card-head');
  head.append(el('span', 'status-glyph', '…'));
  head.append(providerLink(adapter));
  card.append(head);
  card.append(el('div', 'card-note', 'Fetching…'));
  return card;
}

function renderToggleRow(adapter: ProviderAdapter, enabled: boolean): HTMLElement {
  const row = el('div', 'toggle-row');
  row.append(el('span', 'provider-name', adapter.displayName));
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.checked = enabled;
  toggle.title = `Track ${adapter.displayName}`;
  toggle.addEventListener('change', () => {
    void onToggle(adapter, toggle);
  });
  row.append(toggle);
  return row;
}

async function onToggle(adapter: ProviderAdapter, toggle: HTMLInputElement): Promise<void> {
  if (toggle.checked) {
    // Host permission must be requested from the popup: it needs a user gesture.
    const granted = await chrome.permissions.request({ origins: adapter.hostPermissions });
    if (!granted) {
      toggle.checked = false;
      return;
    }
    await send({ type: 'setEnabled', providerId: adapter.id, enabled: true });
  } else {
    await send({ type: 'setEnabled', providerId: adapter.id, enabled: false });
    await chrome.permissions.remove({ origins: adapter.hostPermissions });
  }
  await render();
}

async function render(): Promise<void> {
  const [settings, snapshots]: [Settings, Record<string, ProviderSnapshot>] = await Promise.all([
    getSettings(),
    getAllSnapshots(),
  ]);
  const now = new Date();

  const enabled = adapters.filter((a) => settings.providers[a.id]?.enabled);
  const disabled = adapters.filter((a) => !settings.providers[a.id]?.enabled);

  const ok: { adapter: ProviderAdapter; snap: ProviderSnapshot; headroom: number }[] = [];
  const problems: { adapter: ProviderAdapter; snap: ProviderSnapshot }[] = [];
  const pending: ProviderAdapter[] = [];

  for (const adapter of enabled) {
    const snap = snapshots[adapter.id];
    if (!snap) {
      pending.push(adapter);
    } else if (snap.status === 'ok' && providerHeadroom(snap) !== null) {
      ok.push({ adapter, snap, headroom: providerHeadroom(snap)! });
    } else {
      problems.push({ adapter, snap });
    }
  }
  // The routing answer: most headroom first.
  ok.sort((a, b) => b.headroom - a.headroom);

  cardsEl.replaceChildren();
  for (const { adapter, snap } of ok) cardsEl.append(renderOkCard(adapter, snap, now));
  for (const { adapter, snap } of problems) cardsEl.append(renderProblemCard(adapter, snap));
  for (const adapter of pending) cardsEl.append(renderPendingCard(adapter));

  if (disabled.length > 0) {
    cardsEl.append(el('div', 'section-label', enabled.length > 0 ? 'More providers' : 'Providers'));
    for (const adapter of disabled) cardsEl.append(renderToggleRow(adapter, false));
  }

  const fetchTimes = Object.values(snapshots)
    .map((s) => Date.parse(s.fetchedAt))
    .filter((t) => !Number.isNaN(t));
  ageEl.textContent =
    fetchTimes.length > 0
      ? `⟳ ${formatAge(new Date(Math.max(...fetchTimes)).toISOString(), now)}`
      : '';
}

wipeEl.addEventListener('click', () => {
  void send({ type: 'wipeAll' }).then(render);
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void render();
});

// Timestamps ("40s ago", countdowns) drift while the popup is open.
setInterval(() => void render(), 30_000);

void render();
// Ask for fresh data after first paint; the worker applies its freshness
// and rate-limit gates, and results stream back via storage.onChanged.
void send({ type: 'refresh' });
