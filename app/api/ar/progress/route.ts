import { route } from "@/lib/peak/route-helpers";
import { isSyncing } from "@/lib/sync/ar-sync";
import { getSyncProgress } from "@/lib/sync/progress";

// GET /api/ar/progress?entity=<id> -> the running pull's steps (what it's doing now), for the loading bar.
// Reads in-memory state only; never calls PEAK / NetSuite.
export const GET = route(async (req) => {
  const entity = new URL(req.url).searchParams.get("entity") ?? "";
  const p = getSyncProgress(entity);
  if (!isSyncing(entity) || !p?.running) return { running: false };
  return { ...p, seconds: Math.round((Date.now() - p.startedAt) / 1000) };
});
