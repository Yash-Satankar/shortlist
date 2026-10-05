# Adapter fixtures

Each fixture is a saved page plus what the reader should extract from it:

```
<site>/<name>.html            the page (first line: <!-- fixture: {"url": "...", ...} -->)
<site>/<name>.expected.json   expected fields; null = must be empty; omitted = not checked
```

The header JSON takes these keys:

- `url`: the page's address, which the reader sees as `location.href`.
- `synthetic`: `true` for a hand-written page modelled on the site's known structure. Real
  captures replace these.
- `assumeJob`: the user pressed Sync. Unknown sites then count as a job page.

`expected.json` takes these keys:

- Any `ExtractedJob` field (`roleTitle`, `companyName`, `location`, `workMode`, `jobUrl`,
  `externalId`, `source`, `applyOnSite`, `adapter`, `missing`, …).
- `jdIncludes` / `jdExcludes`: strings the description must or must not contain.
- `isJob: false`: the page is not a job page, and the reader must return null.

## Real captures

**Known dev-tool limitation:** on some setups the **Capture** button's file never arrives, even
though the popup reports it as saved. Until that's fixed, use Chrome's own save instead:

1. **Save page as… → "Webpage, Complete"** (not "HTML Only": LinkedIn, Naukri and most career
   sites build the page with JavaScript, and an HTML-only save misses that content). The file
   is **not** sanitized yet.
2. Sanitize it:
   `pnpm --filter @jt/extension sanitize:capture <saved.html> <out.html> --name "Your Name" --email you@example.com`
   (the page address is taken from Chrome's "saved from url" comment, or pass `--url`).
3. Review the output by hand like any capture.

### Capture button

Captured with the dev-only **Capture page as fixture** button in a dev build of the extension
(`pnpm dev:extension`). The capture is sanitized in the page before it's saved:

- scripts other than JSON-LD are removed;
- page chrome is removed (navigation, messaging, sidebars, dialogs, forms);
- every attribute not used by selectors is removed;
- links are reduced to their path;
- emails, phone numbers and the paired account's name are replaced.

Each capture is still reviewed by hand before it is committed. `fixtures.test.ts` also fails if
a fixture contains an email address, a phone number or a non-placeholder profile link.
