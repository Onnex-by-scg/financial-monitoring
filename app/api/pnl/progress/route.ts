import { route } from "@/lib/peak/route-helpers";
import { readProgress } from "@/lib/sync/runs";

// GET /api/pnl/progress?entity=<id> -> the running profit & loss pull's steps, for the loading bar, or
// { running: false }. Read from the database. Never calls PEAK.
export const GET = route(async (req) => readProgress(new URL(req.url).searchParams.get("entity") ?? "", "pnl"));
