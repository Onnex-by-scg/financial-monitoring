import "server-only";
import { runPull } from "./run-pull";
import { bangkokToday } from "../ar";
import { db, withDb } from "../db";
import { BASE_URLS, PeakError } from "../peak/client";
import { readTrialBalanceMonth } from "../peak/pnl-source";
import { monthsFor, type PnlAccount, type PnlLine, type PnlMonth, type PnlResponse } from "../pnl";
import { listTargets, type SyncTrigger, type Target } from "./ar-sync";
import { beginProgress, SAVE_STEP } from "./progress";
import { SAMPLE_MODE } from "../mode";

// The sync service for Financial Performance: reads PEAK's trial balance month by month and stores each month in
// the database (PnlMonth). The page only reads the database (readPnl).
//
// Which months a pull reads (PEAK allows 10 trial-balance reads a minute, so only what can have changed):
//  - months that were never read;
//  - this month and last month (still being booked / closed) every time;
//  - older months once a day.
// Scheduled rounds cover this year (plus last month in January). A past year is read when someone opens it.

type PeakTarget = Extract<Target, { provider: "peak" }>;

const OLD_MONTH_MS = 24 * 60 * 60 * 1000;
/** Recent months read less than this long ago aren't read again (e.g. Refresh right after a scheduled round). */
const RECENT_MIN_AGE_MS = 60 * 1000;

const running = new Map<string, Promise<void>>();
export const isPnlSyncing = (entityId: string) => running.has(entityId);
/** Progress for a P&L pull is kept under its own key, next to the tab's AR pull. */
export const pnlProgressKey = (entityId: string) => `pnl:${entityId}`;

