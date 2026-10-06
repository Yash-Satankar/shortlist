import { createHash, timingSafeEqual } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import { z } from 'zod';

/**
 * Email intake has one pipeline behind one interface, fed by either source:
 *   imap     (self-hosting): one mailbox per instance, read-only, incremental by UID;
 *   inbound  (hosted, v1.1): a per-user forwarding address, delivered by an inbound-email
 *            provider's webhook (Postmark adapter below). Never asks for mailbox passwords.
 */
export interface RawEmail {
  messageId: string;
  from: { address: string; name: string | null };
  subject: string;
  date: Date;
  /** Plain text (from the text part, or the HTML part flattened). */
  text: string;
  /** Links found in the email (job postings are matched by these first). */
  links: string[];
}

export const domainOf = (address: string) => address.split('@')[1]?.toLowerCase().trim() ?? '';

const firstAddress = (a: AddressObject | AddressObject[] | undefined) => {
  const v = (Array.isArray(a) ? a[0] : a)?.value?.[0];
  return { address: (v?.address ?? '').toLowerCase(), name: v?.name || null };
};

const htmlToPlain = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

/**
 * Rejoin hard-wrapped lines (plain-text mail wraps at ~72–80 columns) so phrases aren't split;
 * paragraph breaks and bullet/numbered lines are kept.
 */
export const unwrap = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])\n(?![\n\s]*(?:[-*•]|\d+[.)])\s)(?=[^\n])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ');

