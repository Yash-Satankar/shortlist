# Privacy: Job Status Tracker (Chrome extension)

The extension connects your browser to **your own** Job Tracker instance. It has no analytics, no
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
- **No passwords.** The extension never reads, stores or sends portal passwords or form fields you
  type into job sites.
- **Nothing is sent in your name.** It never submits applications, sends messages or emails, or
  clicks anything on job sites.

## Disconnecting

**Disconnect** in the popup revokes the pairing token on your tracker and deletes it from the
browser. You can also revoke any paired browser in Settings → Browser extension. Uninstalling the
extension deletes everything it stored locally.
