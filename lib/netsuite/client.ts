import "server-only";
import crypto from "node:crypto";
import { PeakError, redact } from "../peak/client";
import { SAMPLE_MODE } from "../mode";

// Server-only client for SCG's NetSuite integration RESTlet (netsuite_api_docs/).
// Auth: OAuth 1.0 Token-Based Authentication (TBA), HMAC-SHA256, as in the doc's
// "OAuth 1.0 - How to Generate the Signature" (RFC 5849 §3.4).

export interface NsConnection {
  /** NetSuite Company ID, e.g. 1234567 (Production) or 1234567_SB1 (Sandbox). Used as the OAuth realm. */
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  /** RESTlet script for GET/POST/PUT; the doc's default is customscript_int_api, deployment 1. */
  scriptId: string;
  deployId: string;
}

/** "1234567_SB1" -> "1234567-sb1.restlets.api.netsuite.com" (the "Company ID For URL"). */
export function restletHost(accountId: string): string {
  return `${accountId.toLowerCase().replace(/_/g, "-")}.restlets.api.netsuite.com`;
}

/** Endpoints #42 and later (incl. #46 Invoice From SO) live on this second RESTlet. */
export const NS_SCRIPT_2 = "customscript_int_api_2";

export const restletUrl = (c: Pick<NsConnection, "accountId" | "scriptId" | "deployId">) =>
  `https://${restletHost(c.accountId)}/app/site/hosting/restlet.nl?script=${encodeURIComponent(c.scriptId)}&deploy=${encodeURIComponent(c.deployId)}`;

// RFC 3986 percent-encoding (encodeURIComponent leaves !'()* alone).
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());

/** Builds the OAuth 1.0 Authorization header for one request. */
export function authorizationHeader(conn: NsConnection, method: string, url: string, timestamp?: string, nonce?: string): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: conn.consumerKey,
    oauth_nonce: nonce ?? crypto.randomBytes(15).toString("base64url").slice(0, 20),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: conn.tokenId,
    oauth_version: "1.0",
  };
  // Query parameters + OAuth parameters (not realm, not the signature), encoded, then sorted by name and value.
  const pairs = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseUri = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
  const baseString = `${method.toUpperCase()}&${enc(baseUri)}&${enc(pairs)}`;
  const key = `${enc(conn.consumerSecret)}&${enc(conn.tokenSecret)}`;
  const signature = crypto.createHmac("sha256", key).update(baseString).digest("base64");

  const realm = conn.accountId.toUpperCase().replace(/-/g, "_");
  const fields = { realm, ...oauth, oauth_signature: signature };
  return "OAuth " + Object.entries(fields).map(([k, v]) => `${k}="${enc(v)}"`).join(", ");
}

/** Node's fetch only says "fetch failed"; the real reason (DNS, timeout, TLS) is in err.cause. */
function unreachableMessage(host: string, err: unknown, timeoutMs: number): string {
  const e = err as Error & { cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
  if (e.name === "TimeoutError") return `NetSuite (${host}) didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`;
  const code = e.cause?.code ?? e.cause?.errors?.[0]?.code ?? "";
  const detail = code || e.cause?.message || e.message;
  if (code === "ENOTFOUND") {
    return `The host ${host} doesn't exist (DNS: ${code}). The Account ID or environment is probably wrong, e.g. Sandbox 1 vs Sandbox 2. Use the same account_id that works in Postman.`;
  }
  if (code === "EAI_AGAIN") return `Couldn't look up ${host} (DNS: ${code}). Check this server's internet connection or VPN.`;
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET/.test(code)) {
    return `Couldn't connect to ${host} (${code}). A firewall, VPN or proxy may be blocking this server; Postman may use different network settings.`;
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) {
    return `TLS certificate check failed for ${host} (${code}). A corporate proxy may be inspecting HTTPS; start the server with NODE_EXTRA_CA_CERTS pointing to its root certificate.`;
  }
  return `Could not reach NetSuite (${host}): ${detail}`;
}

const secretsOf = (c: NsConnection) => [c.consumerKey, c.consumerSecret, c.tokenId, c.tokenSecret];

/**
 * Signed GET to the RESTlet. `params` become query parameters, e.g. { service_type: "invoice", "query[current_page]": "1" }.
 * The RESTlet answers HTTP 200 even for errors; the real result is { status, code, error } in the body.
 */
