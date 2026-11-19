import "server-only";
import crypto from "node:crypto";

// Server-only PEAK Open API client. Signing and token handling follow
// ../peak_account/lib/peak.ts and lib/peak-session.ts, extended to several credentials at once.

export type PeakEnv = "uat" | "production";

export const BASE_URLS: Record<PeakEnv, string> = {
  uat: "https://peakengineapidev.azurewebsites.net",
  production: "https://api.peakaccount.com",
};

export class PeakError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: "not_configured" | "invalid" | "test_failed",
  ) {
    super(message);
  }
}

/** Developer (application) credentials from PEAK: one Connect ID / Connect Key per environment. */
export interface Connection {
  env: PeakEnv;
  connectId: string;
  connectKey: string;
}

/** One PEAK business, reached with its own User Token (and optionally its own developer credentials). */
export interface Company {
  id: string;
  name: string;
  conn: Connection;
  userToken: string;
}

export const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// Time-Stamp is yyyyMMddHHmmss in UTC. Time-Signature is HMAC-SHA1 of it, keyed with the Connect ID.
function signHeaders(connectId: string): Record<string, string> {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return { "Time-Stamp": ts, "Time-Signature": crypto.createHmac("sha1", connectId).update(ts).digest("hex") };
}

/** PEAK's examples and responses disagree on key casing (PeakInvoices vs peakInvoices). */
export function pick<T = unknown>(obj: unknown, key: string): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const found = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase());
  return found === undefined ? undefined : ((obj as Record<string, unknown>)[found] as T);
}

