# Chrome Web Store listing — copy-paste source

Everything below maps 1:1 to fields in the
[Chrome Web Store developer console](https://chrome.google.com/webstore/devconsole).
Keep this file updated when the listing changes — it is the source of truth.

## Store listing tab

**Name**

```
Ration — AI Quota Tracker
```

**Summary** (132 chars max)

```
One glance at remaining quota across your AI subscriptions — Claude, Codex, and more. No accounts, no telemetry.
```

**Description**

```
If you pay for more than one AI tool, you know the drill: every provider
meters usage differently, resets on a different cycle, and buries the
number behind a different settings page. Nobody checks three dashboards
before starting a long task — so nobody checks at all, until they get cut
off mid-run.

Ration puts all of it one click away:

• Provider cards sorted by headroom — the subscription with the most
  capacity is on top, because that's the answer to "which tool should I
  use right now?"
• Every limit as its own bar: session windows, weekly limits,
  model-specific pools — with remaining percentage and reset countdown.
• A toolbar badge showing the lowest headroom across your providers — the
  wall you'll hit first. Quiet when everything is fine, amber under 40%,
  red under 15%.
• Supported today: Claude (claude.ai) and Codex (chatgpt.com). More
  providers are added by the open-source community — one file per
  provider.

PRIVACY, BY DESIGN
• No account, no sign-up, no backend. Ration talks only to the provider
  sites you enable.
• Zero telemetry and zero analytics. The extension has no runtime
  dependencies at all — the entire behavior is auditable in the source.
• It never reads your cookies or stores any credential. It simply rides
  the login you already have in your browser, exactly like opening the
  provider's own usage page.
• Each provider's site access is an OPTIONAL permission, requested only
  when you switch that provider on.
• Everything is stored locally in your browser and can be wiped with one
  click.

HONEST BY DESIGN
Ration reads the same internal endpoints the providers' own settings pages
use. When a provider changes something, the affected card shows an error
state — never a wrong number. Fixes ship fast and the project is fully
open source: https://github.com/devudilip/ration
```

**Category**: Developer Tools
**Language**: English

**Screenshots**: upload `docs/store/screenshots/store-light.png` and
`store-dark.png` (1280×800).

## Privacy tab

**Single purpose description**

```
Ration displays the remaining usage quota of the AI subscription services
the user enables (e.g. Claude, ChatGPT/Codex), in a popup and a toolbar
badge, by reading each service's usage endpoint using the user's existing
browser session.
```

**Permission justifications**

- `storage`:

  ```
  Caches the most recent quota readings and the user's provider on/off
  settings locally (chrome.storage.local), so the popup renders instantly
  and settings persist. Nothing is synced or transmitted anywhere.
  ```

- `alarms`:

  ```
  Schedules a background quota refresh every 5 minutes per enabled
  provider, so the toolbar badge stays current without keeping a
  persistent background process.
  ```

- Optional host permission `https://claude.ai/*`:

  ```
  Requested only when the user enables Claude tracking. Used solely to
  call claude.ai's own usage endpoint with the user's existing browser
  session, exactly like the user opening claude.ai Settings → Usage. No
  page content is read or modified; no cookies are accessed.
  ```

- Optional host permission `https://chatgpt.com/*`:

  ```
  Requested only when the user enables Codex/ChatGPT tracking. Used solely
  to call chatgpt.com's own usage endpoint with the user's existing
  browser session, exactly like the user opening ChatGPT Settings → Usage.
  No page content is read or modified; no cookies are accessed.
  ```

**Remote code**: No, I am not using remote code.
(All code ships in the package; there are zero runtime dependencies and no
`eval`/remote script loading.)

**Data usage**: check **none** of the collection categories. Ration
collects no user data: nothing is transmitted to the developer or any
third party. Quota readings stay in the user's local browser storage.

**Certification checkboxes**: all three (complies with policies, data
usage is accurate, no prohibited use) can be checked truthfully.