export async function nsGet(conn: NsConnection, params: Record<string, string>, scriptId = conn.scriptId, timeoutMs = 60_000): Promise<unknown> {
  const u = new URL(restletUrl({ ...conn, scriptId }));
  for (const [k, v] of Object.entries(params)) u.searchParams.append(k, v);
  const url = u.toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent-x": "SuiteScript-Call",
        Authorization: authorizationHeader(conn, "GET", url),
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    throw new PeakError(502, unreachableMessage(restletHost(conn.accountId), err, timeoutMs));
  }
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON (HTML error page)
  }
  const err = (json?.error ?? null) as { code?: string; message?: string } | null;

  if (res.status === 401 || err?.code === "INVALID_LOGIN_ATTEMPT" || err?.code === "INVALID_LOGIN") {
    throw new PeakError(
      401,
      redact(
        `NetSuite refused the login (${err?.code ?? `HTTP ${res.status}`}). Check the Account ID matches the environment, all four keys were copied completely, the token isn't revoked, and the server clock is correct.`,
        secretsOf(conn),
      ),
    );
  }
  // Too many requests at once for this account (NetSuite's concurrency governance).
  if (res.status === 429 || /REQUEST_LIMIT|CONCURRENCY/i.test(err?.code ?? "")) {
    throw new PeakError(429, `NetSuite is busy: too many requests at once (${err?.code ?? "HTTP 429"}).`);
  }
  if (res.status === 403) {
    throw new PeakError(403, `NetSuite: access denied (${err?.code ?? "HTTP 403"}). The token's role may not be allowed to run this RESTlet.`);
  }
  if (!json) throw new PeakError(502, redact(`NetSuite returned HTTP ${res.status}: ${text.slice(0, 200)}`, secretsOf(conn)));
  if (res.status >= 400 || json.status === "error") {
    const msg = err?.message ?? (typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
    throw new PeakError(502, redact(`NetSuite error${err?.code ? ` ${err.code}` : ""}: ${msg}`, secretsOf(conn)));
  }
  return json;
}

export interface NsTestResult {
  ok: boolean;
  message: string;
  subsidiaries?: string[];
  /** Can the token run the dashboard's AR endpoint (#46 on customscript_int_api_2)? */
  arEndpoint?: { ok: boolean; message: string };
}

/** Reads the Subsidiary list (small, read-only): proves the keys, the account and the RESTlet deployment all work. */
export async function testNetSuite(conn: NsConnection): Promise<NsTestResult> {
  if (SAMPLE_MODE) {
    return {
      ok: true,
      message: `Sample mode: no request was sent to NetSuite account ${conn.accountId}.`,
      subsidiaries: ["Sample Subsidiary A", "Sample Subsidiary B"],
      arEndpoint: { ok: true, message: "Sample mode: AR endpoint not checked." },
    };
  }
  try {
    const json = (await nsGet(conn, { service_type: "subsidiary" })) as { data?: { total?: number; data?: { name?: string; full_name?: string }[] } };
    const rows = json.data?.data ?? [];
    const subsidiaries = rows.map((r) => r.full_name || r.name || "").filter(Boolean);
    const total = json.data?.total ?? rows.length;
    return {
      ok: true,
      message: `Connected to NetSuite account ${conn.accountId}. ${total} subsidiar${total === 1 ? "y" : "ies"} visible.`,
      subsidiaries,
      arEndpoint: await testArEndpoint(conn),
    };
  } catch (e) {
    return { ok: false, message: redact((e as Error).message, secretsOf(conn)) };
  }
}

/**
 * The dashboard reads #46 (invoicefromso_lhs) on the second RESTlet. Asking for internal ID 0 matches nothing,
 * so this proves access without downloading invoices (the doc's empty result is status "success", data []).
 */
async function testArEndpoint(conn: NsConnection): Promise<{ ok: boolean; message: string }> {
  try {
    await nsGet(conn, { service_type: "invoicefromso_lhs", "query[inv_ns_internal_id]": "0" }, NS_SCRIPT_2);
    return { ok: true, message: `Dashboard AR endpoint #46 (invoicefromso_lhs on ${NS_SCRIPT_2}) is reachable.` };
  } catch (e) {
    return {
      ok: false,
      message: redact(`Dashboard AR endpoint #46 (invoicefromso_lhs on ${NS_SCRIPT_2}) failed: ${(e as Error).message}`, secretsOf(conn)),
    };
  }
}
