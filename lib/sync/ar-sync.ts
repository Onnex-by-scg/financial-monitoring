import "server-only";
import { runPull } from "./run-pull";
import type { ArDebug, ArEntity, ArInvoice, ArResponse, ArSource, ProjectInfo } from "../ar";
import { db } from "../db";
import { loadNetSuiteAr, nsCredKey, type NsSyncState } from "../netsuite/ar-source";
import { getArData as getPeakAr } from "../peak/ar-source";
import { hash, PeakError, type Company } from "../peak/client";
import { readSettings, resolveCompanies, type StoredNetSuite } from "../peak/settings-store";
import { beginProgress, SAVE_STEP } from "./progress";
import { getFetchPacing } from "./config";
import { SAMPLE_MODE } from "../mode";
import { ON_WORKERS } from "../runtime";
import { sampleRuns } from "../sample-runs";

// The sync service (AR part; profit & loss is lib/sync/pnl-sync.ts, whole rounds lib/sync/round.ts): pulls AR from PEAK / NetSuite and stores it in SQLite (lib/db.ts). The dashboard only reads
// the database (readAr); pulls happen on a schedule (lib/sync/scheduler.ts), when someone clicks Refresh, or the
// first time a tab is opened.
//
// One pull per tab at a time. A failed pull keeps the last good data and is recorded in SyncRun, so the
// dashboard can say "showing data from <time>; the last update failed because …".

export type SyncTrigger = "schedule" | "refresh" | "first-load" | "api";

export type Target =
  | { provider: "peak"; id: string; name: string; company: Company; credKey: string }
  | { provider: "netsuite"; id: string; name: string; conn: StoredNetSuite; credKey: string };

const running = new Map<string, Promise<void>>();

// Cloudflare Workers: a NetSuite full read stops starting new pages after this long and continues on the next
// scheduled pull. A Cron Trigger run may last 15 minutes and one page can take NetSuite up to 3 minutes to build.
const WORKERS_FULL_READ_BUDGET_MS = 9 * 60_000;
export const isSyncing = (entityId: string) => running.has(entityId);

const peakCredKey = (c: Company) => `${c.id}|${c.conn.env}|${hash(`${c.conn.connectId}|${c.conn.connectKey}|${c.userToken}`)}`;

/** Every dashboard tab from Settings (PEAK companies first), with what's needed to pull it. */
export async function listTargets(): Promise<{ entities: ArEntity[]; targets: Target[] }> {
  const { settings } = await readSettings();
  const companies = settings.companies.length ? await resolveCompanies() : [];
  const targets: Target[] = [
    ...companies.map((c) => ({ provider: "peak" as const, id: c.id, name: c.name, company: c, credKey: peakCredKey(c) })),
    ...settings.netsuite.map((n) => ({ provider: "netsuite" as const, id: n.id, name: n.name, conn: n, credKey: nsCredKey(n) })),
  ];
  return { entities: targets.map((t) => ({ id: t.id, name: t.name, provider: t.provider })), targets };
}

/** Starts a pull for one tab, or joins the one already running. Resolves when it ends; rejects if it failed. */
export function syncEntity(target: Target, entities: ArEntity[], trigger: SyncTrigger): Promise<void> {
  if (SAMPLE_MODE) return Promise.resolve(); // sample data is generated on read; nothing to pull
  const existing = running.get(target.id);
  if (existing) return existing;
  const p = runSync(target, entities, trigger).finally(() => running.delete(target.id));
  running.set(target.id, p);
  return p;
}

