import "server-only";
import { bangkokToday, nsDate, round2, type ApiCall, type ArDebug, type ArEntity, type ArInvoice, type ArResponse, type NsSyncInfo, type RemainSource } from "../ar";
import { hash, mapLimit, PeakError } from "../peak/client";
import type { StoredNetSuite } from "../peak/settings-store";
import { nsKind } from "../settings-types";
import { noProgress, type Reporter } from "../sync/progress";
import { makePacer, noPacer, type Pacer } from "../sync/pacing";
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
// Cloudflare Workers have 128 MB of memory per isolate and limited time per run, so:
//  - each page is reduced to its open invoices (trimmed) as soon as it arrives; whole pages are never kept;
//  - the caller can read one page at a time (pageConcurrency) and set a deadline: a full read that isn't finished
//    by then is saved as `partial` and continued by the next run;
//  - the caller can forbid full reads (allowFull: false, used for the dashboard's Refresh): when an update isn't
//    possible, the full read is left to the next scheduled pull and the dashboard keeps the last saved data.
//
// This file only reads. Storing the result and the update state, and deciding when to read, is the sync
// service's job: lib/sync/ar-sync.ts.

export const NS_AR_SERVICE = "invoicefromso_lhs";
const MAX_PAGES = 100;
// NetSuite limits concurrent RESTlet requests per account. 4 is below the usual limits; "busy" answers are retried.
const CONCURRENCY = 4;
const PAGE_TIMEOUT_MS = 180_000; // a 1000-invoice page can take NetSuite a long time to build
const RECHECK_TIMEOUT_MS = 60_000;
const BUSY_RETRIES = 3;
const FULL_EVERY_MS = 24 * 60 * 60 * 1000;
/** A full read split over several runs is started again if it isn't finished within this time. */
const PARTIAL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Up to this many open invoices are re-checked one by one; above it, their pages are re-read when that's fewer calls. */
const FEW_RECHECKS = 30;
/** At most this many older pages are re-read in an update (each can take NetSuite a while to build). */
const MAX_REREAD_PAGES = 5;
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
  /** A full read that didn't fit in one run (time budget on Workers); the next allowed run continues it. */
  partial?: { startedAt: number; nextPage: number; lastPage: number; total: number | null; read: number; open: Json[] } | null;
  /** A dashboard Refresh needed a full read and left it to the next scheduled pull. */
  fullRequested?: boolean;
}

