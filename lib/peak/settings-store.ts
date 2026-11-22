import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { SAMPLE_MODE } from "../mode";
import { sampleSettings } from "../sample-settings";
import { BASE_URLS, PeakError, type Company, type Connection, type PeakEnv } from "./client";
import type { NsConnection } from "../netsuite/client";
import { restletHost } from "../netsuite/client";
import { nsKind, type PublicCompany, type PublicDeveloper, type PublicNetSuite, type PublicSettings } from "../settings-types";

// Credentials and options saved from the Settings page. Kept on the server only, in the database
// (AppSetting row "settings"; RLS keeps it away from Supabase's public API). Read in this order:
//  1. the database, once anything has been saved;
//  2. .peak/settings.json, where older installs saved them (read-only now; the next save moves them to the database);
//  3. .env.local / host environment variables (PEAK_*).

// In sample mode (lib/mode.ts) settings live in memory instead, seeded with sample companies.

const SETTINGS_KEY = "settings";
const mem = globalThis as { __sampleSettings?: Settings };
const LEGACY_FILE = path.join(process.cwd(), ".peak", "settings.json");

interface StoredVerification {
  ok: boolean;
  message: string;
  businessName?: string | null;
  at: string;
}

interface StoredDeveloper extends Connection {
  verified?: StoredVerification;
}

interface StoredCompany {
  id: string;
  name: string;
  userToken: string;
  /** Own developer credentials; when absent the company uses the shared ones. */
  developer?: StoredDeveloper;
  verified?: StoredVerification;
  createdAt: string;
}

export interface StoredNetSuite extends NsConnection {
  id: string;
  name: string;
  verified?: StoredVerification;
  createdAt: string;
}

export interface Settings {
  version: 1;
  developer: StoredDeveloper | null;
  companies: StoredCompany[];
  /** NetSuite accounts (OAuth 1.0 TBA). Each is a dashboard tab. */
  netsuite: StoredNetSuite[];
  /** Scheduled pulls into the database (Settings → Data sync). Absent = defaults / env. */
  sync?: SyncSettings;
}

export interface SyncSettings {
  enabled: boolean;
  intervalMinutes: number;
  /** Skip scheduled pulls of PEAK UAT outside Mon–Fri 08:00–22:00 Bangkok. */
  skipClosedUat: boolean;
}

type Source = "sample" | "db" | "file" | "env" | "none";

function normalize(parsed: Partial<Settings>): Settings {
  return { version: 1, developer: parsed.developer ?? null, companies: parsed.companies ?? [], netsuite: parsed.netsuite ?? [], sync: parsed.sync };
}

