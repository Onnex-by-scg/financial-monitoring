import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

// One Prisma client per server process (kept on globalThis so dev reloads don't open new connections).
// The SQLite file is .peak/app.db by default (gitignored with .peak/); DATABASE_URL overrides it.
// Tables are created by `prisma migrate deploy`, which `npm run dev` / `npm start` run first.

export const DATABASE_URL = process.env.DATABASE_URL ?? "file:./.peak/app.db";

const g = globalThis as { __prisma?: PrismaClient };

export const db: PrismaClient = (g.__prisma ??= new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: DATABASE_URL }) }));
