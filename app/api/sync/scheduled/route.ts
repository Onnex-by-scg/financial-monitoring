import { route } from "@/lib/peak/route-helpers";
import { PeakError } from "@/lib/peak/client";
import { runScheduledRound } from "@/lib/sync/scheduler";

// POST /api/sync/scheduled -> run one scheduled round if one is due, and answer when it has finished.
// Called only by the Cloudflare Cron Trigger (worker.ts), from inside the same Worker: worker.ts puts a fresh
// random token on globalThis for each cron run and sends it in a header, so a request from outside can't
// start a round (it can't know the token, and outside a cron run there is none).
export const POST = route(async (req) => {
  const expected = (globalThis as { __cronToken?: string }).__cronToken;
  if (!expected || req.headers.get("x-cron-token") !== expected) throw new PeakError(403, "Only the scheduler can call this.");
  return runScheduledRound();
});
