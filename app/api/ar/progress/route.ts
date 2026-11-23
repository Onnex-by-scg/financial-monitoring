import { route } from "@/lib/peak/route-helpers";
import { progressFor } from "@/lib/sync/progress-view";

// GET /api/ar/progress?entity=<id> -> the running pull's steps (what it's doing now), for the loading bar, plus
// when the tab's last pull finished (lib/sync/progress-view.ts). Never calls PEAK / NetSuite.
export const GET = route(async (req) => progressFor(new URL(req.url).searchParams.get("entity") ?? "", "ar"));
