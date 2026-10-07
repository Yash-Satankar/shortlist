# Chrome Web Store listing: ShortList

Copy these into the Developer Dashboard (https://chrome.google.com/webstore/devconsole).
The upload is `apps/extension/release/job-status-tracker-<version>.zip` (CI artifact
"job-status-tracker-extension", or `pnpm --filter @jt/extension release`).

## Store listing

- **Name:** ShortList
- **Summary (≤ 132 chars):** Save jobs with their description, catch "application submitted" pages and sync portal statuses into your own tracker.
- **Category:** Workflow & Planning
- **Language:** English
- **Visibility:** Unlisted (only people with the link can install it)
- **Icon:** `public/icons/icon-128.png`
- **Screenshots (1280×800):** `store/screenshot-1-save.png`, `store/screenshot-2-sites.png`, `store/screenshot-3-detected.png`
- **Small promo tile (440×280):** `store/promo-440x280.png`

### Description

ShortList is the browser companion to your own ShortList. It works only with a tracker you
run or sign in to, and the extension has no servers of its own.

- **Save a job in one click.** It reads the job you're viewing (title, company, location and the
  full description) and checks whether you already have it. You review the form, then save.
- **Catch "application submitted".** On sites you switch on, a platform's own confirmation, for
  example LinkedIn's "Application status · Application submitted", marks the job Applied. A small
  notice in the page lets you undo it. Confirmations the extension isn't sure about wait for you to
  confirm them.
- **Sync statuses from your portals.** Your applications list (such as LinkedIn's My Jobs →
  Applied) becomes a list of proposed changes. Nothing changes until you accept them.

**Private by design:**
- Every site is off until you switch it on, and Chrome asks you first.
- It only reads the page you have open, as it's shown: no background browsing, scrolling or paging.
- It never stores portal passwords.
- It never sends anything in your name.
- Optional AI fill-in uses your own API key.

## Privacy practices tab

- **Single purpose:** Save job postings and track the status of your job applications in your own
  ShortList.
- **Permission justifications:**
  - `storage`: keeps the pairing token and your account email in this browser profile.
  - `activeTab`: "Sync this page" reads the current tab once, only when you click the button.
  - `scripting`: injects the page reader into the current tab (on your click), or on job sites you
    have switched on.
  - **Host permission (required), your tracker's address:** to save jobs and status updates to your
    account.
  - **Optional host permissions** (LinkedIn, Naukri, Greenhouse, Lever, Workday): requested one site
    at a time, only when you switch that site on in the popup, to read job pages and your
    applications list as you view them.
- **Remote code:** No. All code ships in the package.
- **Data usage.** Collected and sent only to the user's own tracker:
  - Website content: job postings you save, and your applications list.
  - Authentication information: the pairing token.
  - The extension doesn't sell data, use it for anything unrelated to its single purpose, or use it
    to determine creditworthiness.
- **Privacy policy URL:** `https://yash-satankar.github.io/shortlist/privacy.html`

## Test instructions for reviewers

1. Sign in to the tracker with the test account given privately in the dashboard's "Test
   instructions" field (sign-up is closed on this instance).
2. In the tracker, open Settings → Browser extension → Pair a browser, and copy the code.
3. Open the extension popup, paste the code and press Connect.
4. Open any job posting, open the popup and press "Sync this page".
