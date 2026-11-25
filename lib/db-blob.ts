import "server-only";
import { db } from "./db";

// Large text values (NetSuite sync state, a snapshot's debug info) kept in the SyncState table in pieces.
//
// Why pieces: on Cloudflare Workers, node-postgres (pg-cloudflare) loses the connection when one statement is
// larger than about 64 KB ("Connection terminated unexpectedly"; https://github.com/brianc/node-postgres/issues/3757).
// Small statements always work, so a large value is written as several rows of at most CHUNK_CHARS characters
// (≤ 24 KB even for Thai text, 3 bytes per character in UTF-8).
//
// Layout: the row `key` holds the value itself when it is small, or "@chunks:<n>" when it is split into rows
// `key#0` … `key#<n-1>`.

const CHUNK_CHARS = 8_000;
const MARK = "@chunks:";

/** The statements that store `value` under `key` (run them in one db.$transaction([...])). */
export function blobWrites(key: string, value: string) {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_CHARS) parts.push(value.slice(i, i + CHUNK_CHARS));
  const head = parts.length <= 1 ? value : `${MARK}${parts.length}`;
  return [
    db.syncState.deleteMany({ where: { key: { startsWith: `${key}#` } } }),
    ...(parts.length > 1 ? parts.map((p, i) => db.syncState.create({ data: { key: `${key}#${i}`, value: p } })) : []),
    db.syncState.upsert({ where: { key }, create: { key, value: head }, update: { value: head } }),
  ];
}

/** Stores `value` under `key`, in one transaction. */
export async function putBlob(key: string, value: string): Promise<void> {
  await db.$transaction(blobWrites(key, value));
}

/** Reads a value stored with putBlob / blobWrites (or a plain SyncState value), or null. */
export async function getBlob(key: string): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key } });
  if (!row) return null;
  if (!row.value.startsWith(MARK)) return row.value;
  const n = Number(row.value.slice(MARK.length));
  const parts = await db.syncState.findMany({ where: { key: { in: Array.from({ length: n }, (_, i) => `${key}#${i}`) } } });
  if (parts.length !== n) return null; // incomplete: treat as missing
  const byIndex = new Map(parts.map((p) => [Number(p.key.slice(key.length + 1)), p.value]));
  return Array.from({ length: n }, (_, i) => byIndex.get(i) ?? "").join("");
}

/** The statement that removes a value and its pieces. */
export const blobDelete = (key: string) => db.syncState.deleteMany({ where: { OR: [{ key }, { key: { startsWith: `${key}#` } }] } });
