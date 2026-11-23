import "server-only";
import { round2 } from "../ar";
import { classifyAccount, emptyTotals, type PnlAccount, type PnlMonth } from "../pnl";
import { peakGet, PeakError, pick, type Company } from "./client";

// Profit & loss per month from PEAK's trial balance (GET /api/v1/FinancialReports/trialbalance), one call per month.
// PEAK has no P&L report endpoint; the trial balance's "change" for a month is that month's movement on each
// account, so income (4xxxxx) and expense (5xxxxx) movements give the month's P&L.
//
// Called only by the sync service (lib/sync/pnl-sync.ts), which stores the months in the database.
// PEAK allows the trial balance 10 requests a minute, one at a time, so reads are queued per User Token.

const PER_MINUTE = 10;

type Json = Record<string, unknown>;

// ---- Rate limit: one trial-balance request at a time, at most 10 in any 60 seconds, per User Token ----
const queues = new Map<string, { tail: Promise<unknown>; stamps: number[] }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throttled<T>(token: string, fn: () => Promise<T>): Promise<T> {
  const q = queues.get(token) ?? { tail: Promise.resolve(), stamps: [] };
  queues.set(token, q);
  const run = q.tail.then(async () => {
    q.stamps = q.stamps.filter((t) => Date.now() - t < 60_000);
    if (q.stamps.length >= PER_MINUTE) await sleep(60_000 - (Date.now() - q.stamps[0]) + 500);
    q.stamps.push(Date.now());
    return fn();
  });
  q.tail = run.catch(() => undefined);
  return run;
}

/** One month's P&L (ym = yyyyMM) from PEAK. */
export async function readTrialBalanceMonth(company: Company, ym: string): Promise<PnlMonth> {
  const p = `/api/v1/FinancialReports/trialbalance?fromMonth=${ym}&toMonth=${ym}`;
  const json = await throttled(company.userToken, () => peakGet(company.conn, company.userToken, p));
  return toMonth(ym, json);
}

/** PeakTrialBalance.trialBalanceAccount[] → this month's P&L lines. */
function toMonth(ym: string, json: unknown): PnlMonth {
  const body = pick(json, "PeakTrialBalance");
  const resCode = pick<string>(body, "resCode") ?? pick<string>(json, "resCode");
  if (resCode !== undefined && String(resCode) !== "200") {
    const desc = pick<string>(body, "resDesc") ?? pick<string>(json, "resDesc") ?? "";
    throw new PeakError(502, `PEAK resCode ${resCode}${desc ? `: ${desc}` : ""}`);
  }
  const rows = pick<Json[]>(body, "trialBalanceAccount") ?? [];
  const totals = emptyTotals();
  const accounts: PnlAccount[] = [];
  for (const r of rows) {
    const acc = pick(r, "account");
    if (pick<boolean>(acc, "isSubAccount")) continue; // sub accounts are already inside their parent's balance
    const code = String(pick(acc, "accountCode") ?? "");
    const name = String(pick(acc, "accountName") ?? "");
    const kind = classifyAccount(code, name);
    if (!kind) continue;
    const change = pick(r, "change");
    const debit = num(pick(change, "debit"));
    const credit = num(pick(change, "credit"));
    const amount = round2(kind.line === "revenue" ? credit - debit : debit - credit);
    if (amount === 0) continue;
    totals[kind.line] = round2(totals[kind.line] + amount);
    accounts.push({ code, name, line: kind.line, amount, rule: kind.rule });
  }
  return { month: `${ym.slice(0, 4)}-${ym.slice(4)}`, totals, accounts };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
