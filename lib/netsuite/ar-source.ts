import "server-only";
import { bangkokToday, nsDate, round2, type ApiCall, type ArDebug, type ArEntity, type ArInvoice, type ArResponse, type NsSyncInfo, type RemainSource } from "../ar";
import { hash, mapLimit, PeakError } from "../peak/client";
import type { StoredNetSuite } from "../peak/settings-store";
import { nsKind } from "../settings-types";
import { noProgress, type Reporter } from "../sync/progress";
import { NS_SCRIPT_2, nsGet, restletHost } from "./client";

// Outstanding AR from NetSuite, via SCG's RESTlet endpoint #46 "Query Invoice From SO + Apply Deposit"
// (service_type=invoicefromso_lhs, script customscript_int_api_2). It is the only documented AR endpoint
// that returns a due date, a status and the remaining amount. The standard #07 invoice query has none of them.
//
// #46 has no status or date filter (only current_page and inv_ns_internal_id), so:
//  - a FULL read downloads every invoice (1000 per page) and keeps the open ones;
//  - an UPDATE re-reads only what can have changed since the last read:
//      1. the last page and any new pages after it (new invoices are appended at the end), and
//      2. every invoice that was open last time and isn't on those pages, one call each by inv_ns_internal_id.
//    Paid invoices aren't re-read. If anything suggests the page order changed, or there are too many open invoices
//    to re-check, it does a full read instead. A full read also runs once every FULL_EVERY_MS, to catch the rare
//    invoice that is reopened after being paid.
//
// This file only reads. Storing the result (SQLite) and the update state, and deciding when to read, is the sync
// service's job: lib/sync/ar-sync.ts.

export const NS_AR_SERVICE = "invoicefromso_lhs";
const MAX_PAGES = 100;
// NetSuite limits concurrent RESTlet requests per account. 4 is below the usual limits; "busy" answers are retried.
const CONCURRENCY = 4;
const PAGE_TIMEOUT_MS = 180_000; // a 1000-invoice page can take NetSuite a long time to build
const RECHECK_TIMEOUT_MS = 60_000;
const BUSY_RETRIES = 3;
const FULL_EVERY_MS = 24 * 60 * 60 * 1000;
/** Above this many open invoices to re-check one by one, a full read is likely quicker. */
const MAX_RECHECK = 400;

type Json = Record<string, unknown>;

/** What an update needs from the previous read. Stored by the sync service (lib/sync/ar-sync.ts). */
export interface NsSyncState {
  /** When the last full read finished. */
  fullAt: number;
  /** Last page number read, and NetSuite's total at that time. */
  lastPage: number;
  total: number | null;
  /** Invoice IDs on the last page, in order: if they move, the page order changed and an update isn't safe. */
  lastPageIds: string[];
  /** The open invoices (trimmed to the fields the dashboard reads). */
  open: Json[];
}

/** Identifies the credentials a result was read with, so data read with other keys is never reused. */
export const nsCredKey = (conn: StoredNetSuite) =>
  `${conn.id}|${hash([conn.accountId, conn.consumerKey, conn.consumerSecret, conn.tokenId, conn.tokenSecret, conn.deployId].join("|"))}`;

/** Reads NetSuite (full read or update from `prev`). The sync service stores the result and the new state. */
export async function loadNetSuiteAr(
  conn: StoredNetSuite,
  entities: ArEntity[],
  prev: NsSyncState | null,
  progress: Reporter = noProgress,
): Promise<{ data: ArResponse; sync: NsSyncState }> {
  return load(conn, entities, prev, progress);
}

/** Paths shown in the Debug panel (host is in debug.baseUrl). */
const restletPath = (conn: StoredNetSuite, query: string) =>
  `/app/site/hosting/restlet.nl?script=${NS_SCRIPT_2}&deploy=${conn.deployId}&service_type=${NS_AR_SERVICE}&${query}`;

/**
 * The doc's two list shapes: #46's example puts total/last_page/data[] at the top level;
 * the standard structure nests them in data: { total, last_page, data: [] }. Accept both.
 */
function listOf(json: unknown): { rows: Json[]; lastPage: number | null; total: number | null } {
  const top = (json ?? {}) as Json;
  const nested = top.data && !Array.isArray(top.data) && typeof top.data === "object" ? (top.data as Json) : null;
  const holder = nested ?? top;
  const rows = Array.isArray(holder.data) ? (holder.data as Json[]) : [];
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  return { rows, lastPage: num(holder.last_page), total: num(holder.total) };
}

