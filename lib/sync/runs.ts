import "server-only";
import { db } from "../db";
import { SAMPLE_MODE } from "../mode";
import type { SyncProgress } from "./progress";

// Pulls are tracked in the database (SyncRun), not in server memory, because on Netlify each request can land on a
// different function instance and pulls run in a separate background function (netlify/pull-background.ts).
//  - One pull per tab and kind at a time: claimRun() takes a Postgres advisory lock, checks for a running row and
//    creates one, all in one transaction, so two instances can't both start the same pull.
//  - A running pull saves its progress and a heartbeat on its row. A "running" row with no heartbeat for STALE_MS is
//    treated as dead (e.g. Netlify stopped the function at its time limit) and marked as failed.

export type RunKind = "ar" | "pnl";

/** A running pull that hasn't reported for this long is treated as dead. Longer than one slow NetSuite page (180 s). */
export const STALE_MS = 5 * 60_000;
const HEARTBEAT_MS = 20_000;
const SAVE_EVERY_MS = 1_500;
const DEAD_MESSAGE = "Stopped without finishing (the server ended it, e.g. at a time limit). The next pull starts over.";

const staleBefore = () => new Date(Date.now() - STALE_MS);

/** Marks dead "running" rows for a tab (or all tabs) as failed. */
async function reapDead(tx: Pick<typeof db, "syncRun">, where: { entityId?: string; kind?: RunKind }) {
  const cutoff = staleBefore();
  await tx.syncRun.updateMany({
    where: { ...where, status: "running", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }] },
    data: { status: "error", finishedAt: new Date(), error: DEAD_MESSAGE },
  });
}

/**
 * Starts tracking a pull: creates its "running" row, unless one is already running for this tab and kind
 * (then returns that row's id as `busy`).
 */
export async function claimRun(input: {
  entityId: string;
  provider: string;
  kind: RunKind;
  trigger: string;
  mode?: string | null;
}): Promise<{ runId: number } | { busy: number }> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`sync:${input.kind}:${input.entityId}`}))) AS l`;
    await reapDead(tx, { entityId: input.entityId, kind: input.kind });
    const busy = await tx.syncRun.findFirst({ where: { entityId: input.entityId, kind: input.kind, status: "running" }, select: { id: true } });
    if (busy) return { busy: busy.id };
    const run = await tx.syncRun.create({
      data: { ...input, mode: input.mode ?? null, status: "running", heartbeatAt: new Date() },
      select: { id: true },
    });
    return { runId: run.id };
  });
}

/** Waits for another instance's pull to end. Resolves if it succeeded; rejects with its error otherwise. */
export async function waitForRun(runId: number): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 2_000));
    await reapDead(db, {});
    const run = await db.syncRun.findUnique({ where: { id: runId }, select: { status: true, error: true } });
    if (!run || run.status === "ok" || run.status === "skipped") return;
    if (run.status === "error") throw new Error(run.error ?? "The pull failed.");
  }
}

/**
 * Saves a pull's progress on its row (at most every SAVE_EVERY_MS, plus a heartbeat every HEARTBEAT_MS while
 * nothing changes, e.g. during a long NetSuite page). Pass `onChange` to beginProgress(); call `stop()` at the end.
 */
export function progressSaver(runId: number): { onChange: (p: SyncProgress) => void; stop: () => Promise<void> } {
  let latest: SyncProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<unknown> = Promise.resolve();
  const write = () => {
    timer = null;
    const value = latest ? JSON.stringify(latest) : undefined;
    writing = writing
      .then(() => db.syncRun.update({ where: { id: runId }, data: { progress: value, heartbeatAt: new Date() } }))
      .catch(() => undefined); // progress is best effort; the pull itself must not fail on it
  };
  const heartbeat = setInterval(write, HEARTBEAT_MS);
  return {
    onChange(p) {
      latest = p;
      timer ??= setTimeout(write, SAVE_EVERY_MS);
    },
    async stop() {
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      write();
      await writing;
    },
  };
}

/** Whether a pull is running for this tab and kind (on any instance). */
export async function isRunning(entityId: string, kind: RunKind): Promise<boolean> {
  if (SAMPLE_MODE) return false;
  const cutoff = staleBefore();
  const n = await db.syncRun.count({ where: { entityId, kind, status: "running", heartbeatAt: { gte: cutoff } } });
  return n > 0;
}

export type ProgressView = (SyncProgress & { seconds: number; latestRunId: number }) | { running: false; latestRunId: number };

/**
 * For GET /api/ar/progress and /api/pnl/progress: the running pull's steps, or { running: false }. `latestRunId` is
 * the newest pull row for the tab (any status), so a page that asked for a pull can tell when one has come and gone.
 */
export async function readProgress(entityId: string, kind: RunKind): Promise<ProgressView> {
  if (SAMPLE_MODE || !entityId) return { running: false, latestRunId: 0 };
  const latest = await db.syncRun.findFirst({
    where: { entityId, kind },
    orderBy: { id: "desc" },
    select: { id: true, status: true, progress: true, heartbeatAt: true, startedAt: true, provider: true },
  });
  if (!latest) return { running: false, latestRunId: 0 };
  const alive = latest.status === "running" && (latest.heartbeatAt ?? latest.startedAt) >= staleBefore();
  if (!alive) return { running: false, latestRunId: latest.id };
  const p: SyncProgress = latest.progress
    ? (JSON.parse(latest.progress) as SyncProgress)
    : { running: true, provider: latest.provider as SyncProgress["provider"], startedAt: latest.startedAt.getTime(), finishedAt: null, steps: [], note: null };
  return { ...p, running: true, seconds: Math.round((Date.now() - latest.startedAt.getTime()) / 1000), latestRunId: latest.id };
}
