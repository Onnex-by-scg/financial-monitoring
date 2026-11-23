import { route } from "@/lib/peak/route-helpers";
import { isPnlSyncing, pnlProgressKey } from "@/lib/sync/pnl-sync";
import { getSyncProgress } from "@/lib/sync/progress";

// GET /api/pnl/progress?entity=<id> -> the running profit & loss pull's steps, for the loading bar.
// Reads in-memory state only; never calls PEAK.
export const GET = route(async (req) => {
  const entity = new URL(req.url).searchParams.get("entity") ?? "";
  const p = getSyncProgress(pnlProgressKey(entity));
  if (!isPnlSyncing(entity) || !p?.running) return { running: false };
  return { ...p, seconds: Math.round((Date.now() - p.startedAt) / 1000) };
});
