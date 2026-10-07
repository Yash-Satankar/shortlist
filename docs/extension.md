# Chrome extension (ShortList)


`apps/extension` is an MV3 extension, named in one place (`packages/shared/src/brand.ts`).

```bash
pnpm dev:extension     # watch build → apps/extension/dist (points at http://localhost:5173)
pnpm build:extension   # production build (points at the Railway URL; no dev-only features)
```

Load `apps/extension/dist` via `chrome://extensions` → Developer mode → Load unpacked. Pair it in
the web app under Settings → Browser extension → Pair a browser, then paste the code into the popup.

**Reading pages: how and when** (full detail in [PRIVACY.md](PRIVACY.md)):

- Job sites are *optional* host permissions, defined once in `apps/extension/src/lib/sites.ts`.
  Every site is **off by default**.
- A site's switch in the popup *is* Chrome's permission for that site. Turning it on asks Chrome for
  that site only, and the background worker then registers the reader for it
  (`chrome.scripting.registerContentScripts`) so pages are read when they load. Turning it off
  unregisters the reader and removes the permission. A grant or removal made in
  `chrome://extensions` is picked up as well.
- **Sync this page** is always available. It uses `activeTab`, so it reads the current tab once
  after your click and needs no stored permission.
- Readers look at the rendered DOM only: no auto-scrolling, pagination or extra requests. A read
  stays in session storage for its tab. Nothing is saved or applied without your confirmation.
- **Adapters** (`apps/extension/src/adapters`) read one job from the rendered page. There is one
  per site, and a generic reader handles unknown sites. Fields come, in order, from:
  1. the site's DOM, using layered selectors that prefer stable hooks (`data-automation-id`,
     `data-qa`, partial class names, the tab title);
  2. schema.org `JobPosting` JSON-LD;
  3. meta tags;
  4. a main-content heuristic for the description.

  Each field records where it came from, and missing required fields are listed so the save
  form can ask for them. Fixtures and their expected output are in
  `apps/extension/test/fixtures` (see its README).
- **Fixture capture** (dev builds only, never in production or the Web Store) saves the current
  page as a sanitized fixture into `Downloads/jst-captures/`. Captures are reviewed by hand
  before they're committed. *Known dev-tool limitation:* on some setups the file never arrives.
  Use Chrome's "Save page as… → Webpage, Complete" and `pnpm --filter @jt/extension
  sanitize:capture` instead (see `apps/extension/test/fixtures/README.md`).
- Content scripts are built as self-contained IIFE files (`content/reader.js`, `content/auto.js`)
  and run in the extension's isolated world, so the page's own scripts can't see them.
- **Job descriptions** come from structured data first (JSON-LD, then schema.org microdata),
  then the site adapter, then a content scorer. The scorer excludes consent banners, dialogs,
  overlays and page chrome. A description must pass a quality gate before the popup says
  "Job description added": at least `VITE_JD_MIN_CHARS` characters (default 600), not
  dominated by cookie/privacy text, and with job-description signals when it was found by page
  shape alone. Late-rendered pages are re-checked for up to `VITE_JD_SETTLE_MAX_MS` (default 4 s).

### Install (GitHub Releases, Load unpacked)

Until it's on the Chrome Web Store, the extension is a zip attached to each [GitHub release](https://github.com/Yash-Satankar/shortlist/releases/latest):

1. Download `shortlist-extension-<version>.zip` from the latest release and unzip it into a folder you'll keep (Chrome loads it from there).
2. Open `chrome://extensions`, switch on **Developer mode** (top right), click **Load unpacked** and choose that folder.
3. Pin ShortList from the puzzle-piece menu. Open it, enter your ShortList's address (Chrome asks to allow that one site), then pair it from Settings → Browser extension in the web app.

To update: download the new zip, replace the folder's contents, and click the reload arrow on the extension's card in `chrome://extensions`. Your pairing and site switches are kept.

### Building the release zip

- `pnpm --filter @jt/extension release` builds production and writes `apps/extension/release/shortlist-extension-<version>.zip`. It refuses to pack a dev build.
- Public builds have no server built in. For your own copy you can bake one in: `VITE_API_ORIGIN=https://your.server pnpm --filter @jt/extension release`.
- CI builds the same zip on every push and uploads it as the `shortlist-extension` artifact, after `check:prod` proves no dev-only switch or code is in the build.

### Chrome Web Store (later)

The listing texts, permission justifications and data-use answers are ready in `apps/extension/store/listing.md`, with screenshots (1280×800) and the promo tile (440×280) in `apps/extension/store/`. Publishing needs a developer account (one-time fee): create the item, upload the same zip, paste the listing, and submit. The privacy policy is on the website at `/privacy.html`.

### "Application submitted" detection

The extension only detects submissions on sites you switched on. Each detector requires the
platform's own confirmation marker, never generic "thank you" text:

| Site | Marker |
| --- | --- |
| LinkedIn | post-apply dialog ("Application sent"), or the job's "Applied … ago" state |
| Greenhouse | `…/jobs/<id>/confirmation` page, or the legacy `#application_confirmation` |
| Lever | `…/<posting>/thanks` page |
| Naukri | the "Applied" state of the apply button |
| Workday | Workday's post-submit dialog/page hooks |

- **Verified detector** (it passes tests on a real captured page): the job is marked Applied
  with high confidence (`DETECTION_VERIFIED_CONFIDENCE`, 0.95), shown on the timeline, and an
  in-page notice offers **Undo**.
- **Unverified detector:** low confidence (`DETECTION_UNVERIFIED_CONFIDENCE`, 0.4). The
  submission waits in Follow-ups for you to confirm, and the status doesn't change.
- **Idempotent:** a reload or revisit records nothing new. A local "seen" record skips the
  call, and the server's per-job evidence key prevents a second event.
- **New jobs:** a job you don't track yet is saved from a *fresh* confirmation only. A standing
  "Applied … ago" never creates jobs while you browse. Matching by company and role (a
  different link) always asks.

**Adapter verification status** (`apps/extension/src/adapters/verification.ts`). A capability, or
for "submitted" each confirmation marker, is marked verified only together with a real captured
fixture that proves it, and a test enforces this.

| Site | Job page | Applications list |
| --- | --- | --- |
| LinkedIn | built, unverified (classic + newer layout; the real capture is a submitted page) | built, unverified (My Jobs → Applied) |
| Naukri | built, unverified | built, unverified (My Applies) |
| Greenhouse | built, unverified | — |
| Lever | built, unverified | — |
| Workday | built, unverified | — (deferred) |

Unverified readers are defensive. An applications-list row is read only when its job link, title,
company and status are all found where the reader expects them. Incomplete rows are dropped and
counted, never guessed. An unrecognised page reads nothing, and the popup says "Couldn't read this
page". Portal sync from any reader only ever creates proposals for you to review.

| "Submitted" marker | Verified |
| --- | --- |
| LinkedIn: "Application status · Application submitted" card (newer layout) | **yes** (real capture) |
| LinkedIn: Easy Apply "Application sent" dialog | not yet |
| LinkedIn: "Applied … ago" state (classic layout) | not yet |
| Greenhouse: confirmation page / legacy confirmation section | not yet |
| Lever: thanks page | not yet |
| Naukri: "Applied" button state | not yet |
| Workday: post-submit dialog | not yet |
