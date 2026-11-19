"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ApiCall, ArResponse, ArRow, CallPurpose, Provider } from "@/lib/ar";
import { BUCKET_STYLE, fmtAmount, fmtDateTime } from "@/lib/format";

// Debug button + panel: for one chart, shows the API paths that fed it (PEAK or NetSuite),
// the source fields it reads, how they're computed, and the exact data plotted.

export interface FieldUse {
  /** Source field path, as in the PEAK / NetSuite response */
  peak: string;
  purpose: CallPurpose;
  /** Field in this app's ArInvoice / ArRow */
  app: string;
  use: string;
}

export interface DebugSpec {
  title: string;
  fields: FieldUse[];
  formula: string[];
  /** The values the chart draws, after filters */
  plotted: unknown;
  /** Invoices that make up the chart, after filters */
  rows: ArRow[];
}

export const ENDPOINTS: Record<CallPurpose, { label: string; path: string; root: string }> = {
  "invoices-list": {
    label: "Outstanding invoice list",
    path: "GET /api/v1/Invoices/list?status={3|4}&includeRemainAmount=1&limit=100&page={n}",
    root: "PeakInvoices.invoices[]",
  },
  "invoice-detail": {
    label: "One invoice in full (for remainAmount)",
    path: "GET /api/v1/Invoices?code={invoice code}",
    root: "PeakInvoices.invoices[0]",
  },
  contacts: { label: "Customer names", path: "GET /api/v1/Contacts/list?limit=100&page={n}", root: "PeakContacts.contacts[]" },
  user: { label: "Connected business", path: "GET /api/v1/User/detail", root: "PeakUser.userMerchant.merchant" },
  classification: {
    label: "Classification groups (the project list is the group named โครงการ / project)",
    path: "GET /api/v1/Classification",
    root: "PeakClassification.classificationGroup[]",
  },
  "invoice-classification": {
    label: "Projects on one invoice (only when a project group exists)",
    path: "GET /api/v1/Classification/transaction?transactionId={invoice id}&transactionType=102",
    root: "PeakClassification.classifications[]",
  },
  "ns-invoices": {
    label: "#46 Query Invoice From SO + Apply Deposit (all invoices, 1000 per page)",
    path: "GET restlet.nl?script=customscript_int_api_2&deploy=1&service_type=invoicefromso_lhs&query[current_page]={n}",
    root: "data[]",
  },
  "ns-recheck": {
    label: "#46 one invoice by ID (re-checks invoices that were open at the last read)",
    path: "GET restlet.nl?script=customscript_int_api_2&deploy=1&service_type=invoicefromso_lhs&query[inv_ns_internal_id]={id}",
    root: "data[]",
  },
};

export const PROVIDER_LABEL: Record<Provider, string> = { peak: "PEAK", netsuite: "NetSuite" };

/** Catalog of the PEAK fields the dashboard reads. Charts pick the ones they use. */
export const FIELDS = {
  status: {
    peak: "query: status=3, status=4",
    purpose: "invoices-list",
    app: "(row selection)",
    use: "Only invoices waiting for payment (3) or overdue (4) are pulled; de-duplicated by code",
  },
  code: { peak: "invoices[].code", purpose: "invoices-list", app: "code", use: "Document number; key for the detail call" },
  isVoid: { peak: "invoices[].isVoid", purpose: "invoice-detail", app: "(filter)", use: "Voided (1) invoices are dropped" },
  remainAmount: {
    peak: "invoices[].remainAmount",
    purpose: "invoice-detail",
    app: "remainAmount",
    use: "Amount due; the value summed in every chart. Rows with ≤ 0 are dropped as paid",
  },
  netAmount: {
    peak: "invoices[].netAmount",
    purpose: "invoices-list",
    app: "netAmount",
    use: "Invoice total (incl. VAT); used as amount due only if remainAmount is missing",
  },
  exchangeRate: {
    peak: "invoices[].currency.exchangeRate",
    purpose: "invoice-detail",
    app: "× rate",
    use: "Converts foreign-currency amounts to THB (1 when absent)",
  },
  issuedDate: { peak: "invoices[].issuedDate (yyyyMMdd)", purpose: "invoices-list", app: "issuedDate", use: "Credit days and duration" },
  dueDate: {
    peak: "invoices[].dueDate (yyyyMMdd)",
    purpose: "invoices-list",
    app: "dueDate → overdueDays",
    use: "overdueDays = max(0, asOf − dueDate); decides current/overdue, bucket and KPI",
  },
  contactCode: {
    peak: "invoices[].contactCode",
    purpose: "invoices-list",
    app: "contactCode",
    use: "Groups invoices per customer; distinct count = # customers",
  },
  contactName: { peak: "contacts[].code → contacts[].name", purpose: "contacts", app: "contactName", use: "Customer label, joined on contactCode" },
  reference: { peak: "invoices[].reference", purpose: "invoice-detail", app: "reference", use: "Ref. under the project in the documents table" },
  projectList: {
    peak: "classificationGroup[name ~ โครงการ|project].classificationItemList[].number, name",
    purpose: "classification",
    app: "projects.items",
    use: "Every project, including ones with no outstanding AR",
  },
  project: {
    peak: "classifications[classificationGroupCode = project group].classificationItemList[].number, percent",
    purpose: "invoice-classification",
    app: "projects[] (code, name, percent)",
    use: "Which project(s) an invoice belongs to; a split invoice's amount is shared by percent",
  },
  link: { peak: "invoices[].onlineViewLink", purpose: "invoice-detail", app: "link", use: "Link on the document number" },
  merchant: { peak: "userMerchant.merchant.name", purpose: "user", app: "businessName", use: "Business name in the sidebar" },
} satisfies Record<string, FieldUse>;