type List = ReturnType<typeof listOf>;
type ReadResult = { rows: Json[]; sync: NsSyncState };

async function load(
  conn: StoredNetSuite,
  entities: ArEntity[],
  prev: NsSyncState | null,
  progress: Reporter,
): Promise<{ data: ArResponse; sync: NsSyncState }> {
  const calls: ApiCall[] = [];
  const warnings: string[] = [];
  let rechecked = 0;
  /** Progress step that page reads count towards ("pages" in a full read, "tail" in an update). */
  let pageStep = "pages";

  /** One #46 call, retried while NetSuite says it's busy. */
  const request = async (params: Record<string, string>, purpose: ApiCall["purpose"], timeoutMs: number): Promise<List> => {
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const call: ApiCall = { method: "GET", path: restletPath(conn, query), purpose, resCode: null, rows: null, ms: 0 };
    calls.push(call);
    const started = Date.now();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const json = await nsGet(conn, { service_type: NS_AR_SERVICE, ...params }, NS_SCRIPT_2, timeoutMs);
          const list = listOf(json);
          call.resCode = String((json as Json).code ?? "200");
          call.rows = list.rows.length;
          return list;
        } catch (e) {
          // NetSuite "busy" (too many concurrent requests): wait and try again.
          if (e instanceof PeakError && e.status === 429 && attempt < BUSY_RETRIES) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      call.error = (e as Error).message;
      throw e;
    } finally {
      call.ms = Date.now() - started;
    }
  };

  const fetchPage = async (page: number) => {
    const list = await request({ "query[current_page]": String(page) }, "ns-invoices", PAGE_TIMEOUT_MS);
    progress.tick(pageStep);
    return list;
  };

  // ---- Full read: every page ----
  const full = async (note: string | null): Promise<ReadResult> => {
    pageStep = "pages";
    progress.plan([{ key: "pages", label: "Reading every invoice from NetSuite (1,000 per page)", unit: "pages" }], note);
    progress.start("pages");
    const first = await fetchPage(1).catch((e: Error) => {
      // Point at the endpoint only when NetSuite itself answered (access denied / RESTlet error), not for network failures.
      const fromNetSuite = e instanceof PeakError && (e.status === 403 || /^NetSuite error/.test(e.message));
      if (!fromNetSuite) throw e;
      throw new PeakError(e.status, `${e.message} (endpoint #46 ${NS_AR_SERVICE} on ${NS_SCRIPT_2}. If the token's role can't run that RESTlet, ask the NetSuite admin to grant it.)`);
    });
    if (first.lastPage) progress.setTotal("pages", Math.min(first.lastPage, MAX_PAGES));
    const lastPage = Math.min(first.lastPage ?? 1, MAX_PAGES);
    if ((first.lastPage ?? 1) > MAX_PAGES) warnings.push(`NetSuite reported ${first.lastPage} pages; only the first ${MAX_PAGES} (${MAX_PAGES * 1000} invoices) were read.`);
    const rest = lastPage > 1 ? await mapLimit(range(2, lastPage), CONCURRENCY, fetchPage) : [];
    const pages = [first, ...rest];
    progress.done("pages", `${pages.reduce((n, p) => n + p.rows.length, 0).toLocaleString("en-US")} invoices read`);
    return {
      rows: pages.flatMap((p) => p.rows),
      sync: { fullAt: Date.now(), lastPage, total: first.total, lastPageIds: pages[pages.length - 1].rows.map(idOf), open: [] },
    };
  };

  // ---- Update: last page + new pages + re-check of last time's open invoices. Returns a reason when it can't. ----
  const update = async (p: NsSyncState): Promise<ReadResult | string> => {
    pageStep = "tail";
    progress.plan([
      { key: "tail", label: "Reading the newest invoices (last page and any new pages)", unit: "pages", total: 1 },
      { key: "recheck", label: "Re-checking invoices that were open last time", unit: "invoices" },
    ]);
    progress.start("tail");
    const tail = await fetchPage(p.lastPage);
    const tailIds = tail.rows.map(idOf);
    if (!p.lastPageIds.every((id, i) => tailIds[i] === id)) return `the invoices on page ${p.lastPage} changed, so NetSuite's page order isn't stable`;
    if (tail.lastPage !== null && tail.lastPage < p.lastPage) return `NetSuite now reports fewer pages (${tail.lastPage}) than last time (${p.lastPage})`;
    if (tail.total !== null && p.total !== null && tail.total < p.total) return `NetSuite now reports fewer invoices (${tail.total}) than last time (${p.total})`;

    const reported = tail.lastPage ?? p.lastPage;
    const lastPage = Math.min(reported, MAX_PAGES);
    if (reported > MAX_PAGES) warnings.push(`NetSuite reported ${reported} pages; only the first ${MAX_PAGES} (${MAX_PAGES * 1000} invoices) were read.`);
    progress.setTotal("tail", 1 + lastPage - p.lastPage);
    const extra = lastPage > p.lastPage ? await mapLimit(range(p.lastPage + 1, lastPage), CONCURRENCY, fetchPage) : [];
    const pageRows = [tail, ...extra].flatMap((l) => l.rows);

    const merged = new Map(p.open.map((r) => [idOf(r), r]));
    const seen = new Set(pageRows.map(idOf));
    // Rows without an internal ID can't be looked up; they are refreshed by the next full read.
    const recheck = [...merged.keys()].filter((id) => !seen.has(id) && !id.startsWith("doc:"));
    if (recheck.length > MAX_RECHECK) return `${recheck.length} open invoices would need re-checking one by one (more than ${MAX_RECHECK})`;

    progress.done("tail");
    rechecked = recheck.length;
    if (recheck.length) progress.start("recheck", recheck.length);
    else progress.skip("recheck", "every open invoice was on the pages just read");
    let filterIgnored = false;
    await mapLimit(recheck, CONCURRENCY, async (id) => {
      const list = await request({ "query[inv_ns_internal_id]": id }, "ns-recheck", RECHECK_TIMEOUT_MS);
      progress.tick("recheck");
      const row = list.rows.find((r) => idOf(r) === id);
      if (row) merged.set(id, row);
      else if (list.rows.length) filterIgnored = true; // got other invoices back: the ID filter didn't apply
      else merged.delete(id); // no longer exists (deleted in NetSuite)
    });
    if (filterIgnored) return "looking up an invoice by inv_ns_internal_id returned other invoices";
    if (recheck.length) progress.done("recheck");

    for (const r of pageRows) merged.set(idOf(r), r);
    const last = extra.length ? extra[extra.length - 1] : tail;
    return {
      rows: [...merged.values()],
      sync: { fullAt: p.fullAt, lastPage, total: tail.total ?? p.total, lastPageIds: last.rows.map(idOf), open: [] },
    };
  };

  let result: ReadResult;
  let sync: NsSyncInfo;
  const fullDue = !prev || Date.now() - prev.fullAt >= FULL_EVERY_MS;
  const attempt = prev && !fullDue ? await update(prev) : null;
  if (attempt && typeof attempt !== "string") {
    result = attempt;
    sync = { mode: "update", reason: null, rechecked };
  } else {
    // Calls made by an abandoned update stay in the Debug list; the progress steps switch to a full read.
    const reason = typeof attempt === "string" ? `Update not possible: ${attempt}.` : prev ? "Daily full read." : "No earlier read saved.";
    result = await full(typeof attempt === "string" ? `${reason} Reading everything instead.` : reason === "Daily full read." ? "Once a day every invoice is read again." : null);
    sync = { mode: "full", reason, rechecked: 0 };
  }

  const built = build(conn, entities, result.rows, calls, warnings);
  result.sync.open = built.openRows;
  built.data.debug.sync = { ...sync, fullAt: new Date(result.sync.fullAt).toISOString(), pagesRead: calls.filter((c) => c.purpose === "ns-invoices").length };
  return { data: built.data, sync: result.sync };
}

