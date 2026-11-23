// AR model shared by the server (building rows) and the browser (filtering and aggregating).

/** One outstanding sales invoice, normalized from PEAK or NetSuite. Dates are ISO yyyy-MM-dd. */
export interface ArInvoice {
  code: string;
  contactCode: string;
  contactName: string;
  reference: string;
  issuedDate: string;
  dueDate: string;
  netAmount: number;
  remainAmount: number;
  link: string | null;
  /** Projects the invoice is assigned to (PEAK classification / NetSuite inv_project_code). Empty when none. */
  projects: ProjectShare[];
}

/** One project on an invoice. percent = share of the invoice amount (100 when not split). */
export interface ProjectShare {
  code: string;
  name: string;
  percent: number;
}

/** Every project known for a tab, including ones with no outstanding AR. */
export interface ProjectInfo {
  /** PEAK: the classification group the projects come from. NetSuite / sample: null. */
  groupName: string | null;
  items: { code: string; name: string }[];
  /** Why there are no projects, shown in the Projects card. */
  note: string | null;
}

export type Provider = "peak" | "netsuite";

/** One dashboard tab: a PEAK company or a NetSuite connection from Settings. */
export interface ArEntity {
  id: string;
  name: string;
  provider: Provider;
}

export type ArSource = "peak-uat" | "peak-production" | "netsuite-sandbox" | "netsuite-production" | "sample";

export interface ArResponse {
  /** Company / connection id (from Settings) */
  entity: string;
  entityName: string;
  entities: ArEntity[];
  /** PEAK: business name. NetSuite: subsidiary name(s) on the invoices. */
  businessName: string | null;
  source: ArSource;
  /** Date the aging is measured against (today in Bangkok), ISO yyyy-MM-dd. */
  asOf: string;
  /** When the data was pulled from the source system, ISO timestamp. */
  fetchedAt: string;
  invoices: ArInvoice[];
  projects: ProjectInfo;
  warnings: string[];
  debug: ArDebug;
  /** A sync (pull from PEAK / NetSuite into the database) is running; the page reloads when it ends. */
  refreshing?: boolean;
  /** The last sync failed after this data was saved: the numbers shown are from fetchedAt. */
  syncError?: { message: string; status: number | null; at: string } | null;
  /** Last finished sync for this tab (from the database). */
  lastSync?: { at: string; trigger: string; status: string; mode: string | null } | null;
}

// ---- Debug info (shown by each chart's Debug button) ----

/** Groups calls so each chart can show the ones it depends on. */
export type CallPurpose =
  | "user"
  | "contacts"
  | "invoices-list"
  | "invoice-detail"
  | "classification"
  | "invoice-classification"
  | "ns-invoices"
  | "ns-recheck";

/** How a NetSuite read was done (see lib/netsuite/ar-source.ts). */
export interface NsSyncInfo {
  /** full: every page. update: last page + new pages + open invoices re-checked by ID. */
  mode: "full" | "update";
  /** Why a full read ran (null for an update). */
  reason: string | null;
  /** Open invoices re-checked one by one. */
  rechecked: number;
  /** When the last full read finished (an update builds on it). */
  fullAt?: string;
  pagesRead?: number;
}

export interface ApiCall {
  method: "GET";
  path: string;
  purpose: CallPurpose;
  resCode: string | null;
  rows: number | null;
  ms: number;
  error?: string;
}

/** Where an invoice's outstanding amount came from. */
export type RemainSource = "list" | "detail" | "netAmount (fallback)" | "inv_amount_remaining_total" | "total − applied (fallback)";

export interface ArDebug {
  provider: Provider;
  baseUrl: string | null;
  /** True when this response came from the 5-minute server cache (the calls listed ran at fetchedAt). */
  servedFromCache: boolean;
  calls: ApiCall[];
  /** Per invoice code: the source fields the dashboard read, exactly as sent. */
  raw: Record<string, { remainSource: RemainSource; fields: Record<string, unknown> }>;
  /** NetSuite only. */
  sync?: NsSyncInfo;
}

export const BUCKETS = ["0_Current", "1_1-30", "2_31-60", "3_61-90", "4_>90"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** ESCO KPI: an invoice is on target when it is not yet due or at most this many days overdue. */
export const KPI_OVERDUE_LIMIT = 30;

export interface ArRow extends ArInvoice {
  creditDays: number;
  durationDays: number;
  overdueDays: number;
  bucket: Bucket;
  isOverdue: boolean;
  onTarget: boolean;
}

const DAY = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY);

/** PEAK sends document dates as yyyyMMdd text. */
export function peakDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/) ?? value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** NetSuite sends dates as DD/MM/YYYY text. */
export function nsDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export function bangkokToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

export function bucketFor(overdueDays: number): Bucket {
  if (overdueDays <= 0) return "0_Current";
  if (overdueDays <= 30) return "1_1-30";
  if (overdueDays <= 60) return "2_31-60";
  if (overdueDays <= 90) return "3_61-90";
  return "4_>90";
}

export function toRow(inv: ArInvoice, asOf: string): ArRow {
  const overdueDays = Math.max(0, daysBetween(inv.dueDate, asOf));
  return {
    ...inv,
    projects: inv.projects ?? [], // NetSuite results saved before projects existed
    creditDays: daysBetween(inv.issuedDate, inv.dueDate),
    durationDays: Math.max(0, daysBetween(inv.issuedDate, asOf)),
    overdueDays,
    bucket: bucketFor(overdueDays),
    isOverdue: overdueDays > 0,
    onTarget: overdueDays <= KPI_OVERDUE_LIMIT,
  };
}

export interface BucketStat {
  bucket: Bucket;
  documents: number;
  customers: number;
  amount: number;
}

export interface ArSummary {
  total: number;
  documents: number;
  customers: number;
  current: number;
  overdue: number;
  buckets: BucketStat[];
  kpi: {
    target: { documents: number; customers: number; amount: number };
    over: { documents: number; customers: number; amount: number };
  };
}

export function summarize(rows: ArRow[]): ArSummary {
  const buckets: BucketStat[] = BUCKETS.map((bucket) => {
    const inBucket = rows.filter((r) => r.bucket === bucket);
    return {
      bucket,
      documents: inBucket.length,
      customers: new Set(inBucket.map((r) => r.contactCode)).size,
      amount: sum(inBucket),
    };
  });

  // A customer counts as "Over" if any of their invoices is past the KPI limit,
  // so Target + Over customers adds up to the total customer count.
  const overCustomers = new Set(rows.filter((r) => !r.onTarget).map((r) => r.contactCode));
  const allCustomers = new Set(rows.map((r) => r.contactCode));
  const target = rows.filter((r) => r.onTarget);
  const over = rows.filter((r) => !r.onTarget);

  return {
    total: sum(rows),
    documents: rows.length,
    customers: allCustomers.size,
    current: sum(rows.filter((r) => !r.isOverdue)),
    overdue: sum(rows.filter((r) => r.isOverdue)),
    buckets,
    kpi: {
      target: { documents: target.length, customers: allCustomers.size - overCustomers.size, amount: sum(target) },
      over: { documents: over.length, customers: overCustomers.size, amount: sum(over) },
    },
  };
}

function sum(rows: ArRow[]): number {
  return round2(rows.reduce((s, r) => s + r.remainAmount, 0));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
