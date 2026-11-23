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
  /** sample = sample mode (in memory, lib/mode.ts), db = saved from Settings, file = old .peak/settings.json (moved to the database on the next save),
   *  env = still read from .env.local / host environment, none = nothing set up */
  source: "sample" | "db" | "file" | "env" | "none";
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

/** AR fetch pacing (Settings → Data sync). Defaults keep the original behaviour: PEAK's maximum page, no wait. */
export const PEAK_PAGE_SIZE_MIN = 1;
export const PEAK_PAGE_SIZE_MAX = 100; // PEAK's maximum `limit`
export const PEAK_PAGE_SIZE_DEFAULT = 100;
export const PAGE_WAIT_MAX_SECONDS = 60;

export interface SyncConfigView {
  enabled: boolean;
  intervalMinutes: number;
  skipClosedUat: boolean;
  /** false = not saved in Settings yet (defaults / SYNC_INTERVAL_MINUTES). */
  fromSettings: boolean;
  /** Rows per page when reading PEAK lists (invoices, customers). NetSuite's page size is fixed at 1,000 by its API. */
  peakPageSize: number;
  /** Seconds to wait between page requests (PEAK and NetSuite). 0 = no wait. */
  pageWaitSeconds: number;
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
