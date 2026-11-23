import { route } from "@/lib/peak/route-helpers";
import { readProgress } from "@/lib/sync/runs";

// GET /api/ar/progress?entity=<id> -> the running pull's steps (what it's doing now), for the loading bar, or
// { running: false }. Read from the database, so it works whichever server instance runs the pull. Never calls PEAK / NetSuite.
export const GET = route(async (req) => readProgress(new URL(req.url).searchParams.get("entity") ?? "", "ar"));