export async function readSettings(): Promise<{ source: Source; settings: Settings }> {
  if (SAMPLE_MODE) return { source: "sample", settings: structuredClone((mem.__sampleSettings ??= sampleSettings())) };
  const row = await db.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (row) {
    try {
      return { source: "db", settings: normalize(JSON.parse(row.value) as Partial<Settings>) };
    } catch (e) {
      throw new PeakError(500, `Saved settings in the database are not valid JSON: ${(e as Error).message}`);
    }
  }
  try {
    return { source: "file", settings: normalize(JSON.parse(await fs.readFile(LEGACY_FILE, "utf8")) as Partial<Settings>) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw new PeakError(500, `Could not read ${LEGACY_FILE}: ${(e as Error).message}`);
  }
  const fromEnv = settingsFromEnv();
  return { source: fromEnv.developer || fromEnv.companies.length ? "env" : "none", settings: fromEnv };
}

// Serialize writes within this server process so two quick saves can't interleave.
let writing: Promise<unknown> = Promise.resolve();

export async function updateSettings(mutate: (s: Settings) => void | Promise<void>): Promise<Settings> {
  const run = writing.then(async () => {
    const { settings } = await readSettings();
    await mutate(settings);
    if (SAMPLE_MODE) {
      mem.__sampleSettings = structuredClone(settings);
      return settings;
    }
    const value = JSON.stringify(settings);
    await db.appSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
    return settings;
  });
  writing = run.catch(() => undefined);
  return run;
}

/** Companies with fully resolved credentials, in display order. */
export async function resolveCompanies(): Promise<Company[]> {
  const { settings } = await readSettings();
  if (!settings.companies.length) {
    throw new PeakError(409, "No company is connected yet. Open Settings to set up PEAK.", "not_configured");
  }
  return settings.companies.map((c) => {
    const conn = c.developer ?? settings.developer;
    if (!conn) throw new PeakError(409, `“${c.name}” has no developer credentials. Add them in Settings.`, "not_configured");
    return { id: c.id, name: c.name, userToken: c.userToken, conn: { env: conn.env, connectId: conn.connectId, connectKey: conn.connectKey } };
  });
}

export function connectionFor(settings: Settings, company: StoredCompany | undefined): Connection | null {
  const d = company?.developer ?? settings.developer;
  return d ? { env: d.env, connectId: d.connectId, connectKey: d.connectKey } : null;
}

// ---- What the browser may see: never a full secret ----

export function mask(value: string): string {
  if (!value) return "";
  return value.length <= 10 ? "••••••" : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function publicDeveloper(d: StoredDeveloper): PublicDeveloper {
  return { env: d.env, baseUrl: BASE_URLS[d.env], connectIdMasked: mask(d.connectId), hasConnectKey: Boolean(d.connectKey), verified: d.verified ?? null };
}

export async function publicSettings(): Promise<PublicSettings> {
  const { source, settings } = await readSettings();
  const companies: PublicCompany[] = settings.companies.map((c) => ({
    id: c.id,
    name: c.name,
    userTokenMasked: mask(c.userToken),
    ownDeveloper: c.developer ? publicDeveloper(c.developer) : null,
    env: (c.developer ?? settings.developer)?.env ?? null,
    verified: c.verified ?? null,
    createdAt: c.createdAt,
  }));
  return {
    source,
    storagePath: SAMPLE_MODE ? "memory (sample mode, reset on restart)" : "the database",
    developer: settings.developer ? publicDeveloper(settings.developer) : null,
    companies,
    netsuite: settings.netsuite.map(publicNetSuite),
  };
}

function publicNetSuite(n: StoredNetSuite): PublicNetSuite {
  return {
    id: n.id,
    name: n.name,
    accountId: n.accountId,
    kind: nsKind(n.accountId),
    host: restletHost(n.accountId),
    consumerKeyMasked: mask(n.consumerKey),
    tokenIdMasked: mask(n.tokenId),
    scriptId: n.scriptId,
    deployId: n.deployId,
    verified: n.verified ?? null,
    createdAt: n.createdAt,
  };
}

// ---- Input validation ----

export function parseEnv(v: unknown): PeakEnv {
  if (v !== "uat" && v !== "production") throw new PeakError(400, "Environment must be UAT or Production.", "invalid");
  return v;
}

export function cleanSecret(v: unknown, label: string, required: boolean): string | undefined {
  if (typeof v !== "string" || !v.trim()) {
    if (required) throw new PeakError(400, `${label} is required.`, "invalid");
    return undefined;
  }
  const s = v.trim();
  if (/\s/.test(s) || s.length < 6 || s.length > 300) throw new PeakError(400, `${label} doesn't look right (no spaces, 6–300 characters).`, "invalid");
  return s;
}

export function cleanName(v: unknown, existing: { id: string; name: string }[], selfId?: string, what = "company"): string {
  const name = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 40) throw new PeakError(400, `A ${what} name is required (up to 40 characters).`, "invalid");
  if (existing.some((c) => c.id !== selfId && c.name.toLowerCase() === name.toLowerCase())) {
    throw new PeakError(409, `A ${what} named “${name}” already exists.`, "invalid");
  }
  return name;
}

export const newId = () => crypto.randomUUID().slice(0, 8);

export function verification(r: { ok: boolean; message: string; business?: { name: string | null } }): StoredVerification {
  return { ok: r.ok, message: r.message, businessName: r.business?.name ?? null, at: new Date().toISOString() };
}

// ---- Seed from .env.local (the setup used before the Settings page existed) ----

function settingsFromEnv(): Settings {
  const { PEAK_ENV, PEAK_BASE_URL, PEAK_CONNECT_ID, PEAK_CONNECT_KEY, PEAK_USER_TOKEN, PEAK_ENTITIES, PEAK_ENTITY_NAME } = process.env;
  let env: PeakEnv | undefined;
  if (PEAK_BASE_URL?.trim()) {
    const normalized = PEAK_BASE_URL.trim()
      .replace(/\/+$/, "")
      .replace(/\/api\/v1$/i, "")
      .replace(/^http:/i, "https:");
    env = (Object.keys(BASE_URLS) as PeakEnv[]).find((k) => BASE_URLS[k] === normalized);
  } else if (PEAK_ENV === "uat" || PEAK_ENV === "production") {
    env = PEAK_ENV;
  }
  const developer =
    env && PEAK_CONNECT_ID?.trim() && PEAK_CONNECT_KEY?.trim() ? { env, connectId: PEAK_CONNECT_ID.trim(), connectKey: PEAK_CONNECT_KEY.trim() } : null;

  const companies: StoredCompany[] = [];
  const createdAt = new Date(0).toISOString();
  for (const part of (PEAK_ENTITIES ?? "").split(",")) {
    const i = part.indexOf("=");
    const name = part.slice(0, i).trim();
    const userToken = part.slice(i + 1).trim();
    if (i > 0 && name && userToken) companies.push({ id: `env-${hash8(name)}`, name, userToken, createdAt });
  }
  if (!companies.length && PEAK_USER_TOKEN?.trim()) {
    const name = PEAK_ENTITY_NAME?.trim() || "Main";
    companies.push({ id: `env-${hash8(name)}`, name, userToken: PEAK_USER_TOKEN.trim(), createdAt });
  }
  return { version: 1, developer, companies, netsuite: [] };
}

const hash8 = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