/** The same catalog for NetSuite tabs (endpoint #46 invoicefromso_lhs). Keys match FIELDS. */
export const NS_FIELDS: Record<keyof typeof FIELDS, FieldUse> = {
  status: {
    peak: "data[].inv_status",
    purpose: "ns-invoices",
    app: "(row selection)",
    use: "All invoices are read (no status filter on #46); Paid In Full / voided / rejected / cancelled are dropped",
  },
  code: { peak: "data[].inv_doc_number", purpose: "ns-invoices", app: "code", use: "Document number (inv_ns_internal_id if blank)" },
  isVoid: { peak: "data[].inv_status", purpose: "ns-invoices", app: "(filter)", use: "Status text decides what's open" },
  remainAmount: {
    peak: "data[].inv_amount_remaining_total",
    purpose: "ns-invoices",
    app: "remainAmount",
    use: "Amount due; the value summed in every chart. Rows with ≤ 0 are dropped as paid. If absent: total − applied deposits/payments",
  },
  netAmount: {
    peak: "data[].inv_amount_total",
    purpose: "ns-invoices",
    app: "netAmount",
    use: "Invoice total incl. VAT (the field table calls it inv_inv_amount_total; both are read)",
  },
  exchangeRate: { peak: "data[].inv_exchange_rate", purpose: "ns-invoices", app: "× rate", use: "Converts foreign-currency amounts to THB (1 when absent)" },
  issuedDate: { peak: "data[].inv_date (DD/MM/YYYY)", purpose: "ns-invoices", app: "issuedDate", use: "Credit days and duration" },
  dueDate: {
    peak: "data[].inv_due_date (DD/MM/YYYY)",
    purpose: "ns-invoices",
    app: "dueDate → overdueDays",
    use: "overdueDays = max(0, asOf − dueDate); decides current/overdue, bucket and KPI",
  },
  contactCode: {
    peak: "data[].inv_customer_ns_internal_id",
    purpose: "ns-invoices",
    app: "contactCode",
    use: "Groups invoices per customer; distinct count = # customers",
  },
  contactName: { peak: "data[].inv_customer_name", purpose: "ns-invoices", app: "contactName", use: "Customer label (same response)" },
  reference: { peak: "data[].inv_createfrom_so_no", purpose: "ns-invoices", app: "reference", use: "Ref. (sales order) under the project in the documents table" },
  projectList: {
    peak: "distinct data[].inv_project_code",
    purpose: "ns-invoices",
    app: "projects.items",
    use: "#46 has no project list, so only projects with open invoices are known",
  },
  project: { peak: "data[].inv_project_code", purpose: "ns-invoices", app: "projects[] (percent 100)", use: "The invoice's project" },
  link: { peak: "data[].inv_url_link_printform_inc_vat", purpose: "ns-invoices", app: "link", use: "Link on the document number (when NetSuite sends one)" },
  merchant: { peak: "data[].inv_subsidiary_name", purpose: "ns-invoices", app: "businessName", use: "Subsidiary name(s) in the sidebar" },
};

export const fieldsFor = (provider: Provider | undefined) => (provider === "netsuite" ? NS_FIELDS : FIELDS);

