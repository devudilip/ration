# Ration - AI Quota Tracker

**One glance at remaining quota across your AI subscriptions.** A browser
extension that answers a single question: *which of my AI tools has capacity
right now?*

If you pay for Claude, Codex/ChatGPT, Cursor and friends, each one meters
usage differently, resets on a different cycle, and buries the number behind
a different settings page. Nobody checks three dashboards before starting a
long agent run — so nobody checks at all, until they get cut off forty
minutes in. Ration puts all of it one click away, in the browser where those
dashboards already live.

- **Popup**: provider cards sorted by headroom — the tool with the most
  capacity on top, per-limit bars, reset countdowns, and the age of every
  reading.
- **Badge**: the extension icon shows the *lowest* headroom across your
  enabled providers — the wall you'll hit first. Quiet when everything is
  fine, amber under 40%, red under 15%, grey `!` when a reading failed.
- **No accounts, no telemetry, no backend. Ever.** Everything stays in your
  browser profile.

## Supported providers

| Provider | Status | How it reads your quota |
|---|---|---|
| Claude (claude.ai) | ✅ v0.1 | Your existing claude.ai browser session |
| Codex (chatgpt.com) | ✅ v0.1 | Your existing chatgpt.com browser session |
| Cursor (cursor.com) | ✅ v0.2 | Your existing cursor.com browser session |
| Gemini | 🙏 PRs welcome | — |
| Grok | 🙏 PRs welcome | — |
| GitHub Copilot | 🙏 PRs welcome | — |

Adding a provider is designed to be a single-file contribution — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Install

**⭐ Easiest — [Chrome Web Store](https://chromewebstore.google.com/detail/ration-%E2%80%94-ai-quota-tracker/lhmbecapbijngjmmbojinikaaabeajoe):**
one click, auto-updates. Works on Chrome, Brave, Edge, Opera and other
Chromium browsers. (**Website:** <https://devudilip.github.io/ration>)

**Option A — from a release (no build tools needed):**

1. Download `ration-vX.Y.Z.zip` from the
   [latest release](https://github.com/devudilip/ration/releases/latest)
   and unzip it.
2. Follow the browser steps below, selecting the unzipped folder.

**Option B — build from source:**

```sh
git clone https://github.com/devudilip/ration.git
cd ration
npm install
npm run build
```

Then in Chrome (or any Chromium browser):

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder (or the unzipped release
   folder).
3. Click the Ration icon and toggle on the providers you use. Each toggle
   asks for permission to that provider's site only, at that moment.
4. You must be logged into the provider's site in this browser — Ration
   reads the same usage endpoint the provider's own settings page uses.

Time to first value should be under 20 seconds.

## How it works — and what it never does

Ration rides your **existing browser login**. When you enable a provider it
asks Chrome for permission to that provider's origin, then calls the same
internal usage endpoint the provider's own settings page calls, with
`credentials: 'include'` so your session cookie is attached by the browser
itself.

Privacy and safety commitments, in order of importance:

- **No credentials are ever read or stored.** The extension never requests
  the `cookies` permission and never sees cookie values. Where a provider's
  own web app authenticates with a short-lived session token (Codex), the
  adapter asks that provider's own session endpoint for the token at
  refresh time — exactly what the page itself does — uses it in-memory for
  the single request, and never persists it (there's a test asserting
  this). For Claude, no `Authorization` header is ever constructed at all
  (also tested).
- **Zero telemetry.** No analytics, no error reporting service, no remote
  config, no runtime dependencies at all. What you see in this repo is the
  entire behavior.
- **Everything is local.** Snapshots live in `chrome.storage.local` (never
  synced), and **Clear all data** in the popup footer wipes every byte
  Ration has stored.
- **Polite polling.** One scheduled refresh per provider every 5 minutes,
  a hard floor of one request per provider per minute regardless of what
  you click, and exponential backoff (up to 60 min) whenever a provider
  errors or rate-limits. We are guests on these endpoints.

### The Claude Code OAuth constraint

Anthropic's consumer terms restrict Claude Code / claude.ai OAuth tokens to
those products. **Ration does not ship, bundle, or document any path that
uses a Claude Code OAuth token** — Claude support works only by riding your
own claude.ai browser session, exactly like opening Settings → Usage
yourself. Please don't send PRs that handle Anthropic OAuth tokens; they
will be declined to protect contributors' and users' accounts.

### These endpoints are undocumented — they will break

Every endpoint Ration reads is internal to its provider and can change
without notice. When that happens the affected card shows an error and the
badge shows a grey `!` — **a failed reading always looks failed; Ration
never renders a guess as a number.** If you see a grey `!` that isn't a
logged-out session, please
[open an "adapter broken" issue](../../issues/new/choose): with your help
(DevTools → Network tab → the provider's usage page → copy the response
shape, **redact any ids**) fixes are typically a few lines.

The claude.ai usage endpoint in particular is community-verified: the
adapter probes a short list of candidate paths and reports honestly if none
matches your account. Captures from real accounts are the fastest way to
pin it down.

## Development

```sh
npm install
npm run watch      # rebuild dist/ on save
npm test           # vitest, fixture-based — no network
npm run typecheck
npm run ci         # what CI runs: typecheck + test + build
```

Reload the extension from `chrome://extensions` after a rebuild.

## Roadmap

v0.1 is deliberately small: two providers, popup, badge, scheduled refresh.
Next, roughly in order — history sparklines, more providers (Cursor,
Gemini, Grok, Copilot), opt-in threshold notifications, Firefox, store
builds. See the issues for current plans; the
[product requirements discussion](../../issues) is open.

## License

[Apache-2.0](LICENSE). Contributions welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).
