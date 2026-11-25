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

let loggedHost = false;

/** Fails with a readable message when DATABASE_URL can't be a Postgres URL, and logs (once) where it points,
 *  without the password, so the Worker's logs show which host it tries. */
function checkConnectionString(value: string): void {
  let url: URL | null = null;
  try {
    url = new URL(value.trim());
  } catch {
    // reported below
  }
  if (!url || !/^postgres(ql)?:$/.test(url.protocol) || !url.hostname) {
    throw new Error(
      "DATABASE_URL on this Worker isn't a valid connection string. It should look like " +
        "postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres, with no quotes or `DATABASE_URL=` " +
        "in front, and with @ # / : % in the password URL-encoded.",
    );
  }
  if (!loggedHost) {
    loggedHost = true;
    console.log(`Database: connecting to ${url.hostname}:${url.port || "5432"} as ${decodeURIComponent(url.username)}`);
  }
}

function requestClient(): PrismaClient {
  const { env, ctx } = getCloudflareContext();
  let client = perRequest.get(ctx as object);
  if (!client) {
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    const connectionString = hyperdrive?.connectionString ?? process.env.DATABASE_URL;
    // Without one, the client would try localhost, which Workers refuse with an unhelpful
    // "proxy request failed, cannot connect to the specified address".
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set on this Worker. Add it as a secret (Supabase's transaction pooler string, port 6543): " +
          "`npx wrangler secret put DATABASE_URL`, or the Worker's Settings → Variables and Secrets. A build variable isn't enough.",
      );
    }
    if (!hyperdrive) checkConnectionString(connectionString);
    // A small pool: a request runs a few queries at once at most, and Workers allow only a few open sockets.
    client = createClient(connectionString, 3);
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

/**
 * Cloudflare Workers: closes this request's database connection, so the next query opens a fresh one.
 * Called before a long NetSuite / PEAK read: a connection left idle for that long can be closed by the network or
 * Supabase's pooler, and the first query after the read then fails with "Connection terminated unexpectedly".
 * Does nothing on a Node server (its pool replaces dead connections itself).
 */
export async function releaseDb(): Promise<void> {
  if (!ON_WORKERS || SAMPLE_MODE) return;
  const { ctx } = getCloudflareContext();
  const client = perRequest.get(ctx as object);
  if (!client) return;
  perRequest.delete(ctx as object);
  await client.$disconnect().catch(() => undefined);
}

const DROPPED = /Connection terminated|ECONNRESET|connection (was )?closed|Socket closed|server closed the connection/i;

/** Runs a database step, and once more on a fresh connection if the connection had been dropped. */
export async function withDb<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (!ON_WORKERS || !DROPPED.test((e as Error).message ?? "")) throw e;
    console.warn(`[db] connection dropped (${(e as Error).message}); retrying on a new connection`);
    await releaseDb();
    return step();
  }
}

const g = globalThis as { __prisma?: PrismaClient };

export const db: PrismaClient = SAMPLE_MODE ? noDatabase : ON_WORKERS ? workersDatabase : (g.__prisma ??= createClient());
