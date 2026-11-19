// Profit & loss model shared by the server (building months from PEAK's trial balance) and the browser.
import { bangkokToday } from "./ar";

/** P&L lines, in the order of the Financial Summary. */
export const PNL_LINES = ["revenue", "costOfSales", "operatingExpenses", "financeCost", "incomeTax"] as const;
export type PnlLine = (typeof PNL_LINES)[number];

export const PNL_LABEL: Record<PnlLine, string> = {
  revenue: "Revenue",
  costOfSales: "Cost of Sales",
  operatingExpenses: "Operating Expenses",
  financeCost: "Finance Cost",
  incomeTax: "Income Tax",
};

/** One account's movement in one month, as PEAK's trial balance reports it. */
export interface PnlAccount {
  code: string;
  name: string;
  line: PnlLine;
  /** Signed so that every line is positive in the normal case: revenue = credit − debit, costs = debit − credit. */
  amount: number;
  /** Why the account landed on this line (shown in "Accounts used"). */
  rule: string;
}

export interface PnlMonth {
  /** yyyy-MM */
  month: string;
  totals: Record<PnlLine, number>;
  accounts: PnlAccount[];
}

export interface PnlResponse {
  entity: string;
  entityName: string;
  businessName: string | null;
  source: "peak-uat" | "peak-production" | "sample";
  year: number;
  /** This year in Bangkok, for the year picker. */
  currentYear: number;
  /** Months that have been read: January up to the current month (or all 12 for a past year). */
  months: PnlMonth[];
  fetchedAt: string;
  warnings: string[];
  debug: { baseUrl: string; calls: { path: string; ms: number; cached: boolean; error?: string }[] };
  /** A pull of the trial balance into the database is running; the page reloads when it ends. */
  refreshing?: boolean;
  /** The last pull failed: the months shown are the ones saved before it. */
  syncError?: { message: string; status: number | null; at: string } | null;
  /** Last finished pull for this company (from the database). */
  lastSync?: { at: string; trigger: string; status: string } | null;
}

/**
 * Puts an account on a P&L line from its code and name, or returns null for balance-sheet accounts.
 * Thai charts of accounts (PEAK's default included) number income 4xxxxx and expenses 5xxxxx; cost of sales
 * is 51xxxx. Finance cost and income tax are recognised by name because their codes vary between businesses.
 */
export function classifyAccount(code: string, name: string): { line: PnlLine; rule: string } | null {
  const c = code.trim();
  if (c.startsWith("4")) return { line: "revenue", rule: "code 4xxxxx (income)" };
  if (!c.startsWith("5")) return null;
  if (/ภาษีเงินได้นิติบุคคล|ค่าใช้จ่ายภาษีเงินได้|income tax/i.test(name)) return { line: "incomeTax", rule: "name: income tax" };
  if (/ดอกเบี้ยจ่าย|ต้นทุนทางการเงิน|interest expense|finance cost/i.test(name)) return { line: "financeCost", rule: "name: interest / finance cost" };
  if (c.startsWith("51")) return { line: "costOfSales", rule: "code 51xxxx (cost of sales)" };
  if (/ต้นทุนขาย|ต้นทุนบริการ|cost of (sales|goods|services?)/i.test(name)) return { line: "costOfSales", rule: "name: cost of sales" };
  return { line: "operatingExpenses", rule: "other 5xxxxx expense" };
}

export const emptyTotals = (): Record<PnlLine, number> => ({ revenue: 0, costOfSales: 0, operatingExpenses: 0, financeCost: 0, incomeTax: 0 });

export interface PnlSummary extends Record<PnlLine, number> {
  grossProfit: number;
  ebit: number;
  /** Profit before tax */
  ebt: number;
  netProfit: number;
}

export function summarizePnl(t: Record<PnlLine, number>): PnlSummary {
  const grossProfit = t.revenue - t.costOfSales;
  const ebit = grossProfit - t.operatingExpenses;
  const ebt = ebit - t.financeCost;
  return { ...t, grossProfit, ebit, ebt, netProfit: ebt - t.incomeTax };
}

export function addTotals(months: PnlMonth[]): Record<PnlLine, number> {
  const out = emptyTotals();
  for (const m of months) for (const l of PNL_LINES) out[l] += m.totals[l];
  return out;
}

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Months to show for a year: January to the current month (Bangkok), or all 12 for a past year. */
export function monthsFor(year: number, today = bangkokToday()): string[] {
  const [ty, tm] = today.split("-").map(Number);
  const last = year < ty ? 12 : year === ty ? tm : 0;
  return Array.from({ length: last }, (_, i) => `${year}${String(i + 1).padStart(2, "0")}`);
}
