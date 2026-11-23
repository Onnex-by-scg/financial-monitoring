import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { ArDebug, ArEntity, ArInvoice, ArResponse, ArSource, ProjectInfo } from "../ar";
import { db } from "../db";
import { loadNetSuiteAr, nsCredKey, type NsSyncState } from "../netsuite/ar-source";
import { getArData as getPeakAr } from "../peak/ar-source";
import { hash, PeakError, type Company } from "../peak/client";
import { readSettings, resolveCompanies, type StoredNetSuite } from "../peak/settings-store";
import { beginProgress, SAVE_STEP } from "./progress";
import { getFetchPacing, getSyncConfig } from "./config";
import { claimRun, isRunning, progressSaver, waitForRun } from "./runs";
import { SAMPLE_MODE } from "../mode";
import { sampleRuns } from "../sample-runs";

// The sync service (AR part; profit & loss is lib/sync/pnl-sync.ts, whole rounds lib/sync/round.ts): pulls AR from
// PEAK / NetSuite and stores it in the database (lib/db.ts). The dashboard only reads the database (readAr).
// Pulls are requested by the page (Refresh, or opening a tab whose data is old or missing: lib/sync/pull.ts), and
// run on a schedule when the app runs as a long-lived server (lib/sync/scheduler.ts).
//
// One pull per tab at a time, across server instances (lib/sync/runs.ts). A failed pull keeps the last good data
// and is recorded in SyncRun, so the dashboard can say "showing data from <time>; the last update failed because …".

export type SyncTrigger = "schedule" | "refresh" | "first-load" | "api";

export type Target =
  | { provider: "peak"; id: string; name: string; company: Company; credKey: string }
  | { provider: "netsuite"; id: string; name: string; conn: StoredNetSuite; credKey: string };

/** Pulls started by this server instance (others are found through the database). */
const running = new Map<string, Promise<void>>();

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

/**
 * Starts a pull for one tab. If one is already running (here or on another instance), waits for it instead, or with
 * ifBusy "skip" returns at once. Resolves when it ends; rejects if it failed.
 */
export function syncEntity(target: Target, entities: ArEntity[], trigger: SyncTrigger, opts: { ifBusy?: "wait" | "skip" } = {}): Promise<void> {
  if (SAMPLE_MODE) return Promise.resolve(); // sample data is generated on read; nothing to pull
  const existing = running.get(target.id);
  if (existing) return opts.ifBusy === "skip" ? Promise.resolve() : existing;
  const p = (async () => {
    const claim = await claimRun({ entityId: target.id, provider: target.provider, kind: "ar", trigger });
    if ("busy" in claim) return opts.ifBusy === "skip" ? undefined : waitForRun(claim.busy);
    await runSync(target, entities, claim.runId);
  })().finally(() => running.delete(target.id));
  running.set(target.id, p);
  return p;
}

async function runSync(target: Target, entities: ArEntity[], runId: number): Promise<void> {
  const saver = progressSaver(runId);
  const progress = beginProgress(target.provider, saver.onChange);
  const run = { id: runId };
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
      const prev = parsed?.credKey === target.credKey ? parsed.state : await legacyNsState(target.id, target.credKey);
      const result = await loadNetSuiteAr(target.conn, entities, prev, progress, pacing.pageWaitMs);
      data = result.data;
      mode = result.data.debug.sync?.mode ?? null;
      await db.syncState.upsert({
        where: { key: stateKey },
        create: { key: stateKey, value: JSON.stringify({ credKey: target.credKey, state: result.sync }) },
        update: { value: JSON.stringify({ credKey: target.credKey, state: result.sync }) },
      });
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
    await saver.stop();
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
 * The dashboard's read: the tab's data from the database. Never calls PEAK / NetSuite. If the tab has nothing saved
 * yet (or its credentials changed), throws 404 "not_pulled" (with the last pull's error, if it failed); the page then
 * asks for a pull. `autoPull` tells the page the saved data is older than Settings → Data sync allows.
 */
export async function readAr(entityId: string | null): Promise<ArResponse> {
  const { entities, targets } = await listTargets();
  if (!targets.length) throw new PeakError(409, "No company is connected yet. Open Settings to connect PEAK or NetSuite.", "not_configured");
  const target = targets.find((t) => t.id === entityId) ?? targets[0];

  const snap = await db.arSnapshot.findUnique({ where: { entityId: target.id } });
  if (!snap || snap.credKey !== target.credKey) {
    const last = await db.syncRun.findFirst({ where: { entityId: target.id, kind: "ar" }, orderBy: { id: "desc" } });
    const failed = last?.status === "error" ? last : null;
    throw Object.assign(new PeakError(404, failed?.error ?? "Nothing saved for this company yet.", "not_pulled"), {
      entity: target.id,
      lastFailedAt: failed ? (failed.finishedAt ?? failed.startedAt).toISOString() : null,
    });
  }

  const [rows, lastRun, refreshing, config] = await Promise.all([
    db.arInvoice.findMany({ where: { entityId: target.id }, orderBy: { id: "asc" } }),
    db.syncRun.findFirst({ where: { entityId: target.id, kind: "ar", status: { in: ["ok", "error"] } }, orderBy: { startedAt: "desc" } }),
    isRunning(target.id, "ar"),
    getSyncConfig(),
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
  // Old = the last attempt (good or failed) is older than the setting, so a failing source isn't retried on every visit.
  const lastTry = Math.max(snap.fetchedAt.getTime(), (lastRun?.finishedAt ?? lastRun?.startedAt)?.getTime() ?? 0);
  const autoPull = !refreshing && config.autoPullMinutes > 0 && Date.now() - lastTry > config.autoPullMinutes * 60_000;

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
    warnings: JSON.parse(snap.warnings) as string[],
    debug: { ...(JSON.parse(snap.debug) as ArDebug), servedFromCache: true },
    refreshing,
    autoPull,
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
  await fs.rm(legacyFile(entityId), { force: true }).catch(() => undefined);
}

/** Recent pulls, newest first (for the sync status API). */
export async function recentRuns(limit = 50) {
  if (SAMPLE_MODE) return sampleRuns((await listTargets()).targets, limit);
  return db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: limit, omit: { progress: true, heartbeatAt: true } });
}

// ---- One-off: reuse the update state from the old disk cache (.peak/cache/netsuite-<id>.json), so the first
// pull after switching to the database is an update instead of a full read. ----
const legacyFile = (id: string) => path.join(process.cwd(), ".peak", "cache", `netsuite-${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);

async function legacyNsState(id: string, credKey: string): Promise<NsSyncState | null> {
  try {
    const c = JSON.parse(await fs.readFile(legacyFile(id), "utf8")) as { key?: string; sync?: NsSyncState };
    return c.key === credKey && c.sync ? c.sync : null;
  } catch {
    return null;
  }
}