/** Remaining amount of an invoice still open, or null when it's paid, void or fully applied. */
function openAmount(r: Json): { remain: number; remainSource: RemainSource } | null {
  if (/paid in full|void|reject|cancel/i.test(str(r.inv_status))) return null;
  let remain: number;
  let remainSource: RemainSource;
  if (r.inv_amount_remaining_total !== undefined && r.inv_amount_remaining_total !== null && r.inv_amount_remaining_total !== "") {
    remain = num(r.inv_amount_remaining_total);
    remainSource = "inv_amount_remaining_total";
  } else {
    // Not in the field table, only in the example: fall back to total minus applied deposits and payments.
    const total = num(r.inv_amount_total ?? r.inv_inv_amount_total);
    const applied = sumOf(r.apply_customerdeposit, "apply_customerdeposit_amount") + sumOf(r.payment_query, "payment_query_ref_amount");
    remain = round2(total - applied);
    remainSource = "total − applied (fallback)";
  }
  return remain > 0.004 ? { remain, remainSource } : null;
}

function build(conn: StoredNetSuite, entities: ArEntity[], rows: Json[], calls: ApiCall[], warnings: string[]): { data: ArResponse; openRows: Json[] } {
  const debug: ArDebug = { provider: "netsuite", baseUrl: `https://${restletHost(conn.accountId)}`, servedFromCache: false, calls, raw: {} };
  const invoices: ArInvoice[] = [];
  const openRows: Json[] = [];
  const subsidiaries = new Set<string>();
  let fallbackRemain = 0;
  let skippedDates = 0;

  for (const r of rows) {
    const open = openAmount(r);
    if (!open) continue;
    openRows.push(trim(r));
    if (open.remainSource === "total − applied (fallback)") fallbackRemain++;

    const issuedDate = nsDate(r.inv_date);
    const dueDate = nsDate(r.inv_due_date) ?? issuedDate;
    if (!issuedDate || !dueDate) {
      skippedDates++;
      continue;
    }

    const total = num(r.inv_amount_total ?? r.inv_inv_amount_total);
    const rate = num(r.inv_exchange_rate) || 1;
    const code = str(r.inv_doc_number) || str(r.inv_ns_internal_id);
    const sub = str(r.inv_subsidiary_name);
    if (sub) subsidiaries.add(sub);

    debug.raw[code] = { remainSource: open.remainSource, fields: rawFields(r) };
    invoices.push({
      code,
      contactCode: str(r.inv_customer_ns_internal_id) || str(r.inv_customer_name),
      contactName: str(r.inv_customer_name) || str(r.inv_customer_ns_internal_id),
      reference: str(r.inv_createfrom_so_no),
      issuedDate,
      dueDate,
      netAmount: round2(total * rate),
      remainAmount: round2(open.remain * rate),
      link: str(r.inv_url_link_printform_inc_vat) || null,
      projects: str(r.inv_project_code) ? [{ code: str(r.inv_project_code), name: str(r.inv_project_code), percent: 100 }] : [],
    });
  }

  if (fallbackRemain) warnings.push(`${fallbackRemain} invoice(s) had no inv_amount_remaining_total; amount due = total − applied deposits/payments.`);
  if (skippedDates) warnings.push(`${skippedDates} open invoice(s) were skipped because inv_date / inv_due_date wasn't DD/MM/YYYY.`);

  const data: ArResponse = {
    entity: conn.id,
    entityName: conn.name,
    entities,
    businessName: [...subsidiaries].join(", ") || null,
    source: nsKind(conn.accountId) === "sandbox" ? "netsuite-sandbox" : "netsuite-production",
    asOf: bangkokToday(),
    fetchedAt: new Date().toISOString(),
    invoices,
    // #46 has no project list, so the projects are the ones seen on open invoices.
    projects: {
      groupName: null,
      items: [...new Map(invoices.flatMap((i) => i.projects).map((p) => [p.code, { code: p.code, name: p.name }])).values()],
      note: invoices.some((i) => i.projects.length) ? null : "No open invoice has inv_project_code.",
    },
    warnings,
    debug,
  };
  return { data, openRows };
}

