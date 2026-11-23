import { after } from "next/server";
import { route } from "@/lib/peak/route-helpers";
import { SAMPLE_MODE } from "@/lib/mode";
import { listTargets } from "@/lib/sync/ar-sync";
import { parsePullRequest, runPull } from "@/lib/sync/pull";

// POST /api/pull?kind=ar|pnl|all&entity=<id>[&year=yyyy] -> { started } at once; the pull runs after the response.
// Used when the app runs as a normal server (pnpm dev / next start). On Netlify the page calls the background
// function instead (netlify/pull-background.ts), which can run for 15 minutes. The page follows the pull through
// /api/ar/progress or /api/pnl/progress.
export const POST = route(async (req) => {
  const pull = parsePullRequest(new URL(req.url).searchParams);
  if (SAMPLE_MODE) return { started: false };
  if (pull.entity && !(await listTargets()).targets.some((t) => t.id === pull.entity)) return { started: false };
  after(() => runPull(pull).catch((e) => console.error("[pull]", e)));
  return { started: true };
});
