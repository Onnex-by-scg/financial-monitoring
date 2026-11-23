import { route } from "@/lib/peak/route-helpers";
import { progressFor } from "@/lib/sync/progress-view";

// GET /api/pnl/progress?entity=<id> -> the running profit & loss pull's steps, for the loading bar, plus when the
// company's last P&L pull finished (lib/sync/progress-view.ts). Never calls PEAK.
export const GET = route(async (req) => progressFor(new URL(req.url).searchParams.get("entity") ?? "", "pnl"));
