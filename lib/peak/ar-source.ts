import "server-only";
import { noProgress, type Reporter } from "../sync/progress";
import type { FetchPacing } from "../sync/config";
import { makePacer, type Pacer } from "../sync/pacing";
import {
  bangkokToday,
  peakDate,
  round2,
  type ApiCall,
  type ArDebug,
  type ArInvoice,
  type ArResponse,
  type CallPurpose,
  type ProjectInfo,
  type ProjectShare,
  type RemainSource,
} from "../ar";
import { BASE_URLS, hash, mapLimit, peakGet, PeakError, pick, type Company } from "./client";
import { resolveCompanies } from "./settings-store";

// Invoice status filter codes (PEAK docs): 3 = waiting for payment, 4 = overdue.
// On UAT, status 3 already includes the overdue ones; 4 is queried too and de-duplicated, to be safe.
const OUTSTANDING_STATUSES = [3, 4];
const DEFAULT_PAGE_SIZE = 100; // PEAK maximum; Settings → Data sync can lower it
/** Safety cap on rows read per list, whatever the page size (was 50 pages × 100). */
const MAX_ROWS = 5000;
const DETAIL_CONCURRENCY = 8; // PEAK allows 20 GETs in flight per User Token
const CACHE_MS = 5 * 60 * 1000;
// PEAK has no project API. Projects are a classification group, found by its name.
const PROJECT_GROUP = /โครงการ|project/i;
const INVOICE_TYPE = 102; // TransactionType code for an invoice (PEAK docs)

type Json = Record<string, unknown>;

const cache = new Map<string, { at: number; data: ArResponse }>();
const inflight = new Map<string, Promise<ArResponse>>();

