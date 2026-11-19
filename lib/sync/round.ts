import "server-only";
import { db } from "../db";
import { listTargets, syncEntity, type SyncTrigger, type Target } from "./ar-sync";
import { syncPnl } from "./pnl-sync";

/**
 * A round: every tab, one after another (NetSuite's and PEAK's limits are per account). For a PEAK company the
 * AR pull is followed by its profit & loss (this year's months that can have changed). Failures are recorded, not thrown.
 */
export async function syncAll(trigger: SyncTrigger, opts: { skip?: (t: Target) => string | null; pnlRecentMinAgeMs?: number } = {}) {
  const { entities, targets } = await listTargets();
  for (const t of targets) {
    const reason = opts.skip?.(t);
    if (reason) {
      await db.syncRun.create({ data: { entityId: t.id, provider: t.provider, trigger, status: "skipped", finishedAt: new Date(), note: reason } });
      continue;
    }
    await syncEntity(t, entities, trigger).catch(() => undefined);
    if (t.provider === "peak") await syncPnl(t, trigger, null, { recentMinAgeMs: opts.pnlRecentMinAgeMs }).catch(() => undefined);
  }
}
