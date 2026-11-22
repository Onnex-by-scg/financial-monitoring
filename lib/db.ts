import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// One Prisma client per server process (kept on globalThis so dev reloads don't open new connections).
// The database is Postgres on Supabase (project testProject). DATABASE_URL (in .env.local) is the
// Session pooler connection string from the Supabase dashboard's "Connect" dialog.
// Tables are created by `prisma migrate deploy`, which `npm run dev` / `npm start` run first.

const DATABASE_URL = process.env.DATABASE_URL;
// Not a throw: `next build` loads this module without a database. Queries fail until it is set.
if (!DATABASE_URL) console.warn("DATABASE_URL is not set: copy .env.example to .env.local and fill it in.");

const g = globalThis as { __prisma?: PrismaClient };

export const db: PrismaClient = (g.__prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) }));
