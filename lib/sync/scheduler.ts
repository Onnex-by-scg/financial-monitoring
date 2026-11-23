import "server-only";
import { db } from "../db";
import { listTargets, syncEntity, type Target } from "./ar-sync";
import { syncPnl } from "./pnl-sync";
import { syncAll } from "./round";
import { getSyncConfig, scheduleBlockedBy } from "./config";
import { ON_WORKERS } from "../runtime";

// Scheduled pulls into the database.
// Node server: started once per server by instrumentation.ts, and runs on a timer in the process.
// Cloudflare Workers: nothing runs between requests, so a Cron Trigger (worker.ts, wrangler.jsonc) calls
// POST /api/sync/scheduled every 15 minutes, which runs runScheduledRound() below.
//  - The interval and on/off come from Settings → Data sync (lib/sync/config.ts); a heartbeat re-reads them every
//    30 seconds, so a change applies without a restart.
//  - Each round pulls every tab, one at a time.
//  - 10 seconds after the server starts, tabs whose data is older than the interval (or missing) are pulled.
//  - PEAK companies also get their profit & loss pulled (lib/sync/pnl-sync.ts) after their AR.
//  - PEAK UAT is only open Mon–Fri 08:00–22:00 Bangkok; scheduled pulls skip it outside those hours unless that's
//    turned off in Settings (Refresh still tries).

const HEARTBEAT_MS = 30_000;
const FIRST_DELAY_MS = 10_000;

interface SchedulerState {
  timer?: NodeJS.Timeout;
  /** When the last scheduled round started (the next one is due one interval later). */
  lastRoundAt: number;
  roundRunning: boolean;
}
const g = globalThis as { __syncScheduler?: SchedulerState };

export function startScheduler() {
  if (ON_WORKERS || scheduleBlockedBy() || g.__syncScheduler) return; // dev reloads re-run register()
  const state: SchedulerState = { lastRoundAt: Date.now(), roundRunning: false };
  g.__syncScheduler = state;
  setTimeout(() => void catchUp(), FIRST_DELAY_MS).unref();
  state.timer = setInterval(() => void heartbeat(), HEARTBEAT_MS);
  state.timer.unref();
  console.log("[sync] scheduler started (interval from Settings → Data sync)");
}

/** When the next scheduled round is due, or null when scheduling is off. */
export async function nextRoundAt(): Promise<number | null> {
  const cfg = await getSyncConfig();
  if (!cfg.enabled || scheduleBlockedBy()) return null;
  if (ON_WORKERS) {
    // Due one interval after the last scheduled round; the cron checks every 15 minutes.
    const last = await lastScheduledRoundAt();
    return last === null ? Date.now() : last + cfg.intervalMinutes * 60_000;
  }
  const s = g.__syncScheduler;
  return s ? s.lastRoundAt + cfg.intervalMinutes * 60_000 : null;
}

/** When the last scheduled round started (from the pull history), or null if there's never been one. */
async function lastScheduledRoundAt(): Promise<number | null> {
  const last = await db.syncRun.findFirst({ where: { trigger: "schedule" }, orderBy: { id: "desc" }, select: { startedAt: true } });
  return last ? last.startedAt.getTime() : null;
}

// The cron fires every 15 minutes, a little after the round is due at most; this much early still counts as due,
// so a 60-minute interval doesn't slip to 75.
const CRON_SLACK_MS = 2 * 60_000;

/**
 * Cloudflare Workers: one scheduled round, if one is due (Settings → Data sync: on, and the interval has passed
 * since the last one). Runs to the end before returning: a Cron Trigger may run for up to 15 minutes.
 */
export async function runScheduledRound(): Promise<{ ran: boolean; reason?: string }> {
  const blocked = scheduleBlockedBy();
  if (blocked) return { ran: false, reason: blocked };
  const cfg = await getSyncConfig();
  if (!cfg.enabled) return { ran: false, reason: "Scheduled pulls are off in Settings → Data sync." };
  const last = await lastScheduledRoundAt();
  if (last !== null && Date.now() - last < cfg.intervalMinutes * 60_000 - CRON_SLACK_MS) return { ran: false, reason: "Not due yet." };
  await syncAll("schedule", { skip: (t) => skipReason(t, cfg.skipClosedUat), pnlRecentMinAgeMs: cfg.intervalMinutes * 60_000 });
  return { ran: true };
}

/** After Settings change: count the next round from now (so a shorter interval doesn't fire a burst). */
export function restartSchedule() {
  if (g.__syncScheduler) g.__syncScheduler.lastRoundAt = Date.now();
}

async function heartbeat() {
  const s = g.__syncScheduler;
  if (!s || s.roundRunning) return;
  try {
    const cfg = await getSyncConfig();
    if (!cfg.enabled || Date.now() - s.lastRoundAt < cfg.intervalMinutes * 60_000) return;
    s.lastRoundAt = Date.now();
    s.roundRunning = true;
    await syncAll("schedule", { skip: (t) => skipReason(t, cfg.skipClosedUat) });
  } catch (e) {
    console.warn(`[sync] ${(e as Error).message}`);
  } finally {
    s.roundRunning = false;
  }
}

/** Why a scheduled pull should not run now, or null. */
function skipReason(t: Target, skipClosedUat: boolean): string | null {
  if (!skipClosedUat || t.provider !== "peak" || t.company.conn.env !== "uat") return null;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const day = now.getDay();
  const hour = now.getHours();
  return day === 0 || day === 6 || hour < 8 || hour >= 22 ? "PEAK UAT is closed (open Mon–Fri 08:00–22:00 Bangkok)" : null;
}

async function catchUp() {
  try {
    const cfg = await getSyncConfig();
    if (!cfg.enabled) return;
    const { entities, targets } = await listTargets();
    const snaps = await db.arSnapshot.findMany({ select: { entityId: true, fetchedAt: true, credKey: true } });
    for (const t of targets) {
      const snap = snaps.find((x) => x.entityId === t.id);
      const fresh = snap && snap.credKey === t.credKey && Date.now() - snap.fetchedAt.getTime() < cfg.intervalMinutes * 60_000;
      if (skipReason(t, cfg.skipClosedUat)) continue;
      if (!fresh) await syncEntity(t, entities, "schedule").catch((e: Error) => console.warn(`[sync] ${t.name}: ${e.message}`));
      // Profit & loss: only months not read within the interval (so a restart doesn't re-read them).
      if (t.provider === "peak")
        await syncPnl(t, "schedule", null, { recentMinAgeMs: cfg.intervalMinutes * 60_000 }).catch((e: Error) => console.warn(`[sync] ${t.name} P&L: ${e.message}`));
    }
  } catch (e) {
    console.warn(`[sync] ${(e as Error).message}`);
  }
}