export function extractLinks(text: string, html?: string | null): string[] {
  const found = new Set<string>();
  for (const m of (html ?? '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.add(m[1]!);
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) found.add(m[0]);
  return [...found].filter((u) => /^https?:\/\//i.test(u)).slice(0, 200);
}

/**
 * A manual forward ("Fwd: …" from your own address, with Gmail's / Outlook's "Forwarded message"
 * block) is read as the original email: its sender, subject and body. Otherwise the forwarder
 * (you) would look like the sender. Automatic filter-forwarding keeps the original sender anyway.
 */
export function unforward(email: RawEmail): RawEmail {
  const m = /^[ \t>]*-{3,}\s*(?:Forwarded message|Original Message)\s*-{3,}[ \t]*\n((?:[ \t>]*[A-Za-z][\w -]{0,20}:[^\n]*\n){1,8})/im.exec(email.text);
  if (!m) return email;
  const header = (name: string) => new RegExp(`^[ \\t>]*${name}:[ \\t]*(.*)$`, 'im').exec(m[1]!)?.[1]?.trim() ?? null;
  const fromLine = header('From');
  const addr = fromLine ? /<?([^\s<>@]+@[^\s<>]+?)>?\s*$/.exec(fromLine)?.[1] : null;
  if (!fromLine || !addr) return email;
  const name = fromLine.replace(/<[^>]*>/, '').replace(/["']/g, '').trim();
  const body = email.text.slice(m.index + m[0].length).replace(/^\s+/, '');
  return {
    ...email,
    from: { address: addr.toLowerCase(), name: name && name.toLowerCase() !== addr.toLowerCase() ? name : null },
    subject: header('Subject') ?? email.subject.replace(/^(?:\s*(?:fwd?|fw)\s*:\s*)+/i, ''),
    text: body,
  };
}

/** A raw RFC 822 message (from IMAP) → RawEmail. */
export async function parseRawMessage(source: Buffer | string): Promise<RawEmail | null> {
  const m = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = firstAddress(m.from);
  if (!from.address) return null;
  const html = typeof m.html === 'string' ? m.html : null;
  const text = (m.text ?? '').trim() || (html ? htmlToPlain(html) : '');
  const messageId = (m.messageId ?? '').trim() || `<sha256:${createHash('sha256').update(typeof source === 'string' ? source : source.toString('binary')).digest('hex').slice(0, 32)}>`;
  // Read a manual forward as the original first (its header block is line-based), then rejoin wrapped lines.
  const email = unforward({ messageId, from, subject: (m.subject ?? '').trim(), date: m.date ?? new Date(), text, links: extractLinks(text, html) });
  return { ...email, text: unwrap(email.text) };
}

// ---------------------------------------------------------------- IMAP (self-hosting)

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  sinceDays: number;
  maxPerRun: number;
}

export interface ImapCursor {
  uidValidity: string | null;
  lastUid: number;
}

export const mailboxKey = (c: Pick<ImapConfig, 'host' | 'user' | 'mailbox'>) =>
  createHash('sha256').update(`${c.host.toLowerCase()}|${c.user.toLowerCase()}|${c.mailbox}`).digest('hex').slice(0, 32);

/**
 * Reads new messages since the cursor, read-only (never marks anything as read). First run (or
 * a reset mailbox) starts `sinceDays` back. Returns the messages and the new cursor.
 */
export async function fetchImap(cfg: ImapConfig, cursor: ImapCursor): Promise<{ emails: RawEmail[]; cursor: ImapCursor }> {
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.password }, logger: false });
  await client.connect();
  try {
    const box = await client.mailboxOpen(cfg.mailbox, { readOnly: true });
    const validity = String(box.uidValidity);
    const fresh = cursor.uidValidity !== validity;
    const range = fresh ? null : `${cursor.lastUid + 1}:*`;
    const uids = (range
      ? await client.search({ uid: range }, { uid: true })
      : await client.search({ since: new Date(Date.now() - cfg.sinceDays * 86_400_000) }, { uid: true })) || [];
    const todo = uids.filter((u) => fresh || u > cursor.lastUid).sort((a, b) => a - b).slice(0, cfg.maxPerRun);
    const emails: RawEmail[] = [];
    let lastUid = fresh ? 0 : cursor.lastUid;
    if (todo.length) {
      for await (const msg of client.fetch(todo.join(','), { uid: true, source: true }, { uid: true })) {
        if (msg.source) {
          const parsed = await parseRawMessage(msg.source);
          if (parsed) emails.push(parsed);
        }
        lastUid = Math.max(lastUid, msg.uid);
      }
    }
    return { emails, cursor: { uidValidity: validity, lastUid } };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- Inbound (hosted; Postmark)

/** An inbound-email provider: authenticates its webhook and turns its payload into RawEmail. */
export interface InboundAdapter {
  name: string;
  /** Checks the webhook's credentials (constant-time). */
  authorized(authorizationHeader: string | undefined): boolean;
  /** Payload → the recipient local part (to find the user) and the email. */
  parse(body: unknown): { recipientLocalPart: string; email: RawEmail } | null;
}

const postmarkSchema = z.object({
  MessageID: z.string().optional(),
  FromFull: z.object({ Email: z.string(), Name: z.string().optional() }),
  ToFull: z.array(z.object({ Email: z.string() })).default([]),
  OriginalRecipient: z.string().optional(),
  Subject: z.string().default(''),
  Date: z.string().optional(),
  TextBody: z.string().default(''),
  HtmlBody: z.string().default(''),
  Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).default([]),
});

/**
 * Postmark inbound webhooks (JSON). Protect the webhook URL with HTTP Basic credentials set in
 * Postmark (https://user:password@host/api/email/inbound/postmark).
 */
export function postmarkAdapter(opts: { domain: string; basicUser: string; basicPassword: string }): InboundAdapter {
  const expected = Buffer.from(`Basic ${Buffer.from(`${opts.basicUser}:${opts.basicPassword}`).toString('base64')}`);
  return {
    name: 'postmark',
    authorized(header) {
      const got = Buffer.from(header ?? '');
      return got.length === expected.length && timingSafeEqual(got, expected);
    },
    parse(body) {
      const p = postmarkSchema.safeParse(body);
      if (!p.success) return null;
      const d = p.data;
      const recipient = [d.OriginalRecipient, ...d.ToFull.map((t) => t.Email)].find((a) => a && domainOf(a) === opts.domain.toLowerCase());
      if (!recipient) return null;
      const headerId = d.Headers.find((h) => h.Name.toLowerCase() === 'message-id')?.Value;
      const text = d.TextBody.trim() || htmlToPlain(d.HtmlBody);
      return {
        recipientLocalPart: recipient.split('@')[0]!.toLowerCase(),
        email: unforward({
          messageId: (headerId ?? d.MessageID ?? '').trim() || `<postmark:${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)}>`,
          from: { address: d.FromFull.Email.toLowerCase(), name: d.FromFull.Name || null },
          subject: d.Subject.trim(),
          date: d.Date ? new Date(d.Date) : new Date(),
          text,
          links: extractLinks(text, d.HtmlBody),
        }),
      };
    },
  };
}
