import type { PublicSettings, SyncConfigView, SyncStatusView, TestResponse } from "@/lib/settings-types";

// Browser helpers for the /api/settings routes.

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string | null,
    public test: TestResponse | null,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({ error: `Unexpected response (HTTP ${res.status})` }));
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, json.code ?? null, json.test ?? null);
  return json as T;
}

export interface DeveloperBody {
  env: string;
  connectId?: string;
  connectKey?: string;
}

type Saved = { settings: PublicSettings; test: TestResponse | null };

export interface NetSuiteBody {
  accountId?: string;
  consumerKey?: string;
  consumerSecret?: string;
  tokenId?: string;
  tokenSecret?: string;
  scriptId?: string;
  deployId?: string;
}

export const api = {
  settings: () => call<PublicSettings>("GET", "/api/settings"),
  testDeveloper: (b: DeveloperBody) => call<TestResponse>("POST", "/api/settings/developer", b),
  saveDeveloper: (b: DeveloperBody & { skipTest?: boolean }) => call<Saved>("PUT", "/api/settings/developer", b),
  testCompany: (b: { id?: string; userToken?: string; developer?: DeveloperBody | null }) => call<TestResponse>("POST", "/api/settings/companies/test", b),
  addCompany: (b: { name: string; userToken: string; developer?: DeveloperBody; skipTest?: boolean }) => call<Saved>("POST", "/api/settings/companies", b),
  updateCompany: (id: string, b: { name?: string; userToken?: string; developer?: DeveloperBody | null; skipTest?: boolean }) =>
    call<Saved>("PATCH", `/api/settings/companies/${encodeURIComponent(id)}`, b),
  deleteCompany: (id: string) => call<{ settings: PublicSettings }>("DELETE", `/api/settings/companies/${encodeURIComponent(id)}`),
  testNetSuite: (b: NetSuiteBody & { id?: string }) => call<TestResponse>("POST", "/api/settings/netsuite/test", b),
  addNetSuite: (b: NetSuiteBody & { name: string; skipTest?: boolean }) => call<Saved>("POST", "/api/settings/netsuite", b),
  updateNetSuite: (id: string, b: NetSuiteBody & { name?: string; skipTest?: boolean }) =>
    call<Saved>("PATCH", `/api/settings/netsuite/${encodeURIComponent(id)}`, b),
  resolveNetSuite: (account: string) =>
    call<{ host: string; found: boolean | null; code: string | null }>("GET", `/api/settings/netsuite/resolve?account=${encodeURIComponent(account)}`),
  deleteNetSuite: (id: string) => call<{ settings: PublicSettings }>("DELETE", `/api/settings/netsuite/${encodeURIComponent(id)}`),
  syncStatus: () => call<SyncStatusView>("GET", "/api/sync"),
  saveSync: (b: { enabled: boolean; intervalMinutes: number; skipClosedUat: boolean; peakPageSize: number; pageWaitSeconds: number; autoPullMinutes: number }) =>
    call<SyncConfigView>("PUT", "/api/settings/sync", b),
};

/** UAT is only available Mon–Fri, 08:00–22:00 Bangkok time. */
export function isUatOpen(now = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return !["Sat", "Sun"].includes(parts.weekday) && Number(parts.hour) >= 8 && Number(parts.hour) < 22;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
