import "server-only";
import { PeakError } from "../peak/client";
import { SAMPLE_MODE } from "../mode";
import { listTargets, syncEntity, type Target } from "./ar-sync";
import { syncPnl } from "./pnl-sync";
import { syncAll } from "./round";

// A pull the page asked for: Refresh, opening a tab whose data is old or missing, or Settings → "Pull now".
// Run by the Netlify background function (netlify/pull-background.ts) when deployed there, or in the app itself
// (POST /api/pull) when running as a normal server. Either way the PEAK / NetSuite keys are read from the saved
// settings here, on the server: the request names only the tab.

export interface PullRequest {
  kind: "ar" | "pnl" | "all";
  entity: string | null;
  /** P&L only: the year to read (default: this year). */
  year: number | null;
}

/** Reads ?kind=ar|pnl|all&entity=<id>&year=<yyyy>. Throws 400 on anything else. */
export function parsePullRequest(params: URLSearchParams): PullRequest {
  const kind = params.get("kind") ?? "ar";
  if (kind !== "ar" && kind !== "pnl" && kind !== "all") throw new PeakError(400, "kind must be ar, pnl or all.");
  const entity = params.get("entity");
  if (kind !== "all" && !entity) throw new PeakError(400, "entity is required.");
  const y = params.get("year");
  const year = y === null ? null : Number(y);
  if (year !== null && !(Number.isInteger(year) && year >= 2000 && year <= 2100)) throw new PeakError(400, "year must be a year, e.g. 2026.");
  return { kind, entity, year };
}

/**
 * Runs the pull and resolves when it ends. Never throws for a failed pull (that's recorded in SyncRun and shown by
 * the page); throws 404 for a tab that isn't in Settings. If the same pull is already running, returns at once.
 */
export async function runPull(req: PullRequest): Promise<void> {
  if (SAMPLE_MODE) return;
  if (req.kind === "all") return syncAll("api");

  const { entities, targets } = await listTargets();
  const target = targets.find((t) => t.id === req.entity);
  if (!target) throw new PeakError(404, "No such company in Settings.");

  if (req.kind === "ar") {
    await syncEntity(target, entities, "refresh", { ifBusy: "skip" }).catch(() => undefined);
    return;
  }
  if (target.provider !== "peak") throw new PeakError(400, "Profit & loss is only read from PEAK.");
  await syncPnl(target as Extract<Target, { provider: "peak" }>, "refresh", req.year, { ifBusy: "skip" }).catch(() => undefined);
}