async function runSync(target: Target, entities: ArEntity[], trigger: SyncTrigger): Promise<void> {
  const progress = beginProgress(target.id, target.provider);
  const run = await db.syncRun.create({ data: { entityId: target.id, provider: target.provider, trigger, status: "running" } });
  try {
    let data: ArResponse;
    let mode: string | null = null;
    const pacing = await getFetchPacing(); // Settings → Data sync: PEAK page size, wait between pages
    if (target.provider === "peak") {
      data = await getPeakAr(target.id, true, progress, pacing);
    } else {
      const stateKey = `ns:${target.id}`;
      const saved = await db.syncState.findUnique({ where: { key: stateKey } });
      const parsed = saved ? (JSON.parse(saved.value) as { credKey: string; state: NsSyncState }) : null;
      const prev = parsed?.credKey === target.credKey ? parsed.state : null;
      const result = await loadNetSuiteAr(target.conn, entities, prev, progress, {
        pageWaitMs: pacing.pageWaitMs,
        // Workers: one 1,000-invoice page in memory at a time, and full reads split over runs that fit the limits.
        pageConcurrency: ON_WORKERS ? 1 : undefined,
        deadline: ON_WORKERS ? Date.now() + WORKERS_FULL_READ_BUDGET_MS : undefined,
        // The dashboard's Refresh only updates (fast); a full read is left to the scheduled pull.
        allowFull: !ON_WORKERS || trigger !== "refresh",
      });
      const value = JSON.stringify({ credKey: target.credKey, state: result.sync });
      await db.syncState.upsert({ where: { key: stateKey }, create: { key: stateKey, value }, update: { value } });
      if (result.kind !== "done") {
        // Nothing new to show yet: keep the saved snapshot, and say why in the pull history.
        await db.syncRun.update({
          where: { id: run.id },
          data: { status: result.kind === "partial" ? "partial" : "skipped", mode: result.kind === "partial" ? "full" : null, finishedAt: new Date(), note: result.note },
        });
        progress.skip(SAVE_STEP, result.note);
        return;
      }
      data = result.data;
      mode = result.data.debug.sync?.mode ?? null;
    }
    progress.start(SAVE_STEP, data.invoices.length);
    await saveSnapshot(target, data);
    progress.tick(SAVE_STEP, data.invoices.length);
    progress.done(SAVE_STEP, `${data.invoices.length.toLocaleString("en-US")} open invoices saved`);
    await db.syncRun.update({ where: { id: run.id }, data: { status: "ok", mode, finishedAt: new Date(), invoices: data.invoices.length } });
  } catch (e) {
    const err = e as Error;
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), error: err.message, errorStatus: e instanceof PeakError ? e.status : null },
    });
    throw e;
  } finally {
    progress.finish();
  }
}

/** Replaces the tab's snapshot and invoices in one transaction, so readers never see half a pull. */
async function saveSnapshot(target: Target, data: ArResponse) {
  const snapshot = {
    provider: target.provider,
    credKey: target.credKey,
    entityName: data.entityName,
    businessName: data.businessName,
    source: data.source,
    asOf: data.asOf,
    fetchedAt: new Date(data.fetchedAt),
    projects: JSON.stringify(data.projects),
    warnings: JSON.stringify(data.warnings),
    debug: JSON.stringify({ ...data.debug, servedFromCache: false }),
  };
  await db.$transaction([
    db.arSnapshot.upsert({ where: { entityId: target.id }, create: { entityId: target.id, ...snapshot }, update: snapshot }),
    db.arInvoice.deleteMany({ where: { entityId: target.id } }),
    db.arInvoice.createMany({
      data: data.invoices.map((i) => ({
        entityId: target.id,
        code: i.code,
        contactCode: i.contactCode,
        contactName: i.contactName,
        reference: i.reference,
        issuedDate: i.issuedDate,
        dueDate: i.dueDate,
        netAmount: i.netAmount,
        remainAmount: i.remainAmount,
        link: i.link,
        projects: JSON.stringify(i.projects),
      })),
    }),
  ]);
}

/**
 * The dashboard's read: the tab's data from the database. If the tab has never been pulled (or its credentials
 * changed), this waits for the first pull. Never calls PEAK / NetSuite otherwise.
 */