/** Raw source columns in the "Source invoices" table, per provider. */
const RAW_COLUMNS: Record<Provider, { issued: string; due: string; customer: string; total: string; remain: string }> = {
  peak: { issued: "issuedDate", due: "dueDate", customer: "contactCode", total: "netAmount", remain: "remainAmount" },
  netsuite: {
    issued: "inv_date",
    due: "inv_due_date",
    customer: "inv_customer_ns_internal_id",
    total: "inv_amount_total",
    remain: "inv_amount_remaining_total",
  },
};

interface DebugContextValue {
  data: ArResponse;
  filters: string;
}

export const DebugContext = createContext<DebugContextValue | null>(null);

export function DebugButton({ spec, tone = "light" }: { spec: () => DebugSpec; tone?: "light" | "dark" }) {
  const [open, setOpen] = useState(false);
  const ctx = useContext(DebugContext);
  if (!ctx) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Show the API calls and data fields behind this chart"
        className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium transition ${
          tone === "dark" ? "text-blue-100 hover:bg-white/15 hover:text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        }`}
      >
        {"</>"} Debug
      </button>
      {open && <DebugModal spec={spec()} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

function DebugModal({ spec, ctx, onClose }: { spec: DebugSpec; ctx: DebugContextValue; onClose: () => void }) {
  const { data, filters } = ctx;
  const purposes = [...new Set(spec.fields.map((f) => f.purpose))];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Debug: ${spec.title}`}
        className="w-full max-w-6xl rounded-xl bg-white text-left shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="font-mono text-xs text-slate-500">DEBUG</div>
            <h2 className="text-lg font-semibold">{spec.title}</h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>
                Source: <b>{data.source}</b>
              </span>
              <span>
                Base URL: <code>{data.debug.baseUrl ?? "none (sample data, no API calls)"}</code>
              </span>
              <span>
                Fetched: <b>{fmtDateTime(data.fetchedAt)}</b>
                {data.debug.servedFromCache && " (served from 5-min server cache)"}
              </span>
              <span>
                Aged as of: <b>{data.asOf}</b>
              </span>
              <span>
                Company: <b>{data.entityName}</b>
              </span>
              {data.debug.sync && (
                <span>
                  NetSuite read:{" "}
                  <b>
                    {data.debug.sync.mode === "update"
                      ? `update (${data.debug.sync.pagesRead ?? 0} page(s), ${data.debug.sync.rechecked} open invoice(s) re-checked)`
                      : `full (${data.debug.sync.pagesRead ?? 0} page(s))`}
                  </b>
                  {data.debug.sync.reason && ` · ${data.debug.sync.reason}`}
                  {data.debug.sync.fullAt && ` · last full read ${fmtDateTime(data.debug.sync.fullAt)}`}
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100" aria-label="Close">
            ×
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {filters && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Active filters: <b>{filters}</b>. Plotted data and invoices below reflect them; API calls don&apos;t.
            </div>
          )}

          <Section title={`1 · ${PROVIDER_LABEL[data.debug.provider ?? "peak"]} API calls`}>
            <div className="space-y-4">
              {purposes.map((p) => (
                <EndpointCalls key={p} purpose={p} calls={data.debug.calls.filter((c) => c.purpose === p)} sample={data.source === "sample"} />
              ))}
            </div>
          </Section>

          <Section title="2 · Data fields used">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 font-semibold">{PROVIDER_LABEL[data.debug.provider ?? "peak"]} field</th>
                    <th className="px-2 py-1.5 font-semibold">From</th>
                    <th className="px-2 py-1.5 font-semibold">App field</th>
                    <th className="px-2 py-1.5 font-semibold">How it&apos;s used</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.fields.map((f) => (
                    <tr key={f.peak} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5 font-mono text-violet-800">{f.peak}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-500">{ENDPOINTS[f.purpose].path.split("?")[0]}</td>
                      <td className="px-2 py-1.5 font-mono">{f.app}</td>
                      <td className="px-2 py-1.5 text-slate-700">{f.use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="3 · Calculation">
            <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-slate-800">
              {spec.formula.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Section>

          <Section title="4 · Plotted data" action={<CopyButton value={spec.plotted} />}>
            <pre className="max-h-72 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">{JSON.stringify(spec.plotted, null, 2)}</pre>
          </Section>

          <Section title={`5 · Source invoices (${spec.rows.length}): raw ${PROVIDER_LABEL[data.debug.provider ?? "peak"]} values → computed`}>
            <SourceRows rows={spec.rows} data={data} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function EndpointCalls({ purpose, calls, sample }: { purpose: CallPurpose; calls: ApiCall[]; sample: boolean }) {
  const [all, setAll] = useState(false);
  const ep = ENDPOINTS[purpose];
  const shown = all ? calls : calls.slice(0, 8);
  const totalMs = calls.reduce((s, c) => s + c.ms, 0);
  return (
    <div className="rounded-md border border-slate-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div>
          <div className="font-mono text-xs font-semibold text-brand">{ep.path}</div>
          <div className="text-xs text-slate-500">
            {ep.label} · response root <code>{ep.root}</code>
          </div>
        </div>
        <div className="text-xs text-slate-500">{sample ? "not called (sample data)" : `${calls.length} call(s) · Σ ${totalMs} ms${calls.length > 1 ? " (some run in parallel)" : ""}`}</div>
      </div>
      {calls.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="px-3 py-1 font-medium">Path called</th>
              <th className="px-3 py-1 text-right font-medium">Code</th>
              <th className="px-3 py-1 text-right font-medium">Rows</th>
              <th className="px-3 py-1 text-right font-medium">ms</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c, i) => (
              <tr key={`${c.path}-${i}`} className="border-t border-slate-100">
                <td className="break-all px-3 py-1 font-mono">
                  {c.method} {c.path}
                  {c.error && <div className="text-red-700">{c.error}</div>}
                </td>
                <td className={`px-3 py-1 text-right font-mono ${c.resCode === "200" ? "text-green-700" : "text-red-700"}`}>{c.resCode ?? "–"}</td>
                <td className="px-3 py-1 text-right tabular-nums">{c.rows ?? "–"}</td>
                <td className="px-3 py-1 text-right tabular-nums">{c.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {calls.length > 8 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="w-full border-t border-slate-100 py-1.5 text-xs font-medium text-brand hover:bg-brand-soft"
        >
          {all ? "Show fewer" : `Show all ${calls.length} calls`}
        </button>
      )}
    </div>
  );
}

function SourceRows({ rows, data }: { rows: ArRow[]; data: ArResponse }) {
  const LIMIT = 200;
  if (!rows.length) return <p className="text-xs text-slate-500">No invoices.</p>;
  const col = RAW_COLUMNS[data.debug.provider ?? "peak"];
  const raw = (code: string, f: string) => {
    const fields = data.debug.raw[code]?.fields;
    const v = fields?.[f] ?? (f === "inv_amount_total" ? fields?.inv_inv_amount_total : undefined);
    return v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[960px] text-xs">
        <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
          <tr>
            <th className="px-2 py-1.5 font-semibold">code</th>
            <th className="px-2 py-1.5 font-semibold text-violet-800">{col.issued}</th>
            <th className="px-2 py-1.5 font-semibold text-violet-800">{col.due}</th>
            <th className="px-2 py-1.5 font-semibold text-violet-800">{col.customer}</th>
            <th className="px-2 py-1.5 text-right font-semibold text-violet-800">{col.total}</th>
            <th className="px-2 py-1.5 text-right font-semibold text-violet-800">{col.remain}</th>
            <th className="px-2 py-1.5 font-semibold">remain from</th>
            <th className="px-2 py-1.5 text-right font-semibold">→ amount due (THB)</th>
            <th className="px-2 py-1.5 text-right font-semibold">→ overdueDays</th>
            <th className="px-2 py-1.5 font-semibold">→ bucket</th>
            <th className="px-2 py-1.5 font-semibold">→ KPI</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.slice(0, LIMIT).map((r) => (
            <tr key={r.code} className="border-t border-slate-100">
              <td className="px-2 py-1">{r.code}</td>
              <td className="px-2 py-1">{raw(r.code, col.issued)}</td>
              <td className="px-2 py-1">{raw(r.code, col.due)}</td>
              <td className="px-2 py-1">{raw(r.code, col.customer)}</td>
              <td className="px-2 py-1 text-right">{raw(r.code, col.total)}</td>
              <td className="px-2 py-1 text-right">{raw(r.code, col.remain)}</td>
              <td className="px-2 py-1 text-slate-500">{data.debug.raw[r.code]?.remainSource ?? "–"}</td>
              <td className="px-2 py-1 text-right">{fmtAmount(r.remainAmount)}</td>
              <td className="px-2 py-1 text-right">{r.overdueDays}</td>
              <td className="px-2 py-1">{BUCKET_STYLE[r.bucket].label}</td>
              <td className="px-2 py-1">{r.onTarget ? "✓ Target" : "⚠ Over"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > LIMIT && (
        <p className="px-2 py-1.5 text-xs text-slate-500">
          Showing the first {LIMIT} of {rows.length}.
        </p>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
      onClick={async () => {
        await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy JSON"}
    </button>
  );
}
