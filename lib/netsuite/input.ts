import "server-only";
import { PeakError } from "../peak/client";
import { cleanSecret } from "../peak/settings-store";
import { NS_DEFAULT_SCRIPT } from "../settings-types";
import type { NsConnection } from "./client";

/** "1234567-sb1" / "1234567_sb1" -> "1234567_SB1" (the realm form). */
export function cleanAccountId(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const id = v.trim().toUpperCase().replace(/-/g, "_");
  if (!/^[0-9A-Z]+(_[0-9A-Z]+)?$/.test(id) || id.length > 30) {
    throw new PeakError(400, "Account ID looks wrong. Use the NetSuite Company ID, e.g. 1234567 or 1234567_SB1.", "invalid");
  }
  return id;
}

function cleanScript(v: unknown, fallback: string, label: string, pattern: RegExp): string {
  if (typeof v !== "string" || !v.trim()) return fallback;
  const s = v.trim();
  if (!pattern.test(s)) throw new PeakError(400, `${label} looks wrong.`, "invalid");
  return s;
}

/** NetSuite credentials from a form. Blank secret fields keep the saved values. */
export function netsuiteInput(input: unknown, saved?: NsConnection | null): NsConnection {
  const b = (input ?? {}) as Record<string, unknown>;
  const accountId = cleanAccountId(b.accountId) ?? saved?.accountId;
  const consumerKey = cleanSecret(b.consumerKey, "Consumer Key", false) ?? saved?.consumerKey;
  const consumerSecret = cleanSecret(b.consumerSecret, "Consumer Secret", false) ?? saved?.consumerSecret;
  const tokenId = cleanSecret(b.tokenId, "Token ID", false) ?? saved?.tokenId;
  const tokenSecret = cleanSecret(b.tokenSecret, "Token Secret", false) ?? saved?.tokenSecret;
  const missing = [
    [accountId, "Account ID"],
    [consumerKey, "Consumer Key"],
    [consumerSecret, "Consumer Secret"],
    [tokenId, "Token ID"],
    [tokenSecret, "Token Secret"],
  ].find(([v]) => !v);
  if (missing) throw new PeakError(400, `${missing[1]} is required.`, "invalid");
  return {
    accountId: accountId!,
    consumerKey: consumerKey!,
    consumerSecret: consumerSecret!,
    tokenId: tokenId!,
    tokenSecret: tokenSecret!,
    scriptId: cleanScript(b.scriptId, saved?.scriptId ?? NS_DEFAULT_SCRIPT, "Script ID", /^customscript[a-z0-9_]+$/i),
    deployId: cleanScript(b.deployId, saved?.deployId ?? "1", "Deployment ID", /^[a-z0-9_]{1,40}$/i),
  };
}

export const sameConnection = (a: NsConnection, b: NsConnection) =>
  (["accountId", "consumerKey", "consumerSecret", "tokenId", "tokenSecret", "scriptId", "deployId"] as const).every((k) => a[k] === b[k]);

export const pickConnection = (n: NsConnection): NsConnection => ({
  accountId: n.accountId,
  consumerKey: n.consumerKey,
  consumerSecret: n.consumerSecret,
  tokenId: n.tokenId,
  tokenSecret: n.tokenSecret,
  scriptId: n.scriptId,
  deployId: n.deployId,
});
