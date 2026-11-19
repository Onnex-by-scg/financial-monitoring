// Settings as the browser sees them: secrets are masked or reduced to "is set".

export type PeakEnvName = "uat" | "production";

export interface Verification {
  ok: boolean;
  message: string;
  businessName?: string | null;
  at: string;
}

export interface PublicDeveloper {
  env: PeakEnvName;
  baseUrl: string;
  connectIdMasked: string;
  hasConnectKey: boolean;
  verified: Verification | null;
}

export interface PublicCompany {
  id: string;
  name: string;
  userTokenMasked: string;
  /** Set when the company has its own developer credentials instead of the shared ones */
  ownDeveloper: PublicDeveloper | null;
  env: PeakEnvName | null;
  verified: Verification | null;
  createdAt: string;
}

export interface PublicSettings {
  /** file = .peak/settings.json, env = still read from .env.local, none = nothing set up */
  source: "file" | "env" | "none";
  storagePath: string;
  developer: PublicDeveloper | null;
  companies: PublicCompany[];
  netsuite: PublicNetSuite[];
}

/** One NetSuite account connected with OAuth 1.0 Token-Based Authentication. */
export interface PublicNetSuite {
  id: string;
  name: string;
  accountId: string;
  kind: NsKind;
  host: string;
  consumerKeyMasked: string;
  tokenIdMasked: string;
  scriptId: string;
  deployId: string;
  verified: Verification | null;
  createdAt: string;
}

export type NsKind = "production" | "sandbox";

/** "1234567_SB1" is a sandbox, "1234567" is production. */
export const nsKind = (accountId: string): NsKind => (/_SB\d*$|-sb\d*$/i.test(accountId) ? "sandbox" : "production");

export const NS_DEFAULT_SCRIPT = "customscript_int_api";

export interface TestResponse {
  ok: boolean;
  message: string;
  business?: { name: string | null; package: string | null; userEmail: string | null; userName: string | null };
  /** NetSuite test: subsidiaries the token can see */
  subsidiaries?: string[];
  /** NetSuite test: can the token run the dashboard's AR endpoint? */
  arEndpoint?: { ok: boolean; message: string };
}

export const ENV_LABEL: Record<PeakEnvName, string> = { uat: "UAT (Test)", production: "Production (Live)" };

// Same hosts as lib/peak/client.ts BASE_URLS (that module is server-only).
export const BASE_URLS_PUBLIC: Record<PeakEnvName, string> = {
  uat: "https://peakengineapidev.azurewebsites.net",
  production: "https://api.peakaccount.com",
};

// ---- Data sync (Settings → Data sync, /api/settings/sync and /api/sync) ----

export const SYNC_MIN_MINUTES = 5;
export const SYNC_MAX_MINUTES = 24 * 60;

export interface SyncConfigView {
  enabled: boolean;
  intervalMinutes: number;
  skipClosedUat: boolean;
  /** false = not saved in Settings yet (defaults / SYNC_INTERVAL_MINUTES). */
  fromSettings: boolean;
}

export interface SyncRunView {
  id: number;
  entityId: string;
  provider: string;
  /** "ar" | "pnl" */
  kind: string;
  trigger: string;
  status: string;
  mode: string | null;
  startedAt: string;
  finishedAt: string | null;
  invoices: number | null;
  error: string | null;
  note: string | null;
}

export interface SyncStatusView {
  config: SyncConfigView;
  /** Set when the server's environment turns scheduling off regardless of Settings. */
  blockedBy: string | null;
  nextRunAt: string | null;
  tabs: { id: string; name: string; provider: "peak" | "netsuite"; running: boolean }[];
  runs: SyncRunView[];
}