export async function getArData(
  companyId: string | null,
  refresh = false,
  progress: Reporter = noProgress,
  pacing: FetchPacing = { peakPageSize: DEFAULT_PAGE_SIZE, pageWaitMs: 0 },
): Promise<ArResponse> {
  const companies = await resolveCompanies();
  const company = companies.find((c) => c.id === companyId) ?? companies[0];
  // Credentials are part of the key, so editing them in Settings bypasses stale cached data.
  const key = `${company.id}|${company.conn.env}|${hash(`${company.conn.connectId}|${company.conn.connectKey}|${company.userToken}`)}`;

  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return { ...hit.data, debug: { ...hit.data.debug, servedFromCache: true } };
  const running = inflight.get(key);
  if (running) return running;

  const promise = load(company, companies, progress, pacing)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Records every PEAK GET (path, resCode, row count, timing) for the Debug panels. */
type Get = (purpose: CallPurpose, path: string, root: string, listKey?: string) => Promise<unknown>;

/** Progress step each kind of call counts towards. */
const STEP_OF: Partial<Record<CallPurpose, string>> = {
  user: "business",
  contacts: "customers",
  "invoices-list": "invoices",
  classification: "projects",
  "invoice-detail": "details",
  "invoice-classification": "projectLinks",
};

function tracker(company: Company, calls: ApiCall[], progress: Reporter): Get {
  return async (purpose, path, root, listKey) => {
    const started = Date.now();
    const call: ApiCall = { method: "GET", path, purpose, resCode: null, rows: null, ms: 0 };
    calls.push(call);
    try {
      const json = await peakGet(company.conn, company.userToken, path);
      const body = pick(json, root);
      call.resCode = pick<string>(body, "resCode") ?? null;
      const list = listKey ? pick<unknown[]>(body, listKey) : undefined;
      call.rows = Array.isArray(list) ? list.length : null;
      return json;
    } catch (e) {
      call.error = (e as Error).message;
      throw e;
    } finally {
      call.ms = Date.now() - started;
      const step = STEP_OF[purpose];
      if (step) progress.tick(step);
    }
  };
}

async function load(company: Company, companies: Company[], progress: Reporter, pacing: FetchPacing): Promise<ArResponse> {
  const paging: Paging = { pageSize: pacing.peakPageSize, pacer: makePacer(pacing.pageWaitMs) };
  const warnings: string[] = [];
  const calls: ApiCall[] = [];
  const get = tracker(company, calls, progress);
  progress.plan([
    { key: "business", label: "Connecting to PEAK", unit: "calls" },
    { key: "customers", label: "Reading customer names", unit: "pages" },
    { key: "invoices", label: "Reading outstanding invoices", unit: "pages" },
    { key: "projects", label: "Reading project groups (โครงการ)", unit: "calls" },
    { key: "details", label: "Getting amounts due for invoices the list left out", unit: "invoices" },
    { key: "projectLinks", label: "Finding each invoice's project", unit: "invoices" },
  ]);
  /** Runs one of the parallel first steps, marking it active, then done. */
  const phase = <T>(key: string, p: () => Promise<T>) => {
    progress.start(key);
    return p().finally(() => progress.done(key));
  };

  const [business, contacts, listed, projectGroup] = await Promise.all([
    phase("business", () => businessName(get)).catch(() => null),
    phase("customers", () => contactNames(get, paging)).catch((e: Error) => {
      warnings.push(`Customer names unavailable: ${e.message}`);
      return new Map<string, string>();
    }),
    phase("invoices", () => outstandingInvoices(get, paging)),
    phase("projects", () => findProjectGroup(get)).catch((e: Error): ProjectGroup => {
      warnings.push(`Projects unavailable: ${e.message}`);
      return { info: { groupName: null, items: [], note: `PEAK's Classification call failed: ${e.message}` }, number: null };
    }),
  ]);

  const needDetail = listed.filter((row) => typeof pick(row, "remainAmount") !== "number").length;
  if (needDetail) progress.start("details", needDetail);
  else progress.skip("details", "not needed: the list had every amount due");

  // Invoices/list does not return remainAmount on every PEAK host even with includeRemainAmount=1,
  // so get each outstanding invoice in full when the list row lacks it (to account for partial payments).
  const fetched = await mapLimit(listed, DETAIL_CONCURRENCY, async (row): Promise<{ row: Json; from: "list" | "detail" }> => {
    if (typeof pick(row, "remainAmount") === "number") return { row, from: "list" };
    try {
      const json = await get("invoice-detail", `/api/v1/Invoices?code=${encodeURIComponent(String(pick(row, "code")))}`, "PeakInvoices", "invoices");
      const detail = (pick<Json[]>(pick(json, "PeakInvoices"), "invoices") ?? [])[0];
      return detail ? { row: detail, from: "detail" } : { row, from: "list" };
    } catch {
      return { row, from: "list" };
    }
  });
  if (needDetail) progress.done("details");
  const rows = fetched.map((f) => f.row);
  const debug: ArDebug = { provider: "peak", baseUrl: BASE_URLS[company.conn.env], servedFromCache: false, calls, raw: {} };

  const missingRemain = rows.filter((r) => typeof pick(r, "remainAmount") !== "number").length;
  if (missingRemain) {
    warnings.push(`${missingRemain} invoice(s) had no outstanding amount from PEAK; their full net amount is shown.`);
  }

  const invoices: ArInvoice[] = [];
  const ids = new Map<string, string>(); // invoice code -> PEAK id, for the classification call
  for (const [i, r] of rows.entries()) {
    if (pick<number>(r, "isVoid") === 1) continue;
    const issuedDate = peakDate(pick(r, "issuedDate"));
    const dueDate = peakDate(pick(r, "dueDate")) ?? issuedDate;
    if (!issuedDate || !dueDate) continue;

    const netAmount = toNumber(pick(r, "netAmount"));
    const remain = pick(r, "remainAmount");
    const remainAmount = typeof remain === "number" ? remain : netAmount;
    if (remainAmount <= 0.004) continue; // fully paid

    // Convert foreign-currency documents to THB.
    const rate = toNumber(pick(pick(r, "currency"), "exchangeRate")) || 1;
    const contactCode = String(pick(r, "contactCode") ?? "");
    const remainSource: RemainSource = typeof remain === "number" ? fetched[i].from : "netAmount (fallback)";
    debug.raw[String(pick(r, "code") ?? "")] = { remainSource, fields: rawFields(r) };
    const id = pick<string>(r, "id");
    if (id) ids.set(String(pick(r, "code") ?? ""), id);
    invoices.push({
      code: String(pick(r, "code") ?? ""),
      contactCode,
      contactName: contacts.get(contactCode) ?? contactCode,
      reference: String(pick(r, "reference") ?? ""),
      issuedDate,
      dueDate,
      netAmount: round2(netAmount * rate),
      remainAmount: round2(remainAmount * rate),
      link: (pick<string>(r, "onlineViewLink") || pick<string>(r, "documentLink")) ?? null,
      projects: [],
    });
  }

  // One Classification/transaction call per outstanding invoice, only when a project group exists.
  if (!projectGroup.number) progress.skip("projectLinks", "no project group in PEAK");
  else progress.start("projectLinks", invoices.length);
  if (projectGroup.number) {
    const names = new Map(projectGroup.info.items.map((p) => [p.code, p.name]));
    let failed = 0;
    await mapLimit(invoices, DETAIL_CONCURRENCY, async (inv) => {
      const id = ids.get(inv.code);
      const by = id ? `transactionId=${encodeURIComponent(id)}` : `transactionCode=${encodeURIComponent(inv.code)}`;
      try {
        const json = await get("invoice-classification", `/api/v1/Classification/transaction?${by}&transactionType=${INVOICE_TYPE}`, "PeakClassification", "classifications");
        const body = pick(json, "PeakClassification");
        const match = (pick<Json[]>(body, "classifications") ?? []).find((c) => String(pick(c, "classificationGroupCode") ?? "") === projectGroup.number);
        inv.projects = (pick<Json[]>(match, "classificationItemList") ?? []).map((it): ProjectShare => {
          const code = String(pick(it, "number") ?? "");
          return { code, name: names.get(code) ?? code, percent: toNumber(pick(it, "percent")) || 100 };
        });
        const raw = debug.raw[inv.code];
        if (raw && match) raw.fields.classification = match;
      } catch {
        failed++;
      }
    });
    if (failed) warnings.push(`Project unavailable for ${failed} invoice(s): PEAK's Classification/transaction call failed.`);
    progress.done("projectLinks");
  }

  return {
    entity: company.id,
    entityName: company.name,
    entities: companies.map((c) => ({ id: c.id, name: c.name, provider: "peak" as const })),
    businessName: business,
    source: company.conn.env === "uat" ? "peak-uat" : "peak-production",
    asOf: bangkokToday(),
    fetchedAt: new Date().toISOString(),
    invoices,
    projects: projectGroup.info,
    warnings,
    debug,
  };
}

interface ProjectGroup {
  info: ProjectInfo;
  /** Classification group code to look for on each invoice; null when there's no project group. */
  number: string | null;
}

async function findProjectGroup(get: Get): Promise<ProjectGroup> {
  const json = await get("classification", "/api/v1/Classification", "PeakClassification", "classificationGroup");
  const body = pick(json, "PeakClassification");
  const resCode = pick<string>(body, "resCode");
  if (resCode !== "200") throw new PeakError(502, `Classification failed (${resCode ?? "no resCode"}): ${pick<string>(body, "resDesc") ?? ""}`);

  const groups = pick<Json[]>(body, "classificationGroup") ?? [];
  const group = groups.find((g) => PROJECT_GROUP.test(`${pick(g, "name") ?? ""} ${pick(g, "description") ?? ""}`));
  if (!group) {
    const found = groups.map((g) => String(pick(g, "name") ?? pick(g, "number") ?? "")).filter(Boolean);
    return {
      number: null,
      info: {
        groupName: null,
        items: [],
        note: found.length
          ? `No PEAK classification group is named โครงการ or project (groups found: ${found.join(", ")}).`
          : "This PEAK business has no classification groups, so invoices have no project. Create a group named โครงการ in PEAK to use projects.",
      },
    };
  }
  const items = (pick<Json[]>(group, "classificationItemList") ?? []).map((it) => ({
    code: String(pick(it, "number") ?? ""),
    name: String(pick(it, "name") ?? pick(it, "number") ?? ""),
  }));
  return {
    number: String(pick(group, "number") ?? ""),
    info: { groupName: String(pick(group, "name") ?? ""), items, note: items.length ? null : `The ${pick(group, "name")} group has no items in PEAK.` },
  };
}

// The PEAK fields the dashboard reads, exactly as PEAK returned them.
const RAW_FIELDS = [
  "code",
  "issuedDate",
  "dueDate",
  "contactCode",
  "reference",
  "status",
  "isVoid",
  "netAmount",
  "paymentAmount",
  "remainAmount",
  "currency",
  "onlineViewLink",
];

function rawFields(r: Json): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RAW_FIELDS) {
    const v = pick(r, f);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

async function outstandingInvoices(get: Get, paging: Paging): Promise<Json[]> {
  const byCode = new Map<string, Json>();
  for (const status of OUTSTANDING_STATUSES) {
    await paginate(get, paging, "invoices-list", "PeakInvoices", "invoices", `/api/v1/Invoices/list?status=${status}&includeRemainAmount=1`, (rows) => {
      for (const r of rows) {
        const code = String(pick(r, "code") ?? "");
        if (code && !byCode.has(code)) byCode.set(code, r);
      }
    });
  }
  return [...byCode.values()];
}

async function contactNames(get: Get, paging: Paging): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await paginate(get, paging, "contacts", "PeakContacts", "contacts", "/api/v1/Contacts/list?", (rows) => {
    for (const c of rows) names.set(String(pick(c, "code") ?? ""), String(pick(c, "name") ?? ""));
  });
  return names;
}

