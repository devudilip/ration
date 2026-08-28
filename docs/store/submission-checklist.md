# Chrome Web Store submission checklist

A one-time walkthrough for publishing Ration. Budget ~30 minutes of form
filling plus a review wait of one to several days.

## 1. Register (once, $5)

1. Go to the [developer console](https://chrome.google.com/webstore/devconsole)
   with the Google account that should own the listing.
2. Pay the one-time $5 registration fee and accept the developer agreement.
3. In **Account** settings, set a contact email and verify it (required
   before you can publish).

## 2. Get the package

Use the zip from the release you're shipping — it's the exact build CI
tested:

- Download `ration-vX.Y.Z.zip` from
  <https://github.com/devudilip/ration/releases/latest>.
- Do **not** re-zip a local build; the release artifact is reproducible
  and its SHA-256 is recorded on the release.

## 3. Create the item

1. Developer console → **+ New item** → upload the zip.
2. Fill the **Store listing** tab from [`listing.md`](listing.md) —
   name, summary, description, category, language.
3. Upload the screenshots from `screenshots/` (1280×800).
   Optional but recommended: a 128×128 store icon is taken from the
   manifest automatically.
4. Fill the **Privacy** tab from `listing.md` — single-purpose statement,
   per-permission justifications, "no remote code", and the data-usage
   section with **no** collection categories checked.
5. **Distribution** tab: visibility **Public**, all regions (default).

## 4. Submit, and what to expect from review

- Extensions requesting host access to high-value domains (chatgpt.com,
  claude.ai) get extra scrutiny. Our mitigations are already in place and
  stated in the listing: **optional** host permissions requested at
  enable-time, no `cookies` permission, no remote code, zero runtime
  dependencies, fully open source.
- If the review comes back with a rejection:
  1. Read the cited policy carefully — most first-round rejections for
     this category are about permission justification wording.
  2. Reply/appeal pointing to: the optional-permission design (nothing is
     accessed at install time), the single-purpose statement, and the
     public source repository.
  3. Do not weaken the manifest to get through review (e.g. don't drop
     `optional_host_permissions` for content-script tricks) — the current
     design is the honest and minimal one.
- Once published, note the item ID / store URL and:
  - add the store link to `README.md` and `site/index.html` (replace the
    "coming soon" button),
  - keep future uploads in sync with git tags: each store update should be
    a released version, uploaded from its release zip.

## 5. Updating the listing later

- New version: tag a release (`git tag vX.Y.Z && git push origin vX.Y.Z`),
  download the zip from the release, upload it in the console, submit.
- Listing text changes: edit `listing.md` first, then paste into the
  console — the repo copy is the source of truth.
