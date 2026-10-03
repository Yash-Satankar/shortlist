import { customType } from 'drizzle-orm/pg-core';
import { decrypt, encrypt } from '../lib/crypto';

/** Text column transparently encrypted at rest (AES-256-GCM, see lib/crypto). */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => encrypt(value),
  fromDriver: (value) => decrypt(value),
});

/** JSON value serialized then encrypted; stored as text, so it is not queryable in SQL. */
export const encryptedJson = <T>() =>
  customType<{ data: T; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => encrypt(JSON.stringify(value)),
    fromDriver: (value) => JSON.parse(decrypt(value)) as T,
  });

/** Postgres tsvector, used only as a generated full-text search column. */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});
