import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';
import { decrypt, encrypt } from '../src/lib/crypto';

describe('field encryption', () => {
  it('round-trips unicode text', () => {
    const value = 'Expected CTC: ₹12 LPA — negotiable';
    const enc = encrypt(value);
    // The plaintext must not appear (checking for '12' alone was flaky: random base64 can contain it).
    expect(enc).not.toContain('₹12 LPA');
    expect(enc).not.toContain('negotiable');
    expect(enc.startsWith('v1.k1.')).toBe(true);
    expect(decrypt(enc)).toBe(value);
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects tampered ciphertext', () => {
    const parts = encrypt('secret').split('.');
    const ct = Buffer.from(parts[4]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('rejects unknown key ids and malformed payloads', () => {
    const parts = encrypt('secret').split('.');
    parts[1] = 'nope';
    expect(() => decrypt(parts.join('.'))).toThrow(/Unknown encryption key/);
    expect(() => decrypt('garbage')).toThrow(/Malformed/);
  });
});

describe('env parsing', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    ENCRYPTION_KEYS: `k1:${Buffer.alloc(32).toString('base64')}`,
    ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  };

  it('applies defaults', () => {
    const e = parseEnv(base);
    expect(e.GHOST_AFTER_DAYS).toBe(21);
    expect(e.ALLOW_SIGNUP).toBe(false);
  });

  it('rejects short keys and unknown active key', () => {
    expect(() => parseEnv({ ...base, ENCRYPTION_KEYS: 'k1:c2hvcnQ=' })).toThrow(/32 bytes/);
    expect(() => parseEnv({ ...base, ENCRYPTION_ACTIVE_KEY_ID: 'k2' })).toThrow(/ENCRYPTION_ACTIVE_KEY_ID/);
  });

  it('reads tunables from env', () => {
    expect(parseEnv({ ...base, GHOST_AFTER_DAYS: '30' }).GHOST_AFTER_DAYS).toBe(30);
  });
});