/** Invoice key: NetSuite internal ID (the document number only if that is missing). */
const idOf = (r: Json) => str(r.inv_ns_internal_id) || `doc:${str(r.inv_doc_number)}`;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Fields kept for open invoices between reads (line items and addresses are dropped). */
const KEEP_FIELDS = ["inv_url_link_printform_inc_vat", "apply_customerdeposit", "payment_query"];
function trim(r: Json): Json {
  const out: Json = {};
  for (const f of [...RAW_FIELDS, ...KEEP_FIELDS]) if (r[f] !== undefined) out[f] = r[f];
  return out;
}

// The NetSuite fields the dashboard reads, exactly as NetSuite returned them.
const RAW_FIELDS = [
  "inv_ns_internal_id",
  "inv_doc_number",
  "inv_date",
  "inv_due_date",
  "inv_status",
  "inv_customer_ns_internal_id",
  "inv_customer_name",
  "inv_amount_total",
  "inv_inv_amount_total",
  "inv_amount_remaining_total",
  "inv_currency_name",
  "inv_exchange_rate",
  "inv_term_name",
  "inv_project_code",
  "inv_createfrom_so_no",
  "inv_subsidiary_name",
  "inv_main_department_name",
];

function rawFields(r: Json): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RAW_FIELDS) if (r[f] !== undefined) out[f] = r[f];
  return out;
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/** NetSuite sends amounts as text such as ".00" or "1,499.00". */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function sumOf(list: unknown, field: string): number {
  return Array.isArray(list) ? list.reduce((s: number, x) => s + num((x as Json)?.[field]), 0) : 0;
}