export interface LoadOptions {
  /** Seconds between page reads (Settings → Data sync). NetSuite's page size itself is fixed at 1,000 by #46. */
  pageWaitMs?: number;
  /** Pages read at the same time in a full read (default 4). On Workers 1, so only one large page is in memory. */
  pageConcurrency?: number;
  /** A full read stops starting new pages after this time (ms since epoch) and is continued by a later run. */
  deadline?: number;
  /** May this run do a full read? When not, and an update isn't possible, the full read is left to the schedule. */
  allowFull?: boolean;
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
  opts: LoadOptions = {},
): Promise<NsLoadResult> {
  const pageWaitMs = opts.pageWaitMs ?? 0;
  return load(conn, entities, prev, progress, pageWaitMs > 0 ? makePacer(pageWaitMs) : noPacer, opts);
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

/**
 * One page, reduced as soon as it arrives: the IDs of every invoice on it, and only the open ones (trimmed to the
 * fields the dashboard reads). A 1,000-invoice page with line items and addresses is many MB of JSON; keeping
 * whole pages until the end of a read is what pushed the Worker past its 128 MB memory limit (Error 1102).
 */
interface Page {
  ids: string[];
  open: Json[];
  count: number;
  lastPage: number | null;
  total: number | null;
}
const reducePage = (list: List, page: number): Page => ({
  ids: list.rows.map(idOf),
  // __page: where the invoice was, so an update can re-read that page instead of looking invoices up one by one.
  open: list.rows.filter((r) => openAmount(r) !== null).map((r) => ({ ...trim(r), [PAGE_FIELD]: page })),
  count: list.rows.length,
  lastPage: list.lastPage,
  total: list.total,
});

type ReadResult = { rows: Json[]; sync: NsSyncState };

/** What one call to loadNetSuiteAr ended with. */
export type NsLoadResult =
  /** New data to save. */
  | { kind: "done"; data: ArResponse; sync: NsSyncState }
  /** A full read ran out of time; `sync.partial` holds how far it got, and the next scheduled pull continues it. */
  | { kind: "partial"; sync: NsSyncState; note: string }
  /** A full read was needed but not allowed here (dashboard Refresh); the next scheduled pull does it. */
  | { kind: "deferred"; sync: NsSyncState; note: string };

const NO_BASE: Omit<NsSyncState, "partial" | "fullRequested"> = { fullAt: 0, lastPage: 0, total: null, lastPageIds: [], open: [] };

async function load(conn: StoredNetSuite, entities: ArEntity[], prev: NsSyncState | null, progress: Reporter, pacer: Pacer, opts: LoadOptions): Promise<NsLoadResult> {
  const calls: ApiCall[] = [];
  const warnings: string[] = [];
  let rechecked = 0;
  /** Progress step that page reads count towards ("pages" in a full read, "tail" in an update). */
  let pageStep = "pages";
  const concurrency = opts.pageConcurrency ?? CONCURRENCY;
  const deadline = opts.deadline ?? Infinity;

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

  const fetchPage = async (page: number): Promise<Page> => {
    // Through the pacer: with a wait set, pages go one at a time with the wait in between.
    const list = await pacer.run(() => request({ "query[current_page]": String(page) }, "ns-invoices", PAGE_TIMEOUT_MS));
    progress.tick(pageStep);
    return reducePage(list, page);
  };

  // ---- Full read: every page, `concurrency` at a time. Stops at the deadline and returns how far it got. ----
  type Partial = NonNullable<NsSyncState["partial"]>;
  const full = async (note: string | null, resume: Partial | null): Promise<ReadResult | Partial> => {
    pageStep = "pages";
    progress.plan([{ key: "pages", label: "Reading every invoice from NetSuite (1,000 per page)", unit: "pages" }], note);
    progress.start("pages");
    const startedAt = resume?.startedAt ?? Date.now();
    const open = new Map<string, Json>((resume?.open ?? []).map((r) => [idOf(r), r]));
    let lastPage: number;
    let total: number | null;
    let next: number;
    let lastIds: string[] = [];
    let read = resume?.read ?? 0;
    const keep = (p: Page) => {
      for (const r of p.open) open.set(idOf(r), r);
      read += p.count;
    };
    if (resume) {
      ({ lastPage, total, nextPage: next } = resume);
      progress.setTotal("pages", lastPage);
      progress.tick("pages", next - 1);
    } else {
      const first = await fetchPage(1).catch((e: Error) => {
        // Point at the endpoint only when NetSuite itself answered (access denied / RESTlet error), not for network failures.
        const fromNetSuite = e instanceof PeakError && (e.status === 403 || /^NetSuite error/.test(e.message));
        if (!fromNetSuite) throw e;
        throw new PeakError(e.status, `${e.message} (endpoint #46 ${NS_AR_SERVICE} on ${NS_SCRIPT_2}. If the token's role can't run that RESTlet, ask the NetSuite admin to grant it.)`);
      });
      lastPage = Math.min(first.lastPage ?? 1, MAX_PAGES);
      total = first.total;
      if ((first.lastPage ?? 1) > MAX_PAGES) warnings.push(`NetSuite reported ${first.lastPage} pages; only the first ${MAX_PAGES} (${MAX_PAGES * 1000} invoices) were read.`);
      progress.setTotal("pages", lastPage);
      keep(first);
      lastIds = first.ids;
      next = 2;
    }

    while (next <= lastPage) {
      if (Date.now() >= deadline) {
        return { startedAt, nextPage: next, lastPage, total, read, open: [...open.values()] };
      }
      const batch = range(next, Math.min(next + concurrency - 1, lastPage));
      const pages = batch.length === 1 ? [await fetchPage(batch[0])] : await Promise.all(batch.map(fetchPage));
      pages.forEach(keep);
      lastIds = pages[pages.length - 1].ids;
      next += batch.length;
    }
    progress.done("pages", `${read.toLocaleString("en-US")} invoices read`);
    return { rows: [...open.values()], sync: { fullAt: Date.now(), lastPage, total, lastPageIds: lastIds, open: [] } };
  };

  // ---- Update: last page + new pages + re-check of last time's open invoices. Returns a reason when it can't. ----
  const update = async (p: NsSyncState): Promise<ReadResult | string> => {
    pageStep = "tail";
    progress.plan([
      { key: "tail", label: "Reading the newest invoices (last page and any new pages)", unit: "pages", total: 1 },
      { key: "reread", label: "Re-reading the pages that held open invoices", unit: "pages" },
      { key: "recheck", label: "Re-checking invoices that were open last time", unit: "invoices" },
    ]);
    progress.start("tail");
    const tail = await fetchPage(p.lastPage);
    if (!p.lastPageIds.every((id, i) => tail.ids[i] === id)) return `the invoices on page ${p.lastPage} changed, so NetSuite's page order isn't stable`;
    if (tail.lastPage !== null && tail.lastPage < p.lastPage) return `NetSuite now reports fewer pages (${tail.lastPage}) than last time (${p.lastPage})`;
    if (tail.total !== null && p.total !== null && tail.total < p.total) return `NetSuite now reports fewer invoices (${tail.total}) than last time (${p.total})`;

    const reported = tail.lastPage ?? p.lastPage;
    const lastPage = Math.min(reported, MAX_PAGES);
    if (reported > MAX_PAGES) warnings.push(`NetSuite reported ${reported} pages; only the first ${MAX_PAGES} (${MAX_PAGES * 1000} invoices) were read.`);
    progress.setTotal("tail", 1 + lastPage - p.lastPage);
    const extra = lastPage > p.lastPage ? await mapLimit(range(p.lastPage + 1, lastPage), concurrency, fetchPage) : [];
    const newest = [tail, ...extra];
    const pages = [...newest];

    const merged = new Map(p.open.map((r) => [idOf(r), r]));
    const seen = new Set(pages.flatMap((pg) => pg.ids));
    // Rows without an internal ID can't be looked up; they are refreshed by the next full read.
    let recheck = [...merged.keys()].filter((id) => !seen.has(id) && !id.startsWith("doc:"));
    progress.done("tail");

    // Many open invoices to re-check, on a few pages: re-reading those pages is far quicker than one call each.
    const byPage = new Map<number, string[]>();
    for (const id of recheck) {
      const pg = Number(merged.get(id)?.[PAGE_FIELD]);
      if (Number.isInteger(pg) && pg >= 1 && pg < p.lastPage) byPage.set(pg, [...(byPage.get(pg) ?? []), id]);
    }
    if (recheck.length > FEW_RECHECKS && byPage.size && byPage.size <= MAX_REREAD_PAGES) {
      const list = [...byPage.keys()].sort((a, b) => a - b);
      pageStep = "reread";
      progress.start("reread", list.length);
      for (const pg of list) {
        const page = await fetchPage(pg);
        const ids = new Set(page.ids);
        // An invoice that was open on this page isn't there any more: the page order changed.
        if (byPage.get(pg)!.some((id) => !ids.has(id))) return `an open invoice is no longer on page ${pg}, so NetSuite's page order changed`;
        pages.push(page);
        for (const id of page.ids) seen.add(id);
      }
      progress.done("reread");
      recheck = recheck.filter((id) => !seen.has(id));
    } else progress.skip("reread", recheck.length > FEW_RECHECKS ? "open invoices are spread over too many pages" : "few enough to check one by one");
    if (recheck.length > MAX_RECHECK) return `${recheck.length} open invoices would need re-checking one by one (more than ${MAX_RECHECK})`;

    rechecked = recheck.length;
    if (recheck.length) progress.start("recheck", recheck.length);
    else progress.skip("recheck", "every open invoice was on the pages just read");
    let filterIgnored = false;
    await mapLimit(recheck, CONCURRENCY, async (id) => {
      const list = await request({ "query[inv_ns_internal_id]": id }, "ns-recheck", RECHECK_TIMEOUT_MS);
      progress.tick("recheck");
      const row = list.rows.find((r) => idOf(r) === id);
      if (row) merged.set(id, { ...trim(row), [PAGE_FIELD]: merged.get(id)?.[PAGE_FIELD] });
      else if (list.rows.length) filterIgnored = true; // got other invoices back: the ID filter didn't apply
      else merged.delete(id); // no longer exists (deleted in NetSuite)
    });
    if (filterIgnored) return "looking up an invoice by inv_ns_internal_id returned other invoices";
    if (recheck.length) progress.done("recheck");

    // Invoices on the pages just read: drop them all (paid ones must go), then put back the open ones.
    for (const pg of pages) for (const id of pg.ids) merged.delete(id);
    for (const pg of pages) for (const r of pg.open) merged.set(idOf(r), r);
    return {
      rows: [...merged.values()],
      sync: { fullAt: p.fullAt, lastPage, total: tail.total ?? p.total, lastPageIds: newest[newest.length - 1].ids, open: [] },
    };
  };

  const base = prev && prev.fullAt > 0 ? prev : null;
  const resume = prev?.partial && Date.now() - prev.partial.startedAt < PARTIAL_MAX_AGE_MS ? prev.partial : null;
  const fullDue = !base || Date.now() - base.fullAt >= FULL_EVERY_MS || Boolean(prev?.fullRequested) || Boolean(resume);
  const allowFull = opts.allowFull ?? true;
  const keepBase = (extra: Pick<NsSyncState, "partial" | "fullRequested">): NsSyncState => ({ ...NO_BASE, ...(base ?? {}), partial: resume, fullRequested: prev?.fullRequested, ...extra });

  let result: ReadResult;
  let sync: NsSyncInfo;
  const attempt = base && (!fullDue || !allowFull) ? await update(base) : null;
  if (attempt && typeof attempt !== "string") {
    result = attempt;
    // An update doesn't finish a full read that's due or under way: keep that for the next scheduled pull.
    result.sync.partial = resume;
    result.sync.fullRequested = prev?.fullRequested;
    sync = { mode: "update", reason: null, rechecked };
  } else {
    const reason = typeof attempt === "string" ? `Update not possible: ${attempt}.` : resume ? "Continuing a full read." : base ? "Daily full read." : "No earlier read saved.";
    if (!allowFull) {
      const note = `${reason} Every invoice will be read again by the next scheduled pull; the dashboard keeps showing the last saved data until then.`;
      return { kind: "deferred", note, sync: keepBase({ fullRequested: true }) };
    }
    const note = resume
      ? `Continuing the full read from page ${resume.nextPage} of ${resume.lastPage}.`
      : typeof attempt === "string"
        ? `${reason} Reading everything instead.`
        : reason === "Daily full read."
          ? "Once a day every invoice is read again."
          : null;
    const out = await full(note, resume);
    if (!("rows" in out)) {
      const pct = Math.round(((out.nextPage - 1) / out.lastPage) * 100);
      return {
        kind: "partial",
        note: `Full read ${pct}% done (pages 1–${out.nextPage - 1} of ${out.lastPage}); it continues on the next scheduled pull.`,
        sync: keepBase({ partial: out, fullRequested: prev?.fullRequested }),
      };
    }
    result = out;
    result.sync.partial = null;
    result.sync.fullRequested = false;
    sync = { mode: "full", reason, rechecked: 0 };
  }

  const built = build(conn, entities, result.rows, calls, warnings);
  result.sync.open = built.openRows;
  built.data.debug.sync = { ...sync, fullAt: new Date(result.sync.fullAt).toISOString(), pagesRead: calls.filter((c) => c.purpose === "ns-invoices").length };
  return { kind: "done", data: built.data, sync: result.sync };
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
const PAGE_FIELD = "__page";
const KEEP_FIELDS = ["inv_url_link_printform_inc_vat", "apply_customerdeposit", "payment_query", PAGE_FIELD];
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
