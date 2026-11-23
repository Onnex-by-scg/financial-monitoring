import "server-only";
import { db } from "../db";
import { SAMPLE_MODE } from "../mode";
import { SERVERLESS } from "../runtime";
import { isSyncing } from "./ar-sync";
import { isPnlSyncing, pnlProgressKey } from "./pnl-sync";
import { getSyncProgress, type SyncProgress } from "./progress";

// What GET /api/ar/progress and /api/pnl/progress answer.
//
// The step-by-step progress lives in the memory of the server instance running the pull. On Netlify the page's
// progress check often lands on another instance, which knows nothing about it. So the answer also comes from the
// pull history in the database (SyncRun):
//  - a pull recorded as running (and started recently) counts as running, without step details;
//  - `lastFinishedAt` is when the tab's newest pull of this kind ended, so the page can tell its pull has finished
//    even if it never saw it running.

/**
 * A "running" row older than this is a pull that was cut off, not a live one. On Netlify (AWS Lambda underneath) a
 * request, and the pull it started, is stopped within a minute; a long-lived server lets a full NetSuite read run longer.
 */
const RUNNING_FOR_AT_MOST_MS = SERVERLESS ? 2 * 60_000 : 15 * 60_000;

export type ProgressAnswer = (SyncProgress & { seconds: number; lastFinishedAt: string | null }) | { running: false; lastFinishedAt: string | null };

export async function progressFor(entity: string, kind: "ar" | "pnl"): Promise<ProgressAnswer> {
  if (SAMPLE_MODE || !entity) return { running: false, lastFinishedAt: null };
  const [latest, finished] = await Promise.all([
    db.syncRun.findFirst({ where: { entityId: entity, kind }, orderBy: { id: "desc" }, select: { status: true, startedAt: true, provider: true } }),
    db.syncRun.findFirst({ where: { entityId: entity, kind, status: { in: ["ok", "error"] } }, orderBy: { id: "desc" }, select: { finishedAt: true, startedAt: true } }),
  ]);
  const lastFinishedAt = finished ? (finished.finishedAt ?? finished.startedAt).toISOString() : null;

  // This instance runs the pull: full step-by-step progress.
  const local = kind === "ar" ? (isSyncing(entity) ? getSyncProgress(entity) : null) : isPnlSyncing(entity) ? getSyncProgress(pnlProgressKey(entity)) : null;
  if (local?.running) return { ...local, seconds: Math.round((Date.now() - local.startedAt) / 1000), lastFinishedAt };

  // Another instance runs it: running, without step details.
  if (latest?.status === "running" && Date.now() - latest.startedAt.getTime() < RUNNING_FOR_AT_MOST_MS) {
    const startedAt = latest.startedAt.getTime();
    return {
      running: true,
      provider: latest.provider as SyncProgress["provider"],
      startedAt,
      finishedAt: null,
      steps: [],
      note: null,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      lastFinishedAt,
    };
  }
  return { running: false, lastFinishedAt };
}
