# Contributing to Ration

Thanks for helping! The most valuable contribution is a **provider
adapter** — Ration's coverage is designed to grow through single-file
community contributions.

## Dev setup

```sh
npm install
npm run watch        # rebuilds dist/ on save
```

Load `dist/` as an unpacked extension at `chrome://extensions` (Developer
mode → Load unpacked), and reload it there after changes. `npm run ci` runs
exactly what GitHub Actions runs: typecheck, tests, build.

## Adding a provider adapter

An adapter is five artifacts:

1. `src/adapters/<id>.ts` — the adapter itself
2. One line in `src/adapters/index.ts` — import it and append to the array
3. Its origin added to `optional_host_permissions` in `public/manifest.json`
4. `tests/fixtures/<id>/*.json` — recorded responses (redacted!)
5. `tests/<id>.test.ts` — fixture tests

### The contract (`src/types.ts`)

Your adapter implements `ProviderAdapter` and returns `ProviderSnapshot`s
made of `QuotaLane`s. Three rules are non-negotiable, and reviewers will
check them:

- **Never throw.** Every failure path — logged out, rate-limited, server
  error, unparseable body — returns a snapshot with the matching `status`
  (`unauthenticated` / `rate_limited` / `error`). One broken adapter must
  never take down the popup.
- **Never coerce to zero.** Validate the response with `src/lib/validate.ts`
  (see `matchVariant` for handling multiple known shapes). If the shape
  doesn't match, return `status: 'error'` with code `schema_mismatch`. A
  confidently wrong number is worse than no number.
- **Read raw field names, not inferred labels.** Codex, for example, has
  been observed with both `primary_window`/`secondary_window` and
  `five_hour_limit`/`weekly_limit`. Match each known shape literally as a
  named variant and record which one matched in `snapshot.schemaVariant`.
  Mislabeling which window is which produces a confidently wrong display.

`headroomPct` (0–100 remaining) is the universal comparator. A provider's
overall headroom is the **minimum** across its lanes — you're blocked by
whichever ceiling you hit first.

### Politeness rules

We read undocumented endpoints as guests:

- Set `minRefreshMs` to at least `60_000`. The scheduler additionally
  enforces a hard floor of one request per provider per minute and
  exponential backoff on failures — your adapter doesn't need to implement
  backoff, just report honest statuses.
- Use `ctx.fetch(url, { credentials: 'include', headers: { Accept:
  'application/json' } })`. Do not spoof another client's identity, add
  fake client headers, or construct `Authorization` headers. Cookie-riding
  Tier A adapters must never read credential values at all.
- **Anthropic-specific:** PRs that read, store, or transmit Claude Code /
  claude.ai OAuth tokens will be declined — Anthropic's terms restrict
  those tokens to their own products (see README).

### Recording a fixture

1. Log into the provider's site, open DevTools → Network.
2. Open the provider's own usage/settings page and find the usage request.
3. Copy the response JSON into `tests/fixtures/<id>/`.
4. **Redact every identifier** — org/user UUIDs, emails, plan names if
   sensitive. Keep the shape and realistic numbers.

Also record (or hand-write) at least: a logged-out response, and a
deliberately wrong shape (for the `schema_mismatch` test).

### Worked example: a hypothetical Cursor adapter

```ts
// src/adapters/cursor.ts
import type { FetchContext, ProviderAdapter, ProviderSnapshot } from '../types';
import { clampPct } from '../lib/headroom';
import { matchVariant, num, obj, optional } from '../lib/validate';

const variants = {
  usage_summary: obj({
    included_usd_used: num,
    included_usd_limit: num,
    // ...match the real field names you observed, literally
  }),
};

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  tier: 'A',
  hostPermissions: ['https://cursor.com/*'],
  dashboardUrl: 'https://cursor.com/settings',
  minRefreshMs: 60_000,
  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    // 1. ctx.fetch the usage endpoint with credentials: 'include'
    // 2. map 401/403 → 'unauthenticated', 429 → 'rate_limited'
    // 3. matchVariant(variants, body) — mismatch → 'schema_mismatch' error
    // 4. build QuotaLanes; for currency lanes:
    //    kind: 'currency', used, limit,
    //    headroomPct: clampPct(100 * (1 - used / limit))
    // ...
  },
};
```

Then in `src/adapters/index.ts`:

```ts
import { cursorAdapter } from './cursor';
export const adapters = [claudeAdapter, codexAdapter, cursorAdapter] as const;
```

Look at `src/adapters/codex.ts` (simpler) and `src/adapters/claude.ts`
(endpoint probing, per-provider cache) for complete, tested references, and
mirror `tests/codex.test.ts` for the test checklist: happy path per
variant, unauthenticated, rate-limited, unknown shape → `schema_mismatch`,
never-throws, and no `Authorization` header.

## Non-adapter contributions

Bug fixes and small improvements: open a PR. New surface area (options
pages, notifications, history) tends to be roadmap-sensitive — open an
issue first so we don't waste your time.

## Commit style

Conventional commits (`feat(adapter): …`, `fix: …`, `docs: …`). CI must be
green: `npm run ci` locally before pushing.
