import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../logger';

/**
 * Outgoing email (verification, password reset) behind one small interface. SMTP works with any
 * provider (Postmark, SES, Resend, Mailgun, Gmail…). Off unless SMTP_HOST and MAIL_FROM are set.
 * The app never sends anything else: no marketing, and never mail on the user's behalf.
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export const mailEnabled = () => {
  const e = env();
  return Boolean(e.SMTP_HOST && e.MAIL_FROM);
};

function smtpMailer(): Mailer {
  const e = env();
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: e.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

/** Test hook: swap the mailer (tests capture messages instead of sending). */
export const mailerFactory = { create: (): Mailer => smtpMailer() };

/** Sends, logging failures without the message body (it holds a one-time link). */
export async function sendMail(mail: OutgoingMail): Promise<boolean> {
  if (!mailEnabled()) return false;
  try {
    await mailerFactory.create().send(mail);
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), subject: mail.subject }, 'Email could not be sent');
    return false;
  }
}
