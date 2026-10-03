import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Field-level encryption (AES-256-GCM) for sensitive columns: CTC figures,
 * recruiter contacts, portal-sync snapshots.
 *
 * Ciphertext format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * The key id allows rotation: add a new key to ENCRYPTION_KEYS, switch
 * ENCRYPTION_ACTIVE_KEY_ID, and old rows still decrypt.
 */

const VERSION = 'v1';

export function encrypt(plaintext: string): string {
  const { ENCRYPTION_KEYS, ENCRYPTION_ACTIVE_KEY_ID } = env();
  const key = ENCRYPTION_KEYS.get(ENCRYPTION_ACTIVE_KEY_ID)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, ENCRYPTION_ACTIVE_KEY_ID, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [version, keyId, iv, tag, ct] = payload.split('.');
  if (version !== VERSION || !keyId || !iv || !tag || ct === undefined) {
    throw new Error('Malformed encrypted value');
  }
  const key = env().ENCRYPTION_KEYS.get(keyId);
  if (!key) throw new Error(`Unknown encryption key id "${keyId}"`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** Random URL-safe token (sessions, API tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes; a DB leak does not leak live tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
