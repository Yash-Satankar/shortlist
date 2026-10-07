# Privacy: ShortList

The extension connects your browser to **your own** ShortList instance. It has no analytics, no
third-party servers, and no ads. This page says exactly what it can read, when, and where it goes.

## What it can access

| Permission | Why |
| --- | --- |
| Your tracker's address (required) | To save jobs and status updates to your own account. |
| `storage` | Keeps the pairing token and your account email in this browser profile. |
| `activeTab` + `scripting` | **Sync this page**: when you click the button, the current tab is read once. Chrome grants this for that one tab only, after your click. |
| LinkedIn, Naukri, Greenhouse, Lever, Workday (optional, each **off by default**) | Only if you switch a site on in the popup. Chrome asks you first, for that site only. |

## When pages are read

- **Never in the background, never from a server.** The extension only reads pages that you have
  open in your own browser. Nothing scrapes any site from a server.
- **Sync this page** reads the current tab once, when you press it. This works even when the site's
  automatic reading is off.
- **Read automatically** (per site, off by default): once you switch a site on, its pages are read
  when they finish loading. Switching it off unregisters the reader and **gives the permission back
  to Chrome**. You can also remove it at any time in `chrome://extensions` → Site access.
- Reading means looking at the page **as it is rendered**: no scrolling, clicking, pagination or
  extra network requests on your behalf.

## What happens to what's read

- **Nothing is saved without your confirmation.** A read stays in the browser's session memory for
  that tab, which is cleared when the tab or browser closes, until you choose to save it.
- What you save (job title, company, URL, description, status) goes only to your own tracker over
  HTTPS, authenticated with the pairing token.
- **Fill with AI** (only shown when you've added your own AI key, and only when you click it) sends
  the visible text of the page's main content to your tracker. The tracker passes it to the AI
  provider *you* chose in Settings → AI, using *your* key. The result only fills the save form,
  and nothing is saved until you press Save. Without a key this never happens.
- **Application submitted detection** (only on sites you switched on). When a page shows that
  platform's own confirmation, for example LinkedIn's "Application sent" dialog, the extension
  sends your tracker that job's link and, for a job you don't track yet, its title, company and
  description. The change is recorded on the timeline. It is either undoable from a small notice
  in the page, or, for detectors not yet verified, left in Follow-ups for you to confirm.
- **Portal sync** (only on sites you switched on, only your own applications list such as
  LinkedIn's My Jobs → Applied). Each listed job's title, company, link and the portal's status
  label are sent to your tracker. They are stored there as an encrypted snapshot that is deleted
  automatically after 90 days, and turned into proposals that change nothing until you accept them.
  Accepted changes keep only the portal's status label as evidence on the timeline.
- **No passwords.** The extension never reads, stores or sends portal passwords or form fields you
  type into job sites.
- **Nothing is sent in your name.** It never submits applications, sends messages or emails, or
  clicks anything on job sites.

## The tracker's AI features (web app)

These run on your tracker, not in the extension. Each one is optional, has its own switch in
Settings → Features, and only runs when you use it, with the AI provider and key **you** added
in Settings → AI. Nothing is ever sent to anyone else, and nothing is sent in your name.

- **Ask my job search**: your question goes to your provider.
  - **Counting questions** ("how many…", "which…"): only the question is sent. The provider turns
    it into a filter, and the numbers come from your own database.
  - **Other questions**: short excerpts of the matching applications, notes, job descriptions and
    screening answers are sent along with the question.
  - **Job emails**: stored email excerpts are only included if you switch on **Include job emails
    in Ask**. This is off unless your server's owner changed the default. The excerpts stay
    encrypted on the server. They are decrypted in memory for that one question and never written
    anywhere decrypted, including the AI cache.
- **Interview prep packs**: the job description, your resume text, profile basics (headline,
  experience, location, notice period, relocation) and your saved answers are sent. Your CTC is
  never sent. The pack is stored encrypted, and the app shows the estimated cost before every
  generation.
- **Follow-up drafts**: the company, role, status, relevant dates, your name, your note (if any)
  and the recruiter's first name are sent. The recruiter's email address is never sent; it only
  fills the "To" field when you open the draft in your own mail app. Drafts are never sent from
  the tracker.

## Disconnecting

**Disconnect** in the popup revokes the pairing token on your tracker and deletes it from the
browser. You can also revoke any paired browser in Settings → Browser extension. Uninstalling the
extension deletes everything it stored locally.