async function businessName(get: Get): Promise<string | null> {
  const json = await get("user", "/api/v1/User/detail", "PeakUser");
  return pick<string>(pick(pick(pick(json, "PeakUser"), "userMerchant"), "merchant"), "name") ?? null;
}

/** Page size and spacing for PEAK list reads (Settings → Data sync). */
interface Paging {
  pageSize: number;
  pacer: Pacer;
}

async function paginate(
  get: Get,
  paging: Paging,
  purpose: CallPurpose,
  root: string,
  listKey: string,
  basePath: string,
  onPage: (rows: Json[]) => void,
) {
  const sep = basePath.endsWith("?") ? "" : "&";
  const { pageSize, pacer } = paging;
  const maxPages = Math.ceil(MAX_ROWS / pageSize);
  for (let page = 1; page <= maxPages; page++) {
    const json = await pacer.run(() => get(purpose, `${basePath}${sep}limit=${pageSize}&page=${page}`, root, listKey));
    const body = pick(json, root);
    const resCode = pick<string>(body, "resCode");
    if (resCode !== "200") {
      const desc = pick<string>(body, "resDesc") ?? pick<string>(json, "error") ?? JSON.stringify(json)?.slice(0, 200);
      throw new PeakError(502, `${basePath.split("?")[0]} failed (${resCode ?? "no resCode"}): ${desc}`);
    }
    const rows = pick<Json[]>(body, listKey) ?? [];
    onPage(rows);
    if (rows.length < pageSize) return;
  }
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
