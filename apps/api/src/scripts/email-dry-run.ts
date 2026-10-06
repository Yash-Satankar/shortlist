/**
 * Dry run of email intake against the configured IMAP mailbox: reads (read-only, nothing marked
 * as read), classifies with the rules, matches and decides, and prints a summary. Writes nothing:
 * no stored emails, no cursor, no status changes, no AI calls. Never prints subjects or bodies.
 *
 *   pnpm --filter @jt/api email:dry-run [--days 30]
 */
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb } from '../db/client';
import { applications, companies } from '../db/schema';
import { previewEmail } from '../email/ingest';
import { imapConfig, imapOwnerId } from '../email/poll';
import { fetchImap } from '../email/sources';

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || undefined;
const cfg = imapConfig();
if (!cfg) {
  console.error('IMAP_HOST, IMAP_USER and IMAP_PASSWORD must be set.');
  process.exit(2);
}
const db = getDb();
try {
  const owner = await imapOwnerId(db);
  if (!owner) throw new Error('No mailbox owner (IMAP_OWNER_EMAIL or an admin account).');
  const started = Date.now();
  const { emails } = await fetchImap({ ...cfg, ...(days ? { sinceDays: days } : {}) }, { uidValidity: null, lastUid: 0 });
  console.log(`Read ${emails.length} emails from ${cfg.mailbox} (last ${days ?? cfg.sinceDays} days) in ${Date.now() - started} ms.`);

  const previews = [];
  for (const raw of emails) previews.push(await previewEmail(db, owner, raw));
  const byCategory: Record<string, number> = {};
  for (const p of previews) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
  console.log('Classified (rules):', JSON.stringify(byCategory));
  console.log(`Not job-related but looks like it (would ask the AI if on): ${previews.filter((p) => p.wouldAskAi).length}`);
  const job = previews.filter((p) => p.category !== 'other');
  console.log(`Job-related: ${job.length} · matched: ${job.filter((p) => p.match).length} · unmatched: ${job.filter((p) => !p.match).length} · already stored: ${previews.filter((p) => p.duplicate).length}`);
  const byDomain: Record<string, number> = {};
  for (const p of job) byDomain[p.fromDomain] = (byDomain[p.fromDomain] ?? 0) + 1;
  console.log('Job-related senders (domains):', JSON.stringify(byDomain));

  const ids = [...new Set(job.flatMap((p) => (p.match ? [p.match.applicationId] : [])))];
  const names = ids.length
    ? await db.select({ id: applications.id, role: applications.roleTitle, company: companies.name }).from(applications).innerJoin(companies, eq(companies.id, applications.companyId)).where(inArray(applications.id, ids))
    : [];
  const label = (id: string) => {
    const n = names.find((x) => x.id === id);
    return n ? `${n.company} · ${n.role}` : id;
  };
  console.log('\nWhat a real run would do (nothing has been changed):');
  for (const p of job.filter((x) => x.proposal)) {
    const verb = p.proposal!.disposition === 'applied' ? 'WOULD CHANGE' : p.proposal!.disposition === 'pending_review' ? 'would ask (review)' : 'no change';
    console.log(`  ${verb.padEnd(18)} ${label(p.match!.applicationId)}: ${p.match!.current} → ${p.proposal!.to} (${p.category}, ${p.proposal!.confidence.toFixed(2)}, matched by ${p.match!.by}, from ${p.fromDomain}; ${p.proposal!.reason})`);
  }
  for (const p of job.filter((x) => !x.match)) console.log(`  unmatched          ${p.category} from ${p.fromDomain} (would wait in Emails to match)`);
} catch (err) {
  const msg = (err instanceof Error ? err.message : String(err)).split(cfg.password).join('[redacted]');
  console.error(`Error: ${msg}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