export async function readAr(entityId: string | null, opts: { refresh?: boolean } = {}): Promise<ArResponse> {
  const { entities, targets } = await listTargets();
  if (!targets.length) throw new PeakError(409, "No company is connected yet. Open Settings to connect PEAK or NetSuite.", "not_configured");
  const target = targets.find((t) => t.id === entityId) ?? targets[0];

  let snap = await db.arSnapshot.findUnique({ where: { entityId: target.id } });
  if (!snap || snap.credKey !== target.credKey) {
    await syncEntity(target, entities, "first-load"); // throws the pull's error if there's nothing to show
    snap = await db.arSnapshot.findUnique({ where: { entityId: target.id } });
    if (!snap) {
      const last = await db.syncRun.findFirst({ where: { entityId: target.id, kind: "ar" }, orderBy: { id: "desc" } });
      if (last?.note && (last.status === "partial" || last.status === "skipped"))
        throw new PeakError(503, `The first read of this company's invoices is large and is still running in the background. ${last.note}`);
      throw new PeakError(500, "The pull finished but saved nothing.");
    }
  } else if (opts.refresh) {
    await runPull(() => syncEntity(target, entities, "refresh")); // background, or waited for on Workers (run-pull.ts)
  }

  const [rows, lastRun, lastNote] = await Promise.all([
    db.arInvoice.findMany({ where: { entityId: target.id }, orderBy: { id: "asc" } }),
    db.syncRun.findFirst({ where: { entityId: target.id, kind: "ar", status: { in: ["ok", "error"] } }, orderBy: { startedAt: "desc" } }),
    // A NetSuite full read under way (or left to the schedule) after the saved data: tell the reader.
    db.syncRun.findFirst({ where: { entityId: target.id, kind: "ar", status: { in: ["partial", "skipped"] }, startedAt: { gt: snap.fetchedAt } }, orderBy: { id: "desc" } }),
  ]);
  const invoices: ArInvoice[] = rows.map((r) => ({
    code: r.code,
    contactCode: r.contactCode,
    contactName: r.contactName,
    reference: r.reference,
    issuedDate: r.issuedDate,
    dueDate: r.dueDate,
    netAmount: r.netAmount,
    remainAmount: r.remainAmount,
    link: r.link,
    projects: JSON.parse(r.projects),
  }));
  const failedSince = lastRun?.status === "error" && lastRun.startedAt > snap.fetchedAt;

  return {
    entity: target.id,
    entityName: target.name,
    entities,
    businessName: snap.businessName,
    source: snap.source as ArSource,
    asOf: snap.asOf,
    fetchedAt: snap.fetchedAt.toISOString(),
    invoices,
    projects: JSON.parse(snap.projects) as ProjectInfo,
    warnings: [...(JSON.parse(snap.warnings) as string[]), ...(target.provider === "netsuite" && lastNote?.note ? [lastNote.note] : [])],
    debug: { ...(JSON.parse(snap.debug) as ArDebug), servedFromCache: true },
    refreshing: isSyncing(target.id),
    syncError: failedSince ? { message: lastRun.error ?? "Unknown error", status: lastRun.errorStatus, at: (lastRun.finishedAt ?? lastRun.startedAt).toISOString() } : null,
    lastSync: lastRun ? { at: (lastRun.finishedAt ?? lastRun.startedAt).toISOString(), trigger: lastRun.trigger, status: lastRun.status, mode: lastRun.mode } : null,
  };
}

/** Removes everything stored for a tab (called when it's deleted in Settings). */
export async function deleteEntityData(entityId: string) {
  if (SAMPLE_MODE) return;
  await db.$transaction([
    db.arSnapshot.deleteMany({ where: { entityId } }), // invoices cascade
    db.syncRun.deleteMany({ where: { entityId } }),
    db.syncState.deleteMany({ where: { key: `ns:${entityId}` } }),
  ]);
}

/** Recent pulls, newest first (for the sync status API). */
export async function recentRuns(limit = 50) {
  if (SAMPLE_MODE) return sampleRuns((await listTargets()).targets, limit);
  return db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
}

