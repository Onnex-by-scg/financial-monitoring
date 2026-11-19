import { route } from "@/lib/peak/route-helpers";
import { isSyncing, listTargets, recentRuns, syncEntity } from "@/lib/sync/ar-sync";
import { isPnlSyncing, syncPnl } from "@/lib/sync/pnl-sync";
import { syncAll } from "@/lib/sync/round";
import { getSyncConfig, scheduleBlockedBy } from "@/lib/sync/config";
import { nextRoundAt } from "@/lib/sync/scheduler";

// GET  /api/sync               -> sync status: schedule, next round, each tab (running?) and the last 50 pulls.
// POST /api/sync[?entity=<id>] -> start a pull now (one tab, or all tabs one after another). Returns at once.
// Same-origin only (route()), and the server binds to 127.0.0.1.
export const GET = route(async () => {
  const [{ targets }, config, next] = await Promise.all([listTargets().catch(() => ({ targets: [] })), getSyncConfig(), nextRoundAt()]);
  return {
    config,
    blockedBy: scheduleBlockedBy(),
    nextRunAt: next ? new Date(next).toISOString() : null,
    tabs: targets.map((t) => ({ id: t.id, name: t.name, provider: t.provider, running: isSyncing(t.id) || isPnlSyncing(t.id) })),
    runs: await recentRuns(),
  };
});

export const POST = route(async (req) => {
  const entity = new URL(req.url).searchParams.get("entity");
  const { entities, targets } = await listTargets();
  if (entity) {
    const t = targets.find((x) => x.id === entity);
    if (!t) return { started: false, error: "Unknown tab" };
    void syncEntity(t, entities, "api")
      .catch(() => undefined)
      .then(() => (t.provider === "peak" ? syncPnl(t, "api", null) : undefined))
      .catch(() => undefined);
    return { started: true, tabs: [t.id] };
  }
  void syncAll("api");
  return { started: true, tabs: targets.map((t) => t.id) };
});
