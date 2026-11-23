import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaClient } from "./generated/prisma/client";
import { SAMPLE_MODE } from "./mode";
import { ON_WORKERS } from "./runtime";

// The database is Postgres on Supabase (project testProject). DATABASE_URL (in .env.local, or a secret on the
// Cloudflare Worker) is a Supabase connection string from the dashboard's "Connect" dialog.
// Tables are created by `prisma migrate deploy`, which `npm run dev` / `npm start` run first.
//
// Node server (`pnpm dev` / `pnpm start`): one Prisma client per process, kept on globalThis so dev reloads don't
// open new connections.
// Cloudflare Workers: a connection opened while handling one request can't be used by another, so each request
// (with the work it runs after its response) gets its own client. If the Worker has a Hyperdrive binding named
// HYPERDRIVE (wrangler.jsonc), connections go through it, which keeps them warm between requests.
//
// In sample mode (lib/mode.ts) there is no database: any use of `db` throws, so a code path that would
// reach Supabase shows up as an error instead of silently connecting.

const DATABASE_URL = process.env.DATABASE_URL;

function createClient(connectionString = DATABASE_URL, poolSize?: number): PrismaClient {
  // Not a throw: `next build` loads this module without a database. Queries fail until it is set.
  if (!connectionString) console.warn("DATABASE_URL is not set: copy .env.example to .env.local and fill it in.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: poolSize }) });
}

const noDatabase = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === "then") return undefined; // so `await db` or Promise checks don't trip the guard
    throw new Error(`Sample mode has no database (tried db.${String(prop)}). Handle this path in sample mode, or run \`pnpm dev\`.`);
  },
});

// ---- Cloudflare Workers: one client per request ----
const perRequest = new WeakMap<object, PrismaClient>();

function requestClient(): PrismaClient {
  const { env, ctx } = getCloudflareContext();
  let client = perRequest.get(ctx as object);
  if (!client) {
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    // A small pool: a request runs a few queries at once at most, and Workers allow only a few open sockets.
    client = createClient(hyperdrive?.connectionString ?? DATABASE_URL, 3);
    perRequest.set(ctx as object, client);
  }
  return client;
}

const workersDatabase = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === "then") return undefined;
    const client = requestClient();
    const value = Reflect.get(client, prop) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});

const g = globalThis as { __prisma?: PrismaClient };

export const db: PrismaClient = SAMPLE_MODE ? noDatabase : ON_WORKERS ? workersDatabase : (g.__prisma ??= createClient());
