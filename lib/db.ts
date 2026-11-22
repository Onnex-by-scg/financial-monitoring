import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { SAMPLE_MODE } from "./mode";

// One Prisma client per server process (kept on globalThis so dev reloads don't open new connections).
// The database is Postgres on Supabase (project testProject). DATABASE_URL (in .env.local) is the
// Session pooler connection string from the Supabase dashboard's "Connect" dialog.
// Tables are created by `prisma migrate deploy`, which `npm run dev` / `npm start` run first.
//
// In sample mode (lib/mode.ts) there is no database: any use of `db` throws, so a code path that would
// reach Supabase shows up as an error instead of silently connecting.

const DATABASE_URL = process.env.DATABASE_URL;

function createClient(): PrismaClient {
  // Not a throw: `next build` loads this module without a database. Queries fail until it is set.
  if (!DATABASE_URL) console.warn("DATABASE_URL is not set: copy .env.example to .env.local and fill it in.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
}

const noDatabase = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === "then") return undefined; // so `await db` or Promise checks don't trip the guard
    throw new Error(`Sample mode has no database (tried db.${String(prop)}). Handle this path in sample mode, or run \`pnpm dev\`.`);
  },
});

const g = globalThis as { __prisma?: PrismaClient };

export const db: PrismaClient = SAMPLE_MODE ? noDatabase : (g.__prisma ??= createClient());
