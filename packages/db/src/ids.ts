import { randomBytes } from 'node:crypto';

/**
 * A UUIDv7, made here rather than by PostgreSQL.
 *
 * For batched writes: rows inserted with `createMany` cannot hand their
 * generated ids back to link the next batch, so the ids are chosen before
 * the insert. Version 7 still — a 48-bit millisecond timestamp first — so
 * these rows land in the same B-tree order the database's own `uuidv7()`
 * gives every other row.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