const thisAndLastMonth = (today = bangkokToday()) => {
  const [y, m] = today.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`;
  return [`${y}${String(m).padStart(2, "0")}`, prev];
};

/** Months saved for a company (yyyyMM → when read). Drops months read with other credentials. */
async function storedMonths(target: PeakTarget): Promise<Map<string, number>> {
  let rows = await db.pnlMonth.findMany({ where: { entityId: target.id }, select: { month: true, credKey: true, fetchedAt: true } });
  if (rows.some((r) => r.credKey !== target.credKey)) {
    await db.pnlMonth.deleteMany({ where: { entityId: target.id, credKey: { not: target.credKey } } });
    rows = rows.filter((r) => r.credKey === target.credKey);
  }
  return new Map(rows.map((r) => [r.month, r.fetchedAt.getTime()]));
}

/** The months a pull should read. year = null: a scheduled round (this year, plus last month). */
function plan(year: number | null, stored: Map<string, number>, trigger: SyncTrigger, recentMinAgeMs: number): string[] {
  const today = bangkokToday();
  const recent = thisAndLastMonth(today);
  const wanted = new Set(year === null ? [...monthsFor(Number(today.slice(0, 4)), today), recent[1]] : monthsFor(year, today));
  const now = Date.now();
  return [...wanted]
    .filter((ym) => {
      const at = stored.get(ym);
      if (at === undefined) return true;
      if (trigger === "first-load") return false; // only fill gaps; the page is waiting
      if (recent.includes(ym)) return now - at >= recentMinAgeMs;
      return now - at >= OLD_MONTH_MS;
    })
    .sort();
}

/**
 * Pulls the months that need it for one PEAK company. Waits for a pull already running for the company first
 * (then plans again, so nothing is read twice). Resolves when done; rejects if a month failed.
 */
export async function syncPnl(target: PeakTarget, trigger: SyncTrigger, year: number | null, opts: { recentMinAgeMs?: number } = {}): Promise<void> {
  if (SAMPLE_MODE) return; // sample P&L is generated on read
  for (let r = running.get(target.id); r; r = running.get(target.id)) await r.catch(() => undefined);
  const p = runPnl(target, trigger, year, opts.recentMinAgeMs ?? RECENT_MIN_AGE_MS).finally(() => running.delete(target.id));
  running.set(target.id, p);
  return p;
}

async function runPnl(target: PeakTarget, trigger: SyncTrigger, year: number | null, recentMinAgeMs: number): Promise<void> {
  const months = plan(year, await storedMonths(target), trigger, recentMinAgeMs);
  if (!months.length) return;

  const progress = beginProgress(pnlProgressKey(target.id), "peak");
  const run = await db.syncRun.create({ data: { entityId: target.id, provider: "peak", kind: "pnl", mode: String(year ?? bangkokToday().slice(0, 4)), trigger, status: "running" } });
  progress.plan(
    [{ key: "months", label: "Reading the trial balance", unit: "months", total: months.length }],
    months.length > 10 ? "PEAK allows 10 trial-balance reads a minute, so this takes a little over a minute." : null,
  );
  let saved = 0;
  try {
    progress.start("months", months.length);
    for (const ym of months) {
      const m = await readTrialBalanceMonth(target.company, ym); // stops at the first failure: the rest would fail the same way
      const row = { credKey: target.credKey, totals: JSON.stringify(m.totals), accounts: JSON.stringify(m.accounts), fetchedAt: new Date() };
      await withDb(() => db.pnlMonth.upsert({ where: { entityId_month: { entityId: target.id, month: ym } }, create: { entityId: target.id, month: ym, ...row }, update: row }));
      saved++;
      progress.tick("months");
    }
    progress.done("months");
    progress.start(SAVE_STEP);
    progress.done(SAVE_STEP, `${saved} months saved`);
    await withDb(() => db.syncRun.update({ where: { id: run.id }, data: { status: "ok", finishedAt: new Date(), note: `${saved} month${saved === 1 ? "" : "s"}` } }));
  } catch (e) {
    const err = e as Error;
    await withDb(() =>
      db.syncRun.update({
        where: { id: run.id },
        data: {
          status: "error",
          finishedAt: new Date(),
          error: err.message,
          errorStatus: e instanceof PeakError ? e.status : null,
          note: saved ? `${saved} of ${months.length} months saved` : null,
        },
      }),
    );
    throw e;
  } finally {
    progress.finish();
  }
}

/**
 * The page's read: one PEAK company's P&L for a year, from the database. Months never read are pulled first (the
 * page waits and shows progress); Refresh starts a pull in the background. Never calls PEAK otherwise.
 */
export async function readPnl(entityId: string | null, year: number, opts: { refresh?: boolean } = {}): Promise<PnlResponse> {
  const { targets } = await listTargets();
  const peak = targets.filter((t): t is PeakTarget => t.provider === "peak");
  if (!peak.length) throw new PeakError(409, "No PEAK company is connected yet. Open Settings to connect one.", "not_configured");
  const target = peak.find((t) => t.id === entityId) ?? peak[0];
  const today = bangkokToday();
  const need = monthsFor(year, today);

  const stored = await storedMonths(target);
  const missing = need.filter((ym) => !stored.has(ym));
  let pullError: unknown = null;
  if (missing.length) {
    await syncPnl(target, "first-load", year).catch((e) => (pullError = e)); // the page waits for this
  } else if (opts.refresh) {
    await runPull(() => syncPnl(target, "refresh", year)); // background, or waited for on Workers (run-pull.ts)
  }

  const [rows, lastRun, snap] = await Promise.all([
    db.pnlMonth.findMany({ where: { entityId: target.id, credKey: target.credKey, month: { in: need } }, orderBy: { month: "asc" } }),
    db.syncRun.findFirst({ where: { entityId: target.id, kind: "pnl", mode: String(year), status: { in: ["ok", "error"] } }, orderBy: { startedAt: "desc" } }),
    db.arSnapshot.findUnique({ where: { entityId: target.id }, select: { businessName: true, credKey: true } }),
  ]);
  if (pullError && !rows.length) throw pullError; // nothing to show
  const months: PnlMonth[] = rows.map((r) => ({
    month: `${r.month.slice(0, 4)}-${r.month.slice(4)}`,
    totals: JSON.parse(r.totals) as Record<PnlLine, number>,
    accounts: JSON.parse(r.accounts) as PnlAccount[],
  }));
  const gaps = need.filter((ym) => !rows.some((r) => r.month === ym));
  const warnings = gaps.length ? [`Not read from PEAK yet: ${gaps.map((ym) => `${ym.slice(4)}/${ym.slice(0, 4)}`).join(", ")}. The totals leave these months out.`] : [];
  const oldest = rows.length ? Math.min(...rows.map((r) => r.fetchedAt.getTime())) : Date.now();
  const failed = lastRun?.status === "error";

  return {
    entity: target.id,
    entityName: target.name,
    businessName: snap?.credKey === target.credKey ? snap.businessName : null,
    source: target.company.conn.env === "uat" ? "peak-uat" : "peak-production",
    year,
    currentYear: Number(today.slice(0, 4)),
    months,
    fetchedAt: new Date(oldest).toISOString(),
    warnings,
    debug: { baseUrl: BASE_URLS[target.company.conn.env], calls: [] },
    refreshing: isPnlSyncing(target.id),
    syncError: failed ? { message: lastRun.error ?? "Unknown error", status: lastRun.errorStatus, at: (lastRun.finishedAt ?? lastRun.startedAt).toISOString() } : null,
    lastSync: lastRun ? { at: (lastRun.finishedAt ?? lastRun.startedAt).toISOString(), trigger: lastRun.trigger, status: lastRun.status } : null,
  };
}

/** Removes a company's saved months (called when it's deleted in Settings). */
export async function deletePnlData(entityId: string) {
  if (SAMPLE_MODE) return;
  await db.pnlMonth.deleteMany({ where: { entityId } });
}