async function rawFetch(env: PeakEnv, method: "GET" | "POST", path: string, headers: Record<string, string>, body?: unknown) {
  const baseUrl = BASE_URLS[env];
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
  } catch (err) {
    const hint = env === "uat" ? " PEAK UAT is only open Mon–Fri 08:00–22:00 (Bangkok)." : "";
    throw new PeakError(502, `Could not reach PEAK (${baseUrl}): ${(err as Error).message}.${hint}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON (e.g. a gateway error page). Callers fall back to the raw text.
  }
  return { status: res.status, retryAfter: res.headers.get("retry-after"), json, text };
}

// Client Tokens last 24 h and token requests are limited to 10 per minute per IP, so reuse one per
// developer credential, and let parallel requests share a single in-flight token request.
const tokens = new Map<string, { token: string; expiresAt: number }>();
const pendingTokens = new Map<string, Promise<string>>();
const tokenKey = (c: Connection) => `${c.env}|${c.connectId}|${hash(c.connectKey)}`;

export function clientToken(conn: Connection, fresh = false): Promise<string> {
  const key = tokenKey(conn);
  const hit = tokens.get(key);
  if (!fresh && hit && Date.now() < hit.expiresAt) return Promise.resolve(hit.token);
  const pending = pendingTokens.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const r = await rawFetch(conn.env, "POST", "/api/v1/ClientToken", signHeaders(conn.connectId), {
      PeakClientToken: { connectId: conn.connectId, connectKey: conn.connectKey },
    });
    const t = pick(r.json, "PeakClientToken");
    const token = pick<string>(t, "token");
    if (pick<string>(t, "resCode") !== "200" || !token) {
      if (r.status === 429) throw new PeakError(429, "PEAK rate limit: at most 10 Client Token requests per minute. Wait a minute and try again.");
      const desc = (pick<string>(t, "resDesc") ?? pick<string>(r.json, "error") ?? `HTTP ${r.status}`).replace(/\.+$/, "");
      throw new PeakError(502, `PEAK rejected the developer credentials: ${desc}. ${explainClientTokenError(desc, conn.env)}`);
    }
    tokens.set(key, { token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 });
    return token;
  })().finally(() => pendingTokens.delete(key));
  pendingTokens.set(key, promise);
  return promise;
}

function explainClientTokenError(desc: string, env: PeakEnv): string {
  if (/timesignature/i.test(desc)) return "The signature is keyed with the Connect ID: check it for typos, and check the server clock.";
  return `Check the Connect ID and Connect Key (not the Application Code). ${env === "uat" ? "UAT" : "Production"} credentials only work on ${env === "uat" ? "UAT" : "Production"}.`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Signed GET for one company. Retries once on a revoked Client Token and up to 3 times on HTTP 429. */
export async function peakGet(conn: Connection, userToken: string, path: string): Promise<unknown> {
  let fresh = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await clientToken(conn, fresh);
    const r = await rawFetch(conn.env, "GET", path, { ...signHeaders(conn.connectId), "Client-Token": token, "User-Token": userToken });

    if (/invalid client token/i.test(r.text) && !fresh) {
      fresh = true;
      continue;
    }
    if (r.status === 429 && attempt < 3) {
      const wait = Number(pick(r.json, "retryAfterSeconds") ?? r.retryAfter ?? 5);
      await sleep(Math.min(Math.max(wait, 1), 60) * 1000);
      continue;
    }
    if (r.status >= 400 && r.json === null) {
      throw new PeakError(502, `PEAK returned HTTP ${r.status} for ${path.split("?")[0]}: ${r.text.slice(0, 200)}`);
    }
    return r.json;
  }
  throw new PeakError(429, `PEAK rate limit: gave up on ${path.split("?")[0]}`);
}

/** Runs fn over items with at most `limit` calls in flight (PEAK allows 20 per User Token). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- Connection tests used by the Settings page ----

export interface TestResult {
  ok: boolean;
  message: string;
  business?: { name: string | null; package: string | null; userEmail: string | null; userName: string | null };
}

/** Requests a fresh Client Token: proves the Connect ID / Connect Key pair works on that environment. */
export async function testDeveloper(conn: Connection): Promise<TestResult> {
  try {
    await clientToken(conn, true);
    return { ok: true, message: `PEAK issued a Client Token on ${conn.env === "uat" ? "UAT" : "Production"} (valid 24 h).` };
  } catch (e) {
    return { ok: false, message: redact((e as Error).message, [conn.connectKey]) };
  }
}

/** PEAK error messages can echo the submitted value ("Value: '<token>'"); never pass secrets on to the browser or the settings file. */
export function redact(message: string, secrets: string[]): string {
  let out = message.replace(/Value:\s*'[^']*'\.?/gi, "");
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join("••••");
  return out.replace(/\.{2,}/g, ".").replace(/\s{2,}/g, " ").trim();
}

/** Calls GET /api/v1/User/detail with the User Token: proves it is valid and shows which business it opens. */
export async function testCompany(conn: Connection, userToken: string): Promise<TestResult> {
  try {
    const json = await peakGet(conn, userToken, "/api/v1/User/detail");
    const outer = pick(json, "PeakUser");
    const um = pick(outer, "userMerchant");
    const code = pick<string>(outer, "resCode") ?? pick<string>(json, "resCode");
    const merchant = pick(um, "merchant");
    if (String(code) !== "200" || !merchant) {
      const desc = (pick<string>(outer, "resDesc") ?? pick<string>(um, "resDesc") ?? pick<string>(json, "error") ?? "no business returned").replace(/[.\s]+$/, "");
      return {
        ok: false,
        message: redact(
          `PEAK rejected the User Token: ${desc}. Check it was copied completely; the owner may need to accept the connection again in PEAK.`,
          [userToken, conn.connectKey],
        ),
      };
    }
    const user = pick(um, "user");
    const userName = [pick<string>(user, "firstName"), pick<string>(user, "lastName")].filter(Boolean).join(" ");
    const business = {
      name: pick<string>(merchant, "name") ?? null,
      package: pick<string>(merchant, "package") ?? null,
      userEmail: pick<string>(user, "email") ?? null,
      userName: userName || null,
    };
    return { ok: true, message: `Connected to “${business.name ?? "business"}”.`, business };
  } catch (e) {
    return { ok: false, message: redact((e as Error).message, [userToken, conn.connectKey]) };
  }
}
