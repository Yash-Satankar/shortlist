import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 10;

// Used when the email is unknown so the response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password); // argon2id with library defaults (OWASP-compliant)
}

export async function verifyPassword(passwordHash: string | undefined, password: string): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hash('timing-equalizer-not-a-real-password');
    await verify(await dummyHash, password);
    return false;
  }
  return verify(passwordHash, password);
}
